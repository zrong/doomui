import { describe, expect, it } from 'vitest';
import { applyAdoptionFileIds } from '../source/services/sync-service';
import { collectNodeMapping } from '../source/core/diff';
import type { AdoptionMapping, AssetTask, NormalizeResult, NormalizedNode } from '../source/types';

function node(id: string, children: NormalizedNode[] = []): NormalizedNode {
  return {
    id,
    fileId: `generated-${id}`,
    name: id,
    sourceType: 'FRAME',
    kind: 'container',
    renderMode: 'none',
    visible: true,
    opacity: 1,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    hash: `hash-${id}`,
    children,
  };
}

function adoption(nodes: AdoptionMapping['nodes']): AdoptionMapping {
  return {
    schemaVersion: 3,
    kind: 'view',
    sourcePrefabUrl: 'db://assets/game/prefabs/view/UI.prefab',
    sourcePrefabUuid: 'uuid',
    sourcePrefabHash: 'hash',
    figma: { fileKey: 'file', fileName: 'File', nodeId: '1:2' },
    nodes,
    createdAt: '2026-08-29T00:00:00.000Z',
    assets: {},
  };
}

describe('adopted Cocos file IDs', () => {
  it('reuses imported file IDs and leaves newly designed Figma nodes generated', () => {
    const root = node('1:2', [node('1:3'), node('1:4')]);
    const issues = applyAdoptionFileIds(root, adoption({
      '1:2': { cocosFileId: 'cocos-root', cocosNodeName: 'UI' },
      '1:3': { cocosFileId: 'cocos-child', cocosNodeName: '$btn_close' },
    }));
    expect(issues).toEqual([]);
    const mapping = collectNodeMapping({ root, issues: [], assets: [], components: {}, componentSets: {} } satisfies NormalizeResult);
    expect(mapping['1:2'].fileId).toBe('cocos-root');
    expect(mapping['1:3'].fileId).toBe('cocos-child');
    expect(mapping['1:4'].fileId).toBe('generated-1:4');
  });

  it('blocks duplicate adopted file IDs', () => {
    const root = node('1:2', [node('1:3')]);
    const issues = applyAdoptionFileIds(root, adoption({
      '1:2': { cocosFileId: 'duplicate', cocosNodeName: 'UI' },
      '1:3': { cocosFileId: 'duplicate', cocosNodeName: '$btn_close' },
    }));
    expect(issues).toContainEqual(expect.objectContaining({ severity: 'blocker', code: 'ADOPTION_FILE_ID_DUPLICATE' }));
  });

  it('restores an unchanged adopted Label box and suppresses Figma default constraints', () => {
    const label = node('1:3');
    Object.assign(label, {
      sourceType: 'TEXT',
      kind: 'label',
      renderMode: 'label',
      width: 80,
      height: 22,
      x: -2,
      y: -51.92,
      widget: {
        alignLeft: true,
        alignTop: true,
        left: 8,
        top: 90.92,
        absoluteLeft: true,
        absoluteTop: true,
      },
      label: {
        text: '道具名字',
        fontSize: 20,
        lineHeight: 22,
        color: { r: 255, g: 255, b: 255, a: 255 },
        horizontalAlign: 'center',
        verticalAlign: 'center',
        overflow: 'clamp',
        wrap: false,
        bold: false,
        italic: false,
        underline: false,
      },
    } satisfies Partial<NormalizedNode>);
    const root = node('1:2', [label]);

    expect(applyAdoptionFileIds(root, adoption({
      '1:3': {
        cocosFileId: 'cocos-label',
        cocosNodeName: '$txt_name',
        sourceWidgetMapped: false,
        sourceText: {
          width: 84,
          height: 31.72,
          importedWidth: 80,
          importedHeight: 22,
          overflow: 'none',
          wrap: true,
        },
      },
    }))).toEqual([]);

    expect(label).toMatchObject({
      fileId: 'cocos-label',
      x: 0,
      y: -56.78,
      width: 84,
      height: 31.72,
      widget: undefined,
      label: { overflow: 'none', wrap: true },
    });
  });

  it('keeps deliberate non-default Figma constraints and changed text-box semantics', () => {
    const label = node('1:3');
    Object.assign(label, {
      kind: 'label',
      renderMode: 'label',
      width: 120,
      height: 31.72,
      widget: {
        alignHorizontalCenter: true,
        alignTop: true,
        horizontalCenter: 0,
        top: 90.92,
        absoluteHorizontalCenter: true,
        absoluteTop: true,
      },
      label: {
        text: '设计修改',
        fontSize: 20,
        lineHeight: 22,
        color: { r: 255, g: 255, b: 255, a: 255 },
        horizontalAlign: 'center',
        verticalAlign: 'center',
        overflow: 'clamp',
        wrap: false,
        bold: false,
        italic: false,
        underline: false,
      },
    } satisfies Partial<NormalizedNode>);
    applyAdoptionFileIds(node('1:2', [label]), adoption({
      '1:3': {
        cocosFileId: 'cocos-label',
        cocosNodeName: '$txt_name',
        sourceWidgetMapped: false,
        sourceText: {
          width: 84,
          height: 31.72,
          importedWidth: 84,
          importedHeight: 31.72,
          overflow: 'none',
          wrap: true,
        },
      },
    }));

    expect(label.widget).toMatchObject({ alignHorizontalCenter: true, alignTop: true });
    expect(label.label).toMatchObject({ overflow: 'clamp', wrap: false });
  });

  it('round-trips an unchanged adopted empty SpriteFrame without generating a white texture', () => {
    const slot = node('1:3');
    Object.assign(slot, {
      name: '$sp_bg',
      kind: 'container',
      renderMode: 'image-fill',
      sprite: {
        assetKey: '__solid_white',
        source: 'image-fill',
        color: { r: 255, g: 255, b: 255, a: 0 },
      },
    } satisfies Partial<NormalizedNode>);
    const assets: AssetTask[] = [{
      key: '__solid_white',
      kind: 'generated-solid',
      hash: 'solid-white',
      targetUrl: 'db://assets/subgame_doomui/textures/figma/__solid_white.png',
      importSettingsHash: 'solid',
    }];

    expect(applyAdoptionFileIds(node('1:2', [slot]), adoption({
      '1:3': {
        cocosFileId: 'cocos-empty-sprite',
        cocosNodeName: '$sp_bg',
        sourceEmptySpriteFrame: {
          sliced: true,
          color: { r: 255, g: 255, b: 255, a: 255 },
        },
      },
    }), assets)).toEqual([]);

    expect(slot).toMatchObject({
      fileId: 'cocos-empty-sprite',
      renderMode: 'none',
      sprite: {
        assetKey: '__cocos_empty_sprite_frame',
        color: { r: 255, g: 255, b: 255, a: 255 },
        nineSlice: { left: 0, right: 0, top: 0, bottom: 0 },
      },
    });
    expect(assets).toEqual([]);
  });

  it('keeps a designer-authored visible solid fill on an adopted empty SpriteFrame', () => {
    const slot = node('1:3');
    Object.assign(slot, {
      name: '$sp_icon',
      kind: 'container',
      renderMode: 'image-fill',
      sprite: {
        assetKey: '__solid_white',
        source: 'image-fill',
        color: { r: 240, g: 120, b: 20, a: 255 },
      },
    } satisfies Partial<NormalizedNode>);
    const assets: AssetTask[] = [{
      key: '__solid_white',
      kind: 'generated-solid',
      hash: 'solid-white',
      targetUrl: 'db://assets/subgame_doomui/textures/figma/__solid_white.png',
      importSettingsHash: 'solid',
    }];

    applyAdoptionFileIds(node('1:2', [slot]), adoption({
      '1:3': {
        cocosFileId: 'cocos-empty-sprite',
        cocosNodeName: '$sp_icon',
        sourceEmptySpriteFrame: {
          sliced: false,
          color: { r: 255, g: 255, b: 255, a: 255 },
        },
      },
    }), assets);

    expect(slot.sprite).toMatchObject({
      assetKey: '__solid_white',
      color: { r: 240, g: 120, b: 20, a: 255 },
    });
    expect(assets).toHaveLength(1);
  });

  it('does not trust a legacy false empty marker when an adopted source asset proves the SpriteFrame existed', () => {
    const slot = node('1:3');
    Object.assign(slot, {
      name: '$sp_overlay',
      renderMode: 'image-fill',
      sprite: {
        assetKey: '__solid_white',
        source: 'image-fill',
        color: { r: 0, g: 0, b: 0, a: 0 },
      },
    } satisfies Partial<NormalizedNode>);
    const assets: AssetTask[] = [{
      key: '__solid_white',
      kind: 'generated-solid',
      hash: 'solid-white',
      targetUrl: 'db://assets/subgame_doomui/textures/figma/__solid_white.png',
      importSettingsHash: 'solid',
    }];
    const mapping = adoption({
      '1:3': {
        cocosFileId: 'cocos-image-sprite',
        cocosNodeName: '$sp_overlay',
        sourceEmptySpriteFrame: {
          sliced: false,
          color: { r: 0, g: 0, b: 0, a: 180 },
        },
      },
    });
    mapping.assets = {
      source: {
        key: 'source',
        sourceUrl: 'db://assets/resources/textures/singleColor.png',
        sourceImageUuid: 'image-uuid',
        sourceSpriteFrameUuid: 'sprite-frame-uuid',
        contentHash: 'content-hash',
        sliced: false,
        sourceNodeFileIds: ['cocos-image-sprite'],
        mimeType: 'image/png',
        width: 2,
        height: 2,
        figmaImageRef: 'figma-image-ref',
      },
    };

    applyAdoptionFileIds(node('1:2', [slot]), mapping, assets);

    expect(slot.sprite).toMatchObject({
      assetKey: '__solid_white',
      color: { a: 0 },
    });
    expect(assets).toHaveLength(1);
  });

  it('recognizes the transparent placeholder in a legacy adoption mapping', () => {
    const slot = node('1:3');
    Object.assign(slot, {
      name: '$sp_icon',
      renderMode: 'image-fill',
      sprite: {
        assetKey: '__solid_white',
        source: 'image-fill',
        color: { r: 255, g: 255, b: 255, a: 0 },
      },
    } satisfies Partial<NormalizedNode>);
    const assets: AssetTask[] = [{
      key: '__solid_white',
      kind: 'generated-solid',
      hash: 'solid-white',
      targetUrl: 'db://assets/subgame_doomui/textures/figma/__solid_white.png',
      importSettingsHash: 'solid',
    }];

    applyAdoptionFileIds(node('1:2', [slot]), adoption({
      '1:3': { cocosFileId: 'cocos-empty-sprite', cocosNodeName: '$sp_icon' },
    }), assets);

    expect(slot.sprite).toMatchObject({
      assetKey: '__cocos_empty_sprite_frame',
      color: { a: 255 },
    });
    expect(assets).toEqual([]);
  });
});
