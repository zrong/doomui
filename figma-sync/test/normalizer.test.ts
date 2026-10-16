import { describe, expect, it } from 'vitest';
import basicFrame from './fixtures/frame-basic.json';
import buttonFrame from './fixtures/frame-button.json';
import { normalizeFigmaFrame } from '../source/core/normalizer';
import { applyButtonSemantics } from '../source/core/variants';
import type { FigmaNode, ProjectSettings } from '../source/types';

const settings: ProjectSettings = {
  schemaVersion: 7,
  sharedTextureRoots: [],
  bundleRoot: 'db://assets/subpackages/doomui_test',
  fontMap: { 'Inter/Regular': 'db://assets/fonts/Inter-Regular.ttf' },
  frames: {},
  adoptions: {},
  pendingOrphans: [],
};
const textureRoot = `${settings.bundleRoot}/textures/figma`;

describe('Figma normalization', () => {
  it('creates semantic Sprite/Label nodes and Widget data', () => {
    const result = normalizeFigmaFrame(basicFrame as FigmaNode, {
      textureRoot,
      settings,
    });
    expect(result.root.children).toHaveLength(2);
    expect(result.root.children[0]).toMatchObject({
      name: 'bg',
      kind: 'sprite',
      x: 0,
      y: 0,
      sprite: { nineSlice: { left: 4, right: 4, top: 4, bottom: 4 } },
      widget: { alignLeft: true, alignRight: true, left: 10, right: 10 },
    });
    expect(result.root.children[1].label).toMatchObject({ text: 'Doom UI', fontUrl: 'db://assets/fonts/Inter-Regular.ttf' });
    expect(result.assets.map((asset) => asset.kind)).toContain('generated-solid');
    expect(result.assets.find((asset) => asset.kind === 'generated-solid')?.nineSlice).toEqual({ left: 4, right: 4, top: 4, bottom: 4 });
    expect(result.issues).not.toContainEqual(expect.objectContaining({ code: 'FONT_UNMAPPED' }));
  });

  it('rasterizes rich text and warns on unmapped fonts', () => {
    const frame = structuredClone(basicFrame) as FigmaNode;
    const text = frame.children![1];
    text.styleOverrideTable = { '1': { fontWeight: 700 } };
    const result = normalizeFigmaFrame(frame, { textureRoot, settings: { ...settings, fontMap: {} } });
    expect(result.root.children[1].renderMode).toBe('raster');
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'TEXT_RASTERIZED' }));
  });

  it('maps supported text styling, truncation, and one drop shadow into Label', () => {
    const frame = structuredClone(basicFrame) as FigmaNode;
    const text = frame.children![1];
    text.style = {
      ...text.style,
      fontFamily: 'Inter',
      fontStyle: 'Bold Italic',
      fontWeight: 700,
      textAlignHorizontal: 'CENTER',
      textAlignVertical: 'BOTTOM',
    };
    text.textAutoResize = 'NONE';
    text.textTruncation = 'ENDING';
    text.maxLines = 1;
    text.textDecoration = 'UNDERLINE';
    text.effects = [{
      type: 'DROP_SHADOW',
      color: { r: 0, g: 0, b: 0, a: 0.5 },
      offset: { x: 3, y: 4 },
      radius: 6,
      spread: 0,
      blendMode: 'NORMAL',
    }];

    const result = normalizeFigmaFrame(frame, { textureRoot, settings });
    expect(result.root.children[1]).toMatchObject({
      renderMode: 'label',
      label: {
        bold: true,
        italic: true,
        underline: true,
        overflow: 'clamp',
        wrap: false,
        horizontalAlign: 'center',
        verticalAlign: 'bottom',
        shadow: { color: { r: 0, g: 0, b: 0, a: 128 }, offsetX: 3, offsetY: -4, blur: 6 },
      },
    });
    expect(result.issues).not.toContainEqual(expect.objectContaining({ code: 'TEXT_RASTERIZED' }));
  });

  it('maps image fill opacity to Sprite alpha', () => {
    const frame = structuredClone(basicFrame) as FigmaNode;
    frame.children = [{
      id: 'image:alpha',
      name: 'faded',
      type: 'RECTANGLE',
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      fills: [{ type: 'IMAGE', imageRef: 'faded-image', scaleMode: 'FIT', opacity: 0.4 }],
    }];
    const result = normalizeFigmaFrame(frame, { textureRoot, settings });
    expect(result.root.children[0].sprite?.color).toEqual({ r: 255, g: 255, b: 255, a: 102 });
  });

  it('keeps Component Set for analysis but marks it runtime-ignored', () => {
    const result = normalizeFigmaFrame(buttonFrame as FigmaNode, { textureRoot, settings });
    applyButtonSemantics(result.root, result.issues);
    const set = result.root.children.find((node) => node.sourceType === 'COMPONENT_SET')!;
    const instance = result.root.children.find((node) => node.kind === 'instance')!;
    expect(set.kind).toBe('ignored');
    expect(instance.button?.transition).toBe('color');
    expect(instance.button?.hoverColor).not.toEqual(instance.button?.normalColor);
  });

  it('deduplicates visually identical raster nodes independent of node ID and canvas position', () => {
    const frame = structuredClone(basicFrame) as FigmaNode;
    frame.children = [
      {
        id: 'vector:1', name: 'icon-a', type: 'VECTOR', absoluteBoundingBox: { x: 110, y: 60, width: 20, height: 20 },
        fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }],
      },
      {
        id: 'vector:2', name: 'icon-b', type: 'VECTOR', absoluteBoundingBox: { x: 210, y: 100, width: 20, height: 20 },
        fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }],
      },
    ];
    const result = normalizeFigmaFrame(frame, { textureRoot, settings });
    expect(result.assets.filter((asset) => asset.kind === 'raster')).toHaveLength(1);
    expect(result.root.children[0].sprite?.assetKey).toBe(result.root.children[1].sprite?.assetKey);
  });

  it('shares one image asset between SIMPLE and SLICED nodes', () => {
    const frame = structuredClone(basicFrame) as FigmaNode;
    frame.children = [
      {
        id: 'image:1', name: 'plain', type: 'RECTANGLE',
        absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
        fills: [{ type: 'IMAGE', imageRef: 'figma-content-hash', scaleMode: 'FIT' }],
      },
      {
        id: 'image:2', name: 'panel @9slice{l:10,r:10,t:10,b:10}', type: 'RECTANGLE',
        absoluteBoundingBox: { x: 120, y: 0, width: 100, height: 100 },
        fills: [{ type: 'IMAGE', imageRef: 'figma-content-hash', scaleMode: 'FIT' }],
      },
    ];
    const result = normalizeFigmaFrame(frame, { textureRoot, settings });
    expect(result.assets).toHaveLength(1);
    expect(result.root.children[0].sprite?.assetKey).toBe(result.root.children[1].sprite?.assetKey);
    expect(result.root.children[0].sprite?.nineSlice).toBeUndefined();
    expect(result.root.children[1].sprite?.nineSlice).toEqual({ left: 10, right: 10, top: 10, bottom: 10 });
    expect(result.assets[0].nineSlice).toEqual({ left: 10, right: 10, top: 10, bottom: 10 });
    expect(result.assets[0].targetUrl).toMatch(/\/textures\/figma\/image__/);
    expect(result.issues).not.toContainEqual(expect.objectContaining({ code: 'TEXTURE_IMPORT_SETTINGS_CONFLICT' }));
  });

  it('blocks two different non-empty nine-slice borders for one image', () => {
    const frame = structuredClone(basicFrame) as FigmaNode;
    frame.children = [
      {
        id: 'image:1', name: 'panel-a @9slice{l:10,r:10,t:10,b:10}', type: 'RECTANGLE',
        absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
        fills: [{ type: 'IMAGE', imageRef: 'figma-content-hash', scaleMode: 'FILL' }],
      },
      {
        id: 'image:2', name: 'panel-b @9slice{l:12,r:12,t:8,b:8}', type: 'RECTANGLE',
        absoluteBoundingBox: { x: 120, y: 0, width: 100, height: 100 },
        fills: [{ type: 'IMAGE', imageRef: 'figma-content-hash', scaleMode: 'FILL' }],
      },
    ];

    const result = normalizeFigmaFrame(frame, { textureRoot, settings });
    expect(result.assets).toHaveLength(1);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: 'blocker',
      code: 'TEXTURE_IMPORT_SETTINGS_CONFLICT',
      nodeId: 'image:2',
    }));
  });

  it('preserves a nine-slice FILL background on a semantic container', () => {
    const frame = structuredClone(basicFrame) as FigmaNode;
    frame.children = [{
      id: 'button:1',
      name: '$btn_action @9slice{l:16,r:16,t:12,b:12}',
      type: 'FRAME',
      absoluteBoundingBox: { x: 0, y: 0, width: 220, height: 72 },
      fills: [{
        type: 'IMAGE',
        imageRef: 'button-background',
        scaleMode: 'FILL',
        imageTransform: [[1, 0, 0], [0, 1, 0]],
      }],
      children: [{
        id: 'button-label:1',
        name: '$txt_label',
        type: 'TEXT',
        absoluteBoundingBox: { x: 60, y: 20, width: 100, height: 32 },
        fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }],
        characters: 'Action',
        style: {
          fontFamily: 'Inter',
          fontStyle: 'Regular',
          fontSize: 24,
          lineHeightPx: 32,
          textAlignHorizontal: 'CENTER',
          textAlignVertical: 'CENTER',
        },
      }],
    }];

    const result = normalizeFigmaFrame(frame, { textureRoot, settings });
    expect(result.root.children[0]).toMatchObject({
      name: '$btn_action',
      kind: 'container',
      renderMode: 'image-fill',
      sprite: {
        source: 'image-fill',
        nineSlice: { left: 16, right: 16, top: 12, bottom: 12 },
      },
    });
    expect(result.root.children[0].children).toHaveLength(1);
    expect(result.assets).toContainEqual(expect.objectContaining({
      kind: 'image-fill',
      imageRef: 'button-background',
      nineSlice: { left: 16, right: 16, top: 12, bottom: 12 },
    }));
  });

  it('blocks an unsupported plain FILL on a semantic container instead of silently dropping its background', () => {
    const frame = structuredClone(basicFrame) as FigmaNode;
    frame.children = [{
      id: 'panel:1',
      name: '$node_panel',
      type: 'FRAME',
      absoluteBoundingBox: { x: 0, y: 0, width: 220, height: 72 },
      fills: [{
        type: 'IMAGE',
        imageRef: 'cropped-background',
        scaleMode: 'FILL',
        imageTransform: [[1, 0, 0], [0, 1, 0]],
      }],
      children: [{
        id: 'panel-label:1',
        name: '$txt_label',
        type: 'TEXT',
        absoluteBoundingBox: { x: 60, y: 20, width: 100, height: 32 },
        fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }],
        characters: 'Action',
        style: {
          fontFamily: 'Inter',
          fontStyle: 'Regular',
          fontSize: 24,
          lineHeightPx: 32,
          textAlignHorizontal: 'CENTER',
          textAlignVertical: 'CENTER',
        },
      }],
    }];

    const result = normalizeFigmaFrame(frame, { textureRoot, settings });
    expect(result.root.children[0]).toMatchObject({ renderMode: 'none', sprite: undefined });
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: 'blocker',
      code: 'CONTAINER_BACKGROUND_UNSUPPORTED',
      nodeId: 'panel:1',
    }));
  });
});
