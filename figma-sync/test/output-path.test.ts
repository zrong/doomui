import { describe, expect, it } from 'vitest';
import {
  mappingBundleIssues,
  normalizeSyncRequest,
  resolveOutputPaths,
} from '../source/core/output-path';
import type { FrameMapping, SyncRequest } from '../source/types';

const request: SyncRequest = {
  sourceUrl: 'https://www.figma.com/design/file/name?node-id=1-2',
  bundleRoot: 'db://assets/subpackages/doomui_test/',
};

function mapping(overrides: Partial<FrameMapping> = {}): FrameMapping {
  return {
    schemaVersion: 4,
    source: { fileKey: 'file', nodeId: '1:2', fileVersion: '1' },
    frameName: 'UI_Test',
    visualPrefabUrl: 'db://assets/subpackages/doomui_test/prefabs/view/figma/UI_Test.root.prefab',
    logicPrefabUrl: 'db://assets/subpackages/doomui_test/prefabs/view/UI_Test.prefab',
    nodes: {},
    assets: {},
    ownedAssets: [],
    bundleRoot: 'db://assets/subpackages/doomui_test',
    ...overrides,
  };
}

describe('unified bundle output layout', () => {
  it('keeps logic, visual, components, and textures inside the selected bundle', () => {
    expect(resolveOutputPaths(request, 'UI_DoomUITest')).toEqual({
      root: 'db://assets/subpackages/doomui_test',
      logicPrefabUrl: 'db://assets/subpackages/doomui_test/prefabs/view/UI_DoomUITest.prefab',
      visualPrefabUrl: 'db://assets/subpackages/doomui_test/prefabs/view/figma/UI_DoomUITest.root.prefab',
      itemVisualRoot: 'db://assets/subpackages/doomui_test/prefabs/item/figma',
      itemRoot: 'db://assets/subpackages/doomui_test/prefabs/item',
      textureRoot: 'db://assets/subpackages/doomui_test/textures/figma',
    });
  });

  it('requires a safe Asset Bundle root', () => {
    expect(() => normalizeSyncRequest({ ...request, bundleRoot: '' }))
      .toThrow(/必须填写 Asset Bundle 根目录/);
    expect(() => normalizeSyncRequest({ ...request, bundleRoot: '../hall' }))
      .toThrow(/必须位于 db:\/\/assets/);
  });

  it('locks a mapped Frame to its original bundle root', () => {
    expect(mappingBundleIssues(mapping(), 'db://assets/subpackages/doomui_test')).toEqual([]);
    expect(mappingBundleIssues(mapping(), 'db://assets/subpackages/battle'))
      .toContainEqual(expect.objectContaining({ code: 'BUNDLE_ROOT_LOCKED' }));
  });
});
