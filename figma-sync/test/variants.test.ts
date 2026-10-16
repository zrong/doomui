import { describe, expect, it } from 'vitest';
import type { NormalizedNode, RGBA } from '../source/types';
import { groupButtonVariants, inferButtonSpec } from '../source/core/variants';

const color = (r: number): RGBA => ({ r, g: 20, b: 30, a: 255 });

function variant(id: string, state: string, asset: string, tint = color(10), width = 100): NormalizedNode {
  return {
    id,
    fileId: id,
    name: `State=${state}, Size=Large`,
    sourceType: 'COMPONENT',
    kind: 'container',
    renderMode: 'none',
    visible: true,
    opacity: 1,
    x: 0,
    y: 0,
    width,
    height: width / 2,
    rotation: 0,
    hash: id,
    variantProperties: { State: state, Size: 'Large' },
    children: [{
      id: `${id}:bg`, fileId: `${id}:bg`, name: 'bg', sourceType: 'RECTANGLE', kind: 'sprite', renderMode: 'image-fill',
      visible: true, opacity: 1, x: 0, y: 0, width: 100, height: 50, rotation: 0, hash: `${id}:bg`, children: [],
      sprite: { assetKey: asset, source: 'image-fill', color: tint },
    }],
  };
}

function setOf(...children: NormalizedNode[]): NormalizedNode {
  return {
    id: 'set', fileId: 'set', name: 'Button/Primary', sourceType: 'COMPONENT_SET', kind: 'ignored', renderMode: 'none',
    visible: true, opacity: 1, x: 0, y: 0, width: 0, height: 0, rotation: 0, hash: 'set', children,
  };
}

describe('Button variants', () => {
  it('isolates non-State properties and falls missing states back to Normal', () => {
    const groups = groupButtonVariants(setOf(variant('a', 'Default', 'normal'), variant('b', 'Hover', 'hover')));
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('Size=Large');
    const inferred = inferButtonSpec(groups[0]);
    expect(inferred.spec).toMatchObject({ transition: 'sprite', normalAssetKey: 'normal', hoverAssetKey: 'hover', pressedAssetKey: 'normal', disabledAssetKey: 'normal' });
  });

  it('detects a color-only transition', () => {
    const [group] = groupButtonVariants(setOf(variant('a', 'Normal', 'white', color(10)), variant('b', 'Pressed', 'white', color(50))));
    expect(inferButtonSpec(group).spec?.transition).toBe('color');
  });

  it('detects a root scale-only transition', () => {
    const [group] = groupButtonVariants(setOf(variant('a', 'Normal', 'white'), variant('b', 'Pressed', 'white', color(10), 95)));
    expect(inferButtonSpec(group).spec).toMatchObject({ transition: 'scale', zoomScale: 0.95, targetFigmaId: 'a' });
  });

  it('blocks duplicate or missing Normal states', () => {
    const [duplicate] = groupButtonVariants(setOf(variant('a', 'Normal', 'a'), variant('b', 'Default', 'b')));
    expect(duplicate.issues).toContainEqual(expect.objectContaining({ severity: 'blocker', code: 'BUTTON_STATE_DUPLICATE' }));
    const [missing] = groupButtonVariants(setOf(variant('a', 'Hover', 'a')));
    expect(missing.issues).toContainEqual(expect.objectContaining({ severity: 'blocker', code: 'BUTTON_NORMAL_MISSING' }));
  });

  it('degrades multiple simultaneous changes to Transition.NONE', () => {
    const [group] = groupButtonVariants(setOf(variant('a', 'Normal', 'a', color(10)), variant('b', 'Pressed', 'b', color(20))));
    const inferred = inferButtonSpec(group);
    expect(inferred.spec?.transition).toBe('none');
    expect(inferred.issues).toContainEqual(expect.objectContaining({ code: 'BUTTON_COMPLEX_STATE' }));
  });
});
