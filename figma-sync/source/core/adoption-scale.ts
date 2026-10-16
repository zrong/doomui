import type { CocosAdoptionText, LinearLayoutSpec } from '../types';

export interface AdoptionScale {
  x: number;
  y: number;
}

export interface FlattenedAdoptionGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  cumulativeScale: AdoptionScale;
}

function absoluteFiniteScale(value: number): number {
  return Number.isFinite(value) ? Math.abs(value) : 1;
}

export function flattenAdoptionGeometry(
  geometry: { x: number; y: number; width: number; height: number },
  localScale: AdoptionScale,
  parentScale: AdoptionScale = { x: 1, y: 1 },
): FlattenedAdoptionGeometry {
  const cumulativeScale = {
    x: absoluteFiniteScale(parentScale.x) * absoluteFiniteScale(localScale.x),
    y: absoluteFiniteScale(parentScale.y) * absoluteFiniteScale(localScale.y),
  };
  return {
    x: geometry.x * parentScale.x,
    y: geometry.y * parentScale.y,
    width: Math.max(1, geometry.width * cumulativeScale.x),
    height: Math.max(1, geometry.height * cumulativeScale.y),
    cumulativeScale,
  };
}

export function scaleAdoptionLayout(
  layout: LinearLayoutSpec | undefined,
  scale: AdoptionScale,
): LinearLayoutSpec | undefined {
  if (!layout) return undefined;
  return {
    ...layout,
    paddingLeft: layout.paddingLeft * scale.x,
    paddingRight: layout.paddingRight * scale.x,
    paddingTop: layout.paddingTop * scale.y,
    paddingBottom: layout.paddingBottom * scale.y,
    spacing: layout.spacing * (layout.direction === 'horizontal' ? scale.x : scale.y),
  };
}

export function scaleAdoptionText(text: CocosAdoptionText, scale: AdoptionScale): CocosAdoptionText {
  // Figma has no independent X/Y text scale. Vertical scale preserves the
  // font metrics; callers warn when X/Y differ because that case is lossy.
  const textScale = Math.max(0.01, scale.y);
  return {
    ...text,
    fontSize: text.fontSize * textScale,
    lineHeight: text.lineHeight * textScale,
    outline: text.outline ? {
      ...text.outline,
      width: text.outline.width * textScale,
    } : undefined,
    shadow: text.shadow ? {
      ...text.shadow,
      offsetX: text.shadow.offsetX * scale.x,
      offsetY: text.shadow.offsetY * scale.y,
      blur: text.shadow.blur * textScale,
    } : undefined,
  };
}
