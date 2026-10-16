import type {
  AssetTask,
  FigmaColor,
  FigmaComponentMetadata,
  FigmaComponentSetMetadata,
  FigmaEffect,
  FigmaNode,
  FigmaPaint,
  FigmaRectangle,
  LabelSpec,
  NormalizeResult,
  NormalizedNode,
  ProjectSettings,
  RGBA,
  SpriteSpec,
  SyncIssue,
} from '../types';
import { sha256, shortHash, stableFileId, stableStringify } from './hash';
import { sanitizeNodeName, isSemanticName } from './naming';
import { parseNineSlice, stripNineSliceMarker } from './nine-slice';
import { toLocalTransform } from './coordinates';
import { constraintsToWidget } from './widget';
import { figmaAutoLayoutToCocos } from './layout-conversion';

const CONTAINER_TYPES = new Set(['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE', 'COMPONENT_SET']);
const RASTER_TYPES = new Set([
  'VECTOR', 'BOOLEAN_OPERATION', 'ELLIPSE', 'LINE', 'REGULAR_POLYGON', 'STAR',
  'STAMP', 'HIGHLIGHT', 'SHAPE_WITH_TEXT', 'CODE_BLOCK', 'CONNECTOR', 'WASHI_TAPE',
]);
const IGNORED_TYPES = new Set(['SECTION', 'SLICE', 'CANVAS', 'DOCUMENT']);
const WHITE_ASSET_KEY = '__solid_white';

