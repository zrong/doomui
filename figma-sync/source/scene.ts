import {
  assetManager,
  Button,
  Color,
  Font,
  instantiate,
  js,
  Label,
  LabelOutline,
  LabelShadow,
  Layout,
  Layers,
  Node,
  Prefab,
  Size,
  Sprite,
  SpriteFrame,
  UIOpacity,
  UITransform,
  Vec2,
  Widget,
} from 'cc';
import type {
  ButtonSpec,
  NormalizedNode,
  RGBA,
  SceneAssetReference,
  SceneAdoptionExportRequest,
  SceneAdoptionExportResult,
  SceneAdoptionNode,
  SceneBuildRequest,
  SceneBuildResult,
  SceneLogicInspectionRequest,
  SceneLogicInspectionResult,
  SceneSpriteFrameInspection,
  SceneSpriteFrameInspectionRequest,
} from './types';
import { stableFileId } from './core/hash';
import { toFigmaAdoptionRoot } from './core/adoption-root';
import {
  flattenAdoptionGeometry,
  scaleAdoptionLayout,
  scaleAdoptionText,
  type AdoptionScale,
} from './core/adoption-scale';
import { cocosLayoutToFigma } from './core/layout-conversion';
import { cocosWidgetToFigma } from './core/adoption-widget';

declare const EditorExtends: { serialize(value: unknown): string };
declare const cce: {
  SceneFacadeManager: {
    queryMode(): string;
    queryCurrentSceneUuid(): string;
  };
};

function loadAsset<T>(uuid: string): Promise<T> {
  return new Promise((resolve, reject) => {
    assetManager.loadAny({ uuid }, (error: Error | null, asset: T) => {
      if (error) reject(error);
      else resolve(asset);
    });
  });
}

function rgba(value: RGBA | undefined, opacity = 1): Color {
  const color = value ?? { r: 255, g: 255, b: 255, a: 255 };
  return new Color(color.r, color.g, color.b, Math.round(color.a * opacity));
}

function createClassInstance(className: string): any {
  const ctor = js.getClassByName(className) as (new () => unknown) | undefined;
  if (!ctor) throw new Error(`Cocos 类未注册：${className}`);
  return new ctor();
}

function attachPrefabInfo(root: Node, prefab: Prefab, nodeIds: Record<string, string>): void {
  const nestedPrefabInstanceRoots: Node[] = [];
  let rootInfo: any;
  const visit = (node: Node, isRoot: boolean): void => {
    const existing = (node as any)._prefab;
    if (!isRoot && existing?.asset && existing.asset !== prefab) {
      // Cocos expands nested Prefabs from the owning root PrefabInfo on load.
      // Omitting this index leaves a serialized placeholder named "New Node".
      nestedPrefabInstanceRoots.push(node);
      return;
    }
    const figmaId = (node as any).__figmaNodeId as string | undefined;
    const info = createClassInstance('cc.PrefabInfo');
    info.root = root;
    info.asset = prefab;
    info.fileId = figmaId ? nodeIds[figmaId] : stableFileId(`logic:${node.name}`);
    (node as any)._prefab = info;
    if (isRoot) rootInfo = info;
    for (const component of node.components) {
      const compInfo = createClassInstance('cc.CompPrefabInfo');
      const componentName = js.getClassName(component);
      compInfo.fileId = stableFileId(`${info.fileId}:${componentName}`);
      (component as any).__prefab = compInfo;
    }
    node.children.forEach((child) => visit(child, false));
  };
  visit(root, true);
  rootInfo.nestedPrefabInstanceRoots = nestedPrefabInstanceRoots.length ? nestedPrefabInstanceRoots : null;
}

async function resolveSpriteFrame(reference: SceneAssetReference | undefined): Promise<SpriteFrame | null> {
  if (!reference?.spriteFrameUuid) return null;
  return loadAsset<SpriteFrame>(reference.spriteFrameUuid);
}

async function addSprite(node: Node, spec: NormalizedNode, assets: Record<string, SceneAssetReference>): Promise<void> {
  if (!spec.sprite) return;
  const component = node.getComponent(Sprite) ?? node.addComponent(Sprite);
  component.sizeMode = Sprite.SizeMode.CUSTOM;
  component.color = rgba(spec.sprite.color, spec.opacity);
  component.spriteFrame = await resolveSpriteFrame(assets[spec.sprite.assetKey]);
  if (spec.sprite.nineSlice) component.type = Sprite.Type.SLICED;
}

