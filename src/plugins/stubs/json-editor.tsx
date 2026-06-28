/**
 * F5 — JSON 编辑器 (Phase 44: full FrontendPlugin).
 *
 * Q44-4: routes 字段填 `/json` placeholder path (M1.9 设想为 modal,
 * M2+ 实现为独立 page)。
 */
import React from 'react';
import type { FrontendPlugin } from '../types';
import { PluginPlaceholder } from './_Placeholder';
import { PencilLine } from 'lucide-react';
import JsonEditorPage from '../../pages/json-editor';

const JsonEditorPageStub: React.FC = () => (
  <PluginPlaceholder pluginId="json-editor" displayName="JSON 编辑器" />
);

export const jsonEditorPlugin: FrontendPlugin = {
  id: 'json-editor',
  name: 'JSON 编辑器',
  viewId: 'json-editor',
  sidebarTile: {
    icon: PencilLine,
    short: 'JSON 编辑器',
    order: 3,
    group: 'main',
  },
  pageMeta: {
    title: 'JSON 编辑器',
    description: '可视化 JSON 编辑器：语法高亮 + 校验 + 格式化 + token 遮罩。',
  },
  componentEntry: {
    component: JsonEditorPage as unknown as React.ComponentType,
    propsBuilder: () => ({}),
  },
  // Q44-4: 填 `/json` placeholder path, 引用真实 page (非 _Placeholder)
  routes: [
    {
      path: '/json',
      component: JsonEditorPageStub,
      pluginId: 'json-editor',
      displayName: 'JSON 编辑器',
    },
  ],
};