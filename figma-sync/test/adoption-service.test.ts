import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdoptionService } from '../source/services/adoption-service';
import { mappingKey } from '../source/core/naming';
import type { ProjectSettings, SceneAdoptionExportResult } from '../source/types';

describe('one-time Cocos prefab adoption', () => {
  let temporaryDirectory = '';

  afterEach(async () => {
    delete (globalThis as Record<string, unknown>).Editor;
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = '';
  });

  it('reads the original prefab, keeps the session in memory, and persists only the completed node mapping', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'doomui-adoption-'));
    const sourceFile = join(temporaryDirectory, 'UI_TreasureGame.prefab');
    await writeFile(sourceFile, '{"source":"original"}');
    const prefabUrl = 'db://assets/ui/custom/legacy/UI_TreasureGame.prefab';
    const exported: SceneAdoptionExportResult = {
      root: {
        sourceFileId: 'cocos-root-file-id',
        name: 'UI_TreasureGame',
        kind: 'frame',
        visible: true,
        opacity: 1,
        x: 0,
        y: 0,
        width: 720,
        height: 1280,
        rotation: 0,
        button: false,
        layout: {
          direction: 'horizontal',
          resizeMode: 'none',
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 8,
          paddingBottom: 8,
          spacing: 6,
        },
        children: [{
          sourceFileId: 'cocos-button-file-id',
          name: '$btn_close',
          kind: 'frame',
          visible: true,
          opacity: 1,
          x: 640,
          y: 24,
          width: 56,
          height: 56,
          rotation: 0,
          button: true,
          constraints: { horizontal: 'MAX', vertical: 'MIN' },
          children: [],
        }, {
          sourceFileId: 'cocos-label-file-id',
          name: '$txt_name',
          kind: 'text',
          visible: true,
          opacity: 1,
          x: 8,
          y: 90.92,
          width: 84,
          height: 31.72,
          rotation: 0,
          button: false,
          text: {
            characters: '道具名字',
            fontSize: 20,
            lineHeight: 22,
            color: { r: 255, g: 255, b: 255, a: 255 },
            bold: false,
            italic: false,
            underline: false,
            overflow: 'none',
            wrap: true,
            horizontalAlign: 'center',
            verticalAlign: 'center',
          },
          children: [],
        }, {
          sourceFileId: 'cocos-empty-sprite-file-id',
          name: '$sp_bg',
          kind: 'sprite',
          visible: true,
          opacity: 1,
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          rotation: 0,
          button: false,
          sprite: {
            color: { r: 255, g: 255, b: 255, a: 255 },
            sliced: true,
          },
          children: [],
        }],
      },
      warnings: ['节点 $btn_close 的自定义组件不会导入 Figma'],
    };
    const initial: ProjectSettings = {
      schemaVersion: 7,
      bundleRoot: 'db://assets/game',
      sharedTextureRoots: [],
      fontMap: {},
      frames: {},
      adoptions: {},
      pendingOrphans: [],
    };
    let saved: ProjectSettings | undefined;
    (globalThis as any).Editor = {
      Message: {
        request: vi.fn(async (channel: string, message: string, value: unknown) => {
          if (channel === 'asset-db' && message === 'query-asset-info' && value === prefabUrl) {
            return { uuid: 'prefab-uuid', url: prefabUrl, file: sourceFile };
          }
          if (channel === 'scene' && message === 'execute-scene-script') return exported;
          throw new Error(`unexpected request ${channel}:${message}:${String(value)}`);
        }),
      },
      Profile: {
        getProject: vi.fn(async () => saved ?? initial),
        setProject: vi.fn(async (_packageName: string, _key: string, value: ProjectSettings) => { saved = value; }),
      },
    };

    const service = new AdoptionService();
    const session = await service.create({ prefabUrl, kind: 'view' });
    expect(session).toMatchObject({
      kind: 'view',
      prefabUrl,
      prefabName: 'UI_TreasureGame',
      nodeCount: 4,
      warningCount: 1,
      status: 'ready',
      nodes: [
        { path: 'UI_TreasureGame', name: 'UI_TreasureGame', kind: 'frame' },
        { path: 'UI_TreasureGame/$btn_close', name: '$btn_close', kind: 'frame' },
        { path: 'UI_TreasureGame/$txt_name', name: '$txt_name', kind: 'text' },
        { path: 'UI_TreasureGame/$sp_bg', name: '$sp_bg', kind: 'sprite' },
      ],
      assets: [],
      warnings: ['节点 $btn_close 的自定义组件不会导入 Figma'],
    });
    expect(service.getDocument(session.sessionId)).toMatchObject({
      protocolVersion: 12,
      kind: 'view',
      root: {
        layout: { direction: 'horizontal', resizeMode: 'none', spacing: 6 },
        children: [
          { name: '$btn_close' },
          { name: '$txt_name', width: 84, height: 31.72, text: { overflow: 'none', wrap: true } },
          { name: '$sp_bg', sprite: { assetKey: undefined, sliced: true } },
        ],
      },
    });
    expect(await readdir(temporaryDirectory)).toEqual(['UI_TreasureGame.prefab']);

    const completed = await service.complete(session.sessionId, {
      fileKey: 'example-adoption-file',
      fileName: 'PSDTest',
      nodeId: '2013:35',
      nodeType: 'FRAME',
      nodes: {
        '2013:35': { cocosFileId: 'cocos-root-file-id', cocosNodeName: 'UI_TreasureGame' },
        '2013:36': { cocosFileId: 'cocos-button-file-id', cocosNodeName: '$btn_close' },
        '2013:37': { cocosFileId: 'cocos-label-file-id', cocosNodeName: '$txt_name' },
        '2013:38': { cocosFileId: 'cocos-empty-sprite-file-id', cocosNodeName: '$sp_bg' },
      },
      images: {},
    });
    expect(completed.status).toBe('imported');
    expect(saved?.adoptions[mappingKey('example-adoption-file', '2013:35')]).toMatchObject({
      schemaVersion: 3,
      kind: 'view',
      sourcePrefabUrl: prefabUrl,
      sourcePrefabUuid: 'prefab-uuid',
      nodes: {
        '2013:36': { cocosFileId: 'cocos-button-file-id', sourceWidgetMapped: true },
        '2013:37': {
          cocosFileId: 'cocos-label-file-id',
          sourceWidgetMapped: false,
          sourceText: {
            width: 84,
            height: 31.72,
            importedWidth: 84,
            importedHeight: 31.72,
            overflow: 'none',
            wrap: true,
          },
        },
        '2013:38': {
          cocosFileId: 'cocos-empty-sprite-file-id',
          sourceEmptySpriteFrame: {
            sliced: true,
            color: { r: 255, g: 255, b: 255, a: 255 },
          },
        },
      },
    });

    service.cancel(session.sessionId);
    await expect(service.create({ prefabUrl })).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('禁止重复导入'),
    });
    expect(await service.listBindings('example-adoption-file')).toEqual([
      expect.objectContaining({ kind: 'view', sourcePrefabUuid: 'prefab-uuid', nodeId: '2013:35', nodeType: 'FRAME' }),
    ]);
    expect(await service.listBindings('another-file')).toEqual([]);
    await expect(service.releaseBinding({ fileKey: 'another-file', nodeId: '2013:35' })).rejects.toMatchObject({
      statusCode: 404,
    });

    const previousKey = mappingKey('example-adoption-file', '2013:35');
    saved = {
      ...saved!,
      frames: {
        ...saved!.frames,
        [previousKey]: {
          schemaVersion: 4,
          source: { fileKey: 'example-adoption-file', nodeId: '2013:35', fileVersion: 'old' },
          frameName: 'UI_TreasureGame',
          visualPrefabUrl: 'db://assets/game/prefabs/view/figma/UI_TreasureGame.root.prefab',
          logicPrefabUrl: prefabUrl,
          nodes: {},
          assets: {},
          ownedAssets: [prefabUrl],
          bundleRoot: 'db://assets/game',
          adoptionKey: previousKey,
        },
      },
    };
    await service.releaseBinding({ fileKey: 'example-adoption-file', nodeId: '2013:35' });
    expect(await service.listBindings('example-adoption-file')).toEqual([]);
    expect(saved?.adoptions[previousKey].releasedAt).toBeTruthy();

    const replacement = await service.create({ prefabUrl });
    await service.complete(replacement.sessionId, {
      fileKey: 'example-adoption-file',
      fileName: 'PSDTest',
      nodeId: '3010:40',
      nodeType: 'FRAME',
      nodes: {
        '3010:40': { cocosFileId: 'cocos-root-file-id', cocosNodeName: 'UI_TreasureGame' },
        '3010:41': { cocosFileId: 'cocos-button-file-id', cocosNodeName: '$btn_close' },
        '3010:42': { cocosFileId: 'cocos-label-file-id', cocosNodeName: '$txt_name' },
        '3010:43': { cocosFileId: 'cocos-empty-sprite-file-id', cocosNodeName: '$sp_bg' },
      },
      images: {},
    });
    const replacementKey = mappingKey('example-adoption-file', '3010:40');
    expect(saved?.adoptions[previousKey]).toBeUndefined();
    expect(saved?.adoptions[replacementKey]).toMatchObject({ sourcePrefabUuid: 'prefab-uuid' });
    expect(saved?.frames[previousKey]).toBeUndefined();
    expect(saved?.frames[replacementKey]).toMatchObject({
      source: { fileKey: 'example-adoption-file', nodeId: '3010:40', fileVersion: '' },
      ownedAssets: [prefabUrl],
      adoptionKey: replacementKey,
    });
  });

  it('imports a standard Item prefab as a Component mapping without creating a Frame mapping', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'doomui-item-adoption-'));
    const sourceFile = join(temporaryDirectory, 'item_RoleHead.prefab');
    await writeFile(sourceFile, '{"item":"original"}');
    const prefabUrl = 'db://assets/widgets/rewards/item_RoleHead.prefab';
    const exported: SceneAdoptionExportResult = {
      root: {
        sourceFileId: 'item-root-file-id',
        name: 'item_RoleHead',
        kind: 'frame',
        visible: true,
        opacity: 1,
        x: 0,
        y: 0,
        width: 136,
        height: 136,
        rotation: 0,
        button: false,
        children: [],
      },
      warnings: [],
    };
    const initial: ProjectSettings = {
      schemaVersion: 7,
      bundleRoot: 'db://assets/subpackages/hall',
      sharedTextureRoots: [],
      fontMap: {},
      frames: {},
      adoptions: {},
      pendingOrphans: [],
    };
    let saved = initial;
    (globalThis as any).Editor = {
      Message: {
        request: vi.fn(async (channel: string, message: string, value: unknown) => {
          if (channel === 'asset-db' && message === 'query-asset-info' && value === prefabUrl) {
            return { uuid: 'item-prefab-uuid', url: prefabUrl, file: sourceFile };
          }
          if (channel === 'scene' && message === 'execute-scene-script') return exported;
          throw new Error(`unexpected request ${channel}:${message}:${String(value)}`);
        }),
      },
      Profile: {
        getProject: vi.fn(async () => saved),
        setProject: vi.fn(async (_packageName: string, _key: string, value: ProjectSettings) => { saved = value; }),
      },
    };

    const service = new AdoptionService();
    const session = await service.create({ prefabUrl, kind: 'item' });
    expect(session).toMatchObject({
      kind: 'item',
      prefabName: 'item_RoleHead',
      warningCount: 1,
      warnings: [expect.stringContaining('首次 Figma → Cocos Apply 前删除旧')],
    });
    expect(service.getDocument(session.sessionId)).toMatchObject({ protocolVersion: 12, kind: 'item' });
    await expect(service.complete(session.sessionId, {
      fileKey: 'file-key',
      fileName: 'File',
      nodeId: '2:1',
      nodeType: 'FRAME',
      nodes: { '2:1': { cocosFileId: 'item-root-file-id', cocosNodeName: 'item_RoleHead' } },
      images: {},
    })).rejects.toThrow('Item 必须导入为 Figma COMPONENT');

    const completed = await service.complete(session.sessionId, {
      fileKey: 'file-key',
      fileName: 'File',
      nodeId: '2:1',
      nodeType: 'COMPONENT',
      nodes: { '2:1': { cocosFileId: 'item-root-file-id', cocosNodeName: 'item_RoleHead' } },
      images: {},
    });
    expect(completed.importedNode).toEqual({
      fileKey: 'file-key',
      fileName: 'File',
      nodeId: '2:1',
      nodeType: 'COMPONENT',
    });
    expect(saved.adoptions[mappingKey('file-key', '2:1')]).toMatchObject({
      schemaVersion: 3,
      kind: 'item',
      figma: { nodeId: '2:1' },
    });
    expect(saved.frames).toEqual({});
    expect(await service.listBindings('file-key')).toEqual([
      expect.objectContaining({ kind: 'item', nodeId: '2:1', nodeType: 'COMPONENT' }),
    ]);
    expect(await readdir(temporaryDirectory)).toEqual(['item_RoleHead.prefab']);

    const previousKey = mappingKey('file-key', '2:1');
    const previousVisual = 'db://assets/subpackages/hall/prefabs/item/figma/item_RoleHead.root.prefab';
    saved = {
      ...saved,
      frames: {
        [previousKey]: {
          schemaVersion: 4,
          kind: 'item',
          source: { fileKey: 'file-key', nodeId: '2:1', fileVersion: 'old' },
          frameName: 'item_RoleHead',
          visualPrefabUrl: previousVisual,
          logicPrefabUrl: 'db://assets/subpackages/hall/prefabs/item/item_RoleHead.prefab',
          nodes: {},
          assets: {},
          ownedAssets: [previousVisual],
          bundleRoot: 'db://assets/subpackages/hall',
          adoptionKey: previousKey,
        },
      },
    };
    await service.releaseBinding({ fileKey: 'file-key', nodeId: '2:1' });
    const replacement = await service.create({ prefabUrl, kind: 'item' });
    await service.complete(replacement.sessionId, {
      fileKey: 'file-key',
      fileName: 'File',
      nodeId: '3:1',
      nodeType: 'COMPONENT',
      nodes: { '3:1': { cocosFileId: 'item-root-file-id', cocosNodeName: 'item_RoleHead' } },
      images: {},
    });
    const replacementKey = mappingKey('file-key', '3:1');
    expect(saved.frames[previousKey]).toBeUndefined();
    expect(saved.frames[replacementKey]).toMatchObject({
      kind: 'item',
      source: { fileKey: 'file-key', nodeId: '3:1', fileVersion: '' },
      visualPrefabUrl: previousVisual,
      ownedAssets: [previousVisual],
      adoptionKey: replacementKey,
    });
  });

  it('rejects paths outside db://assets prefab resources', async () => {
    const service = new AdoptionService();
    await expect(service.create({ prefabUrl: '../UI.prefab' })).rejects.toThrow('db://assets');
    await expect(service.create({ prefabUrl: 'db://assets/reference/UI.scene' })).rejects.toThrow('db://assets');
    await expect(service.create({ prefabUrl: 'db://assets/reference/../UI.prefab' })).rejects.toThrow('路径不合法');
  });

  it('persists the exact Cocos image and SpriteFrame identity returned by Figma', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'doomui-adoption-assets-'));
    const prefabFile = join(temporaryDirectory, 'UI.prefab');
    const imageFile = join(temporaryDirectory, 'button.png');
    await writeFile(prefabFile, '{}');
    await writeFile(imageFile, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ));
    const prefabUrl = 'db://assets/subpackages/subgame_treasure/prefabs/view/UI.prefab';
    const imageUrl = 'db://assets/subpackages/common/res/btn/button.png';
    const exported: SceneAdoptionExportResult = {
      root: {
        sourceFileId: 'button-node-file-id',
        name: '$btn_close',
        kind: 'sprite',
        visible: true,
        opacity: 1,
        x: 0,
        y: 0,
        width: 179,
        height: 53,
        rotation: 0,
        sprite: {
          imageUuid: 'image-uuid',
          spriteFrameUuid: 'sprite-frame-uuid',
          color: { r: 255, g: 255, b: 255, a: 255 },
          sliced: true,
          insets: { left: 15, right: 15, top: 15, bottom: 15 },
        },
        button: true,
        children: [],
      },
      warnings: [],
    };
    const initial: ProjectSettings = {
      schemaVersion: 7,
      bundleRoot: 'db://assets/subpackages/subgame_doomui',
      sharedTextureRoots: ['db://assets/subpackages/common'],
      fontMap: {},
      frames: {},
      adoptions: {},
      pendingOrphans: [],
    };
    let saved = initial;
    (globalThis as any).Editor = {
      Message: {
        request: vi.fn(async (channel: string, message: string, value: unknown) => {
          if (channel === 'asset-db' && message === 'query-asset-info' && value === prefabUrl) {
            return { uuid: 'prefab-uuid', url: prefabUrl, file: prefabFile };
          }
          if (channel === 'asset-db' && message === 'query-asset-info' && value === 'image-uuid') {
            return { uuid: 'image-uuid', url: imageUrl, file: imageFile };
          }
          if (channel === 'scene' && message === 'execute-scene-script') return exported;
          throw new Error(`unexpected request ${channel}:${message}:${String(value)}`);
        }),
      },
      Profile: {
        getProject: vi.fn(async () => saved),
        setProject: vi.fn(async (_packageName: string, _key: string, value: ProjectSettings) => { saved = value; }),
      },
    };

    const service = new AdoptionService();
    const session = await service.create({ prefabUrl });
    const document = service.getDocument(session.sessionId);
    expect(document.assets).toEqual([expect.objectContaining({
      sourceUrl: imageUrl,
      sourceImageUuid: 'image-uuid',
      sourceSpriteFrameUuid: 'sprite-frame-uuid',
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      solidWhite: false,
      sourceCreatorVersion: undefined,
      sliced: true,
      insets: { left: 15, right: 15, top: 15, bottom: 15 },
      sourceNodeFileIds: ['button-node-file-id'],
    })]);
    const assetKey = document.assets[0].key;
    await service.complete(session.sessionId, {
      fileKey: 'file-key',
      fileName: 'File',
      nodeId: '1:2',
      nodeType: 'FRAME',
      nodes: { '1:2': { cocosFileId: 'button-node-file-id', cocosNodeName: '$btn_close' } },
      images: { [assetKey]: 'figma-image-ref' },
    });
    expect(saved.adoptions[mappingKey('file-key', '1:2')].assets[assetKey]).toMatchObject({
      figmaImageRef: 'figma-image-ref',
      sourceUrl: imageUrl,
      sourceSpriteFrameUuid: 'sprite-frame-uuid',
      solidWhite: false,
    });
    expect(saved.adoptions[mappingKey('file-key', '1:2')].nodes['1:2'].sourceEmptySpriteFrame).toBeUndefined();
  });

  it('exports default_ui pixels with exact Creator-version provenance', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'doomui-adoption-internal-'));
    const prefabFile = join(temporaryDirectory, 'UI.prefab');
    const imageFile = join(temporaryDirectory, 'default_sprite.png');
    await writeFile(prefabFile, '{}');
    await writeFile(imageFile, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ));
    const prefabUrl = 'db://assets/ui/UI.prefab';
    const imageUrl = 'db://internal/default_ui/default_sprite.png';
    const exported: SceneAdoptionExportResult = {
      root: {
        sourceFileId: 'root-file-id',
        name: 'UI',
        kind: 'sprite',
        visible: true,
        opacity: 1,
        x: 0,
        y: 0,
        width: 40,
        height: 40,
        rotation: 0,
        sprite: {
          imageUuid: 'internal-image-uuid',
          spriteFrameUuid: 'internal-sprite-frame-uuid',
          color: { r: 255, g: 255, b: 255, a: 255 },
        },
        button: false,
        children: [],
      },
      warnings: [],
    };
    const initial: ProjectSettings = {
      schemaVersion: 7,
      bundleRoot: 'db://assets/ui',
      sharedTextureRoots: [],
      fontMap: {},
      frames: {},
      adoptions: {},
      pendingOrphans: [],
    };
    let saved = initial;
    (globalThis as any).Editor = {
      App: { version: '3.8.6' },
      Message: {
        request: vi.fn(async (channel: string, message: string, value: unknown) => {
          if (channel === 'asset-db' && message === 'query-asset-info' && value === prefabUrl) {
            return { uuid: 'prefab-uuid', url: prefabUrl, file: prefabFile };
          }
          if (channel === 'asset-db' && message === 'query-asset-info' && value === 'internal-image-uuid') {
            return { uuid: 'internal-image-uuid', url: imageUrl, file: imageFile };
          }
          if (channel === 'scene' && message === 'execute-scene-script') return exported;
          throw new Error(`unexpected request ${channel}:${message}:${String(value)}`);
        }),
      },
      Profile: {
        getProject: vi.fn(async () => saved),
        setProject: vi.fn(async (_packageName: string, _key: string, value: ProjectSettings) => { saved = value; }),
      },
    };

    const service = new AdoptionService();
    const session = await service.create({ prefabUrl });
    const document = service.getDocument(session.sessionId);
    expect(document.assets).toEqual([expect.objectContaining({
      sourceUrl: imageUrl,
      sourceCreatorVersion: '3.8.6',
      solidWhite: false,
    })]);
    const assetKey = document.assets[0].key;
    await service.complete(session.sessionId, {
      fileKey: 'file-key',
      fileName: 'File',
      nodeId: '1:2',
      nodeType: 'FRAME',
      nodes: { '1:2': { cocosFileId: 'root-file-id', cocosNodeName: 'UI' } },
      images: { [assetKey]: 'figma-image-ref' },
    });
    expect(saved.adoptions[mappingKey('file-key', '1:2')].assets[assetKey]).toMatchObject({
      sourceUrl: imageUrl,
      sourceCreatorVersion: '3.8.6',
      figmaImageRef: 'figma-image-ref',
    });
  });
});