interface NormalizeContext {
  rootBounds: FigmaRectangle;
  textureRoot: string;
  settings: ProjectSettings;
  components: Record<string, FigmaComponentMetadata>;
  componentSets: Record<string, FigmaComponentSetMetadata>;
  issues: SyncIssue[];
  assets: Map<string, AssetTask>;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function colorToRgba(color: FigmaColor | undefined, opacity = 1): RGBA {
  if (!color) return { r: 255, g: 255, b: 255, a: 255 };
  return {
    r: clampByte(color.r * 255),
    g: clampByte(color.g * 255),
    b: clampByte(color.b * 255),
    a: clampByte((color.a ?? 1) * opacity * 255),
  };
}

function visiblePaints(paints: FigmaPaint[] | symbol | undefined): FigmaPaint[] {
  return Array.isArray(paints) ? paints.filter((paint) => paint.visible !== false) : [];
}

function solidPaint(node: FigmaNode): FigmaPaint | undefined {
  const paints = visiblePaints(node.fills);
  return paints.length === 1 && paints[0].type === 'SOLID' ? paints[0] : undefined;
}

function simpleImagePaint(node: FigmaNode, allowNineSliceFill = false): FigmaPaint | undefined {
  const paints = visiblePaints(node.fills);
  const paint = paints.length === 1 && paints[0].type === 'IMAGE' ? paints[0] : undefined;
  const isNineSliceFill = allowNineSliceFill && paint?.scaleMode === 'FILL';
  const supportedScaleMode = paint?.scaleMode === 'FIT'
    || isNineSliceFill;
  if (!paint?.imageRef || !supportedScaleMode) return undefined;
  // JSON_REST_V1 includes an imageTransform for FILL even when the user only
  // selected Figma's standard Fill mode. For an explicit nine-slice this
  // transform controls the Figma preview, while @9slice remains the Cocos
  // rendering contract and the original image remains the semantic source.
  if ((!isNineSliceFill && paint.imageTransform) || visibleEffects(node).length || visiblePaints(node.strokes).length) return undefined;
  return paint;
}

function visibleEffects(node: FigmaNode): FigmaEffect[] {
  return (node.effects ?? []).filter((effect) => effect.visible !== false);
}

function labelShadowFromEffects(effects: FigmaEffect[]): LabelSpec['shadow'] | undefined | null {
  if (!effects.length) return undefined;
  if (effects.length !== 1) return null;
  const effect = effects[0];
  if (
    effect.type !== 'DROP_SHADOW'
    || (effect.spread ?? 0) !== 0
    || !['NORMAL', 'PASS_THROUGH', undefined].includes(effect.blendMode)
  ) return null;
  return {
    color: colorToRgba(effect.color),
    offsetX: effect.offset?.x ?? 0,
    offsetY: -(effect.offset?.y ?? 0),
    blur: Math.max(0, effect.radius ?? 0),
  };
}

function hasSemanticDescendant(node: FigmaNode): boolean {
  return (node.children ?? []).some((child) =>
    child.type === 'TEXT' || child.type === 'INSTANCE' || isSemanticName(child.name) || hasSemanticDescendant(child),
  );
}

function parseVariantProperties(node: FigmaNode): Record<string, string | boolean> | undefined {
  const direct = node.componentProperties;
  if (direct && Object.keys(direct).length) {
    return Object.fromEntries(Object.entries(direct).map(([key, item]) => [key.replace(/#[^#]+$/, ''), item.value ?? '']));
  }
  if (node.type !== 'COMPONENT' || !node.name.includes('=')) return undefined;
  const parsed = Object.fromEntries(
    node.name.split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
      const separator = part.indexOf('=');
      return separator < 1 ? [part, ''] : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
    }),
  );
  return Object.keys(parsed).length ? parsed : undefined;
}

function labelFromNode(node: FigmaNode, settings: ProjectSettings, issues: SyncIssue[]): LabelSpec | undefined {
  const style = node.style ?? {};
  const paints = visiblePaints(node.fills);
  const shadow = labelShadowFromEffects(visibleEffects(node));
  const hasMultipleStyles = Object.keys(node.styleOverrideTable ?? {}).length > 0
    || new Set(node.characterStyleOverrides ?? []).size > 1;
  if (hasMultipleStyles || paints.length !== 1 || paints[0].type !== 'SOLID' || shadow === null) {
    return undefined;
  }
  const family = String(style.fontFamily ?? 'Arial');
  const fontStyle = String(style.fontPostScriptName ?? style.fontStyle ?? 'Regular');
  const fontKey = `${family}/${fontStyle}`;
  const fontUrl = settings.fontMap[fontKey] ?? settings.fontMap[`${family}/Regular`];
  if (!fontUrl) {
    issues.push({
      severity: 'warning',
      code: 'FONT_UNMAPPED',
      nodeId: node.id,
      message: `字体未映射：${fontKey}；暂用系统字体 ${family}`,
    });
  }
  const autoResize = String(node.textAutoResize ?? style.textAutoResize ?? 'NONE');
  const overflow: LabelSpec['overflow'] = autoResize === 'WIDTH_AND_HEIGHT'
    ? 'none'
    : autoResize === 'HEIGHT' ? 'resize-height' : 'clamp';
  const strokes = visiblePaints(node.strokes);
  const outline = strokes.length === 1 && strokes[0].type === 'SOLID' && (node.strokeWeight ?? 0) > 0
    ? { color: colorToRgba(strokes[0].color, strokes[0].opacity), width: node.strokeWeight ?? 0 }
    : undefined;
  const fontWeight = Number(style.fontWeight ?? 400);
  const bold = /(?:semi|demi)?bold|black|heavy/i.test(fontStyle) || fontWeight >= 600;
  const italic = /italic|oblique/i.test(fontStyle);
  const underline = String(node.textDecoration ?? style.textDecoration ?? 'NONE') === 'UNDERLINE';
  return {
    text: node.characters ?? '',
    fontSize: Number(style.fontSize ?? 16),
    lineHeight: Number(style.lineHeightPx ?? style.fontSize ?? 16),
    color: colorToRgba(paints[0].color, paints[0].opacity),
    horizontalAlign: ({ LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'left' } as const)[String(style.textAlignHorizontal)] ?? 'left',
    verticalAlign: ({ TOP: 'top', CENTER: 'center', BOTTOM: 'bottom' } as const)[String(style.textAlignVertical)] ?? 'top',
    overflow,
    wrap: autoResize !== 'WIDTH_AND_HEIGHT' && node.maxLines !== 1,
    fontKey,
    fontUrl,
    bold,
    italic,
    underline,
    outline,
    shadow: shadow ?? undefined,
  };
}

function addSolidAsset(ctx: NormalizeContext, nineSlice?: SpriteSpec['nineSlice']): string {
  const importSettingsHash = shortHash({ kind: 'solid', nineSlice });
  const key = nineSlice ? `${WHITE_ASSET_KEY}:${importSettingsHash}` : WHITE_ASSET_KEY;
  if (!ctx.assets.has(key)) {
    ctx.assets.set(key, {
      key,
      kind: 'generated-solid',
      hash: shortHash({ kind: 'solid-white' }),
      targetUrl: `${ctx.textureRoot}/__solid_white.png`,
      nineSlice,
      importSettingsHash,
    });
  }
  return key;
}

function sameNineSlice(left: SpriteSpec['nineSlice'], right: SpriteSpec['nineSlice']): boolean {
  return left?.left === right?.left
    && left?.right === right?.right
    && left?.top === right?.top
    && left?.bottom === right?.bottom;
}

function addImageAsset(node: FigmaNode, paint: FigmaPaint, ctx: NormalizeContext, nineSlice?: SpriteSpec['nineSlice']): string {
  const key = `fill:${paint.imageRef}`;
  const contentHash = sha256(`figma-image:${paint.imageRef}`);
  const existing = ctx.assets.get(key);
  if (existing) {
    if (existing.nineSlice && nineSlice && !sameNineSlice(existing.nineSlice, nineSlice)) {
      ctx.issues.push({
        severity: 'blocker',
        code: 'TEXTURE_IMPORT_SETTINGS_CONFLICT',
        nodeId: node.id,
        path: existing.targetUrl,
        message: `同一图片在当前 Frame 中使用了不同的九宫格边距：${existing.targetUrl}`,
      });
    } else if (!existing.nineSlice && nineSlice) {
      // SpriteFrame border metadata is asset-level, while Sprite.type is
      // node-level. A SIMPLE node can safely share the asset promoted by a
      // SLICED node because it ignores the stored borders at runtime.
      existing.nineSlice = nineSlice;
      existing.importSettingsHash = shortHash({ nineSlice });
    }
  } else {
    ctx.assets.set(key, {
      key,
      kind: 'image-fill',
      imageRef: paint.imageRef,
      hash: contentHash,
      targetUrl: `${ctx.textureRoot}/image__${contentHash}.png`,
      nineSlice,
      importSettingsHash: shortHash({ nineSlice }),
    });
  }
  return key;
}

function rasterSignature(node: FigmaNode, origin?: { x: number; y: number }): unknown {
  const bounds = node.absoluteBoundingBox ?? node.absoluteRenderBounds;
  const rootOrigin = origin ?? { x: bounds?.x ?? 0, y: bounds?.y ?? 0 };
  return {
    type: node.type,
    bounds: bounds ? {
      x: bounds.x - rootOrigin.x,
      y: bounds.y - rootOrigin.y,
      width: bounds.width,
      height: bounds.height,
    } : undefined,
    fills: node.fills,
    strokes: node.strokes,
    strokeWeight: node.strokeWeight,
    cornerRadius: node.cornerRadius,
    rectangleCornerRadii: node.rectangleCornerRadii,
    effects: node.effects,
    opacity: node.opacity,
    blendMode: node.blendMode,
    characters: node.characters,
    style: node.style,
    styleOverrideTable: node.styleOverrideTable,
    characterStyleOverrides: node.characterStyleOverrides,
    children: node.children?.map((child) => rasterSignature(child, rootOrigin)),
  };
}

function addRasterAsset(node: FigmaNode, ctx: NormalizeContext, nineSlice?: SpriteSpec['nineSlice']): string {
  const renderHash = sha256(stableStringify(rasterSignature(node)));
  const importSettingsHash = shortHash({ nineSlice });
  const key = `raster:${renderHash}:${importSettingsHash}`;
  if (!ctx.assets.has(key)) {
    ctx.assets.set(key, {
      key,
      kind: 'raster',
      nodeId: node.id,
      hash: renderHash,
      targetUrl: `${ctx.textureRoot}/raster__${renderHash}.png`,
      nineSlice,
      importSettingsHash,
    });
  }
  return key;
}

function spriteForNode(
  node: FigmaNode,
  ctx: NormalizeContext,
  allowRaster: boolean,
  forceRaster = false,
): { renderMode: NormalizedNode['renderMode']; sprite?: SpriteSpec } {
  const nineSliceResult = parseNineSlice(node.name, node.absoluteBoundingBox?.width, node.absoluteBoundingBox?.height);
  if (nineSliceResult.error) {
    ctx.issues.push({ severity: 'warning', code: 'NINE_SLICE_INVALID', nodeId: node.id, message: `${node.name}：${nineSliceResult.error}` });
  }
  const nineSlice = nineSliceResult.value;
  if (forceRaster) {
    return {
      renderMode: 'raster',
      sprite: { assetKey: addRasterAsset(node, ctx, nineSlice), source: 'raster', color: { r: 255, g: 255, b: 255, a: 255 }, nineSlice },
    };
  }
  const solid = solidPaint(node);
  if (solid && !visibleEffects(node).length && !visiblePaints(node.strokes).length) {
    return {
      renderMode: 'image-fill',
      sprite: { assetKey: addSolidAsset(ctx, nineSlice), source: 'image-fill', color: colorToRgba(solid.color, solid.opacity), nineSlice },
    };
  }
  // A Cocos-origin SLICED Sprite is represented in Figma as an IMAGE/FILL plus
  // an explicit @9slice marker. In that specific case the original image is
  // the semantic source; treating FILL as an unsupported crop would otherwise
  // drop the background from containers that also contain labels or icons.
  const image = simpleImagePaint(node, Boolean(nineSlice));
  if (image) {
    return {
      renderMode: 'image-fill',
      sprite: {
        assetKey: addImageAsset(node, image, ctx, nineSlice),
        source: 'image-fill',
        color: { r: 255, g: 255, b: 255, a: clampByte((image.opacity ?? 1) * 255) },
        nineSlice,
      },
    };
  }
  if (allowRaster) {
    return {
      renderMode: 'raster',
      sprite: { assetKey: addRasterAsset(node, ctx, nineSlice), source: 'raster', color: { r: 255, g: 255, b: 255, a: 255 }, nineSlice },
    };
  }
  return { renderMode: 'none' };
}

function nodeHash(node: Omit<NormalizedNode, 'hash'>): string {
  return shortHash({ ...node, fileId: undefined }, 20);
}

function normalizeNode(
  node: FigmaNode,
  parentBounds: FigmaRectangle | undefined,
  ctx: NormalizeContext,
  isRoot = false,
  parentHasAutoLayout = false,
): NormalizedNode | null {
  if (node.isMask) {
    ctx.issues.push({ severity: 'warning', code: 'MASK_NODE_IGNORED', nodeId: node.id, message: `Mask ${node.name} 不生成运行时节点；其容器将按可表达语义降级` });
    return null;
  }
  if (IGNORED_TYPES.has(node.type)) {
    ctx.issues.push({ severity: 'warning', code: 'NODE_IGNORED', nodeId: node.id, message: `忽略不支持的 ${node.type}：${node.name}` });
    return null;
  }
  const bounds = node.absoluteBoundingBox ?? node.absoluteRenderBounds;
  if (!bounds) {
    ctx.issues.push({ severity: isRoot ? 'blocker' : 'warning', code: 'BOUNDS_MISSING', nodeId: node.id, message: `${node.name} 缺少 absoluteBoundingBox` });
    if (isRoot) return null;
  }
  const safeBounds = bounds ?? { x: parentBounds?.x ?? 0, y: parentBounds?.y ?? 0, width: 0, height: 0 };
  const transform = toLocalTransform(
    safeBounds,
    isRoot ? undefined : parentBounds,
    node.rotation ?? 0,
    isRoot ? undefined : node.relativeTransform,
    node.size,
  );
  const layoutConversion = CONTAINER_TYPES.has(node.type) && node.type !== 'COMPONENT_SET'
    ? figmaAutoLayoutToCocos(node)
    : { hasAutoLayout: false };
  if (layoutConversion.issue) ctx.issues.push(layoutConversion.issue);
  const base = {
    id: node.id,
    fileId: stableFileId(node.id),
    name: sanitizeNodeName(stripNineSliceMarker(node.name)),
    sourceType: node.type,
    visible: node.visible !== false,
    opacity: Math.max(0, Math.min(1, node.opacity ?? 1)),
    ...transform,
    children: [] as NormalizedNode[],
    layout: layoutConversion.layout,
    widget: isRoot || parentHasAutoLayout ? undefined : constraintsToWidget(node.constraints, safeBounds, parentBounds),
    componentId: node.type === 'COMPONENT' ? node.id : node.componentId,
    componentSetId: node.componentSetId ?? (node.componentId ? ctx.components[node.componentId]?.componentSetId : undefined),
    variantProperties: parseVariantProperties(node),
    remoteComponent: node.componentId ? ctx.components[node.componentId]?.remote === true : undefined,
  };

  if (node.type === 'TEXT') {
    const label = labelFromNode(node, ctx.settings, ctx.issues);
    if (label) {
      const draft: Omit<NormalizedNode, 'hash'> = { ...base, kind: 'label', renderMode: 'label', label };
      return { ...draft, hash: nodeHash(draft) };
    }
    ctx.issues.push({ severity: 'warning', code: 'TEXT_RASTERIZED', nodeId: node.id, message: `文本 ${node.name} 含富文本、渐变或不支持的效果，已栅格化` });
    const spriteData = spriteForNode(node, ctx, true, true);
    const draft: Omit<NormalizedNode, 'hash'> = { ...base, kind: 'sprite', ...spriteData };
    return { ...draft, hash: nodeHash(draft) };
  }

  const isContainer = CONTAINER_TYPES.has(node.type);
  if (isContainer) {
    if (node.type === 'GROUP') {
      ctx.issues.push({ severity: 'warning', code: 'GROUP_IMPORTED', nodeId: node.id, message: `Group ${node.name} 已按容器导入；建议在 Figma 转成 Frame` });
    }
    const containsMask = (node.children ?? []).some((child) => child.isMask);
    const canFlatten = !isRoot && !hasSemanticDescendant(node) && (node.clipsContent || containsMask || visibleEffects(node).length > 0 || Boolean(node.blendMode && node.blendMode !== 'PASS_THROUGH'));
    if (canFlatten) {
      ctx.issues.push({ severity: 'warning', code: 'SUBTREE_RASTERIZED', nodeId: node.id, message: `${node.name} 的裁剪或效果无法语义映射，已栅格化该非交互子树` });
      const spriteData = spriteForNode(node, ctx, true, true);
      const draft: Omit<NormalizedNode, 'hash'> = { ...base, kind: 'sprite', ...spriteData };
      return { ...draft, hash: nodeHash(draft) };
    }
    if ((node.clipsContent || containsMask || visibleEffects(node).length > 0) && hasSemanticDescendant(node)) {
      ctx.issues.push({ severity: 'warning', code: 'CONTAINER_EFFECT_SKIPPED', nodeId: node.id, message: `${node.name} 含交互/文本子节点，保留语义结构但不应用 Mask 或复杂容器效果` });
    }
    const childNodes = (node.children ?? [])
      .map((child) => normalizeNode(child, safeBounds, ctx, false, layoutConversion.hasAutoLayout))
      .filter((child): child is NormalizedNode => Boolean(child));
    const background = node.type === 'COMPONENT_SET' ? { renderMode: 'none' as const } : spriteForNode(node, ctx, false);
    if (
      node.type !== 'COMPONENT_SET'
      && node.visible !== false
      && background.renderMode === 'none'
      && visiblePaints(node.fills).length > 0
    ) {
      ctx.issues.push({
        severity: 'blocker',
        code: 'CONTAINER_BACKGROUND_UNSUPPORTED',
        nodeId: node.id,
        message: `${node.name} 的容器背景无法无损映射；普通 IMAGE/FILL 具有裁剪语义。请改为 FIT、补全 @9slice{l:...,r:...,t:...,b:...}，或把背景拆成独立纯视觉节点`,
      });
    }
    const draft: Omit<NormalizedNode, 'hash'> = {
      ...base,
      // Component Set is an authoring-time definition group. Keeping its
      // children in the IR lets the variant resolver inspect every state,
      // while Scene Script deliberately omits this node from runtime output.
      kind: node.type === 'COMPONENT_SET' ? 'ignored' : node.type === 'INSTANCE' ? 'instance' : 'container',
      renderMode: background.renderMode,
      sprite: node.type === 'COMPONENT_SET' ? undefined : background.sprite,
      children: childNodes,
    };
    return { ...draft, hash: nodeHash(draft) };
  }

  if (node.type === 'RECTANGLE' || RASTER_TYPES.has(node.type)) {
    const spriteData = spriteForNode(node, ctx, true, RASTER_TYPES.has(node.type));
    const draft: Omit<NormalizedNode, 'hash'> = { ...base, kind: 'sprite', ...spriteData };
    return { ...draft, hash: nodeHash(draft) };
  }

  ctx.issues.push({ severity: 'warning', code: 'NODE_RASTERIZED', nodeId: node.id, message: `未知节点类型 ${node.type}（${node.name}）已栅格化` });
  const spriteData = spriteForNode(node, ctx, true, true);
  const draft: Omit<NormalizedNode, 'hash'> = { ...base, kind: 'sprite', ...spriteData };
  return { ...draft, hash: nodeHash(draft) };
}

export function normalizeFigmaFrame(
  root: FigmaNode,
  options: {
    textureRoot: string;
    settings: ProjectSettings;
    components?: Record<string, FigmaComponentMetadata>;
    componentSets?: Record<string, FigmaComponentSetMetadata>;
  },
): NormalizeResult {
  const issues: SyncIssue[] = [];
  const assets = new Map<string, AssetTask>();
  const components = options.components ?? {};
  const componentSets = options.componentSets ?? {};
  if (!['FRAME', 'COMPONENT'].includes(root.type)) {
    issues.push({ severity: 'blocker', code: 'ROOT_NOT_FRAME', nodeId: root.id, message: `同步节点必须是 FRAME 或 COMPONENT，当前为 ${root.type}` });
  }
  const bounds = root.absoluteBoundingBox ?? root.absoluteRenderBounds;
  if (!bounds) {
    throw new Error(`根节点 ${root.name} 缺少尺寸信息`);
  }
  const textureRoot = options.textureRoot.replace(/\/$/, '');
  const ctx: NormalizeContext = {
    rootBounds: bounds,
    textureRoot,
    settings: options.settings,
    components,
    componentSets,
    issues,
    assets,
  };
  const normalized = normalizeNode(root, undefined, ctx, true);
  if (!normalized) {
    throw new Error(`无法标准化根节点 ${root.name}`);
  }
  return { root: normalized, issues, assets: [...assets.values()], components, componentSets };
}

export function canonicalNodeDump(node: NormalizedNode): string {
  return stableStringify(node);
}
