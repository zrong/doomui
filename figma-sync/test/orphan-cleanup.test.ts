import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROJECT_SETTINGS, LEGACY_PACKAGE_NAME, PACKAGE_NAME } from '../source/services/settings';
import { SyncService } from '../source/services/sync-service';
import type { ProjectSettings } from '../source/types';

describe('explicit orphan cleanup', () => {
  const originalEditor = (globalThis as any).Editor;

  afterEach(() => {
    (globalThis as any).Editor = originalEditor;
  });

  it('deletes only unowned generated assets and keeps unsafe candidates pending', async () => {
    const root = 'db://assets/subpackages/doomui';
    const safeTexture = `${root}/textures/figma/unused.png`;
    const nestedTexture = `${root}/textures/figma/component-background.png`;
    const missingTexture = `${root}/textures/figma/missing.png`;
    const referencedComponent = `${root}/prefabs/item/figma/OldButton.root.prefab`;
    const logicPrefab = `${root}/prefabs/view/UI_Unsafe.prefab`;
    const reownedTexture = `${root}/textures/figma/reowned.png`;
    let saved: ProjectSettings = {
      ...DEFAULT_PROJECT_SETTINGS,
      bundleRoot: root,
      frames: {
        current: {
          schemaVersion: 4,
          source: { fileKey: 'file', nodeId: '1:1', fileVersion: '1' },
          frameName: 'UI_Current',
          visualPrefabUrl: `${root}/prefabs/view/figma/UI_Current.root.prefab`,
          logicPrefabUrl: `${root}/prefabs/view/UI_Current.prefab`,
          nodes: {},
          assets: {},
          ownedAssets: [reownedTexture],
          bundleRoot: root,
        },
      },
      pendingOrphans: [safeTexture, nestedTexture, missingTexture, referencedComponent, logicPrefab, reownedTexture],
    };
    const assetInfos = new Map<string, any>([
      [safeTexture, { uuid: 'safe-texture', url: safeTexture }],
      [nestedTexture, { uuid: 'nested-texture', url: nestedTexture }],
      [referencedComponent, {
        uuid: 'component-prefab',
        url: referencedComponent,
        subAssets: { nested: { uuid: 'component-subasset', url: `${referencedComponent}/nested` } },
      }],
      [reownedTexture, { uuid: 'reowned-texture', url: reownedTexture }],
    ]);
    const deleted: string[] = [];
    (globalThis as any).Editor = {
      Profile: {
        getProject: vi.fn(async (packageName: string) => (
          packageName === PACKAGE_NAME ? saved : DEFAULT_PROJECT_SETTINGS
        )),
        setProject: vi.fn(async (_packageName: string, _key: string, value: ProjectSettings) => {
          saved = value;
        }),
      },
      Message: {
        request: vi.fn(async (channel: string, message: string, ...args: unknown[]) => {
          if (channel !== 'asset-db') throw new Error(`unexpected channel ${channel}`);
          if (message === 'query-asset-info') return assetInfos.get(String(args[0])) ?? null;
          if (message === 'query-assets') {
            return [
              {
                uuid: 'component-prefab',
                url: referencedComponent,
                depends: ['nested-texture'],
              },
              {
                uuid: 'external-prefab',
                url: `${root}/prefabs/view/UI_External.prefab`,
                depends: ['component-subasset'],
              },
            ];
          }
          if (message === 'delete-asset') {
            const path = String(args[0]);
            deleted.push(path);
            assetInfos.delete(path);
            return null;
          }
          throw new Error(`unexpected asset-db message ${message}`);
        }),
      },
    };

    const result = await new SyncService().cleanupOrphans();

    expect(deleted).toEqual([safeTexture]);
    expect(result.deletedAssets).toEqual([safeTexture]);
    expect(result.missingAssets).toEqual([missingTexture]);
    expect(result.blockedAssets).toEqual(expect.arrayContaining([
      { path: logicPrefab, reason: '路径不属于插件生成的视觉 Prefab 或贴图目录' },
      { path: reownedTexture, reason: '资源已重新被当前 Frame 映射管理' },
      {
        path: referencedComponent,
        reason: '仍被工程中的其他资源引用',
        dependents: [`${root}/prefabs/view/UI_External.prefab`],
      },
      {
        path: nestedTexture,
        reason: '仍被工程中的其他资源引用',
        dependents: [referencedComponent],
      },
    ]));
    expect(saved.pendingOrphans).toEqual(expect.arrayContaining([
      logicPrefab,
      reownedTexture,
      referencedComponent,
      nestedTexture,
    ]));
    expect(saved.pendingOrphans).not.toContain(safeTexture);
    expect(saved.pendingOrphans).not.toContain(missingTexture);
    expect((globalThis as any).Editor.Profile.getProject).toHaveBeenCalledWith(
      LEGACY_PACKAGE_NAME,
      'settings',
    );
  });

  it('discovers generated output only inside known Bundle roots', async () => {
    const root = 'db://assets/subpackages/doomui';
    const active = `${root}/textures/figma/image__active.png`;
    const oldTexture = `${root}/textures/figma/raster__old.png`;
    const unusedViewVisual = `${root}/prefabs/view/figma/UI_Unused.root.prefab`;
    const unusedItemVisual = `${root}/prefabs/item/figma/item_Unused.root.prefab`;
    let saved: ProjectSettings = {
      ...DEFAULT_PROJECT_SETTINGS,
      bundleRoot: root,
      frames: {
        current: {
          schemaVersion: 4,
          source: { fileKey: 'file', nodeId: '1:1', fileVersion: '1' },
          frameName: 'UI_Current',
          visualPrefabUrl: `${root}/prefabs/view/figma/UI_Current.root.prefab`,
          logicPrefabUrl: `${root}/prefabs/view/UI_Current.prefab`,
          nodes: {},
          assets: {},
          ownedAssets: [active],
          bundleRoot: root,
        },
      },
    };
    (globalThis as any).Editor = {
      Profile: {
        getProject: vi.fn(async (packageName: string) => (
          packageName === PACKAGE_NAME ? saved : DEFAULT_PROJECT_SETTINGS
        )),
        setProject: vi.fn(async (_packageName: string, _key: string, value: ProjectSettings) => {
          saved = value;
        }),
      },
      Message: {
        request: vi.fn(async (channel: string, message: string) => {
          if (channel === 'asset-db' && message === 'query-assets') {
            return [
              { uuid: 'active', url: active },
              { uuid: 'old-texture', url: oldTexture },
              { uuid: 'unused-view-visual', url: unusedViewVisual },
              { uuid: 'unused-item-visual', url: unusedItemVisual },
              { uuid: 'logic', url: `${root}/prefabs/view/UI_Logic.prefab` },
              { uuid: 'item-logic', url: `${root}/prefabs/item/item_Unused.prefab` },
              { uuid: 'outside', url: 'db://assets/other/textures/figma/raster__outside.png' },
            ];
          }
          throw new Error(`unexpected ${channel}:${message}`);
        }),
      },
    };

    const result = await new SyncService().discoverLegacyOrphans();

    expect(result.assets).toEqual([oldTexture, unusedViewVisual, unusedItemVisual].sort());
    expect(saved.pendingOrphans).toEqual(result.assets);
  });

  it('retires a managed target without deleting files and preserves assets owned by another target', async () => {
    const root = 'db://assets/subpackages/doomui';
    const retiredVisual = `${root}/prefabs/view/figma/UI_Old.root.prefab`;
    const retiredTexture = `${root}/textures/figma/old.png`;
    const sharedGeneratedTexture = `${root}/textures/figma/shared.png`;
    const remainingVisual = `${root}/prefabs/item/figma/Item_Current.root.prefab`;
    const oldKey = 'file:1:1';
    const remainingKey = 'file:2:1';
    let saved: ProjectSettings = {
      ...DEFAULT_PROJECT_SETTINGS,
      bundleRoot: root,
      frames: {
        [oldKey]: {
          schemaVersion: 4,
          kind: 'view',
          source: { fileKey: 'file', nodeId: '1:1', fileVersion: 'old' },
          frameName: 'UI_Old',
          visualPrefabUrl: retiredVisual,
          logicPrefabUrl: `${root}/prefabs/view/UI_Old.prefab`,
          nodes: {},
          assets: {},
          ownedAssets: [retiredVisual, retiredTexture, sharedGeneratedTexture],
          bundleRoot: root,
          adoptionKey: oldKey,
        },
        [remainingKey]: {
          schemaVersion: 4,
          kind: 'item',
          source: { fileKey: 'file', nodeId: '2:1', fileVersion: 'current' },
          frameName: 'Item_Current',
          visualPrefabUrl: remainingVisual,
          logicPrefabUrl: `${root}/prefabs/item/Item_Current.prefab`,
          nodes: {},
          assets: {},
          ownedAssets: [remainingVisual, sharedGeneratedTexture],
          bundleRoot: root,
          adoptionKey: remainingKey,
        },
      },
      adoptions: {
        [oldKey]: {
          schemaVersion: 3,
          kind: 'view',
          sourcePrefabUrl: 'db://assets/source/UI_Old.prefab',
          sourcePrefabUuid: 'source-prefab',
          sourcePrefabHash: 'source-hash',
          figma: { fileKey: 'file', fileName: 'File', nodeId: '1:1' },
          nodes: {},
          assets: {},
          createdAt: '2026-09-01T00:00:00.000Z',
        },
      },
    };
    (globalThis as any).Editor = {
      Profile: {
        getProject: vi.fn(async (packageName: string) => (
          packageName === PACKAGE_NAME ? saved : DEFAULT_PROJECT_SETTINGS
        )),
        setProject: vi.fn(async (_packageName: string, _key: string, value: ProjectSettings) => {
          saved = value;
        }),
      },
    };

    const service = new SyncService();
    expect(await service.getManagedSyncTargets()).toEqual([
      expect.objectContaining({
        frameKey: remainingKey,
        frameName: 'Item_Current',
        kind: 'item',
        adoptionState: 'missing',
      }),
      expect.objectContaining({
        frameKey: oldKey,
        frameName: 'UI_Old',
        kind: 'view',
        adoptionState: 'active',
        ownedAssetCount: 3,
      }),
    ]);

    const result = await service.retireManagedSyncTarget({ frameKey: oldKey });

    expect(result.target).toMatchObject({ frameKey: oldKey, frameName: 'UI_Old' });
    expect(result.orphanAssets).toEqual([retiredVisual, retiredTexture].sort());
    expect(saved.frames[oldKey]).toBeUndefined();
    expect(saved.frames[remainingKey]).toBeDefined();
    expect(saved.adoptions[oldKey]).toBeUndefined();
    expect(saved.pendingOrphans).toEqual([retiredVisual, retiredTexture].sort());
    expect(saved.pendingOrphans).not.toContain(sharedGeneratedTexture);
    await expect(service.retireManagedSyncTarget({ frameKey: oldKey })).rejects.toThrow('不存在或已退役');
  });
});
