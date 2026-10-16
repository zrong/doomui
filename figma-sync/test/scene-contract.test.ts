import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sceneSource = readFileSync(resolve(__dirname, '../source/scene.ts'), 'utf8');
const companionSource = readFileSync(resolve(__dirname, '../../cocos-sync/src/code.ts'), 'utf8');

describe('logic and visual Prefab scene contract', () => {
  it('uses one root visual instance and follows its Frame size without a fixed resolution', () => {
    expect(sceneSource).toContain("visual.name = 'root'");
    expect(sceneSource).toContain('transform.setContentSize(sourceTransform.contentSize)');
    expect(sceneSource).not.toContain('new Size(720, 1280)');
  });

  it('adds a four-edge Widget only to the generated logic root', () => {
    expect(sceneSource).toContain('const widget = root.addComponent(Widget)');
    expect(sceneSource).toContain('widget.isAlignLeft = true');
    expect(sceneSource).toContain('widget.isAlignRight = true');
    expect(sceneSource).toContain('widget.isAlignTop = true');
    expect(sceneSource).toContain('widget.isAlignBottom = true');
    expect(sceneSource).not.toContain('visual.addComponent(Widget)');
    expect(sceneSource).toContain("(request.logicKind ?? 'view') === 'view'");
  });

  it('inspects expanded mounted components and Item logic wrappers before Apply', () => {
    expect(sceneSource).toContain('inspectLogicPrefab');
    expect(sceneSource).toContain('prefabProperties.tmpPrefab = tmpPrefabUuid');
    expect(sceneSource).toContain("logicRoot.children.find((child) => child.name === 'root')");
  });

  it('queries the current Prefab edit context instead of relying on AssetDB selection', () => {
    expect(sceneSource).toContain("cce.SceneFacadeManager.queryMode() !== 'prefab'");
    expect(sceneSource).toContain('cce.SceneFacadeManager.queryCurrentSceneUuid()');
    expect(sceneSource).toContain('queryCurrentPrefabUuid,');
  });

  it('creates the restricted Layout subset on both sides', () => {
    expect(sceneSource).toContain('node.addComponent(Layout)');
    expect(sceneSource).toContain('Layout.ResizeMode.CONTAINER');
    expect(sceneSource).toContain("'cc.Layout'");
    expect(companionSource).toContain("frame.layoutMode = layout.direction === 'horizontal' ? 'HORIZONTAL' : 'VERTICAL'");
    expect(companionSource).toContain("frame.primaryAxisSizingMode = 'AUTO'");
    expect(companionSource).toContain("child.layoutPositioning = 'AUTO'");
  });

  it('carries Cocos sliced-sprite insets through the Figma node name contract', () => {
    expect(companionSource).toContain('if (!source.sprite?.sliced || !source.sprite.assetKey) return name');
    expect(companionSource).toContain('@9slice{l:${safeInset(insets.left)}');
    expect(companionSource).toContain("scaleMode: source.sprite?.sliced ? 'FILL' : 'FIT'");
  });

  it('round-trips Cocos LabelOutline through Figma text strokes', () => {
    expect(sceneSource).toContain('node.getComponent(LabelOutline)');
    expect(sceneSource).toContain("'cc.LabelOutline'");
    expect(sceneSource).toContain('outline: outlineEnabled && outlineWidth > 0');
    expect(sceneSource).toContain('label.enableOutline = true');
    expect(companionSource).toContain('text.strokes = [solidPaint(source.text.outline.color)]');
    expect(companionSource).toContain('text.strokeWeight = source.text.outline.width');
  });

  it('round-trips the supported Label style and shadow subset', () => {
    expect(sceneSource).toContain('label.isBold = spec.label.bold');
    expect(sceneSource).toContain('label.isItalic = spec.label.italic');
    expect(sceneSource).toContain('label.isUnderline = spec.label.underline');
    expect(sceneSource).toContain('label.enableShadow = true');
    expect(sceneSource).toContain('node.getComponent(LabelShadow)');
    expect(companionSource).toContain("type: 'DROP_SHADOW'");
    expect(companionSource).toContain("text.textDecoration = source.text.underline ? 'UNDERLINE' : 'NONE'");
    expect(companionSource).toContain('Math.floor(source.height / Math.max(1, source.text.lineHeight))');
  });

  it('maps restricted Widget constraints and aggregates runtime-only components', () => {
    expect(sceneSource).toContain('cocosWidgetToFigma');
    expect(sceneSource).toContain('constraints,');
    expect(sceneSource).toContain('运行时组件不进入 Figma');
    expect(sceneSource).toContain('/Collider2D$/.test(className)');
    expect(companionSource).toContain('node.constraints = source.constraints');
  });

  it('preserves Sprite alpha and converts opaque-white textures to editable solid fills', () => {
    expect(companionSource).toContain('source.sprite?.solidWhite');
    expect(companionSource).toContain('opacity: source.sprite?.color.a === undefined ? 1 : source.sprite.color.a / 255');
  });

  it('propagates cumulative Cocos scale while flattening an adopted Prefab subtree', () => {
    expect(sceneSource).toContain('flattenAdoptionGeometry');
    expect(sceneSource).toContain('geometry.cumulativeScale');
    expect(sceneSource).toContain('scaleAdoptionText');
    expect(sceneSource).toContain('scaleAdoptionLayout');
  });
});
