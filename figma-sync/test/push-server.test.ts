import { afterEach, describe, expect, it, vi } from 'vitest';
import basicFrame from './fixtures/frame-basic.json';
import { LocalPushServer } from '../source/services/local-push-server';
import { SyncService } from '../source/services/sync-service';
import { AdoptionService } from '../source/services/adoption-service';
import { SharedAssetCatalogService } from '../source/services/shared-asset-catalog-service';
import type { CocosAdoptionSessionSummary, PushPrepareResult, PushServiceEvent } from '../source/types';

function preview(planId = 'plan-1') {
  return {
    planId,
    fileVersion: 'push-hash',
    changes: [],
    warnings: [],
    blockers: [],
  };
}

describe('Figma Desktop push service', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).Editor;
  });

  it('negotiates the Cocos Sync protocol, confirms pairing on first authenticated use, and disconnects cleanly', async () => {
    const result: PushPrepareResult = {
      preview: preview(),
      assetRequests: [{ key: 'raster:key', kind: 'raster', nodeId: '2:3' }],
      requiresComplete: true,
    };
    const sync = {
      previewPush: vi.fn(async () => result),
      receivePushAsset: vi.fn(),
      completePush: vi.fn(() => result.preview),
    } as unknown as SyncService;
    const events: PushServiceEvent[] = [];
    const server = new LocalPushServer(sync, (event) => events.push(event), { port: 0 });
    await server.start();
    const status = server.getStatus();
    expect(status).toMatchObject({ running: true, endpoint: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/) });

    const unauthorized = await fetch(`${status.endpoint}/v1/status`);
    expect(unauthorized.status).toBe(401);

    const protocolResponse = await fetch(`${status.endpoint}/v1/protocol`);
    expect(await protocolResponse.json()).toEqual({ protocolVersion: 12, service: 'cocos-sync' });

    const incompatiblePair = await fetch(`${status.endpoint}/v1/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: status.pairingCode, protocolVersion: 3 }),
    });
    expect(incompatiblePair.status).toBe(409);
    expect(await incompatiblePair.json()).toMatchObject({ error: expect.stringContaining('Cocos Sync 协议版本不兼容') });
    expect(server.getStatus()).toMatchObject({ paired: false, pairingCode: status.pairingCode });

    const pairResponse = await fetch(`${status.endpoint}/v1/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: status.pairingCode, protocolVersion: 12 }),
    });
    expect(pairResponse.status).toBe(200);
    const pair = await pairResponse.json() as { token: string };
    const auth = { Authorization: `Bearer ${pair.token}` };
    expect(server.getStatus().paired).toBe(false);

    const confirmedStatus = await fetch(`${status.endpoint}/v1/status`, { headers: auth });
    expect(confirmedStatus.status).toBe(200);
    expect(await confirmedStatus.json()).toEqual({
      protocolVersion: 12,
      running: true,
      endpoint: status.endpoint,
      activeAdoption: null,
      activeSharedAssets: null,
    });
    for (const retiredPath of ['/v1/adoptions/active', '/v1/shared-assets/active']) {
      const retiredResponse = await fetch(`${status.endpoint}${retiredPath}`, { headers: auth });
      expect(retiredResponse.status).toBe(404);
    }
    expect(server.getStatus().paired).toBe(true);

    const prepareResponse = await fetch(`${status.endpoint}/v1/prepare`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocolVersion: 12,
        fileKey: 'file',
        fileName: 'File',
        targets: [{ kind: 'view', document: basicFrame }],
      }),
    });
    expect(prepareResponse.status).toBe(200);
    expect(sync.previewPush).toHaveBeenCalledOnce();
    expect(server.getStatus().paired).toBe(true);

    const asset = Buffer.from('fake-png');
    const assetResponse = await fetch(`${status.endpoint}/v1/assets/plan-1/${encodeURIComponent('raster:key')}`, {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'application/octet-stream' },
      body: asset,
    });
    expect(assetResponse.status).toBe(200);
    expect(sync.receivePushAsset).toHaveBeenCalledWith('plan-1', 'raster:key', asset);

    const completeResponse = await fetch(`${status.endpoint}/v1/complete`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId: 'plan-1' }),
    });
    expect(completeResponse.status).toBe(200);
    expect(events).toContainEqual(expect.objectContaining({ type: 'preview' }));

    const disconnectResponse = await fetch(`${status.endpoint}/v1/disconnect`, { method: 'POST', headers: auth });
    expect(disconnectResponse.status).toBe(200);
    expect(server.getStatus().paired).toBe(false);
    const invalidated = await fetch(`${status.endpoint}/v1/status`, { headers: auth });
    expect(invalidated.status).toBe(401);

    const nextStatus = server.getStatus();
    const nextPairResponse = await fetch(`${nextStatus.endpoint}/v1/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: nextStatus.pairingCode, protocolVersion: 12 }),
    });
    const nextPair = await nextPairResponse.json() as { token: string };
    const nextAuth = { Authorization: `Bearer ${nextPair.token}` };
    await fetch(`${nextStatus.endpoint}/v1/status`, { headers: nextAuth });
    expect(server.getStatus().paired).toBe(true);
    server.resetPairing();
    expect(server.getStatus().paired).toBe(false);
    const resetToken = await fetch(`${nextStatus.endpoint}/v1/status`, { headers: nextAuth });
    expect(resetToken.status).toBe(401);
    await server.stop();
  });

  it('creates a push preview without reading editor-global credentials', async () => {
    const getConfig = vi.fn(async () => {
      throw new Error('editor-global credentials must not be read');
    });
    (globalThis as any).Editor = {
      Profile: {
        getConfig,
        getProject: vi.fn(async () => ({
          schemaVersion: 8,
          sharedTextureRoots: [],
          bundleRoot: 'db://assets/subpackages/doomui_test',
          fontMap: {},
          frames: {},
          adoptions: {
            'file-key:2:1': {
              schemaVersion: 3,
              kind: 'item',
              sourcePrefabUrl: 'db://assets/subpackages/doomui_test/prefabs/item/item_RoleHead.prefab',
              sourcePrefabUuid: 'item-prefab-uuid',
              sourcePrefabHash: 'item-prefab-hash',
              figma: { fileKey: 'file-key', fileName: 'Fixture', nodeId: '2:1' },
              nodes: { '2:1': { cocosFileId: 'adopted-item-root-file-id', cocosNodeName: 'item_RoleHead' } },
              assets: {},
              createdAt: '2026-09-01T00:00:00.000Z',
            },
          },
          sharedAssetCatalogs: {},
          pendingOrphans: [],
        })),
      },
      Message: {
        request: vi.fn(async (channel: string, message: string) => {
          if (channel === 'asset-db' && message === 'query-asset-info') return null;
          throw new Error(`unexpected ${channel}:${message}`);
        }),
      },
    };
    const sync = new SyncService();
    const pushed = await sync.previewPush({
      protocolVersion: 12,
      fileKey: 'file-key',
      fileName: 'Fixture',
      targets: [
        { kind: 'view', document: { ...basicFrame, name: 'UI_Login' } as any },
        {
          kind: 'item',
          document: {
            id: '2:1',
            name: 'item_RoleHead',
            type: 'COMPONENT',
            absoluteBoundingBox: { x: 1000, y: 0, width: 200, height: 100 },
            children: [],
          },
        },
      ],
    });
    expect(getConfig).not.toHaveBeenCalled();
    expect(pushed.preview.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'db://assets/subpackages/doomui_test/prefabs/item/item_RoleHead.prefab' }),
      expect.objectContaining({ path: 'db://assets/subpackages/doomui_test/prefabs/item/figma/item_RoleHead.root.prefab' }),
    ]));
    expect(pushed.preview.targets).toEqual([
      { kind: 'view', nodeId: basicFrame.id, name: 'UI_Login' },
      { kind: 'item', nodeId: '2:1', name: 'item_RoleHead' },
    ]);
    expect(pushed.preview.planId).toBeTruthy();
    expect((sync as any).prepared.targets).toHaveLength(2);
    expect((sync as any).prepared.targets.find((target: any) => target.kind === 'item').normalized.root.fileId)
      .toBe('adopted-item-root-file-id');
    expect(sync.completePush(pushed.preview.planId)).toEqual(pushed.preview);
  });

  it('rejects duplicate targets and kind/type mismatches before creating a plan', async () => {
    const sync = new SyncService();
    await expect(sync.previewPush({
      protocolVersion: 12,
      fileKey: 'file-key',
      fileName: 'Fixture',
      targets: [
        { kind: 'view', document: basicFrame as any },
        { kind: 'view', document: basicFrame as any },
      ],
    })).rejects.toThrow(`Figma Push 包含重复目标：${basicFrame.id}`);

    await expect(sync.previewPush({
      protocolVersion: 12,
      fileKey: 'file-key',
      fileName: 'Fixture',
      targets: [{ kind: 'item', document: basicFrame as any }],
    })).rejects.toThrow('Figma Push 目标必须是与 kind 匹配的 Frame / Component');
  });

  it('only plans explicitly selected Frames and Components', async () => {
    (globalThis as any).Editor = {
      Profile: {
        getProject: vi.fn(async () => ({
          schemaVersion: 7,
          sharedTextureRoots: [],
          bundleRoot: 'db://assets/subpackages/doomui_test',
          fontMap: {},
          frames: {},
          adoptions: {},
          pendingOrphans: [],
        })),
      },
      Message: {
        request: vi.fn(async (channel: string, message: string) => {
          if (channel === 'asset-db' && message === 'query-asset-info') return null;
          throw new Error(`unexpected ${channel}:${message}`);
        }),
      },
    };
    const view = { ...basicFrame, name: 'UI_Login' } as any;
    const item = {
      id: '2:1',
      name: 'item_RoleHead',
      type: 'COMPONENT',
      absoluteBoundingBox: { x: 1000, y: 0, width: 200, height: 100 },
      children: [],
    } as any;

    const viewOnly = await new SyncService().previewPush({
      protocolVersion: 12,
      fileKey: 'file-key',
      fileName: 'Fixture',
      targets: [{ kind: 'view', document: view }],
      components: { '2:1': { name: 'item_RoleHead' } },
    });
    expect(viewOnly.preview.targets).toEqual([{ kind: 'view', nodeId: view.id, name: view.name }]);
    expect(viewOnly.preview.changes.some((change) => change.path.includes('/prefabs/item/'))).toBe(false);

    const itemOnly = await new SyncService().previewPush({
      protocolVersion: 12,
      fileKey: 'file-key',
      fileName: 'Fixture',
      targets: [{ kind: 'item', document: item }],
    });
    expect(itemOnly.preview.targets).toEqual([{ kind: 'item', nodeId: item.id, name: item.name }]);
    expect(itemOnly.preview.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'db://assets/subpackages/doomui_test/prefabs/item/item_RoleHead.prefab' }),
      expect.objectContaining({ path: 'db://assets/subpackages/doomui_test/prefabs/item/figma/item_RoleHead.root.prefab' }),
    ]));
    expect(itemOnly.preview.changes.some((change) => change.path.includes('/prefabs/view/'))).toBe(false);

    const sameOutput = await new SyncService().previewPush({
      protocolVersion: 12,
      fileKey: 'file-key',
      fileName: 'Fixture',
      targets: [
        { kind: 'item', document: item },
        { kind: 'item', document: { ...item, id: '2:2' } },
      ],
    });
    expect(sameOutput.preview.blockers).toContainEqual(expect.objectContaining({
      code: 'TARGET_NAME_COLLISION',
      path: 'db://assets/subpackages/doomui_test/prefabs/item/figma/item_RoleHead.root.prefab',
    }));
    expect(sameOutput.requiresComplete).toBe(false);
  });

  it('serves the authenticated one-time adoption document, assets, and completion route', async () => {
    const session: CocosAdoptionSessionSummary = {
      kind: 'view',
      sessionId: 'session-1',
      prefabUrl: 'db://assets/game/prefabs/view/UI.prefab',
      prefabName: 'UI',
      nodeCount: 1,
      assetCount: 1,
      warningCount: 1,
      nodes: [{ path: 'UI', name: 'UI', kind: 'frame' }],
      assets: [{
        key: 'image-1',
        sourceUrl: 'db://assets/game/textures/ui.png',
        sourceImageUuid: 'image-uuid',
        sourceSpriteFrameUuid: 'sprite-frame-uuid',
        contentHash: 'content-hash',
        sliced: false,
        sourceNodeFileIds: ['file-id'],
        mimeType: 'image/png',
        width: 32,
        height: 24,
      }],
      warnings: ['自定义组件不会导入 Figma'],
      status: 'ready',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const binding = {
      kind: 'view' as const,
      sourcePrefabUrl: session.prefabUrl,
      sourcePrefabUuid: 'prefab-uuid',
      fileKey: 'file',
      fileName: 'File',
      nodeId: '1:2',
      nodeType: 'FRAME' as const,
      createdAt: new Date().toISOString(),
    };
    const adoption = {
      setOnChange: vi.fn(),
      getActiveSummary: vi.fn(() => session),
      listBindings: vi.fn(async () => [binding]),
      releaseBinding: vi.fn(async () => binding),
      getDocument: vi.fn(() => ({ protocolVersion: 12, kind: 'view', sessionId: session.sessionId, root: { name: 'UI' } })),
      getAsset: vi.fn(() => Buffer.from('png')),
      complete: vi.fn(async () => ({ ...session, status: 'imported' as const })),
    } as unknown as AdoptionService;
    const sync = {} as SyncService;
    const server = new LocalPushServer(sync, () => {}, { port: 0 }, adoption);
    await server.start();
    const status = server.getStatus();
    const pairResponse = await fetch(`${status.endpoint}/v1/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: status.pairingCode, protocolVersion: 12 }),
    });
    const pair = await pairResponse.json() as { token: string };
    const auth = { Authorization: `Bearer ${pair.token}` };

    const activeResponse = await fetch(`${status.endpoint}/v1/status`, { headers: auth });
    expect(await activeResponse.json()).toMatchObject({
      activeAdoption: {
        sessionId: 'session-1',
        nodes: [{ path: 'UI', kind: 'frame' }],
        assets: [{ sourceUrl: 'db://assets/game/textures/ui.png', width: 32, height: 24 }],
        warnings: ['自定义组件不会导入 Figma'],
      },
      activeSharedAssets: null,
    });
    const bindingsResponse = await fetch(`${status.endpoint}/v1/adoptions/bindings?fileKey=file`, { headers: auth });
    expect(await bindingsResponse.json()).toMatchObject({ bindings: [{ sourcePrefabUuid: 'prefab-uuid', nodeId: '1:2', nodeType: 'FRAME' }] });
    expect(adoption.listBindings).toHaveBeenCalledWith('file');
    const releaseResponse = await fetch(`${status.endpoint}/v1/adoptions/bindings/release`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileKey: 'file', nodeId: '1:2' }),
    });
    expect(releaseResponse.status).toBe(200);
    expect(adoption.releaseBinding).toHaveBeenCalledWith({ fileKey: 'file', nodeId: '1:2' });
    const documentResponse = await fetch(`${status.endpoint}/v1/adoptions/session-1`, { headers: auth });
    expect(await documentResponse.json()).toMatchObject({ sessionId: 'session-1' });
    const assetResponse = await fetch(`${status.endpoint}/v1/adoptions/session-1/assets/image-1`, { headers: auth });
    expect(await assetResponse.text()).toBe('png');
    const completeResponse = await fetch(`${status.endpoint}/v1/adoptions/session-1/complete`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileKey: 'file', nodeId: '1:2', nodeType: 'FRAME', nodes: {} }),
    });
    expect(completeResponse.status).toBe(200);
    expect(adoption.complete).toHaveBeenCalledWith('session-1', expect.objectContaining({ fileKey: 'file' }));
    await server.stop();
  });

  it('serves the authenticated shared asset Catalog session, image, and completion routes', async () => {
    const session = {
      sessionId: 'shared-session-1',
      assetCount: 1,
      assets: [{
        key: 'sprite-frame-a',
        sourceUrl: 'db://assets/common/button.png',
        sourceImageUuid: 'image-a',
        sourceSpriteFrameUuid: 'sprite-a',
        contentHash: 'hash-a',
        sliced: false,
        mimeType: 'image/png' as const,
        width: 32,
        height: 24,
      }],
      status: 'ready' as const,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const sharedAssets = {
      setOnChange: vi.fn(),
      getActiveSummary: vi.fn(() => session),
      getDocument: vi.fn(() => ({ protocolVersion: 12, sessionId: session.sessionId, assets: session.assets })),
      getAsset: vi.fn(() => Buffer.from('shared-png')),
      complete: vi.fn(async () => ({ ...session, status: 'imported' as const })),
    } as unknown as SharedAssetCatalogService;
    const server = new LocalPushServer(
      {} as SyncService,
      () => {},
      { port: 0 },
      new AdoptionService(),
      sharedAssets,
    );
    await server.start();
    const status = server.getStatus();
    expect(status.activeSharedAssets).toMatchObject({ sessionId: 'shared-session-1', assetCount: 1 });
    const pairResponse = await fetch(`${status.endpoint}/v1/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: status.pairingCode, protocolVersion: 12 }),
    });
    const pair = await pairResponse.json() as { token: string };
    const auth = { Authorization: `Bearer ${pair.token}` };

    const activeResponse = await fetch(`${status.endpoint}/v1/status`, { headers: auth });
    expect(await activeResponse.json()).toMatchObject({
      activeAdoption: null,
      activeSharedAssets: { sessionId: 'shared-session-1' },
    });
    const documentResponse = await fetch(`${status.endpoint}/v1/shared-assets/shared-session-1`, { headers: auth });
    expect(await documentResponse.json()).toMatchObject({ protocolVersion: 12, sessionId: 'shared-session-1' });
    const assetResponse = await fetch(`${status.endpoint}/v1/shared-assets/shared-session-1/assets/sprite-frame-a`, { headers: auth });
    expect(await assetResponse.text()).toBe('shared-png');
    const completeResponse = await fetch(`${status.endpoint}/v1/shared-assets/shared-session-1/complete`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileKey: 'file', catalogNodeId: '1:2', items: {} }),
    });
    expect(completeResponse.status).toBe(200);
    expect(sharedAssets.complete).toHaveBeenCalledWith(
      'shared-session-1',
      expect.objectContaining({ fileKey: 'file', catalogNodeId: '1:2' }),
    );
    await server.stop();
  });
});
