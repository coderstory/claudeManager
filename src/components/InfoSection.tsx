/**
 * InfoSection — 关于页 key-value 列表分区 (M3.7)。
 *
 * 渲染 `<dl>` 列表,label-value 对布局(沿用 F8 时代的 MetaRow 模式
 * 但拆成 2 列网格以适配关于页 5-6 项 key-value 不滚动的场景)。
 *
 * 不引入 Tailwind 类(项目无 Tailwind 管线,见 CLAUDE.md §2.4)。
 */
import type { ReactElement } from 'react';

export interface InfoItem {
  /** 测试 id,默认 `info-row-<index>`。 */
  testId?: string;
  /** 字段标签,如"版本号"。 */
  label: string;
  /** 字段值,如"0.1.0"。 */
  value: string;
  /** 等宽字体(mono)开关,版本号 / hash / 标识符用。 */
  mono?: boolean;
}

export interface InfoSectionProps {
  /** 列表项。 */
  items: ReadonlyArray<InfoItem>;
}

export function InfoSection({ items }: InfoSectionProps): ReactElement {
  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        columnGap: 24,
        rowGap: 8,
        margin: 0,
      }}
    >
      {items.map((it, i) => (
        <div
          key={`${it.label}-${i}`}
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 12,
          }}
        >
          <dt
            style={{
              width: 80,
              flexShrink: 0,
              color: 'var(--text-muted)',
              fontSize: 12,
            }}
          >
            {it.label}
          </dt>
          <dd
            data-testid={it.testId ?? `info-row-${i}`}
            style={{
              color: 'var(--text-primary)',
              fontSize: 14,
              fontFamily: it.mono ? 'var(--font-mono)' : 'inherit',
              fontVariantNumeric: it.mono ? 'tabular-nums' : 'normal',
              margin: 0,
              wordBreak: 'break-word',
            }}
          >
            {it.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default InfoSection;
