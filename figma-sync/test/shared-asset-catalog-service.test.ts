import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SharedAssetCatalogService } from '../source/services/shared-asset-catalog-service';
import type { ProjectSettings } from '../source/types';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('Cocos shared asset catalog sessions', () => {
  let temporaryDirectory = '';

  afterEach(async () => {
    delete (globalThis as Record<string, unknown>).Editor;
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = '';
  });

  it('accepts one or more selected SpriteFrames and persists an exact per-file Catalog mapping', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'doomui-shared-catalog-'));
    const firstFile = join(temporaryDirectory, 'button.png');
    const secondFile = join(temporaryDirectory, 'icon.png');
    await Promise.all([writeFile(firstFile, PNG_1X1), writeFile(secondFile, PNG_1X1)]);
    const root = 'db://assets/subpackages/common';
    const firstUrl = `${root}/buttons/button.png`;
    const secondUrl = `${root}/icons/icon.png`;
    const initial: ProjectSettings = {
      schemaVersion: 8,
      bundleRoot: 'db://assets/subpackages/game',
      sharedTextureRoots: [root],
      fontMap: {},
      frames: {},
      adoptions: {},
      sharedAssetCatalogs: {},
      pendingOrphans: [],
    };
    let saved = initial;
    const request = vi.fn(async (channel: string, message: string, value: unknown) => {
      if (channel !== 'asset-db') throw new Error(`unexpected ${channel}:${message}`);
      if (message === 'query-asset-info' && value === 'image-a') {
        return {
          uuid: 'image-a',
          url: firstUrl,
          file: firstFile,
          type: 'cc.ImageAsset',
          subAssets: { spriteFrame: { uuid: 'sprite-a', name: 'spriteFrame', type: 'cc.SpriteFrame' } },
        };
      }
      if (message === 'query-asset-info' && value === 'image-b') {
        return {
          uuid: 'image-b',
          url: secondUrl,
          file: secondFile,
          type: 'cc.ImageAsset',
          subAssets: { spriteFrame: { uuid: 'sprite-b', name: 'spriteFrame', type: 'cc.SpriteFrame' } },
        };
      }
      if (message === 'query-asset-meta' && value === root) return { userData: { isBundle: true } };
      if (message === 'query-asset-meta' && value === firstUrl) {
        return { subMetas: { f9941: { uuid: 'sprite-a', importer: 'sprite-frame', userData: { borderLeft: 4, borderRight: 4, borderTop: 2, borderBottom: 2 } } } };
      }
      if (message === 'query-asset-meta' && value === secondUrl) {
        return { subMetas: { f9941: { uuid: 'sprite-b', importer: 'sprite-frame', userData: {} } } };
      }
      throw new Error(`unexpected ${channel}:${message}:${String(value)}`);
    });
    const selectedAssets = vi.fn(() => ['image-a', 'image-b']);
    (globalThis as any).Editor = {
      Selection: { getSelected: selectedAssets },
      Message: { request },
      Profile: {
        getProject: vi.fn(async () => saved),
        setProject: vi.fn(async (_packageName: string, _key: string, value: ProjectSettings) => { saved = value; }),
      },
    };

    const service = new SharedAssetCatalogService();
    expect(await service.inspectSelection()).toMatchObject({
      selectedCount: 2,
      errors: [],
      items: [
        { sourceUrl: firstUrl, sourceSpriteFrameUuid: 'sprite-a', sliced: true, insets: { left: 4, right: 4, top: 2, bottom: 2 } },
        { sourceUrl: secondUrl, sourceSpriteFrameUuid: 'sprite-b', sliced: false },
      ],
    });

    const session = await service.create();
    expect(session).toMatchObject({ assetCount: 2, status: 'ready' });
    expect(service.getDocument(session.sessionId)).toMatchObject({ protocolVersion: 12, assets: [{ sourceSpriteFrameUuid: 'sprite-a' }, { sourceSpriteFrameUuid: 'sprite-b' }] });
    expect(service.getAsset(session.sessionId, session.assets[0].key).length).toBeGreaterThan(0);

    const completed = await service.complete(session.sessionId, {
      fileKey: 'figma-file',
      fileName: 'UI Kit',
      catalogNodeId: '1:2',
      retainedSourceSpriteFrameUuids: ['sprite-a', 'sprite-b'],
      items: {
        [session.assets[0].key]: { componentNodeId: '2:1', figmaImageRef: 'figma-image-a' },
        [session.assets[1].key]: { componentNodeId: '2:2', figmaImageRef: 'figma-image-b' },
      },
    });
    expect(completed).toMatchObject({
      status: 'imported',
      importedCatalog: { fileKey: 'figma-file', catalogNodeId: '1:2' },
    });
    expect(saved.sharedAssetCatalogs['figma-file']).toMatchObject({
      schemaVersion: 1,
      figma: { fileName: 'UI Kit', catalogNodeId: '1:2' },
      assets: {
        'sprite-a': {
          sourceUrl: firstUrl,
          sourceImageUuid: 'image-a',
          sourceSpriteFrameUuid: 'sprite-a',
          componentNodeId: '2:1',
          figmaImageRef: 'figma-image-a',
          insets: { left: 4, right: 4, top: 2, bottom: 2 },
        },
      },
    });

    selectedAssets.mockReturnValue(['image-a']);
    const incremental = await service.create();
    await service.complete(incremental.sessionId, {
      fileKey: 'figma-file',
      fileName: 'UI Kit',
      catalogNodeId: '1:2',
      retainedSourceSpriteFrameUuids: ['sprite-a', 'sprite-b'],
      items: {
        [incremental.assets[0].key]: { componentNodeId: '2:1', figmaImageRef: 'figma-image-a-next' },
      },
    });
    expect(Object.keys(saved.sharedAssetCatalogs['figma-file'].assets).sort()).toEqual(['sprite-a', 'sprite-b']);
    expect(saved.sharedAssetCatalogs['figma-file'].assets['sprite-a'].figmaImageRef).toBe('figma-image-a-next');
    expect(saved.sharedAssetCatalogs['figma-file'].assets['sprite-b'].figmaImageRef).toBe('figma-image-b');
  });

  it('rejects the whole preparation when any selected resource is outside an allowed Asset Bundle', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'doomui-shared-catalog-invalid-'));
    const file = join(temporaryDirectory, 'outside.png');
    await writeFile(file, PNG_1X1);
    const initial = {
      schemaVersion: 8,
      bundleRoot: '',
      sharedTextureRoots: ['db://assets/subpackages/common'],
      fontMap: {},
      frames: {},
      adoptions: {},
      sharedAssetCatalogs: {},
      pendingOrphans: [],
    } satisfies ProjectSettings;
    (globalThis as any).Editor = {
      Selection: { getSelected: () => ['outside-image'] },
      Message: {
        request: vi.fn(async (_channel: string, message: string, value: unknown) => {
          if (message === 'query-asset-info' && value === 'outside-image') {
            return {
              uuid: 'outside-image',
              url: 'db://assets/private/outside.png',
              file,
              subAssets: { spriteFrame: { uuid: 'outside-sprite', type: 'cc.SpriteFrame' } },
            };
          }
          if (message === 'query-asset-meta') return { subMetas: {} };
          throw new Error(`unexpected ${message}:${String(value)}`);
        }),
      },
      Profile: { getProject: vi.fn(async () => initial) },
    };

    const service = new SharedAssetCatalogService();
    const selection = await service.inspectSelection();
    expect(selection.items).toEqual([]);
    expect(selection.errors).toContainEqual(expect.stringContaining('不在共享纹理 Bundle 根目录内'));
    await expect(service.create()).rejects.toMatchObject({ statusCode: 400 });
    expect(service.getActiveSummary()).toBeUndefined();
  });
});
