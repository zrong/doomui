import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface MenuContribution {
  path?: string;
  label?: string;
  message?: string;
}

interface ExtensionManifest {
  name?: string;
  contributions?: {
    menu?: MenuContribution[];
    messages?: Record<string, { methods?: string[]; public?: boolean }>;
    profile?: {
      editor?: Record<string, unknown>;
      project?: Record<string, unknown>;
    };
  };
}

const manifest = JSON.parse(
  readFileSync(resolve(__dirname, '../package.json'), 'utf8'),
) as ExtensionManifest;

describe('extension package manifest', () => {
  it('uses the unified internal package name', () => {
    expect(manifest.name).toBe('figma-sync');
  });

  it('registers Figma Sync under the Extensions menu', () => {
    expect(manifest.contributions?.menu).toContainEqual({
      path: 'i18n:menu.extension/DoomUI',
      label: 'Figma Sync',
      message: 'open-panel',
    });
  });

  it('refreshes the adoption Prefab context after the Scene process is ready', () => {
    expect(manifest.contributions?.messages?.['scene:ready']).toEqual({
      methods: ['handleSceneReady'],
    });
    expect(manifest.contributions?.messages?.['figma-sync:adoption-prefab-context-changed']).toEqual({
      public: false,
    });
  });

  it('does not expose the retired REST preview message or editor-global credentials', () => {
    expect(manifest.contributions?.messages).not.toHaveProperty('preview-sync');
    expect(manifest.contributions?.profile?.editor).toBeUndefined();
  });

  it('registers target retirement and shared asset workflows', () => {
    expect(manifest.contributions?.messages?.['get-managed-sync-targets']).toEqual({
      methods: ['getManagedSyncTargets'],
    });
    expect(manifest.contributions?.messages?.['retire-managed-sync-target']).toEqual({
      methods: ['retireManagedSyncTarget'],
    });
    expect(manifest.contributions?.messages?.['get-current-shared-asset-selection']).toEqual({
      methods: ['getCurrentSharedAssetSelection'],
    });
    expect(manifest.contributions?.messages?.['create-shared-asset-catalog']).toEqual({
      methods: ['createSharedAssetCatalog'],
    });
    expect(manifest.contributions?.messages?.['cancel-shared-asset-catalog']).toEqual({
      methods: ['cancelSharedAssetCatalog'],
    });
  });
});