async function addLabel(node: Node, spec: NormalizedNode, fonts: Record<string, SceneAssetReference>): Promise<void> {
  if (!spec.label) return;
  const label = node.getComponent(Label) ?? node.addComponent(Label);
  label.string = spec.label.text;
  label.fontSize = spec.label.fontSize;
  label.lineHeight = spec.label.lineHeight;
  label.color = rgba(spec.label.color, spec.opacity);
  label.horizontalAlign = ({ left: Label.HorizontalAlign.LEFT, center: Label.HorizontalAlign.CENTER, right: Label.HorizontalAlign.RIGHT })[spec.label.horizontalAlign];
  label.verticalAlign = ({ top: Label.VerticalAlign.TOP, center: Label.VerticalAlign.CENTER, bottom: Label.VerticalAlign.BOTTOM })[spec.label.verticalAlign];
  label.overflow = ({ none: Label.Overflow.NONE, 'resize-height': Label.Overflow.RESIZE_HEIGHT, clamp: Label.Overflow.CLAMP })[spec.label.overflow];
  label.enableWrapText = spec.label.wrap;
  label.isBold = spec.label.bold;
  label.isItalic = spec.label.italic;
  label.isUnderline = spec.label.underline;
  label.useSystemFont = !spec.label.fontUrl;
  label.fontFamily = spec.label.fontKey?.split('/')[0] ?? 'Arial';
  if (!spec.label.fontUrl) label.font = null;
  const fontReference = spec.label.fontUrl ? fonts[spec.label.fontUrl] : undefined;
  if (fontReference) {
    label.font = await loadAsset<Font>(fontReference.uuid);
    label.useSystemFont = false;
  }
  if (spec.label.outline) {
    label.enableOutline = true;
    label.outlineColor = rgba(spec.label.outline.color);
    label.outlineWidth = spec.label.outline.width;
  }
  if (spec.label.shadow) {
    label.enableShadow = true;
    label.shadowColor = rgba(spec.label.shadow.color);
    label.shadowOffset = new Vec2(spec.label.shadow.offsetX, spec.label.shadow.offsetY);
    label.shadowBlur = spec.label.shadow.blur;
  }
}

function addWidget(node: Node, spec: NormalizedNode): void {
  if (!spec.widget) return;
  const widget = node.getComponent(Widget) ?? node.addComponent(Widget);
  const source = spec.widget;
  if (source.alignLeft !== undefined) widget.isAlignLeft = source.alignLeft;
  if (source.alignRight !== undefined) widget.isAlignRight = source.alignRight;
  if (source.alignTop !== undefined) widget.isAlignTop = source.alignTop;
  if (source.alignBottom !== undefined) widget.isAlignBottom = source.alignBottom;
  if (source.alignHorizontalCenter !== undefined) widget.isAlignHorizontalCenter = source.alignHorizontalCenter;
  if (source.alignVerticalCenter !== undefined) widget.isAlignVerticalCenter = source.alignVerticalCenter;
  if (source.left !== undefined) widget.left = source.left;
  if (source.right !== undefined) widget.right = source.right;
  if (source.top !== undefined) widget.top = source.top;
  if (source.bottom !== undefined) widget.bottom = source.bottom;
  if (source.horizontalCenter !== undefined) widget.horizontalCenter = source.horizontalCenter;
  if (source.verticalCenter !== undefined) widget.verticalCenter = source.verticalCenter;
  if (source.absoluteLeft !== undefined) widget.isAbsoluteLeft = source.absoluteLeft;
  if (source.absoluteRight !== undefined) widget.isAbsoluteRight = source.absoluteRight;
  if (source.absoluteTop !== undefined) widget.isAbsoluteTop = source.absoluteTop;
  if (source.absoluteBottom !== undefined) widget.isAbsoluteBottom = source.absoluteBottom;
  if (source.absoluteHorizontalCenter !== undefined) widget.isAbsoluteHorizontalCenter = source.absoluteHorizontalCenter;
  if (source.absoluteVerticalCenter !== undefined) widget.isAbsoluteVerticalCenter = source.absoluteVerticalCenter;
}

