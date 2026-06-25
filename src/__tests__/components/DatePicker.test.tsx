/**
 * DatePicker — TDD coverage (M4.6-fix).
 *
 * Tests the 7 contracts documented in DatePicker.tsx:
 *   1. Renders formatted Chinese date when value is set.
 *   2. Shows placeholder when value is empty.
 *   3. Opens calendar popover on trigger click.
 *   4. Month navigation (prev/next) works.
 *   5. Clicking a day fires onChange with YYYY-MM-DD and closes.
 *   6. Locale is zh-CN (months / weekdays render in Chinese).
 *   7. Trigger is a keyboard-accessible <button> (Tab + Enter/Space open it).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DatePicker } from '../../components/DatePicker';

afterEach(() => {
  cleanup();
});

describe('DatePicker', () => {
  it('渲染中文格式日期当 value 已设置', () => {
    render(<DatePicker value="2026-06-25" onChange={vi.fn()} dataTestId="dp" />);
    // 触发器按钮应显示中文日期 (不依赖具体格式:必须含"2026"+"6"+"25"中的中文数字/分隔)
    const trigger = screen.getByTestId('dp-trigger');
    expect(trigger).toBeInTheDocument();
    // 格式约定:YYYY 年 M 月 D 日 — 断言包含关键中文标记
    const text = trigger.textContent ?? '';
    expect(text).toMatch(/2026/);
    expect(text).toMatch(/6/);
    expect(text).toMatch(/25/);
    expect(text).toMatch(/年|月|日/); // 中文格式标记
  });

  it('显示占位文当 value 为空', () => {
    render(<DatePicker value="" onChange={vi.fn()} dataTestId="dp" />);
    const trigger = screen.getByTestId('dp-trigger');
    expect(trigger).toHaveTextContent(/请选择/);
  });

  it('点击触发器打开日历弹窗', async () => {
    const user = userEvent.setup();
    render(<DatePicker value="2026-06-25" onChange={vi.fn()} dataTestId="dp" />);
    // 弹窗默认应不存在
    expect(screen.queryByTestId('date-picker-calendar')).toBeNull();
    await user.click(screen.getByTestId('dp-trigger'));
    // 点击后应出现日历
    expect(screen.getByTestId('date-picker-calendar')).toBeInTheDocument();
  });

  it('月份导航:下个月按钮切换月份', async () => {
    const user = userEvent.setup();
    render(<DatePicker value="2026-06-25" onChange={vi.fn()} dataTestId="dp" />);
    await user.click(screen.getByTestId('dp-trigger'));
    // 弹窗标题应包含 2026 6 月
    const calendar = screen.getByTestId('date-picker-calendar');
    expect(calendar.textContent).toMatch(/2026/);
    expect(calendar.textContent).toMatch(/6\s*月/);
    // 点击下个月
    await user.click(screen.getByTestId('date-picker-next'));
    expect(calendar.textContent).toMatch(/7\s*月/);
    // 点击上个月回到 6 月
    await user.click(screen.getByTestId('date-picker-prev'));
    expect(calendar.textContent).toMatch(/6\s*月/);
  });

  it('点选某天触发 onChange 收到 YYYY-MM-DD 并关闭弹窗', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DatePicker value="2026-06-25" onChange={onChange} dataTestId="dp" />);
    await user.click(screen.getByTestId('dp-trigger'));
    // 找到 "15" 这一天
    const day15 = screen.getByTestId('date-picker-day-15');
    await user.click(day15);
    expect(onChange).toHaveBeenCalledWith('2026-06-15');
    // 弹窗关闭
    expect(screen.queryByTestId('date-picker-calendar')).toBeNull();
  });

  it('locale 显示中文:月份 + 星期', async () => {
    const user = userEvent.setup();
    render(<DatePicker value="2026-06-25" onChange={vi.fn()} dataTestId="dp" />);
    await user.click(screen.getByTestId('dp-trigger'));
    const calendar = screen.getByTestId('date-picker-calendar');
    const text = calendar.textContent ?? '';
    // 月份中文:"6 月"
    expect(text).toMatch(/6\s*月/);
    // 星期中文:必须出现"日"和"一" (周日/周一 缩写)
    // 严格断言:不能出现英文 June / Mon / Tue / Wed / Thu / Fri / Sat / Sun
    expect(text).not.toMatch(/\bJune\b/);
    expect(text).not.toMatch(/\bMon\b/);
    expect(text).not.toMatch(/\bTue\b/);
    expect(text).not.toMatch(/\bWed\b/);
    expect(text).not.toMatch(/\bThu\b/);
    expect(text).not.toMatch(/\bFri\b/);
    expect(text).not.toMatch(/\bSat\b/);
    expect(text).not.toMatch(/\bSun\b/);
    // 至少包含一个中文星期标记
    expect(text).toMatch(/[一二三四五六日]/);
  });

  it('键盘可访问:trigger 是 button 且 Enter 键能打开弹窗', async () => {
    const user = userEvent.setup();
    render(<DatePicker value="2026-06-25" onChange={vi.fn()} dataTestId="dp" />);
    const trigger = screen.getByTestId('dp-trigger');
    expect(trigger.tagName).toBe('BUTTON');
    trigger.focus();
    expect(trigger).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('date-picker-calendar')).toBeInTheDocument();
    // Esc 关闭
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('date-picker-calendar')).toBeNull();
  });
});
