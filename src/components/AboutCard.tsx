/**
 * AboutCard — 通用卡片容器 (M3.7)。
 *
 * M3.7 之前每个页面 inline 写自己的"卡片样式"(border + radius + bg-elevated
 * + padding + box-shadow)。关于页有 4 个分区,如果继续 inline 会出现 4 份
 * 重复样式,改一个 token 要改 4 处。
 *
 * 设计原则:
 *   - 单一样式源(此处),所有卡片都用 AboutCard 包。
 *   - 通过 children 传入任意内容(分区 / 列表 / 引用)。
 *   - 提供可选 title + description 渲染(分区用)。
 *   - 视觉一致:复用了 F8 时代确立的 card 样式(2026-06-26 删 F8 后保留)。
 *
 * 不引入 Tailwind 类(项目无 Tailwind 管线,见 CLAUDE.md §2.4)。
 */
import type { ReactElement, ReactNode } from 'react';

export interface AboutCardProps {
  /** 测试 id,默认 `about-card`。 */
  testId?: string;
  /** 分区标题(可选),渲染为 h2。 */
  title?: string;
  /** 分区副标题(可选),渲染为 p。 */
  description?: string;
  /** 卡片内容。 */
  children: ReactNode;
}

/**
 * AboutCard — 渲染一个关于页分区的卡片容器。
 *
 * @example
 *   <AboutCard testId="about-version-section" title="版本信息">
 *     <dl>...</dl>
 *   </AboutCard>
 */
export function AboutCard({
  testId,
  title,
  description,
  children,
}: AboutCardProps): ReactElement {
  return (
    <section
      data-testid={testId ?? 'about-card'}
      style={{
        marginBottom: 24,
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
        padding: 16,
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      {title && (
        <h2
          style={{
            color: 'var(--text-primary)',
            fontSize: 16,
            fontWeight: 600,
            margin: '0 0 4px 0',
          }}
        >
          {title}
        </h2>
      )}
      {description && (
        <p
          style={{
            color: 'var(--text-secondary)',
            fontSize: 12,
            margin: '0 0 12px 0',
          }}
        >
          {description}
        </p>
      )}
      {children}
    </section>
  );
}

export default AboutCard;