function addLayout(node: Node, spec: NormalizedNode): void {
  if (!spec.layout) return;
  const layout = node.getComponent(Layout) ?? node.addComponent(Layout);
  layout.type = spec.layout.direction === 'horizontal' ? Layout.Type.HORIZONTAL : Layout.Type.VERTICAL;
  layout.resizeMode = spec.layout.resizeMode === 'container' ? Layout.ResizeMode.CONTAINER : Layout.ResizeMode.NONE;
  layout.paddingLeft = spec.layout.paddingLeft;
  layout.paddingRight = spec.layout.paddingRight;
  layout.paddingTop = spec.layout.paddingTop;
  layout.paddingBottom = spec.layout.paddingBottom;
  layout.spacingX = spec.layout.direction === 'horizontal' ? spec.layout.spacing : 0;
  layout.spacingY = spec.layout.direction === 'vertical' ? spec.layout.spacing : 0;
  layout.horizontalDirection = Layout.HorizontalDirection.LEFT_TO_RIGHT;
  layout.verticalDirection = Layout.VerticalDirection.TOP_TO_BOTTOM;
  layout.affectedByScale = false;
  if (spec.layout.direction === 'horizontal') layout.alignHorizontal = true;
  else layout.alignVertical = true;
}

async function addButton(
  node: Node,
  spec: ButtonSpec,
  nodeMap: Map<string, Node>,
  assets: Record<string, SceneAssetReference>,
): Promise<void> {
  const button = node.getComponent(Button) ?? node.addComponent(Button);
  button.target = spec.targetFigmaId ? nodeMap.get(spec.targetFigmaId) ?? node : node;
  button.transition = ({
    none: Button.Transition.NONE,
    color: Button.Transition.COLOR,
    sprite: Button.Transition.SPRITE,
    scale: Button.Transition.SCALE,
  })[spec.transition];
  button.normalColor = rgba(spec.normalColor);
  button.hoverColor = rgba(spec.hoverColor ?? spec.normalColor);
  button.pressedColor = rgba(spec.pressedColor ?? spec.normalColor);
  button.disabledColor = rgba(spec.disabledColor ?? spec.normalColor);
  button.zoomScale = spec.zoomScale ?? 1.05;
  button.normalSprite = await resolveSpriteFrame(spec.normalAssetKey ? assets[spec.normalAssetKey] : undefined);
  button.hoverSprite = await resolveSpriteFrame(spec.hoverAssetKey ? assets[spec.hoverAssetKey] : undefined) ?? button.normalSprite;
  button.pressedSprite = await resolveSpriteFrame(spec.pressedAssetKey ? assets[spec.pressedAssetKey] : undefined) ?? button.normalSprite;
  button.disabledSprite = await resolveSpriteFrame(spec.disabledAssetKey ? assets[spec.disabledAssetKey] : undefined) ?? button.normalSprite;
}

async function applyNodeAppearance(
  node: Node,
  spec: NormalizedNode,
  assets: Record<string, SceneAssetReference>,
  fonts: Record<string, SceneAssetReference>,
  nodeMap: Map<string, Node>,
): Promise<void> {
  node.name = spec.name;
  (node as any).__figmaNodeId = spec.id;
  node.layer = Layers.Enum.UI_2D;
  node.active = spec.visible;
  node.setPosition(spec.x, spec.y, 0);
  node.setRotationFromEuler(0, 0, spec.rotation);
  const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
  transform.setContentSize(new Size(spec.width, spec.height));
  transform.setAnchorPoint(0.5, 0.5);
  nodeMap.set(spec.id, node);
  await addSprite(node, spec, assets);
  await addLabel(node, spec, fonts);
  addWidget(node, spec);
  addLayout(node, spec);
}

async function applyInstanceOverrides(
  instance: Node,
  spec: NormalizedNode,
  assets: Record<string, SceneAssetReference>,
  fonts: Record<string, SceneAssetReference>,
  nodeMap: Map<string, Node>,
): Promise<void> {
  await applyNodeAppearance(instance, spec, assets, fonts, nodeMap);
  for (let index = 0; index < spec.children.length; index += 1) {
    const childSpec = spec.children[index];
    if (childSpec.kind === 'ignored') continue;
    let child = instance.children[index];
    if (!child) {
      child = await buildNodeTree(childSpec, assets, fonts, nodeMap);
      child.parent = instance;
      continue;
    }
    await applyInstanceOverrides(child, childSpec, assets, fonts, nodeMap);
  }
  for (let index = spec.children.length; index < instance.children.length; index += 1) {
    instance.children[index].active = false;
  }
}

