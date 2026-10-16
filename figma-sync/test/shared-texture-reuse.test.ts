import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { diffNormalized } from '../source/core/diff';
import { normalizeTextureBuffer } from '../source/services/asset-writer';
import { resolveSharedTextureSources } from '../source/services/sync-service';
import type {
  AdoptionMapping,
  AssetTask,
  NormalizeResult,
  ProjectSettings,
} from '../source/types';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const WHITE_PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==',
  'base64',
);

describe('shared SpriteFrame reuse', () => {
  let temporaryDirectory = '';

  afterEach(async () => {
    delete (globalThis as Record<string, unknown>).Editor;
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = '';
  });

  async function fixture() {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'doomui-shared-texture-'));
    const imageFile = join(temporaryDirectory, 'combtn_yellow.png');
    await writeFile(imageFile, PNG_1X1);
    const normalizedImage = await normalizeTextureBuffer(PNG_1X1);
    const contentHash = createHash('sha256').update(normalizedImage.buffer).digest('hex');
    const sourceUrl = 'db://assets/subpackages/common/res/btn/combtn_yellow.png';
    const task: AssetTask = {
      key: 'fill:figma-image-ref',
      kind: 'image-fill',
      imageRef: 'figma-image-ref',
      hash: 'figma-task-hash',
      targetUrl: 'db://assets/subpackages/subgame_doomui/textures/figma/image__duplicate.png',
      nineSlice: { left: 15, right: 15, top: 15, bottom: 15 },
      importSettingsHash: 'nine-slice-hash',
    };
    const normalized: NormalizeResult = {
      root: {
        id: '1:1',
        fileId: 'cocos-node-file-id',
        name: '$btn_random',
        sourceType: 'FRAME',
        kind: 'sprite',
        renderMode: 'image-fill',
        visible: true,
        opacity: 1,
        x: 0,
        y: 0,
        width: 179,
        height: 53,
        rotation: 0,
        hash: 'node-hash',
        children: [],
        sprite: {
          assetKey: task.key,
          source: 'image-fill',
          color: { r: 255, g: 255, b: 255, a: 255 },
          nineSlice: task.nineSlice,
        },
      },
      issues: [],
      assets: [task],
      components: {},
      componentSets: {},
    };
    const adoption: AdoptionMapping = {
      schemaVersion: 3,
      kind: 'view',
      sourcePrefabUrl: 'db://assets/subpackages/subgame_treasure/prefabs/view/UI_TreasureGame.prefab',
      sourcePrefabUuid: 'prefab-uuid',
      sourcePrefabHash: 'prefab-hash',
      figma: { fileKey: 'file', fileName: 'File', nodeId: '1:1' },
      nodes: { '1:1': { cocosFileId: 'cocos-node-file-id', cocosNodeName: '$btn_random' } },
      assets: {
        source: {
          key: 'source',
          sourceUrl,
          sourceImageUuid: 'image-uuid',
          sourceSpriteFrameUuid: 'sprite-frame-uuid',
          contentHash,
          sliced: true,
          insets: { left: 15, right: 15, top: 15, bottom: 15 },
          sourceNodeFileIds: ['cocos-node-file-id'],
          mimeType: 'image/png',
          width: 179,
          height: 53,
          figmaImageRef: 'figma-image-ref',
        },
      },
      createdAt: '2026-08-31T00:00:00.000Z',
    };
    const settings: ProjectSettings = {
      schemaVersion: 7,
      bundleRoot: 'db://assets/subpackages/subgame_doomui',
      sharedTextureRoots: ['db://assets/subpackages/common'],
      fontMap: {},
      frames: {},
      adoptions: {},
      pendingOrphans: [],
    };
    const request = vi.fn(async (channel: string, message: string, value: unknown) => {
      if (channel === 'asset-db' && message === 'query-asset-info' && value === sourceUrl) {
        return { uuid: 'image-uuid', url: sourceUrl, file: imageFile };
      }
      if (channel === 'asset-db' && message === 'query-asset-meta' && value === 'db://assets/subpackages/common') {
        return { userData: { isBundle: true } };
      }
      if (channel === 'scene' && message === 'execute-scene-script') {
        return [{
          spriteFrameUuid: 'sprite-frame-uuid',
          imageUuid: 'image-uuid',
          insets: { left: 15, right: 15, top: 15, bottom: 15 },
          exists: true,
        }];
      }
      throw new Error(`unexpected request ${channel}:${message}:${String(value)}`);
    });
    (globalThis as any).Editor = { Message: { request } };
    return { adoption, contentHash, imageFile, normalized, request, settings, task, sourceUrl };
  }

  it('reuses the exact shared SpriteFrame and presents it as REUSE', async () => {
    const { adoption, normalized, settings, task, sourceUrl } = await fixture();
    expect(await resolveSharedTextureSources(normalized, adoption, settings)).toEqual([]);
    expect(task.sharedSource).toMatchObject({ sourceUrl, sourceSpriteFrameUuid: 'sprite-frame-uuid' });
    expect(diffNormalized(normalized, undefined).changes).toContainEqual(expect.objectContaining({
      kind: 'reuse',
      path: sourceUrl,
      detail: expect.stringContaining('不复制'),
    }));
  });

  it('reuses a renamed image copied from another adoption in the same Figma file', async () => {
    const { adoption, normalized, settings, task, sourceUrl } = await fixture();
    normalized.root.fileId = 'new-cocos-file-id';
    normalized.root.name = '$btn_ok_renamed';
    const currentAdoption: AdoptionMapping = {
      ...adoption,
      sourcePrefabUuid: 'current-prefab-uuid',
      figma: { ...adoption.figma, nodeId: '2:1' },
      nodes: { '2:1': { cocosFileId: 'new-cocos-file-id', cocosNodeName: '$btn_old_name' } },
      assets: {},
    };
    const sourceAdoption: AdoptionMapping = {
      ...adoption,
      figma: { ...adoption.figma, nodeId: '3:1' },
    };
    settings.adoptions = {
      'file:2:1': currentAdoption,
      'file:3:1': sourceAdoption,
    };

    expect(await resolveSharedTextureSources(normalized, currentAdoption, settings, 'file')).toEqual([]);
    expect(task.sharedSource).toMatchObject({ sourceUrl, sourceSpriteFrameUuid: 'sprite-frame-uuid' });
  });

  it('reuses a SpriteFrame learned from the unique Shared Assets Catalog in the same Figma file', async () => {
    const { adoption, normalized, settings, task, sourceUrl } = await fixture();
    const { sourceNodeFileIds: _sourceNodeFileIds, ...catalogAsset } = adoption.assets.source;
    settings.sharedAssetCatalogs = {
      file: {
        schemaVersion: 1,
        figma: { fileKey: 'file', fileName: 'File', catalogNodeId: '9:1' },
        assets: {
          'sprite-frame-uuid': {
            ...catalogAsset,
            componentNodeId: '9:2',
            updatedAt: '2026-09-02T00:00:00.000Z',
          },
        },
        updatedAt: '2026-09-02T00:00:00.000Z',
      },
    };

    expect(await resolveSharedTextureSources(normalized, undefined, settings, 'file')).toEqual([]);
    expect(task.sharedSource).toMatchObject({ sourceUrl, sourceSpriteFrameUuid: 'sprite-frame-uuid' });
  });

  it('does not use an image identity learned from a different Figma file', async () => {
    const { adoption, normalized, settings, task } = await fixture();
    const otherFileAdoption: AdoptionMapping = {
      ...adoption,
      figma: { ...adoption.figma, fileKey: 'other-file', nodeId: '3:1' },
    };
    settings.adoptions = { 'other-file:3:1': otherFileAdoption };

    expect(await resolveSharedTextureSources(normalized, undefined, settings, 'file')).toEqual([]);
    expect(task.sharedSource).toBeUndefined();
  });

  it('falls back to a generated texture when the Figma image was replaced', async () => {
    const { adoption, normalized, settings, task } = await fixture();
    task.imageRef = 'changed-figma-image-ref';
    const warnings = await resolveSharedTextureSources(normalized, adoption, settings);
    expect(task.sharedSource).toBeUndefined();
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'ADOPTED_IMAGE_CHANGED' }));
  });

  it('falls back when the current shared SpriteFrame nine-slice no longer matches', async () => {
    const { adoption, normalized, request, settings, task } = await fixture();
    request.mockImplementation(async (channel: string, message: string) => {
      if (channel === 'scene' && message === 'execute-scene-script') {
        return [{
          spriteFrameUuid: 'sprite-frame-uuid',
          imageUuid: 'image-uuid',
          insets: { left: 8, right: 8, top: 8, bottom: 8 },
          exists: true,
        }];
      }
      if (channel === 'asset-db' && message === 'query-asset-meta') return { userData: { isBundle: true } };
      throw new Error('image should not be read after incompatible SpriteFrame inspection');
    });
    const warnings = await resolveSharedTextureSources(normalized, adoption, settings);
    expect(task.sharedSource).toBeUndefined();
    expect(warnings).toContainEqual(expect.objectContaining({ code: 'SHARED_SPRITEFRAME_CHANGED' }));
  });

  it('restores an adopted project SpriteFrame after its opaque-white image became a Figma SOLID', async () => {
    const { adoption, imageFile, normalized, request, settings, task } = await fixture();
    await writeFile(imageFile, WHITE_PNG_1X1);
    const normalizedWhite = await normalizeTextureBuffer(WHITE_PNG_1X1);
    const whiteHash = createHash('sha256').update(normalizedWhite.buffer).digest('hex');
    const sourceUrl = 'db://assets/resources/textures/singleColor.png';
    adoption.assets.source = {
      ...adoption.assets.source,
      sourceUrl,
      contentHash: whiteHash,
      solidWhite: true,
      sliced: false,
      insets: undefined,
    };
    settings.sharedTextureRoots = ['db://assets/resources'];
    Object.assign(task, {
      key: '__solid_white',
      kind: 'generated-solid',
      imageRef: undefined,
      targetUrl: 'db://assets/subpackages/subgame_doomui/textures/figma/__solid_white.png',
      nineSlice: undefined,
      importSettingsHash: 'solid',
    } satisfies Partial<AssetTask>);
    normalized.root.sprite = {
      assetKey: task.key,
      source: 'image-fill',
      color: { r: 0, g: 0, b: 0, a: 180 },
    };
    const nativeSolid = {
      ...normalized.root,
      id: '1:2',
      fileId: 'designer-native-file-id',
      name: '$node_designer_solid',
      hash: 'designer-solid-hash',
      children: [],
      sprite: {
        assetKey: task.key,
        source: 'image-fill' as const,
        color: { r: 10, g: 20, b: 30, a: 255 },
      },
    };
    normalized.root.children = [nativeSolid];
    request.mockImplementation(async (channel: string, message: string, value: unknown) => {
      if (channel === 'asset-db' && message === 'query-asset-info' && value === sourceUrl) {
        return { uuid: 'image-uuid', url: sourceUrl, file: imageFile };
      }
      if (channel === 'asset-db' && message === 'query-asset-meta' && value === 'db://assets/resources') {
        return { userData: { isBundle: true } };
      }
      if (channel === 'scene' && message === 'execute-scene-script') {
        return [{
          spriteFrameUuid: 'sprite-frame-uuid',
          imageUuid: 'image-uuid',
          exists: true,
        }];
      }
      throw new Error(`unexpected request ${channel}:${message}:${String(value)}`);
    });

    expect(await resolveSharedTextureSources(normalized, adoption, settings)).toEqual([]);
    expect(normalized.root.sprite?.assetKey).toMatch(/^adopted-solid:/);
    expect(nativeSolid.sprite.assetKey).toBe('__solid_white');
    expect(normalized.assets).toHaveLength(2);
    expect(normalized.assets.find((asset) => asset.sharedSource)?.sharedSource).toMatchObject({
      sourceUrl,
      sourceSpriteFrameUuid: 'sprite-frame-uuid',
    });
    expect(normalized.assets.find((asset) => asset.key === '__solid_white')?.sharedSource).toBeUndefined();
  });

  it('reuses an engine default_ui SpriteFrame only in the Creator version recorded at adoption', async () => {
    const { adoption, imageFile, normalized, request, settings, task } = await fixture();
    const sourceUrl = 'db://internal/default_ui/default_sprite.png';
    adoption.assets.source = {
      ...adoption.assets.source,
      sourceUrl,
      sourceCreatorVersion: '3.8.6',
    };
    settings.sharedTextureRoots = [];
    (globalThis as any).Editor.App = { version: '3.8.6' };
    request.mockImplementation(async (channel: string, message: string, value: unknown) => {
      if (channel === 'asset-db' && message === 'query-asset-info' && value === sourceUrl) {
        return { uuid: 'image-uuid', url: sourceUrl, file: imageFile };
      }
      if (channel === 'scene' && message === 'execute-scene-script') {
        return [{
          spriteFrameUuid: 'sprite-frame-uuid',
          imageUuid: 'image-uuid',
          insets: { left: 15, right: 15, top: 15, bottom: 15 },
          exists: true,
        }];
      }
      throw new Error(`unexpected request ${channel}:${message}:${String(value)}`);
    });

    expect(await resolveSharedTextureSources(normalized, adoption, settings)).toEqual([]);
    expect(task.sharedSource).toMatchObject({ sourceUrl, sourceCreatorVersion: '3.8.6' });

    task.sharedSource = undefined;
    (globalThis as any).Editor.App.version = '3.8.7';
    const warnings = await resolveSharedTextureSources(normalized, adoption, settings);
    expect(task.sharedSource).toBeUndefined();
    expect(warnings).toContainEqual(expect.objectContaining({
      code: 'INTERNAL_DEFAULT_UI_VERSION_CHANGED',
      message: expect.stringContaining('3.8.6'),
    }));
  });
});
