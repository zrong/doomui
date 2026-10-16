import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PROJECT_SETTINGS,
  LEGACY_PACKAGE_NAME,
  migrateLegacyProfile,
  normalizeProjectSettings,
  PACKAGE_NAME,
} from '../source/services/settings';

describe('project settings migration', () => {
  it('migrates to the unified schema and discards retired layout mappings', () => {
    const frames = { 'file:1:2': { schemaVersion: 1, frameName: 'Legacy' } };
    const result = normalizeProjectSettings({
      schemaVersion: 1,
      outputRoot: 'db://assets/legacy',
      fontMap: { 'Inter/Regular': 'db://assets/fonts/inter.ttf' },
      frames,
    });
    expect(result).toMatchObject({
      schemaVersion: 8,
      bundleRoot: '',
      sharedTextureRoots: [],
      frames: {},
      adoptions: {},
      sharedAssetCatalogs: {},
      pendingOrphans: [],
    });
  });

  it('persists unique orphan candidates and drops invalid values', () => {
    expect(normalizeProjectSettings({
      pendingOrphans: ['db://assets/game/textures/figma/a.png', '', 42, 'db://assets/game/textures/figma/a.png'],
    }).pendingOrphans).toEqual(['db://assets/game/textures/figma/a.png']);
  });

  it('preserves a valid Asset Bundle root and rejects an invalid one', () => {
    expect(normalizeProjectSettings({ bundleRoot: 'db://assets/subpackages/hall/' }))
      .toMatchObject({ bundleRoot: 'db://assets/subpackages/hall' });
    expect(normalizeProjectSettings({ bundleRoot: '../hall' }))
      .toMatchObject({ bundleRoot: '' });
  });

  it('normalizes and deduplicates shared texture Bundle roots', () => {
    expect(normalizeProjectSettings({
      sharedTextureRoots: [
        'db://assets/subpackages/common/',
        'db://assets/subpackages/common',
        '../outside',
      ],
    }).sharedTextureRoots).toEqual(['db://assets/subpackages/common']);
  });

  it('discards the retired manual Item Prefab mapping', () => {
    const result = normalizeProjectSettings({
      itemPrefabMap: {
        item_RoleHead: 'db://assets/subpackages/hall/prefabs/item/item_RoleHead.prefab',
      },
    });
    expect(result).not.toHaveProperty('itemPrefabMap');
  });

  it('discards pre-v7 adoption mappings because shared SpriteFrame identity is required', () => {
    const adoption = {
      schemaVersion: 1,
      sourcePrefabUrl: 'db://assets/game/prefabs/view/UI.prefab',
      sourcePrefabUuid: 'uuid',
      sourcePrefabHash: 'hash',
      figma: { fileKey: 'file', fileName: 'File', frameNodeId: '1:2' },
      nodes: { '1:2': { cocosFileId: 'file-id', cocosNodeName: 'UI' } },
      createdAt: '2026-08-29T00:00:00.000Z',
      releasedAt: '2026-08-30T00:00:00.000Z',
    };
    expect(normalizeProjectSettings({ adoptions: { 'file:1:2': adoption } }).adoptions).toEqual({});
  });

  it('migrates schema-2 view adoption mappings to the typed node model', () => {
    const adoption = {
      schemaVersion: 2,
      sourcePrefabUrl: 'db://assets/game/prefabs/view/UI.prefab',
      sourcePrefabUuid: 'uuid',
      sourcePrefabHash: 'hash',
      figma: { fileKey: 'file', fileName: 'File', frameNodeId: '1:2' },
      nodes: { '1:2': { cocosFileId: 'file-id', cocosNodeName: 'UI' } },
      assets: {},
      createdAt: '2026-08-31T00:00:00.000Z',
    } as const;
    expect(normalizeProjectSettings({ adoptions: { 'file:1:2': adoption } }).adoptions)
      .toEqual({
        'file:1:2': {
          ...adoption,
          schemaVersion: 3,
          kind: 'view',
          figma: { fileKey: 'file', fileName: 'File', nodeId: '1:2' },
        },
      });
  });

  it('preserves schema-3 Item adoption mappings', () => {
    const adoption = {
      schemaVersion: 3,
      kind: 'item',
      sourcePrefabUrl: 'db://assets/game/prefabs/item/item_RoleHead.prefab',
      sourcePrefabUuid: 'item-uuid',
      sourcePrefabHash: 'item-hash',
      figma: { fileKey: 'file', fileName: 'File', nodeId: '2:1' },
      nodes: { '2:1': { cocosFileId: 'item-file-id', cocosNodeName: 'item_RoleHead' } },
      assets: {},
      createdAt: '2026-09-01T00:00:00.000Z',
    } as const;
    expect(normalizeProjectSettings({ adoptions: { 'file:2:1': adoption } }).adoptions)
      .toEqual({ 'file:2:1': adoption });
  });

  it('preserves only valid per-file shared asset Catalog mappings', () => {
    const catalog = {
      schemaVersion: 1,
      figma: { fileKey: 'file', fileName: 'UI Kit', catalogNodeId: '1:2' },
      assets: {},
      updatedAt: '2026-09-02T00:00:00.000Z',
    } as const;
    expect(normalizeProjectSettings({
      sharedAssetCatalogs: { file: catalog, invalid: { schemaVersion: 0 } },
    }).sharedAssetCatalogs).toEqual({ file: catalog });
  });
});

