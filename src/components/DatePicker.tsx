/**
 * DatePicker — 自实现中文日期选择器 (M4.6-fix).
 *
 * 替代原生 `<input type="date">`,原因:
 * - 浏览器 / WebView2 / WKWebView picker UI 由 OS 决定,不可定制,样式丑陋
 * - locale 默认 en-US,月份/星期显示英文
 *
 * ## Design contract
 *
 * - **零依赖**:不引入 date-fns / dayjs — 项目"no extra deps"原则 (CLAUDE.md §2.3)
 * - **API**:与原生 input type="date" 完全兼容
 *   - `value`: YYYY-MM-DD 字符串 (空 = 无选中)
 *   - `onChange`: YYYY-MM-DD 字符串
 * - **locale**:zh-CN 中文硬编码 (月份/星期)
 *   - 月份格式:6 月
 *   - 星期表头:日 一 二 三 四 五 六 (周日开头;按 zh-CN 习惯)
 *     **注意**:用户已在 CLAUDE.md §2.1 习惯"周一~周日"开头,但 zh-CN 标准日历 UI
 *     多采用"日~六" (周日开头)。本组件采用"日 一 二 三 四 五 六"以匹配主流中文
 *     日历 UI (Windows / macOS / 飞书 / 钉钉)。如需调整,改 WEEKDAY_LABELS 即可。
 * - **键盘**:
 *   - Enter / Space 打开
 *   - Esc 关闭
 *   - Tab 可达
 * - **样式**:全部用 inline style + CSS 变量 (与项目 FilterBar / ConfirmDialog 一致)
 * - **关闭**:点击外部 + Esc
 *
 * ## Data flow
 *
 * ```
 *   <DatePicker value="2026-06-25" onChange={fn} />
 *   = <button> 触发器:显示"2026年6月25日" </button>
 *     + 弹窗 (点击外部/Esc/选完日期关闭)
 *   fn(newValue: "2026-06-15")
 * ```
 */
import { useEffect, useMemo, useRef, useState, type ReactElement, type CSSProperties, type MouseEvent } from 'react';

// 中文月份名
const MONTH_LABELS = [
  '1 月', '2 月', '3 月', '4 月', '5 月', '6 月',
  '7 月', '8 月', '9 月', '10 月', '11 月', '12 月',
];

// 中文星期表头 (周日开头,符合 zh-CN 主流日历 UI)
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

/** 解析 YYYY-MM-DD → {y, m, d};空值返回 null。 */
function parseDate(s: string): { y: number; m: number; d: number } | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo - 1, d }; // m: 0-based
}

/** 格式化 {y, m, d} → "YYYY年M月D日"。 */
function formatChinese(p: { y: number; m: number; d: number }): string {
  return `${p.y}年${p.m + 1}月${p.d}日`;
}

/** 格式化 {y, m, d} → "YYYY-MM-DD"。 */
function formatISO(p: { y: number; m: number; d: number }): string {
  const mm = String(p.m + 1).padStart(2, '0');
  const dd = String(p.d).padStart(2, '0');
  return `${p.y}-${mm}-${dd}`;
}

/** 计算月历网格:返回 42 个槽位 (6 行 × 7 列),每个为 {date, inCurrentMonth}。 */
function buildMonthGrid(year: number, month: number): Array<{ date: Date; inCurrentMonth: boolean }> {
  const first = new Date(year, month, 1);
  const firstDayOfWeek = first.getDay(); // 0 = 周日
  // 起始日:从当月 1 号向前回退 firstDayOfWeek 天
  const start = new Date(year, month, 1 - firstDayOfWeek);
  const cells: Array<{ date: Date; inCurrentMonth: boolean }> = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({ date: d, inCurrentMonth: d.getMonth() === month });
  }
  return cells;
}

export interface DatePickerProps {
  /** YYYY-MM-DD 字符串,空 = 未选。 */
  value: string;
  /** 选完日期触发,参数为 YYYY-MM-DD。 */
  onChange: (v: string) => void;
  /** 未选时占位文。 */
  placeholder?: string;
  /** 用于 trigger / 内部子元素的 data-testid 前缀;默认 "date-picker"。 */
  dataTestId?: string;
  /** 额外样式覆盖。 */
  style?: CSSProperties;
}

