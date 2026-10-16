import { describe, expect, it } from 'vitest';
import { stripLegacyItemTemplates } from '../source/core/list-items';
import { normalizeFigmaFrame } from '../source/core/normalizer';
import type { FigmaNode, ProjectSettings } from '../source/types';

const settings: ProjectSettings = {
  schemaVersion: 7,
  bundleRoot: 'db://assets/subpackages/hall',
  sharedTextureRoots: [],
  fontMap: {},
  frames: {},
  adoptions: {},
  pendingOrphans: [],
};

function box(id: string, name: string, type = 'FRAME', children: FigmaNode[] = []): FigmaNode {
  return {
    id,
    name,
    type,
    absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
    children,
  };
}

function normalize(document: FigmaNode) {
  return normalizeFigmaFrame(document, {
    textureRoot: 'db://assets/subpackages/hall/textures/figma',
    settings,
  });
}

describe('$list_ manual Item relation', () => {
  it('keeps an arbitrary-depth list without requiring an Item Instance', () => {
    const document = box('root', 'UI_Role', 'FRAME', [
      box('panel', '$node_panel', 'FRAME', [
        box('heads', '$list_HeadScrollView'),
      ]),
    ]);
    const normalized = normalize(document);
    const result = stripLegacyItemTemplates(document, normalized.root);
    expect(result.issues).toEqual([]);
    expect(result.runtimeRoot.children[0].children[0]).toMatchObject({
      id: 'heads',
      name: '$list_HeadScrollView',
      children: [],
    });
  });

  it('omits a legacy $item_template sample without using it as an association', () => {
    const document = box('root', 'UI_Role', 'FRAME', [
      box('heads', '$list_HeadScrollView', 'FRAME', [
        box('template', '$item_template', 'INSTANCE', [box('avatar', 'avatar')]),
      ]),
    ]);
    const normalized = normalize(document);
    const result = stripLegacyItemTemplates(document, normalized.root);
    expect(result.runtimeRoot.children[0].children).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: 'warning',
      code: 'ITEM_TEMPLATE_DEPRECATED',
      nodeId: 'template',
    }));
  });
});
