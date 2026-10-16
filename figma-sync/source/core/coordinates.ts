import type { FigmaRectangle } from '../types';

export interface LocalTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export function toLocalTransform(
  bounds: FigmaRectangle,
  parentBounds: FigmaRectangle | undefined,
  rotation = 0,
  relativeTransform?: [[number, number, number], [number, number, number]],
  size?: { x: number; y: number },
): LocalTransform {
  const width = size?.x ?? bounds.width;
  const height = size?.y ?? bounds.height;
  if (!parentBounds) {
    return { x: 0, y: 0, width, height, rotation: -rotation };
  }
  if (relativeTransform) {
    const [[a, c, tx], [b, d, ty]] = relativeTransform;
    const centerX = a * width / 2 + c * height / 2 + tx;
    const centerY = b * width / 2 + d * height / 2 + ty;
    return {
      x: centerX - parentBounds.width / 2,
      y: parentBounds.height / 2 - centerY,
      width,
      height,
      rotation: -(Math.atan2(b, a) * 180 / Math.PI),
    };
  }
  return {
    x: bounds.x - parentBounds.x + bounds.width / 2 - parentBounds.width / 2,
    y: parentBounds.height / 2 - (bounds.y - parentBounds.y + bounds.height / 2),
    width,
    height,
    rotation: -rotation,
  };
}
