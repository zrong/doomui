import { describe, expect, it } from 'vitest';
import { collectDependencyConflicts } from '../source/core/dependency-conflicts';
import type { AssetTask, ComponentPrefabPlan, FrameMapping, NormalizedNode } from '../source/types';

function root(): NormalizedNode {
  return {
    id: 'root', fileId: 'root', name: 'root', sourceType: 'FRAME', kind: 'container', renderMode: 'none',
    visible: true, opacity: 1, x: 0, y: 0, width: 100, height: 100, rotation: 0, hash: 'root', children: [],
  };
}

function mapping(assets: FrameMapping['assets']): FrameMapping {
  return {
    schemaVersion: 4,
    source: { fileKey: 'file', nodeId: '1:1', fileVersion: '1' },
    frameName: 'UI_Other',
    visualPrefabUrl: 'db://assets/game/prefabs/view/figma/UI_Other.root.prefab',
    logicPrefabUrl: 'db://assets/game/prefabs/view/UI_Other.prefab',
    nodes: {}, assets, ownedAssets: [], bundleRoot: 'db://assets/game',
  };
}

function image(key: string, importSettingsHash: string): AssetTask {
  return {
    key,
    kind: 'image-fill',
    imageRef: 'same-image-content',
    hash: 'same-image-content',
    targetUrl: 'db://assets/game/textures/figma/image__same.png',
    importSettingsHash,
  };
}

describe('shared generated dependency conflicts', () => {
  it('allows one content-addressed texture when import settings match', () => {
    const issues = collectDependencyConflicts(
      [image('fill:same:a', 'settings-a')],
      [],
      { other: mapping({ 'fill:same:a': { url: image('', '').targetUrl, hash: 'same-image-content', importSettingsHash: 'settings-a' } }) },
      'current',
    );
    expect(issues).toEqual([]);
  });

  it('blocks conflicting nine-slice settings for the same image path', () => {
    const issues = collectDependencyConflicts(
      [image('fill:same:b', 'settings-b')],
      [],
      { other: mapping({ 'fill:same:a': { url: image('', '').targetUrl, hash: 'same-image-content', importSettingsHash: 'settings-a' } }) },
      'current',
    );
    expect(issues).toContainEqual(expect.objectContaining({ code: 'TEXTURE_IMPORT_SETTINGS_CONFLICT' }));
  });

  it('blocks different Components that sanitize to the same flat Prefab path', () => {
    const plans: ComponentPrefabPlan[] = [
      { key: 'component:a', componentName: 'Card', url: 'db://assets/game/prefabs/item/figma/Card.root.prefab', logicUrl: 'db://assets/game/prefabs/item/Card.prefab', hash: 'a', root: root(), instanceIds: ['1'] },
      { key: 'component:b', componentName: 'Card', url: 'db://assets/game/prefabs/item/figma/Card.root.prefab', logicUrl: 'db://assets/game/prefabs/item/Card.prefab', hash: 'b', root: root(), instanceIds: ['2'] },
    ];
    expect(collectDependencyConflicts([], plans, {}, 'current'))
      .toContainEqual(expect.objectContaining({ code: 'COMPONENT_NAME_COLLISION' }));
  });

  it('keeps Item and UI visual Prefabs in separate directories', () => {
    const plan: ComponentPrefabPlan = {
      key: 'component:ui-other',
      componentName: 'UI_Other',
      url: 'db://assets/game/prefabs/item/figma/UI_Other.root.prefab',
      logicUrl: 'db://assets/game/prefabs/item/UI_Other.prefab',
      hash: 'component', root: root(), instanceIds: ['1'],
    };
    expect(collectDependencyConflicts([], [plan], { other: mapping({}) }, 'current')).toEqual([]);
  });

  it('blocks a Component path that would overwrite the current visual Frame Prefab', () => {
    const plan: ComponentPrefabPlan = {
      key: 'component:ui-current',
      componentName: 'UI_Current',
      url: 'db://assets/game/prefabs/item/figma/UI_Current.root.prefab',
      logicUrl: 'db://assets/game/prefabs/item/UI_Current.prefab',
      hash: 'component', root: root(), instanceIds: ['1'],
    };
    expect(collectDependencyConflicts([], [plan], {}, 'current', [plan.url]))
      .toContainEqual(expect.objectContaining({ code: 'COMPONENT_NAME_COLLISION' }));
  });
});
