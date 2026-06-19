/**
 * F19 — 备份与恢复 (stub).
 */
import React from 'react';
import type { FrontendPlugin } from '../types';
import { PluginPlaceholder } from './_Placeholder';

const BackupRestorePage: React.FC = () => (
  <PluginPlaceholder pluginId="backup-restore" displayName="备份与恢复" />
);

export const backupRestorePlugin: FrontendPlugin = {
  id: 'backup-restore',
  name: '备份与恢复',
  routes: [
    {
      path: '/backup',
      component: BackupRestorePage,
      pluginId: 'backup-restore',
      displayName: '备份与恢复',
    },
  ],
};