describe('package profile migration', () => {
  const originalEditor = (globalThis as any).Editor;

  afterEach(() => {
    (globalThis as any).Editor = originalEditor;
  });

  function installProfileMock(values: Map<string, unknown>) {
    const key = (packageName: string, name: string, scope: string) => `${scope}:${packageName}:${name}`;
    (globalThis as any).Editor = {
      Profile: {
        getConfig: async (packageName: string, name: string, scope: string) => values.get(key(packageName, name, scope)),
        setConfig: async (packageName: string, name: string, value: unknown, scope: string) => {
          values.set(key(packageName, name, scope), value);
        },
        removeConfig: async (packageName: string, name: string, scope: string) => {
          values.delete(key(packageName, name, scope));
        },
        getProject: async (packageName: string, name: string) => (
          values.get(key(packageName, name, 'project')) ?? DEFAULT_PROJECT_SETTINGS
        ),
        setProject: async (packageName: string, name: string, value: unknown) => {
          values.set(key(packageName, name, 'project'), value);
        },
      },
    };
    return key;
  }

  it('copies only legacy project settings and leaves retired credentials untouched', async () => {
    const values = new Map<string, unknown>();
    const key = installProfileMock(values);
    const legacyProject = normalizeProjectSettings({
      bundleRoot: 'db://assets/subpackages/doomui',
      frames: { 'file:1:2': { schemaVersion: 1, frameName: 'Legacy' } },
    });
    values.set(key(LEGACY_PACKAGE_NAME, 'token', 'global'), 'figd_secret');
    values.set(key(LEGACY_PACKAGE_NAME, 'settings', 'project'), legacyProject);

    await migrateLegacyProfile();

    expect(values.get(key(PACKAGE_NAME, 'token', 'global'))).toBeUndefined();
    expect(values.get(key(PACKAGE_NAME, 'settings', 'project'))).toEqual(legacyProject);
    expect(values.get(key(PACKAGE_NAME, 'legacyProfileMigration', 'global'))).toBeUndefined();
    expect(values.get(key(LEGACY_PACKAGE_NAME, 'token', 'global'))).toBe('figd_secret');
    expect(values.get(key(LEGACY_PACKAGE_NAME, 'settings', 'project'))).toEqual(legacyProject);
  });

  it('does not overwrite settings already saved under the unified package name', async () => {
    const values = new Map<string, unknown>();
    const key = installProfileMock(values);
    const currentProject = normalizeProjectSettings({ bundleRoot: 'db://assets/current' });
    const legacyProject = normalizeProjectSettings({ bundleRoot: 'db://assets/legacy' });
    values.set(key(PACKAGE_NAME, 'settings', 'project'), currentProject);
    values.set(key(LEGACY_PACKAGE_NAME, 'settings', 'project'), legacyProject);

    await migrateLegacyProfile();

    expect(values.get(key(PACKAGE_NAME, 'settings', 'project'))).toEqual(currentProject);
  });
});