async function buildNodeTree(
  spec: NormalizedNode,
  assets: Record<string, SceneAssetReference>,
  fonts: Record<string, SceneAssetReference>,
  nodeMap: Map<string, Node>,
): Promise<Node> {
  if (spec.kind === 'instance' && spec.componentAssetKey) {
    const reference = assets[spec.componentAssetKey];
    if (!reference) throw new Error(`缺少 Component Prefab 引用：${spec.componentAssetKey}`);
    const prefab = await loadAsset<Prefab>(reference.uuid);
    const instance = instantiate(prefab);
    await applyInstanceOverrides(instance, spec, assets, fonts, nodeMap);
    return instance;
  }
  const node = new Node(spec.name);
  await applyNodeAppearance(node, spec, assets, fonts, nodeMap);
  for (const childSpec of spec.children) {
    if (childSpec.kind === 'ignored') continue;
    const child = await buildNodeTree(childSpec, assets, fonts, nodeMap);
    child.parent = node;
  }
  return node;
}

async function buildVisual(request: SceneBuildRequest): Promise<SceneBuildResult> {
  if (!request.root) throw new Error('视觉 Prefab 缺少 root spec');
  const nodeMap = new Map<string, Node>();
  const root = await buildNodeTree(request.root, request.assetReferences, request.fontReferences, nodeMap);
  const addButtons = async (spec: NormalizedNode): Promise<void> => {
    if (spec.kind === 'ignored') return;
    if (spec.button) await addButton(nodeMap.get(spec.id)!, spec.button, nodeMap, request.assetReferences);
    for (const child of spec.children) await addButtons(child);
  };
  await addButtons(request.root);
  const prefab = new Prefab();
  prefab.name = request.prefabName;
  prefab.data = root;
  const ids: Record<string, string> = {};
  const collectIds = (spec: NormalizedNode): void => {
    ids[spec.id] = spec.fileId;
    spec.children.forEach(collectIds);
  };
  collectIds(request.root);
  attachPrefabInfo(root, prefab, ids);
  return { serialized: EditorExtends.serialize(prefab), nodeFileIds: ids };
}

async function buildLogic(request: SceneBuildRequest): Promise<SceneBuildResult> {
  if (!request.visualPrefabUuid) throw new Error('逻辑 Prefab 缺少 visualPrefabUuid');
  const visualPrefab = await loadAsset<Prefab>(request.visualPrefabUuid);
  const root = new Node(request.prefabName);
  root.layer = Layers.Enum.UI_2D;
  const visual = instantiate(visualPrefab);
  visual.name = 'root';
  visual.parent = root;
  // AssetDB gives a Prefab root the asset filename on import. Persist the
  // UIView contract as a native nested-instance override instead.
  const prefabInfo = (visual as any)._prefab;
  const instance = prefabInfo?.instance;
  if (!prefabInfo?.fileId || !instance) throw new Error('无法为视觉 Prefab 实例建立 root 名称 override');
  const targetInfo = createClassInstance('cc.TargetInfo');
  targetInfo.localID = [prefabInfo.fileId];
  const propertyOverride = createClassInstance('CCPropertyOverrideInfo');
  propertyOverride.targetInfo = targetInfo;
  propertyOverride.propertyPath = ['_name'];
  propertyOverride.value = 'root';
  instance.prefabRootNode = root;
  instance.propertyOverrides = [...(instance.propertyOverrides ?? []), propertyOverride];
  const sourceTransform = visual.getComponent(UITransform);
  const transform = root.addComponent(UITransform);
  if (!sourceTransform) throw new Error('视觉 Prefab root 缺少 UITransform');
  transform.setContentSize(sourceTransform.contentSize);
  transform.setAnchorPoint(0.5, 0.5);
  if ((request.logicKind ?? 'view') === 'view') {
    const widget = root.addComponent(Widget);
    widget.isAlignLeft = true;
    widget.isAlignRight = true;
    widget.isAlignTop = true;
    widget.isAlignBottom = true;
    widget.left = 0;
    widget.right = 0;
    widget.top = 0;
    widget.bottom = 0;
    widget.alignMode = Widget.AlignMode.ALWAYS;
  }
  const prefab = new Prefab();
  prefab.name = request.prefabName;
  prefab.data = root;
  attachPrefabInfo(root, prefab, {});
  return { serialized: EditorExtends.serialize(prefab), nodeFileIds: {} };
}

function colorValue(color: Color | undefined): RGBA {
  const value = color ?? Color.WHITE;
  return { r: value.r, g: value.g, b: value.b, a: value.a };
}

function sourceFileId(node: Node, fallback: string): string {
  const value = (node as any)._prefab?.fileId;
  return typeof value === 'string' && value ? value : stableFileId(fallback);
}

