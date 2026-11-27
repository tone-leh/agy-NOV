import React from 'react';
import type {
  ModuleId,
  NovLocale,
  NovStartupView,
  PresetId,
} from '../../../src/core/catalog.js';
import { novBridge, type NovBridge, type NovConfigSnapshot } from '../bridge.js';
import { SettingsHub, type SettingsHubProps } from './SettingsHub.js';

export { SettingsHub, type SettingsHubProps };

export interface ModulesPanelProps {
  bridge?: NovBridge;
  snapshot: NovConfigSnapshot;
  busyKey: string | null;
  onToggleModule: (moduleId: ModuleId, enabled: boolean) => Promise<void> | void;
  onApplyPreset: (preset: PresetId) => Promise<void> | void;
  onOpenModule: (moduleId: ModuleId) => void;
  onChangeLocale?: (locale: NovLocale) => Promise<void> | void;
  onChangeStartupView?: (startupView: NovStartupView) => Promise<void> | void;
  onSnapshotReplaced?: (snapshot: NovConfigSnapshot) => void;
  onNotify?: (message: string) => void;
}

/**
 * Backward-compatible wrapper delegating to the v0.7.0 4-level Unified Settings Hub.
 */
export const ModulesPanel: React.FC<ModulesPanelProps> = ({
  bridge = novBridge,
  snapshot,
  busyKey,
  onToggleModule,
  onApplyPreset,
  onOpenModule,
  onChangeLocale,
  onChangeStartupView,
  onSnapshotReplaced,
  onNotify,
}) => {
  const handleLocale =
    onChangeLocale ??
    (async (locale: NovLocale) => {
      const next = await bridge.setLocale(locale);
      onSnapshotReplaced?.(next);
    });

  const handleStartupView =
    onChangeStartupView ??
    (async (view: NovStartupView) => {
      const next = await bridge.setStartupView(view);
      onSnapshotReplaced?.(next);
    });

  return (
    <SettingsHub
      bridge={bridge}
      snapshot={snapshot}
      busyKey={busyKey}
      onToggleModule={onToggleModule}
      onApplyPreset={onApplyPreset}
      onChangeLocale={handleLocale}
      onChangeStartupView={handleStartupView}
      onOpenModule={onOpenModule}
      onSnapshotReplaced={onSnapshotReplaced}
      onNotify={onNotify}
    />
  );
};
