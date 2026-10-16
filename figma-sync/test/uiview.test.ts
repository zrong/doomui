import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateUIView } from '../source/core/uiview';
import { normalizeFigmaFrame } from '../source/core/normalizer';
import { applyButtonSemantics } from '../source/core/variants';
import { collectNodeMapping } from '../source/core/diff';
import { SyncService } from '../source/services/sync-service';
import type { FigmaNode, FrameMapping, ProjectSettings, SyncPreview } from '../source/types';

const settings: ProjectSettings = {
  schemaVersion: 7,
  sharedTextureRoots: [],
  bundleRoot: 'db://assets/subpackages/doomui_test',
  fontMap: {},
  frames: {},
  adoptions: {},
  pendingOrphans: [],
};

function child(id: string, name: string, type: string, x: number): FigmaNode {
  const base: FigmaNode = {
    id,
    name,
    type,
    absoluteBoundingBox: { x, y: 100, width: 100, height: 40 },
  };
  if (type === 'TEXT') {
    base.characters = 'Title';
    base.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    base.style = { fontFamily: 'Arial', fontStyle: 'Regular', fontSize: 20 };
  } else if (type === 'RECTANGLE' || type === 'FRAME') {
    base.fills = [{ type: 'SOLID', color: { r: 0.2, g: 0.4, b: 0.6 } }];
  }
  return base;
}

function frame(): FigmaNode {
  return {
    id: '1:1',
    name: 'UI_DoomUITest',
    type: 'FRAME',
    absoluteBoundingBox: { x: 0, y: 0, width: 720, height: 1280 },
    children: [
      child('1:2', '$node_slot', 'FRAME', 20),
      child('1:3', '$btn_play', 'FRAME', 140),
      child('1:4', '$txt_title', 'TEXT', 260),
      child('1:5', '$sp_icon', 'RECTANGLE', 380),
    ],
  };
}

function contract(document: FigmaNode, mapping?: FrameMapping) {
  const normalized = normalizeFigmaFrame(document, {
    textureRoot: 'db://assets/subpackages/doomui_test/textures/figma',
    settings,
  });
  applyButtonSemantics(normalized.root, normalized.issues);
  return { normalized, result: validateUIView(document, normalized.root, mapping) };
}

function previousMapping(bindings: FrameMapping['bindings']): FrameMapping {
  return {
    schemaVersion: 4,
    source: { fileKey: 'file', nodeId: '1:1', fileVersion: '1' },
    frameName: 'UI_DoomUITest',
    visualPrefabUrl: 'visual',
    logicPrefabUrl: 'logic',
    nodes: {},
    assets: {},
    ownedAssets: [],
    bundleRoot: settings.bundleRoot,
    bindings,
  };
}

