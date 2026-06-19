/**
 * F8 — 单文件部署 (stub). Build-time concern; no routes.
 */
import type { FrontendPlugin } from '../types';

export const singleFileDeployPlugin: FrontendPlugin = {
  id: 'single-file-deploy',
  name: '单文件部署',
  routes: [],
};
