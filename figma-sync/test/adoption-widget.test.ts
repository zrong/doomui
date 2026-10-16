import { describe, expect, it } from 'vitest';
import { cocosWidgetToFigma, type CocosWidgetSnapshot } from '../source/core/adoption-widget';

function widget(overrides: Partial<CocosWidgetSnapshot> = {}): CocosWidgetSnapshot {
  return {
    enabled: true,
    targetIsParent: true,
    alignLeft: false,
    alignRight: false,
    alignTop: false,
    alignBottom: false,
    alignHorizontalCenter: false,
    alignVerticalCenter: false,
    absoluteLeft: true,
    absoluteRight: true,
    absoluteTop: true,
    absoluteBottom: true,
    absoluteHorizontalCenter: true,
    absoluteVerticalCenter: true,
    ...overrides,
  };
}

describe('restricted Cocos Widget to Figma Constraints conversion', () => {
  it('maps edge, center, stretch, and proportional pairs', () => {
    expect(cocosWidgetToFigma(widget({ alignLeft: true, alignTop: true })).constraints).toEqual({ horizontal: 'MIN', vertical: 'MIN' });
    expect(cocosWidgetToFigma(widget({ alignRight: true, alignBottom: true })).constraints).toEqual({ horizontal: 'MAX', vertical: 'MAX' });
    expect(cocosWidgetToFigma(widget({ alignHorizontalCenter: true, alignVerticalCenter: true })).constraints).toEqual({ horizontal: 'CENTER', vertical: 'CENTER' });
    expect(cocosWidgetToFigma(widget({ alignLeft: true, alignRight: true, alignTop: true, alignBottom: true })).constraints).toEqual({ horizontal: 'STRETCH', vertical: 'STRETCH' });
    expect(cocosWidgetToFigma(widget({
      alignLeft: true,
      alignRight: true,
      alignTop: true,
      alignBottom: true,
      absoluteLeft: false,
      absoluteRight: false,
      absoluteTop: false,
      absoluteBottom: false,
    })).constraints).toEqual({ horizontal: 'SCALE', vertical: 'SCALE' });
  });

  it('bakes unsupported target and mixed units instead of claiming semantic conversion', () => {
    expect(cocosWidgetToFigma(widget({ targetIsParent: false })).reason).toMatch(/直接父节点/);
    expect(cocosWidgetToFigma(widget({ alignLeft: true, alignRight: true, absoluteRight: false })).reason).toMatch(/混用/);
    expect(cocosWidgetToFigma(widget({ alignHorizontalCenter: true, absoluteHorizontalCenter: false })).reason).toMatch(/百分比水平中心/);
    expect(cocosWidgetToFigma(widget({ enabled: false }))).toEqual({});
  });
});
