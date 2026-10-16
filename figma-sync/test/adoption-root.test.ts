import { describe, expect, it } from 'vitest';
import { toFigmaAdoptionRoot } from '../source/core/adoption-root';
import type { SceneAdoptionNode } from '../source/types';

function node(name: string, width: number, height: number, sourceFileId = name): SceneAdoptionNode {
  return {
    sourceFileId, name, kind: 'frame', visible: true, opacity: 1,
    x: 0, y: 0, width, height, rotation: 0, button: false, children: [],
  };
}

describe('Cocos Prefab adoption root', () => {
  it('unwraps the canonical root visual instance while keeping logic Prefab size and identity', () => {
    const logic = node('UI_Test', 1080, 1920, 'logic-file-id');
    const visual = node('root', 720, 1280, 'visual-file-id');
    visual.sprite = { color: { r: 255, g: 255, b: 255, a: 255 }, sliced: false };
    visual.children = [node('$btn_play', 100, 40)];
    logic.children = [visual];

    const result = toFigmaAdoptionRoot(logic, 'UI_Test', true);

    expect(result).toMatchObject({
      name: 'UI_Test', sourceFileId: 'logic-file-id', width: 1080, height: 1920,
      sprite: visual.sprite,
    });
    expect(result.children).toEqual(visual.children);
  });

  it('keeps a non-canonical Prefab tree unchanged apart from top-level placement', () => {
    const logic = node('OldName', 750, 1334, 'logic-file-id');
    logic.x = 12;
    logic.y = 30;
    expect(toFigmaAdoptionRoot(logic, 'UI_Test', false))
      .toMatchObject({ name: 'UI_Test', x: 0, y: 0, width: 750, height: 1334 });
  });
});