function nodeCoordinates(node: Node, transform: UITransform, parentTransform?: UITransform): { x: number; y: number } {
  if (!parentTransform) return { x: 0, y: 0 };
  const width = transform.width * Math.abs(node.scale.x);
  const height = transform.height * Math.abs(node.scale.y);
  return {
    x: node.position.x + parentTransform.width * parentTransform.anchorX - width * transform.anchorX,
    y: parentTransform.height * (1 - parentTransform.anchorY) - node.position.y - height * (1 - transform.anchorY),
  };
}

function exportLayoutForFigma(
  node: Node,
  path: string,
  warnings: Set<string>,
  cumulativeScale: AdoptionScale,
) {
  const layout = node.getComponent(Layout);
  if (!layout) return undefined;
  const type = layout.type === Layout.Type.HORIZONTAL
    ? 'horizontal'
    : layout.type === Layout.Type.VERTICAL ? 'vertical'
      : layout.type === Layout.Type.GRID ? 'grid' : 'none';
  const resizeMode = layout.resizeMode === Layout.ResizeMode.CONTAINER
    ? 'container'
    : layout.resizeMode === Layout.ResizeMode.CHILDREN ? 'children' : 'none';
  const converted = cocosLayoutToFigma({
    enabled: layout.enabled,
    type,
    resizeMode,
    forward: type === 'horizontal'
      ? layout.horizontalDirection === Layout.HorizontalDirection.LEFT_TO_RIGHT
      : layout.verticalDirection === Layout.VerticalDirection.TOP_TO_BOTTOM,
    alignCrossAxis: type === 'horizontal' ? layout.alignHorizontal : layout.alignVertical,
    affectedByScale: layout.affectedByScale,
    paddingLeft: layout.paddingLeft,
    paddingRight: layout.paddingRight,
    paddingTop: layout.paddingTop,
    paddingBottom: layout.paddingBottom,
    spacingX: layout.spacingX,
    spacingY: layout.spacingY,
    children: node.children.map((child) => {
      const childLayout = child.getComponent(Layout);
      return {
        active: child.active,
        hasUiTransform: Boolean(child.getComponent(UITransform)),
        fixedSize: !childLayout?.enabled
          || childLayout.type === Layout.Type.NONE
          || childLayout.resizeMode !== Layout.ResizeMode.CONTAINER,
        scaleX: child.scale.x,
        scaleY: child.scale.y,
        rotation: child.eulerAngles.z,
      };
    }),
  });
  if (converted.reason) warnings.add(`cc.Layout 未转换为 Figma Auto Layout（节点 ${path}）：${converted.reason}；已保留当前绝对位置`);
  return scaleAdoptionLayout(converted.layout, cumulativeScale);
}

interface AdoptionDiagnostics {
  warnings: Set<string>;
  runtimeComponents: Map<string, Set<string>>;
  unsupportedVisualComponents: Map<string, Set<string>>;
}

const KNOWN_ADOPTION_COMPONENTS = new Set([
  'cc.UITransform',
  'cc.Sprite',
  'cc.Label',
  'cc.LabelOutline',
  'cc.LabelShadow',
  'cc.Button',
  'cc.Widget',
  'cc.UIOpacity',
  'cc.Layout',
]);

const RUNTIME_ADOPTION_COMPONENTS = new Set([
  'cc.ProgressBar',
  'cc.ScrollView',
  'cc.Scrollbar',
  'cc.Toggle',
  'cc.ToggleContainer',
  'cc.Slider',
  'cc.EditBox',
  'cc.PageView',
  'cc.BlockInputEvents',
  'cc.RigidBody2D',
]);

function addComponentDiagnostic(target: Map<string, Set<string>>, className: string, path: string): void {
  const paths = target.get(className) ?? new Set<string>();
  paths.add(path);
  target.set(className, paths);
}

function collectUnsupportedComponents(node: Node, path: string, diagnostics: AdoptionDiagnostics): void {
  for (const component of node.components) {
    const className = js.getClassName(component);
    if (!className || KNOWN_ADOPTION_COMPONENTS.has(className)) continue;
    const runtime = !className.startsWith('cc.')
      || RUNTIME_ADOPTION_COMPONENTS.has(className)
      || /Collider2D$/.test(className);
    addComponentDiagnostic(
      runtime ? diagnostics.runtimeComponents : diagnostics.unsupportedVisualComponents,
      className,
      path,
    );
  }
}

