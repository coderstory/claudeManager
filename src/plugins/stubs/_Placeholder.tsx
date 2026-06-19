/**
 * Shared placeholder component for plugin stubs.
 * Centralised so all 12 stub pages render with the same look.
 */
import React from 'react';

interface PluginPlaceholderProps {
  pluginId: string;
  displayName: string;
}

export const PluginPlaceholder: React.FC<PluginPlaceholderProps> = ({
  pluginId,
  displayName,
}) => {
  return (
    <div className="plugin-placeholder">
      <h2 className="plugin-placeholder__title">{displayName}</h2>
      <p className="plugin-placeholder__hint">
        该功能将在 M2+ 开发 (plugin: <code>{pluginId}</code>)
      </p>
    </div>
  );
};
