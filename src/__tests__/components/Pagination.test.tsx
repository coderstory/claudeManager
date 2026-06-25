/**
 * Pagination component unit tests (M5 #31).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Pagination } from '../../components/Pagination';

describe('Pagination — M5 #31', () => {
  it('hides when there is only one page', () => {
    const { container } = render(
      <Pagination total={5} page={0} onPageChange={() => undefined} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('hides when total is zero', () => {
    const { container } = render(
      <Pagination total={0} page={0} onPageChange={() => undefined} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders prev / next buttons + indicator when multiple pages', () => {
    render(<Pagination total={50} page={0} pageSize={20} onPageChange={() => undefined} />);
    expect(screen.getByTestId('pagination')).toBeInTheDocument();
    expect(screen.getByTestId('pagination-prev')).toBeDisabled();
    expect(screen.getByTestId('pagination-next')).not.toBeDisabled();
    expect(screen.getByTestId('pagination-indicator').textContent).toContain(
      '第 1 / 3 页',
    );
    expect(screen.getByTestId('pagination-indicator').textContent).toContain(
      '共 50 条',
    );
  });

  it('clicking next calls onPageChange with page + 1', () => {
    const onPageChange = vi.fn();
    render(
      <Pagination
        total={50}
        page={0}
        pageSize={20}
        onPageChange={onPageChange}
      />,
    );
    fireEvent.click(screen.getByTestId('pagination-next'));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('clicking prev calls onPageChange with page - 1', () => {
    const onPageChange = vi.fn();
    render(
      <Pagination
        total={50}
        page={2}
        pageSize={20}
        onPageChange={onPageChange}
      />,
    );
    fireEvent.click(screen.getByTestId('pagination-prev'));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('disables next on the last page', () => {
    render(
      <Pagination
        total={50}
        page={2}
        pageSize={20}
        onPageChange={() => undefined}
      />,
    );
    expect(screen.getByTestId('pagination-next')).toBeDisabled();
    expect(screen.getByTestId('pagination-prev')).not.toBeDisabled();
  });

  it('respects custom testIdPrefix', () => {
    render(
      <Pagination
        total={50}
        page={0}
        pageSize={20}
        onPageChange={() => undefined}
        testIdPrefix="usage-pagination"
      />,
    );
    expect(screen.getByTestId('usage-pagination')).toBeInTheDocument();
    expect(screen.getByTestId('usage-pagination-next')).toBeInTheDocument();
  });
});