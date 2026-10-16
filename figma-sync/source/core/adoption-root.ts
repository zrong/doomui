import type { SceneAdoptionNode } from '../types';

export function toFigmaAdoptionRoot(
  exported: SceneAdoptionNode,
  prefabName: string,
  unwrapVisualRoot: boolean,
): SceneAdoptionNode {
  const visual = unwrapVisualRoot && exported.children.length === 1
    ? exported.children[0]
    : undefined;
  if (!visual) return { ...exported, name: prefabName, x: 0, y: 0 };
  return {
    ...visual,
    sourceFileId: exported.sourceFileId,
    name: prefabName,
    x: 0,
    y: 0,
    width: exported.width,
    height: exported.height,
  };
}