function appendComponentDiagnostics(diagnostics: AdoptionDiagnostics): void {
  for (const [className, paths] of diagnostics.runtimeComponents) {
    diagnostics.warnings.add(`运行时组件不进入 Figma（${className} ×${paths.size}）：${[...paths].join('、')}；请在逻辑 Prefab 或业务代码中维护`);
  }
  for (const [className, paths] of diagnostics.unsupportedVisualComponents) {
    diagnostics.warnings.add(`视觉组件尚未支持（${className} ×${paths.size}）：${[...paths].join('、')}；导入后请在 Figma 检查对应节点`);
  }
}

function exportWidgetForFigma(node: Node, path: string, warnings: Set<string>) {
  const widget = node.getComponent(Widget);
  if (!widget) return undefined;
  const converted = cocosWidgetToFigma({
    enabled: widget.enabled,
    targetIsParent: !widget.target || widget.target === node.parent,
    alignLeft: widget.isAlignLeft,
    alignRight: widget.isAlignRight,
    alignTop: widget.isAlignTop,
    alignBottom: widget.isAlignBottom,
    alignHorizontalCenter: widget.isAlignHorizontalCenter,
    alignVerticalCenter: widget.isAlignVerticalCenter,
    absoluteLeft: widget.isAbsoluteLeft,
    absoluteRight: widget.isAbsoluteRight,
    absoluteTop: widget.isAbsoluteTop,
    absoluteBottom: widget.isAbsoluteBottom,
    absoluteHorizontalCenter: widget.isAbsoluteHorizontalCenter,
    absoluteVerticalCenter: widget.isAbsoluteVerticalCenter,
  });
  if (converted.reason) warnings.add(`cc.Widget 未转换为 Figma Constraints（节点 ${path}）：${converted.reason}；已保留当前绝对位置`);
  return converted.constraints;
}

function collectPartialSupportWarnings(node: Node, path: string, warnings: Set<string>): void {
  const sprite = node.getComponent(Sprite);
  if (sprite?.type === Sprite.Type.TILED) warnings.add(`cc.Sprite TILED 暂不支持（节点 ${path}）；Figma 中按普通图片 FIT 导入`);
  if (sprite?.type === Sprite.Type.FILLED) warnings.add(`cc.Sprite FILLED 暂不支持（节点 ${path}）；填充范围不会进入 Figma`);
  if (sprite?.grayscale) warnings.add(`cc.Sprite grayscale 暂不支持（节点 ${path}）；Figma 中保留原图颜色`);

  const button = node.getComponent(Button);
  if (!button) return;
  const limitations: string[] = [];
  if (button.transition !== Button.Transition.NONE) limitations.push(`transition=${Button.Transition[button.transition] ?? button.transition}`);
  if (!button.interactable) limitations.push('interactable=false');
  if (button.target && button.target !== node) limitations.push('target 指向其他节点');
  if (button.clickEvents.length) limitations.push(`${button.clickEvents.length} 个点击事件`);
  if (limitations.length) {
    warnings.add(`cc.Button 仅保留按钮节点身份（节点 ${path}）：${limitations.join('、')} 不进入 Figma；交互状态与事件继续由 Cocos 维护`);
  }
}

