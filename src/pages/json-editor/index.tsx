/**
 * F5 — JSON 编辑器 (M1.9 placeholder).
 * Real implementation: hand-rolled syntax-highlight editor with
 * 200ms-debounce validation, Ctrl+Shift+F format, token mask toggle.
 * See SPEC §3.1 F5 + §5.4.
 */
import type { ReactElement } from 'react';
import { PluginPlaceholder } from '../../components/PluginPlaceholder';

export default function JsonEditorPage(): ReactElement {
  return (
    <PluginPlaceholder
      pluginId="json-editor"
      title="JSON 编辑器"
      description="可视化 JSON 编辑器：语法高亮 + 校验 + 格式化 + token 遮罩。"
    />
  );
}
