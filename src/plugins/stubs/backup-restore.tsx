/**
 * F19 — 备份与恢复 (Phase 44: full FrontendPlugin).
 */
import React from 'react';
import type { FrontendPlugin } from '../types';
import { PluginPlaceholder } from './_Placeholder';
import { Archive } from 'lucide-react';
import BackupRestorePage from '../../pages/backup-restore';

const BackupRestorePageStub: React.FC = () => (
  <PluginPlaceholder pluginId="backup-restore" displayName="备份与恢复" />
);

export const backupRestorePlugin: FrontendPlugin = {
  id: 'backup-restore',
  name: '备份与恢复',
  viewId: 'backup-restore',
  sidebarTile: {
    icon: Archive,
    short: '备份与恢复',
    order: 9,
    group: 'main',
  },
  pageMeta: {
    title: '备份与恢复',
    description: '最近 N 个 settings.json 版本时间线 + 字段级 diff + 一键回滚。',
  },
  componentEntry: {
    component: BackupRestorePage as unknown as React.ComponentType,
    propsBuilder: () => ({}),
  },
  routes: [
    {
      path: '/backup',
      component: BackupRestorePageStub,
      pluginId: 'backup-restore',
      displayName: '备份与恢复',
    },
  ],
};