function exportNodeForFigma(
  node: Node,
  path: string,
  diagnostics: AdoptionDiagnostics,
  fileIds: Set<string>,
  parentTransform?: UITransform,
  parentScale: AdoptionScale = { x: 1, y: 1 },
): SceneAdoptionNode {
  const { warnings } = diagnostics;
  const transform = node.getComponent(UITransform);
  const label = node.getComponent(Label);
  const legacyOutline = node.getComponent(LabelOutline);
  const legacyShadow = node.getComponent(LabelShadow);
  const sprite = node.getComponent(Sprite);
  const button = node.getComponent(Button);
  const coordinates = transform
    ? nodeCoordinates(node, transform, parentTransform)
    : { x: node.position.x, y: -node.position.y };
  const geometry = flattenAdoptionGeometry({
    ...coordinates,
    width: transform?.width ?? 1,
    height: transform?.height ?? 1,
  }, { x: node.scale.x, y: node.scale.y }, parentScale);
  const layout = exportLayoutForFigma(node, path, warnings, geometry.cumulativeScale);
  const constraints = exportWidgetForFigma(node, path, warnings);
  const opacity = node.getComponent(UIOpacity);
  collectUnsupportedComponents(node, path, diagnostics);
  collectPartialSupportWarnings(node, path, warnings);
  if (label && Math.abs(geometry.cumulativeScale.x - geometry.cumulativeScale.y) > 1e-6) {
    warnings.add(`文字节点存在非等比累计缩放（节点 ${path}）；Figma 无法无损保留水平字形缩放，已按垂直比例保留字号`);
  }

  const frame = sprite?.spriteFrame;
  const imageUuid = ((frame?.texture as any)?.image as any)?._uuid as string | undefined;
  const spriteFrameUuid = (frame as any)?._uuid as string | undefined;
  const insets = frame && (frame.insetLeft || frame.insetRight || frame.insetTop || frame.insetBottom)
    ? { left: frame.insetLeft, right: frame.insetRight, top: frame.insetTop, bottom: frame.insetBottom }
    : undefined;
  const originalFileId = sourceFileId(node, path);
  const exportedFileId = fileIds.has(originalFileId) ? stableFileId(`adopt:${path}`) : originalFileId;
  if (exportedFileId !== originalFileId) warnings.add(`重复的 Prefab fileId 已按节点路径重新建立稳定身份：${path}`);
  fileIds.add(exportedFileId);
  const outlineEnabled = Boolean(label && (label.enableOutline || legacyOutline?.enabled));
  const outlineColor = label?.enableOutline ? label.outlineColor : legacyOutline?.color ?? label?.outlineColor;
  const outlineWidth = label?.enableOutline ? label.outlineWidth : legacyOutline?.width ?? label?.outlineWidth ?? 0;
  const shadowEnabled = Boolean(label && (label.enableShadow || legacyShadow?.enabled));
  const shadowColor = label?.enableShadow ? label.shadowColor : legacyShadow?.color ?? label?.shadowColor;
  const shadowOffset = label?.enableShadow ? label.shadowOffset : legacyShadow?.offset ?? label?.shadowOffset;
  const shadowBlur = label?.enableShadow ? label.shadowBlur : legacyShadow?.blur ?? label?.shadowBlur ?? 0;
  const overflow = label?.overflow === Label.Overflow.NONE
    ? 'none'
    : label?.overflow === Label.Overflow.RESIZE_HEIGHT
      ? 'resize-height'
      : label?.overflow === Label.Overflow.SHRINK ? 'shrink' : 'clamp';
  if (label?.overflow === Label.Overflow.SHRINK) {
    warnings.add(`cc.Label SHRINK 在 Figma 中没有等价文本框（节点 ${path}）；导入为固定尺寸，回传 Cocos 时会降级为 CLAMP`);
  }
  const text = label ? scaleAdoptionText({
    characters: label.string,
    fontFamily: label.fontFamily || label.font?.name,
    fontSize: label.fontSize,
    lineHeight: label.lineHeight || label.fontSize,
    color: colorValue(label.color),
    fontStyle: [label.isBold ? 'Bold' : '', label.isItalic ? 'Italic' : ''].filter(Boolean).join(' ') || 'Regular',
    bold: label.isBold,
    italic: label.isItalic,
    underline: label.isUnderline,
    overflow,
    wrap: label.enableWrapText,
    outline: outlineEnabled && outlineWidth > 0 ? {
      color: colorValue(outlineColor as Color | undefined),
      width: outlineWidth,
    } : undefined,
    shadow: shadowEnabled ? {
      color: colorValue(shadowColor as Color | undefined),
      offsetX: shadowOffset?.x ?? 0,
      offsetY: shadowOffset?.y ?? 0,
      blur: shadowBlur,
    } : undefined,
    horizontalAlign: label.horizontalAlign === Label.HorizontalAlign.CENTER
      ? 'center'
      : label.horizontalAlign === Label.HorizontalAlign.RIGHT ? 'right' : 'left',
    verticalAlign: label.verticalAlign === Label.VerticalAlign.CENTER
      ? 'center'
      : label.verticalAlign === Label.VerticalAlign.BOTTOM ? 'bottom' : 'top',
  }, geometry.cumulativeScale) : undefined;
  const exported: SceneAdoptionNode = {
    sourceFileId: exportedFileId,
    name: node.name,
    kind: label ? 'text' : sprite ? 'sprite' : 'frame',
    visible: node.active,
    opacity: (opacity?.opacity ?? 255) / 255,
    x: geometry.x,
    y: geometry.y,
    width: geometry.width,
    height: geometry.height,
    rotation: -node.eulerAngles.z,
    text,
    sprite: sprite ? {
      imageUuid,
      spriteFrameUuid,
      color: colorValue(sprite.color),
      sliced: sprite.type === Sprite.Type.SLICED,
      insets,
    } : undefined,
    button: Boolean(button),
    layout,
    constraints,
    children: [],
  };
  exported.children = node.children.map((child, index) => exportNodeForFigma(
    child,
    `${path}/${child.name || index}`,
    diagnostics,
    fileIds,
    transform ?? parentTransform,
    geometry.cumulativeScale,
  ));
  return exported;
}

