import { describe, expect, it } from 'vitest';
import { toLocalTransform } from '../source/core/coordinates';
import { constraintsToWidget } from '../source/core/widget';
import { parseNineSlice, stripNineSliceMarker } from '../source/core/nine-slice';

describe('layout conversion', () => {
  const parent = { x: 100, y: 50, width: 200, height: 100 };
  const child = { x: 110, y: 60, width: 20, height: 10 };

  it('uses center anchors, flips Y and rotation', () => {
    expect(toLocalTransform(child, parent, 15)).toEqual({ x: -80, y: 35, width: 20, height: 10, rotation: -15 });
  });

  it('uses Figma relativeTransform for nested rotated nodes', () => {
    const angle = Math.PI / 2;
    const matrix: [[number, number, number], [number, number, number]] = [
      [Math.cos(angle), -Math.sin(angle), 60],
      [Math.sin(angle), Math.cos(angle), 10],
    ];
    expect(toLocalTransform(child, parent, 90, matrix, { x: 20, y: 10 })).toEqual({
      x: -45,
      y: 30,
      width: 20,
      height: 10,
      rotation: -90,
    });
  });

  it('maps stretch constraints to absolute Widget margins', () => {
    expect(constraintsToWidget({ horizontal: 'LEFT_RIGHT', vertical: 'TOP_BOTTOM' }, child, parent)).toMatchObject({
      alignLeft: true,
      alignRight: true,
      left: 10,
      right: 170,
      alignTop: true,
      alignBottom: true,
      top: 10,
      bottom: 80,
    });
  });

  it('maps scale constraints to percentages', () => {
    expect(constraintsToWidget({ horizontal: 'SCALE', vertical: 'SCALE' }, child, parent)).toMatchObject({
      left: 0.05,
      right: 0.85,
      top: 0.1,
      bottom: 0.8,
      absoluteLeft: false,
      absoluteTop: false,
    });
  });
});

describe('9-slice marker', () => {
  it('requires all four valid insets and strips the marker', () => {
    expect(parseNineSlice('Panel @9slice{l:12,r:13,t:14,b:15}', 100, 80).value).toEqual({ left: 12, right: 13, top: 14, bottom: 15 });
    expect(stripNineSliceMarker('Panel @9slice{l:12,r:13,t:14,b:15}')).toBe('Panel');
    expect(parseNineSlice('Panel @9slice{l:60,r:60,t:1,b:1}', 100, 80).error).toMatch(/宽度/);
    expect(parseNineSlice('Panel @9slice{l:1,r:1,t:1}', 100, 80).error).toMatch(/四个/);
    expect(parseNineSlice('Panel @9slice{l:1,r:1,t:,b:1}', 100, 80).error).toMatch(/不能为空/);
  });
});
