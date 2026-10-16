import { describe, expect, it } from 'vitest';
import { cocosLayoutToFigma } from '../source/core/layout-conversion';
import { normalizeFigmaFrame } from '../source/core/normalizer';
import type { CocosLayoutSnapshot } from '../source/core/layout-conversion';
import type { FigmaNode, ProjectSettings } from '../source/types';

const settings: ProjectSettings = {
  schemaVersion: 7,
  sharedTextureRoots: [],
  bundleRoot: 'db://assets/subpackages/doomui_test',
  fontMap: {},
  frames: {},
  adoptions: {},
  pendingOrphans: [],
};

function cocosLayout(overrides: Partial<CocosLayoutSnapshot> = {}): CocosLayoutSnapshot {
  return {
    enabled: true,
    type: 'horizontal',
    resizeMode: 'none',
    forward: true,
    alignCrossAxis: true,
    affectedByScale: false,
    paddingLeft: 10,
    paddingRight: 12,
    paddingTop: 14,
    paddingBottom: 14,
    spacingX: 8,
    spacingY: 6,
    children: [{ active: true, hasUiTransform: true, fixedSize: true, scaleX: 1, scaleY: 1, rotation: 0 }],
    ...overrides,
  };
}

function figmaLayout(overrides: Partial<FigmaNode> = {}): FigmaNode {
  return {
    id: '1:1',
    name: 'layout',
    type: 'FRAME',
    absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 100 },
    layoutMode: 'HORIZONTAL',
    layoutWrap: 'NO_WRAP',
    primaryAxisSizingMode: 'FIXED',
    counterAxisSizingMode: 'FIXED',
    primaryAxisAlignItems: 'MIN',
    counterAxisAlignItems: 'CENTER',
    paddingLeft: 10,
    paddingRight: 12,
    paddingTop: 14,
    paddingBottom: 14,
    itemSpacing: 8,
    children: [{
      id: '1:2',
      name: 'item',
      type: 'FRAME',
      absoluteBoundingBox: { x: 10, y: 30, width: 40, height: 40 },
      layoutPositioning: 'AUTO',
      layoutSizingHorizontal: 'FIXED',
      layoutSizingVertical: 'FIXED',
      constraints: { horizontal: 'LEFT', vertical: 'TOP' },
      children: [],
    }],
    ...overrides,
  };
}

describe('restricted bidirectional layout subset', () => {
  it('maps enabled canonical Cocos linear Layout and silently ignores a disabled Layout', () => {
    expect(cocosLayoutToFigma(cocosLayout()).layout).toEqual({
      direction: 'horizontal',
      resizeMode: 'none',
      paddingLeft: 10,
      paddingRight: 12,
      paddingTop: 14,
      paddingBottom: 14,
      spacing: 8,
    });
    expect(cocosLayoutToFigma(cocosLayout({ enabled: false }))).toEqual({});
  });

  it('bakes unsupported Cocos Layout variants instead of claiming semantic conversion', () => {
    expect(cocosLayoutToFigma(cocosLayout({ type: 'grid' })).reason).toMatch(/Grid/);
    expect(cocosLayoutToFigma(cocosLayout({ resizeMode: 'children' })).reason).toMatch(/CHILDREN/);
    expect(cocosLayoutToFigma(cocosLayout({ forward: false })).reason).toMatch(/反向排列/);
    expect(cocosLayoutToFigma(cocosLayout({ alignCrossAxis: false })).reason).toMatch(/居中对齐/);
    expect(cocosLayoutToFigma(cocosLayout({ paddingTop: 1, paddingBottom: 2 })).reason).toMatch(/Padding/);
  });

  it('normalizes canonical Figma Auto Layout into cc.Layout and lets Layout own direct child positions', () => {
    const result = normalizeFigmaFrame(figmaLayout(), {
      textureRoot: `${settings.bundleRoot}/textures/figma`,
      settings,
    });
    expect(result.root.layout).toEqual({
      direction: 'horizontal',
      resizeMode: 'none',
      paddingLeft: 10,
      paddingRight: 12,
      paddingTop: 14,
      paddingBottom: 14,
      spacing: 8,
    });
    expect(result.root.children[0].widget).toBeUndefined();
    expect(result.issues).not.toContainEqual(expect.objectContaining({ code: 'AUTO_LAYOUT_BAKED' }));
  });

  it('maps main-axis Hug to CONTAINER and bakes unsupported Auto Layout without child Widgets', () => {
    const hug = normalizeFigmaFrame(figmaLayout({ primaryAxisSizingMode: 'AUTO' }), {
      textureRoot: `${settings.bundleRoot}/textures/figma`,
      settings,
    });
    expect(hug.root.layout?.resizeMode).toBe('container');

    const wrapped = normalizeFigmaFrame(figmaLayout({ layoutWrap: 'WRAP' }), {
      textureRoot: `${settings.bundleRoot}/textures/figma`,
      settings,
    });
    expect(wrapped.root.layout).toBeUndefined();
    expect(wrapped.root.children[0].widget).toBeUndefined();
    expect(wrapped.issues).toContainEqual(expect.objectContaining({
      code: 'AUTO_LAYOUT_BAKED',
      message: expect.stringContaining('Wrap'),
    }));

    const asymmetric = normalizeFigmaFrame(figmaLayout({ paddingTop: 1, paddingBottom: 2 }), {
      textureRoot: `${settings.bundleRoot}/textures/figma`,
      settings,
    });
    expect(asymmetric.root.layout).toBeUndefined();
    expect(asymmetric.issues).toContainEqual(expect.objectContaining({
      code: 'AUTO_LAYOUT_BAKED',
      message: expect.stringContaining('Padding'),
    }));
  });
});