async function exportPrefabForFigma(request: SceneAdoptionExportRequest): Promise<SceneAdoptionExportResult> {
  if (!request.prefabUuid) throw new Error('一次性导入缺少 Prefab UUID');
  const prefab = await loadAsset<Prefab>(request.prefabUuid);
  const root = instantiate(prefab);
  const diagnostics: AdoptionDiagnostics = {
    warnings: new Set<string>(),
    runtimeComponents: new Map<string, Set<string>>(),
    unsupportedVisualComponents: new Map<string, Set<string>>(),
  };
  try {
    const raw = exportNodeForFigma(root, request.prefabName, diagnostics, new Set());
    appendComponentDiagnostics(diagnostics);
    const exported = toFigmaAdoptionRoot(
      raw,
      request.prefabName,
      root.children.length === 1 && root.children[0].name === 'root',
    );
    return { root: exported, warnings: [...diagnostics.warnings] };
  } finally {
    root.destroy();
  }
}

async function inspectSpriteFrames(
  request: SceneSpriteFrameInspectionRequest,
): Promise<SceneSpriteFrameInspection[]> {
  const results: SceneSpriteFrameInspection[] = [];
  for (const spriteFrameUuid of [...new Set(request.spriteFrameUuids)]) {
    try {
      const frame = await loadAsset<SpriteFrame>(spriteFrameUuid);
      const imageUuid = ((frame.texture as any)?.image as any)?._uuid as string | undefined;
      const insets = frame.insetLeft || frame.insetRight || frame.insetTop || frame.insetBottom
        ? { left: frame.insetLeft, right: frame.insetRight, top: frame.insetTop, bottom: frame.insetBottom }
        : undefined;
      results.push({ spriteFrameUuid, imageUuid, insets, exists: true });
    } catch {
      results.push({ spriteFrameUuid, exists: false });
    }
  }
  return results;
}

async function inspectLogicPrefab(
  request: SceneLogicInspectionRequest,
): Promise<SceneLogicInspectionResult> {
  if (!request.logicPrefabUuid) throw new Error('逻辑 Prefab 检查缺少 UUID');
  const prefab = await loadAsset<Prefab>(request.logicPrefabUuid);
  const logicRoot = instantiate(prefab);
  try {
    const visualRoot = logicRoot.children.find((child) => child.name === 'root');
    if (!visualRoot) return { nodes: [] };
    const nestedVisualPrefabUuid = ((visualRoot as any)._prefab?.asset as any)?._uuid as string | undefined;
    const nodes: SceneLogicInspectionResult['nodes'] = [];
    const visit = (node: Node, path: string): void => {
      nodes.push({
        path,
        components: node.components.map((component) => {
          const prefabProperties: Record<string, string> = {};
          const tmpPrefab = (component as any).tmpPrefab;
          const tmpPrefabUuid = tmpPrefab?._uuid as string | undefined;
          if (tmpPrefabUuid) prefabProperties.tmpPrefab = tmpPrefabUuid;
          return { className: js.getClassName(component), prefabProperties };
        }),
      });
      node.children.forEach((child) => visit(child, `${path}/${child.name}`));
    };
    visit(visualRoot, 'root');
    return { nestedVisualPrefabUuid, nodes };
  } finally {
    logicRoot.destroy();
  }
}

function queryCurrentPrefabUuid(): string | undefined {
  if (cce.SceneFacadeManager.queryMode() !== 'prefab') return undefined;
  const uuid = cce.SceneFacadeManager.queryCurrentSceneUuid();
  return typeof uuid === 'string' && uuid ? uuid : undefined;
}

export const methods: Record<string, (...args: any[]) => any> = {
  buildPrefab(request: SceneBuildRequest): Promise<SceneBuildResult> {
    return request.mode === 'logic' ? buildLogic(request) : buildVisual(request);
  },
  exportPrefabForFigma(request: SceneAdoptionExportRequest): Promise<SceneAdoptionExportResult> {
    return exportPrefabForFigma(request);
  },
  inspectSpriteFrames(request: SceneSpriteFrameInspectionRequest): Promise<SceneSpriteFrameInspection[]> {
    return inspectSpriteFrames(request);
  },
  inspectLogicPrefab(request: SceneLogicInspectionRequest): Promise<SceneLogicInspectionResult> {
    return inspectLogicPrefab(request);
  },
  queryCurrentPrefabUuid,
};

export function load(): void {}
export function unload(): void {}
