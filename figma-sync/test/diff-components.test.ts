import { describe, expect, it } from 'vitest';
import type { FrameMapping, NormalizeResult, NormalizedNode } from '../source/types';
import { diffNormalized } from '../source/core/diff';
import { applyComponentReferences, planComponentPrefabs } from '../source/core/components';

function node(id: string, kind: NormalizedNode['kind'] = 'container'): NormalizedNode {
  return {
    id, fileId: `file-${id}`, name: id, sourceType: kind === 'instance' ? 'INSTANCE' : 'FRAME', kind, renderMode: 'none',
    visible: true, opacity: 1, x: 0, y: 0, width: 100, height: 100, rotation: 0, hash: `hash-${id}`, children: [],
  };
}

describe('diff and component planning', () => {
  it('reports add/update/delete/unchanged and orphan without deleting it', () => {
    const root = node('root');
    root.children = [node('same'), node('changed'), node('added')];
    root.children[1].hash = 'new-hash';
    const result: NormalizeResult = {
      root,
      issues: [],
      components: {},
      componentSets: {},
      assets: [{ key: 'new', kind: 'raster', hash: 'new', targetUrl: 'db://assets/new.png', importSettingsHash: 'x' }],
    };
    const mapping: FrameMapping = {
      schemaVersion: 4,
      source: { fileKey: 'file', nodeId: 'root', fileVersion: '1' },
      frameName: 'root', visualPrefabUrl: 'v', logicPrefabUrl: 'l', ownedAssets: [],
      bundleRoot: 'db://assets/game',
      nodes: {
        root: { fileId: 'file-root', hash: 'hash-root', kind: 'container', name: 'root' },
        same: { fileId: 'file-same', hash: 'hash-same', kind: 'container', name: 'same' },
        changed: { fileId: 'file-changed', hash: 'old', kind: 'container', name: 'changed' },
        removed: { fileId: 'file-removed', hash: 'old', kind: 'container', name: 'removed' },
      },
      assets: { old: { url: 'db://assets/old.png', hash: 'old', importSettingsHash: 'old' } },
    };
    const diff = diffNormalized(result, mapping);
    expect(diff.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'node:same', kind: 'unchanged' }),
      expect.objectContaining({ key: 'node:changed', kind: 'update' }),
      expect.objectContaining({ key: 'node:added', kind: 'add' }),
      expect.objectContaining({ key: 'node:removed', kind: 'delete' }),
      expect.objectContaining({ path: 'db://assets/old.png', detail: expect.stringMatching(/orphan/) }),
    ]));
    expect(diff.orphans).toEqual(['db://assets/old.png']);
  });

  it('treats an asset path change as an update even when content hashes match', () => {
    const root = node('root');
    const result: NormalizeResult = {
      root, issues: [], components: {}, componentSets: {},
      assets: [{ key: 'same', kind: 'raster', hash: 'hash', targetUrl: 'db://assets/new.png', importSettingsHash: 'settings' }],
    };
    const mapping: FrameMapping = {
      schemaVersion: 4, source: { fileKey: 'file', nodeId: 'root', fileVersion: '1' }, frameName: 'root',
      visualPrefabUrl: 'v', logicPrefabUrl: 'l', ownedAssets: [],
      bundleRoot: 'db://assets/game',
      nodes: { root: { fileId: root.fileId, hash: root.hash, kind: root.kind, name: root.name } },
      assets: { same: { url: 'db://assets/old.png', hash: 'hash', importSettingsHash: 'settings' } },
    };
    expect(diffNormalized(result, mapping).changes).toContainEqual(expect.objectContaining({ key: 'asset:same', kind: 'update' }));
  });

  it('matches reimported nodes by stable fileId and assets by stable target URL', () => {
    const root = node('new-root');
    root.fileId = 'stable-root';
    const result: NormalizeResult = {
      root,
      issues: [],
      components: {},
      componentSets: {},
      assets: [{
        key: 'new-image-key',
        kind: 'image-fill',
        hash: 'same-image',
        targetUrl: 'db://assets/game/textures/figma/image__same.png',
        importSettingsHash: 'same-settings',
      }],
    };
    const mapping: FrameMapping = {
      schemaVersion: 4,
      source: { fileKey: 'file', nodeId: 'old-root', fileVersion: '1' },
      frameName: 'root',
      visualPrefabUrl: 'v',
      logicPrefabUrl: 'l',
      ownedAssets: [],
      bundleRoot: 'db://assets/game',
      nodes: {
        'old-root': { fileId: 'stable-root', hash: root.hash, kind: root.kind, name: root.name },
      },
      assets: {
        'old-image-key': {
          url: 'db://assets/game/textures/figma/image__same.png',
          hash: 'same-image',
          importSettingsHash: 'same-settings',
        },
      },
    };

    const diff = diffNormalized(result, mapping);
    expect(diff.changes).toContainEqual(expect.objectContaining({ key: 'node:new-root', kind: 'unchanged' }));
    expect(diff.changes).toContainEqual(expect.objectContaining({ key: 'asset:new-image-key', kind: 'unchanged' }));
    expect(diff.changes).not.toContainEqual(expect.objectContaining({ kind: 'delete' }));
    expect(diff.orphans).toEqual([]);
  });

  it('deduplicates identical local Component instance appearances', () => {
    const root = node('root');
    const first = node('instance-a', 'instance');
    const second = node('instance-b', 'instance');
    first.componentId = second.componentId = 'component:1';
    first.children = [node('Iinstance-a;child')];
    second.children = [node('Iinstance-b;child')];
    root.children = [first, second];
    const definition = node('component:1');
    definition.sourceType = 'COMPONENT';
    definition.componentId = definition.id;
    definition.name = 'Card';
    definition.children = [node('component-child')];
    const plans = planComponentPrefabs(
      [definition],
      [root],
      'db://assets/game/prefabs/item/figma',
      'db://assets/game/prefabs/item',
      { 'component:1': { name: 'Card' } },
    );
    expect(plans).toHaveLength(1);
    expect(plans[0].url).toBe('db://assets/game/prefabs/item/figma/Card.root.prefab');
    expect(plans[0].logicUrl).toBe('db://assets/game/prefabs/item/Card.prefab');
    expect(plans[0].instanceIds).toHaveLength(2);
    const referenced = applyComponentReferences(root, plans);
    expect(referenced.children[0].componentAssetKey).toBe(plans[0].key);
    expect(referenced.children[1].componentAssetKey).toBe(plans[0].key);
  });

  it('keeps a Component Prefab URL stable when its visual content changes', () => {
    const root = node('root');
    const instance = node('instance-a', 'instance');
    instance.componentId = 'component:1';
    instance.children = [node('Iinstance-a;child')];
    root.children = [instance];
    const definition = node('component:1');
    definition.sourceType = 'COMPONENT';
    definition.componentId = definition.id;
    definition.name = 'Card';
    definition.children = [node('component-child')];
    const metadata = { 'component:1': { name: 'Card' } };
    const before = planComponentPrefabs([definition], [root], 'db://assets/game/prefabs/item/figma', 'db://assets/game/prefabs/item', metadata)[0];
    definition.children[0].width = 120;
    const after = planComponentPrefabs([definition], [root], 'db://assets/game/prefabs/item/figma', 'db://assets/game/prefabs/item', metadata)[0];
    expect(after.url).toBe(before.url);
    expect(after.key).toBe(before.key);
    expect(after.hash).not.toBe(before.hash);
  });

  it('plans a standalone Figma Component even when the UI has no Instance', () => {
    const component = node('component:item');
    component.sourceType = 'COMPONENT';
    component.componentId = component.id;
    component.name = 'item_RoleHead';
    const plans = planComponentPrefabs(
      [component],
      [node('ui')],
      'db://assets/game/prefabs/item/figma',
      'db://assets/game/prefabs/item',
      {},
    );
    expect(plans).toEqual([expect.objectContaining({
      key: 'component:component:item',
      componentName: 'item_RoleHead',
      url: 'db://assets/game/prefabs/item/figma/item_RoleHead.root.prefab',
      logicUrl: 'db://assets/game/prefabs/item/item_RoleHead.prefab',
      instanceIds: [],
    })]);
  });

  it('does not treat an Instance inside the UI as an Item definition by itself', () => {
    const ui = node('ui');
    const instance = node('instance:item', 'instance');
    instance.componentId = 'component:item';
    instance.name = 'item_RoleHead';
    ui.children = [instance];

    expect(planComponentPrefabs(
      [],
      [ui],
      'db://assets/game/prefabs/item/figma',
      'db://assets/game/prefabs/item',
      { 'component:item': { name: 'item_RoleHead' } },
    )).toEqual([]);
  });
});