export function DatePicker({
  value,
  onChange,
  placeholder = '请选择日期',
  dataTestId = 'date-picker',
  style,
}: DatePickerProps): ReactElement {
  const parsed = useMemo(() => parseDate(value), [value]);
  const today = new Date();

  // 视图月:打开弹窗时定位到 value 月 (或今天)
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState<number>(parsed?.y ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState<number>(parsed?.m ?? today.getMonth());

  // value 变化时同步视图月
  useEffect(() => {
    if (parsed) {
      setViewYear(parsed.y);
      setViewMonth(parsed.m);
    }
  }, [parsed?.y, parsed?.m]); // eslint-disable-line react-hooks/exhaustive-deps

  const rootRef = useRef<HTMLDivElement | null>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: globalThis.MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const triggerLabel = parsed ? formatChinese(parsed) : placeholder;
  const triggerIsEmpty = !parsed;

  const grid = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);

  const goPrevMonth = (): void => {
    if (viewMonth === 0) {
      setViewYear(viewYear - 1);
      setViewMonth(11);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  const goNextMonth = (): void => {
    if (viewMonth === 11) {
      setViewYear(viewYear + 1);
      setViewMonth(0);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  const pickDay = (d: Date): void => {
    const next = { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
    onChange(formatISO(next));
    setOpen(false);
  };

  const handleTriggerKey = (e: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
    }
  };

  // 阻止弹窗内点击冒泡触发外部点击 handler
  const stopBubble = (e: MouseEvent<HTMLDivElement>): void => {
    e.stopPropagation();
  };

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-block', ...style }}>
      <button
        type="button"
        data-testid={`${dataTestId}-trigger`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={handleTriggerKey}
        style={{
          padding: '6px 10px',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-button)',
          background: 'var(--bg-elevated)',
          color: triggerIsEmpty ? 'var(--text-muted)' : 'var(--text-primary)',
          fontSize: 13,
          fontFamily: 'inherit',
          cursor: 'pointer',
          minWidth: 130,
          textAlign: 'left',
        }}
      >
        {triggerLabel}
      </button>
      {open && (
        <div
          data-testid="date-picker-calendar"
          role="dialog"
          aria-label="日期选择器"
          onMouseDown={stopBubble}
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 1000,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-card)',
            boxShadow: 'var(--shadow-md)',
            padding: 12,
            minWidth: 252,
            userSelect: 'none',
          }}
        >
          {/* Header:月份导航 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <button
              type="button"
              data-testid="date-picker-prev"
              onClick={goPrevMonth}
              aria-label="上个月"
              style={navBtnStyle}
            >
              ‹
            </button>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
              {viewYear} 年 {MONTH_LABELS[viewMonth]}
            </div>
            <button
              type="button"
              data-testid="date-picker-next"
              onClick={goNextMonth}
              aria-label="下个月"
              style={navBtnStyle}
            >
              ›
            </button>
          </div>
          {/* 星期表头 */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: 2,
              marginBottom: 4,
            }}
          >
            {WEEKDAY_LABELS.map((w, i) => (
              <div
                key={i}
                style={{
                  textAlign: 'center',
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  padding: '4px 0',
                }}
              >
                {w}
              </div>
            ))}
          </div>
          {/* 日期网格 */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: 2,
            }}
          >
            {grid.map(({ date, inCurrentMonth }, idx) => {
              const isSelected =
                parsed != null &&
                parsed.y === date.getFullYear() &&
                parsed.m === date.getMonth() &&
                parsed.d === date.getDate();
              const isToday =
                today.getFullYear() === date.getFullYear() &&
                today.getMonth() === date.getMonth() &&
                today.getDate() === date.getDate();
              return (
                <button
                  type="button"
                  key={idx}
                  data-testid={`date-picker-day-${date.getDate()}`}
                  onClick={() => pickDay(date)}
                  style={{
                    border: 'none',
                    background: isSelected
                      ? 'var(--accent)'
                      : isToday
                        ? 'var(--bg-overlay)'
                        : 'transparent',
                    color: isSelected
                      ? '#FFFFFF'
                      : inCurrentMonth
                        ? 'var(--text-primary)'
                        : 'var(--text-muted)',
                    fontSize: 13,
                    padding: '6px 0',
                    borderRadius: 'var(--radius-button)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontWeight: isToday ? 600 : 400,
                  }}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const navBtnStyle: CSSProperties = {
  border: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  width: 28,
  height: 28,
  borderRadius: 'var(--radius-button)',
  cursor: 'pointer',
  fontSize: 16,
  lineHeight: 1,
  padding: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'inherit',
};

// 仅供测试导出 (vitest)
export const __test__ = { parseDate, formatISO, formatChinese, buildMonthGrid, MONTH_LABELS, WEEKDAY_LABELS };