describe('UIView binding contract', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).Editor;
  });

  it('maps the four supported prefixes to root-relative bindings', () => {
    const { normalized, result } = contract(frame());
    expect(result.issues.filter((issue) => issue.severity === 'blocker')).toEqual([]);
    expect(result.bindings).toEqual([
      { nodeId: '1:3', property: 'btn_play', path: 'root/$btn_play', component: 'Button' },
      { nodeId: '1:2', property: 'node_slot', path: 'root/$node_slot', component: 'Node' },
      { nodeId: '1:5', property: 'sp_icon', path: 'root/$sp_icon', component: 'Sprite' },
      { nodeId: '1:4', property: 'txt_title', path: 'root/$txt_title', component: 'Label' },
    ]);
    expect(normalized.root.children.find((node) => node.id === '1:3')?.button).toBeTruthy();
  });

  it('accepts $list_ at arbitrary depth as a mounted ListExtent contract', () => {
    const document = frame();
    document.children = [child('2:1', '$node_panel', 'FRAME', 0)];
    document.children[0].children = [child('2:2', '$list_HeadScrollView', 'FRAME', 0)];
    const result = contract(document).result;
    expect(result.issues.filter((issue) => issue.severity === 'blocker')).toEqual([]);
    expect(result.bindings).toContainEqual({
      nodeId: '2:2',
      property: 'list_HeadScrollView',
      path: 'root/$node_panel/$list_HeadScrollView',
      component: 'ListExtent',
    });
  });

  it('accepts a nine-slice marker after a supported binding name', () => {
    const document = frame();
    document.children![0].name = '$node_panel @9slice{l:11,r:10,t:10,b:9}';
    document.children![1].name = '$btn_play @9slice{l:15,r:15,t:15,b:15}';
    document.children![3].name = '$sp_icon @9slice{l:4,r:4,t:4,b:4}';

    const result = contract(document).result;
    expect(result.issues.filter((issue) => issue.severity === 'blocker')).toEqual([]);
    expect(result.bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'node_panel', component: 'Node' }),
      expect.objectContaining({ property: 'btn_play', component: 'Button' }),
      expect.objectContaining({ property: 'sp_icon', component: 'Sprite' }),
    ]));
    expect(result.bindings.some((binding) => binding.property.includes('@9slice'))).toBe(false);
  });

  it('keeps a clipped subtree semantic when it contains a $ binding', () => {
    const document = frame();
    document.children = [{
      id: '2:1', name: 'clipped', type: 'FRAME', clipsContent: true,
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
      children: [child('2:2', '$node_slot', 'FRAME', 20)],
    }];
    const { normalized } = contract(document);
    expect(normalized.root.children[0].kind).toBe('container');
    expect(normalized.root.children[0].renderMode).not.toBe('raster');
  });

  it('blocks invalid names, nested root, duplicate properties, and unsupported prefixes', () => {
    const document = frame();
    document.name = 'Bad Name';
    document.absoluteBoundingBox!.width = 700;
    document.children!.push(child('2:1', 'root', 'FRAME', 0));
    document.children!.push(child('2:2', '$btn_play', 'FRAME', 0));
    document.children!.push(child('2:3', '$unknown_rewards', 'FRAME', 0));
    const codes = contract(document).result.issues.map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining([
      'UIVIEW_NAME_INVALID',
      'UIVIEW_NESTED_ROOT',
      'UIVIEW_BINDING_DUPLICATE',
      'UIVIEW_BINDING_PREFIX_UNSUPPORTED',
    ]));
  });

  it('accepts the Frame dimensions as the visual Prefab dimensions', () => {
    const document = frame();
    document.absoluteBoundingBox = { x: 0, y: 0, width: 1080, height: 1920 };
    expect(contract(document).result.issues)
      .not.toContainEqual(expect.objectContaining({ code: 'UIVIEW_SIZE_INVALID' }));
  });

  it('blocks a binding prefix whose normalized Cocos component does not match', () => {
    const document = frame();
    document.children![2] = child('1:4', '$txt_title', 'FRAME', 260);
    expect(contract(document).result.issues).toContainEqual(
      expect.objectContaining({ code: 'UIVIEW_BINDING_COMPONENT_MISMATCH', nodeId: '1:4' }),
    );
  });

  it('requires confirmation when an existing binding is renamed or moved', () => {
    const first = contract(frame()).result.bindings;
    const changed = frame();
    changed.children![1].name = '$btn_confirm';
    changed.children![0].children = [changed.children!.splice(1, 1)[0]];
    const result = contract(changed, previousMapping(first)).result;
    expect(result.requiresConfirmation).toBe(true);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'UIVIEW_BINDING_RENAMED' }),
      expect.objectContaining({ code: 'UIVIEW_BINDING_PATH_CHANGED' }),
    ]));
  });

  it('does not require confirmation for an added binding', () => {
    const firstDocument = frame();
    firstDocument.children = firstDocument.children!.slice(0, 1);
    const first = contract(firstDocument).result.bindings;
    const result = contract(frame(), previousMapping(first)).result;
    expect(result.requiresConfirmation).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'UIVIEW_BINDING_ADDED' }));
  });

  it('does not report destructive binding changes when a reimport preserves Cocos fileIds', () => {
    const original = contract(frame());
    const mapping = previousMapping(original.result.bindings);
    mapping.nodes = collectNodeMapping(original.normalized);

    const document = frame();
    const rekey = (node: FigmaNode): void => {
      node.id = node.id.replace(/^1:/, '9:');
      node.children?.forEach(rekey);
    };
    rekey(document);
    const normalized = normalizeFigmaFrame(document, {
      textureRoot: 'db://assets/subpackages/doomui_test/textures/figma',
      settings,
    });
    applyButtonSemantics(normalized.root, normalized.issues);
    const previousFileIds = new Map(Object.values(mapping.nodes).map((node) => [node.name, node.fileId]));
    const restoreFileIds = (node: typeof normalized.root): void => {
      node.fileId = previousFileIds.get(node.name) ?? node.fileId;
      node.children.forEach(restoreFileIds);
    };
    restoreFileIds(normalized.root);

    const result = validateUIView(document, normalized.root, mapping);
    expect(result.requiresConfirmation).toBe(false);
    expect(result.issues).not.toContainEqual(expect.objectContaining({ code: 'UIVIEW_BINDING_REMOVED' }));
    expect(result.issues).not.toContainEqual(expect.objectContaining({ code: 'UIVIEW_BINDING_ADDED' }));
  });

  it('requires confirmation when a binding is deleted or changes component type', () => {
    const first = contract(frame()).result.bindings;
    const changed = frame();
    changed.children = changed.children!.filter((node) => node.id !== '1:5');
    changed.children![2] = child('1:4', '$sp_title', 'RECTANGLE', 260);
    const result = contract(changed, previousMapping(first)).result;
    expect(result.requiresConfirmation).toBe(true);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'UIVIEW_BINDING_REMOVED', nodeId: '1:5' }),
      expect.objectContaining({ code: 'UIVIEW_BINDING_TYPE_CHANGED', nodeId: '1:4' }),
    ]));
  });

  it('blocks an existing unowned logic prefab instead of taking it over', async () => {
    const logicUrl = 'db://assets/subpackages/doomui_test/prefabs/view/UI_DoomUITest.prefab';
    (globalThis as any).Editor = {
      Profile: { getProject: vi.fn(async () => settings) },
      Message: {
        request: vi.fn(async (channel: string, message: string, url: string) => {
          if (channel === 'asset-db' && message === 'query-asset-info') {
            return url === logicUrl ? { uuid: 'existing-logic', imported: true } : null;
          }
          throw new Error(`unexpected ${channel}:${message}`);
        }),
      },
    };
    const service = new SyncService();
    const result = await service.previewPush({
      protocolVersion: 12,
      fileKey: 'file',
      fileName: 'Fixture',
      targets: [{ kind: 'view', document: frame() }],
    });
    expect(result.preview.blockers).toContainEqual(
      expect.objectContaining({ code: 'UNOWNED_ASSET_COLLISION', path: logicUrl }),
    );
  });

  it('rebuilds from a fresh baseline when every previously tracked output is missing', async () => {
    const frameKey = 'file:1:1';
    const staleMapping = previousMapping(contract(frame()).result.bindings);
    staleMapping.visualPrefabUrl = 'db://assets/subpackages/doomui_test/prefabs/frame/UI_DoomUITest.root.prefab';
    staleMapping.logicPrefabUrl = 'db://assets/subpackages/doomui_test/prefabs/view/UI_DoomUITest.prefab';
    staleMapping.ownedAssets = [staleMapping.visualPrefabUrl, staleMapping.logicPrefabUrl];
    const staleSettings: ProjectSettings = {
      ...settings,
      frames: { [frameKey]: staleMapping },
    };
    (globalThis as any).Editor = {
      Project: { path: '/__doomui_missing_project__' },
      Profile: { getProject: vi.fn(async () => staleSettings) },
      Message: {
        request: vi.fn(async (channel: string, message: string, url: string) => {
          if (channel === 'asset-db' && message === 'query-asset-info') {
            if (staleMapping.ownedAssets.includes(url)) {
              return { uuid: 'stale-asset-db-record', file: `/__doomui_missing_output__/${url.split('/').at(-1)}` };
            }
            return null;
          }
          throw new Error(`unexpected ${channel}:${message}`);
        }),
      },
    };

    const service = new SyncService();
    const result = await service.previewPush({
      protocolVersion: 12,
      fileKey: 'file',
      fileName: 'Fixture',
      targets: [{ kind: 'view', document: frame() }],
    });
    expect(result.preview.rebuildFromEmptyOutput).toEqual({ previousTrackedAssets: 2 });
    expect(result.preview.requiresBindingConfirmation).toBe(false);
    expect(result.preview.changes.some((change) => change.kind === 'delete')).toBe(false);
    expect(result.preview.changes.some((change) => change.kind === 'add')).toBe(true);
  });

  it('requires a fresh rebuild while a legacy visual layout still exists', async () => {
    const frameKey = 'file:1:1';
    const oldVisual = 'db://assets/subpackages/doomui_test/prefabs/frame/UI_DoomUITest.root.prefab';
    const logic = 'db://assets/subpackages/doomui_test/prefabs/view/UI_DoomUITest.prefab';
    const current = contract(frame());
    const legacy = previousMapping(current.result.bindings);
    legacy.visualPrefabUrl = oldVisual;
    legacy.logicPrefabUrl = logic;
    legacy.ownedAssets = [oldVisual];
    legacy.nodes = collectNodeMapping(current.normalized);
    const legacySettings: ProjectSettings = { ...settings, frames: { [frameKey]: legacy } };
    (globalThis as any).Editor = {
      Profile: { getProject: vi.fn(async () => legacySettings) },
      Message: {
        request: vi.fn(async (channel: string, message: string, url: string) => {
          if (channel === 'asset-db' && message === 'query-asset-info') {
            if (url === oldVisual) return { uuid: 'stable-visual-uuid', imported: true };
            if (url === logic) return { uuid: 'logic-uuid', imported: true };
            return null;
          }
          throw new Error(`unexpected ${channel}:${message}`);
        }),
      },
    };
    const service = new SyncService();
    const result = await service.previewPush({
      protocolVersion: 12,
      fileKey: 'file',
      fileName: 'Fixture',
      targets: [{ kind: 'view', document: frame() }],
    });
    expect(result.preview.blockers).toContainEqual(expect.objectContaining({
      code: 'OUTPUT_LAYOUT_REQUIRES_REBUILD',
      path: oldVisual,
    }));
    expect((service as any).prepared).toBeUndefined();
  });

  it('rejects Apply before settings or assets are touched when confirmation is missing', async () => {
    const preview: SyncPreview = {
      planId: 'plan', fileVersion: '1', changes: [], warnings: [], blockers: [],
      requiresBindingConfirmation: true,
    };
    const service = new SyncService();
    (service as any).prepared = { preview, expiresAt: Date.now() + 1000 };
    await expect(service.apply('stale-plan')).rejects.toThrow(/当前页面中的 Cocos 预览已不能用于 Apply/);
    await expect(service.apply('plan')).rejects.toThrow(/必须显式确认/);
  });

  it('explains how to refresh an expired Desktop Push Apply plan', async () => {
    const preview: SyncPreview = {
      planId: 'plan', fileVersion: '1', changes: [], warnings: [], blockers: [],
    };
    const service = new SyncService();
    (service as any).prepared = {
      preview,
      expiresAt: Date.now() - 1,
    };
    await expect(service.apply('plan')).rejects.toThrow(/Figma Desktop Push.*重新推送所选内容/);
  });
});
