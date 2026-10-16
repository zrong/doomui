import { describe, expect, it } from 'vitest';
import {
  flattenAdoptionGeometry,
  scaleAdoptionLayout,
  scaleAdoptionText,
} from '../source/core/adoption-scale';

describe('Cocos adoption scale flattening', () => {
  it('propagates a scaled Prefab root through descendant positions and sizes', () => {
    const root = flattenAdoptionGeometry(
      { x: 0, y: 0, width: 126, height: 155 },
      { x: 0.8, y: 0.8 },
    );
    const button = flattenAdoptionGeometry(
      // ScaledItem/button after anchor conversion.
      { x: 3, y: 2.131, width: 120, height: 120 },
      { x: 1, y: 1 },
      root.cumulativeScale,
    );
    const redPoint = flattenAdoptionGeometry(
      // ScaledItem/badge after its local 0.7 scale and anchor conversion.
      { x: 105.05, y: -6.15, width: 37, height: 39 },
      { x: 0.7, y: 0.7 },
      root.cumulativeScale,
    );

    expect(root.cumulativeScale).toEqual({ x: 0.8, y: 0.8 });
    expect(root.width).toBeCloseTo(100.8);
    expect(root.height).toBeCloseTo(124);
    expect(button.x).toBeCloseTo(2.4);
    expect(button.y).toBeCloseTo(1.7048);
    expect(button.width).toBeCloseTo(96);
    expect(button.height).toBeCloseTo(96);
    expect(redPoint.x).toBeCloseTo(84.04);
    expect(redPoint.y).toBeCloseTo(-4.92);
    expect(redPoint.width).toBeCloseTo(20.72);
    expect(redPoint.height).toBeCloseTo(21.84);
  });

  it('scales typography and layout metrics with the cumulative visual scale', () => {
    const text = scaleAdoptionText({
      characters: '探索',
      fontSize: 20,
      lineHeight: 24,
      color: { r: 255, g: 255, b: 255, a: 255 },
      bold: false,
      italic: false,
      underline: false,
      overflow: 'clamp',
      wrap: true,
      outline: { color: { r: 0, g: 0, b: 0, a: 255 }, width: 2 },
      shadow: {
        color: { r: 0, g: 0, b: 0, a: 128 },
        offsetX: 3,
        offsetY: -4,
        blur: 5,
      },
      horizontalAlign: 'center',
      verticalAlign: 'center',
    }, { x: 0.8, y: 0.8 });
    const layout = scaleAdoptionLayout({
      direction: 'horizontal',
      resizeMode: 'none',
      paddingLeft: 10,
      paddingRight: 12,
      paddingTop: 6,
      paddingBottom: 8,
      spacing: 5,
    }, { x: 0.8, y: 0.8 });

    expect(text.fontSize).toBeCloseTo(16);
    expect(text.lineHeight).toBeCloseTo(19.2);
    expect(text.outline?.width).toBeCloseTo(1.6);
    expect(text.shadow?.offsetX).toBeCloseTo(2.4);
    expect(text.shadow?.offsetY).toBeCloseTo(-3.2);
    expect(text.shadow?.blur).toBeCloseTo(4);
    expect(layout?.direction).toBe('horizontal');
    expect(layout?.resizeMode).toBe('none');
    expect(layout?.paddingLeft).toBeCloseTo(8);
    expect(layout?.paddingRight).toBeCloseTo(9.6);
    expect(layout?.paddingTop).toBeCloseTo(4.8);
    expect(layout?.paddingBottom).toBeCloseTo(6.4);
    expect(layout?.spacing).toBeCloseTo(4);
  });
});
