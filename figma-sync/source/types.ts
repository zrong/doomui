export type ChangeKind = 'add' | 'update' | 'delete' | 'unchanged' | 'reuse';
export type IssueSeverity = 'warning' | 'blocker';

export interface ResolvedOutputPaths {
  root: string;
  visualPrefabUrl: string;
  logicPrefabUrl: string;
  itemVisualRoot: string;
  itemRoot: string;
  textureRoot: string;
}

export interface SyncRequest {
  sourceUrl: string;
  bundleRoot: string;
}

export interface ApplySyncInput {
  planId: string;
  confirmBindingChanges?: boolean;
}

export interface FigmaSource {
  fileKey: string;
  nodeId: string;
  normalizedUrl: string;
}

export interface SyncIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  nodeId?: string;
  path?: string;
}

export interface SyncChange {
  key: string;
  kind: ChangeKind;
  path: string;
  detail: string;
  nodeId?: string;
}

export interface SyncPreview {
  planId: string;
  fileVersion: string;
  changes: SyncChange[];
  warnings: SyncIssue[];
  blockers: SyncIssue[];
  unchangedByMetadata?: boolean;
  outputPaths?: ResolvedOutputPaths;
  requiresBindingConfirmation?: boolean;
  rebuildFromEmptyOutput?: {
    previousTrackedAssets: number;
  };
  targets?: Array<{
    kind: AdoptionKind;
    nodeId: string;
    name: string;
  }>;
}

export interface SyncReport extends SyncPreview {
  source: FigmaSource;
  startedAt: string;
  finishedAt: string;
  applied: boolean;
  rolledBack: boolean;
  createdAssets: string[];
  updatedAssets: string[];
  orphanAssets: string[];
}

export interface CocosNodeIdentity {
  fileId: string;
  hash: string;
  kind: NormalizedNodeKind;
  name: string;
}

export interface GeneratedAssetIdentity {
  url: string;
  hash: string;
  uuid?: string;
  spriteFrameUuid?: string;
  sourceNodeId?: string;
  importSettingsHash?: string;
  ownership: 'generated' | 'shared';
}

export type BindingComponentKind = 'Node' | 'Button' | 'Label' | 'Sprite' | 'ListExtent';

export interface BindingContractEntry {
  nodeId: string;
  property: string;
  path: string;
  component: BindingComponentKind;
}

export interface ItemPrefabBinding {
  componentKey: string;
  componentName: string;
  itemVisualPrefabUrl: string;
  itemLogicPrefabUrl: string;
}

export interface FrameMapping {
  schemaVersion: 4;
  kind?: AdoptionKind;
  configHash?: string;
  source: { fileKey: string; nodeId: string; fileVersion: string };
  frameName: string;
  visualPrefabUrl: string;
  logicPrefabUrl: string;
  nodes: Record<string, CocosNodeIdentity>;
  assets: Record<string, GeneratedAssetIdentity>;
  ownedAssets: string[];
  bundleRoot: string;
  bindings?: BindingContractEntry[];
  items?: ItemPrefabBinding[];
  adoptionKey?: string;
}

export interface AdoptionNodeMapping {
  cocosFileId: string;
  cocosNodeName: string;
  /**
   * Undefined means a legacy mapping created before constraint provenance was
   * persisted. False means the Cocos source had no Widget that could be
   * represented by Figma constraints, so Figma's implicit MIN/MIN defaults
   * must not create a new cc.Widget on the way back.
   */
  sourceWidgetMapped?: boolean;
  /** Cocos text-box semantics captured when the Prefab was adopted. */
  sourceText?: {
    width: number;
    height: number;
    importedWidth: number;
    importedHeight: number;
    overflow: LabelSpec['overflow'];
    wrap: boolean;
  };
  /**
   * A Cocos Sprite component whose SpriteFrame was null at adoption time.
   * Cocos Sync uses a transparent Figma fill only as an editable placeholder;
   * an unchanged placeholder must round-trip back to a null SpriteFrame rather
   * than creating a generated white texture.
   */
  sourceEmptySpriteFrame?: {
    sliced: boolean;
    color: RGBA;
  };
}

export type AdoptionKind = 'view' | 'item';
export type AdoptionFigmaNodeType = 'FRAME' | 'COMPONENT';

export interface AdoptionMapping {
  schemaVersion: 3;
  kind: AdoptionKind;
  sourcePrefabUrl: string;
  sourcePrefabUuid: string;
  sourcePrefabHash: string;
  figma: {
    fileKey: string;
    fileName: string;
    nodeId: string;
    normalizedUrl?: string;
  };
  nodes: Record<string, AdoptionNodeMapping>;
  assets: Record<string, AdoptionAssetMapping>;
  createdAt: string;
  releasedAt?: string;
}

export interface CocosSharedAsset {
  key: string;
  sourceUrl: string;
  sourceImageUuid: string;
  sourceSpriteFrameUuid: string;
  contentHash: string;
  /** True when the original image is fully opaque white. */
  solidWhite?: boolean;
  /** Required provenance for engine-owned db://internal/default_ui assets. */
  sourceCreatorVersion?: string;
  sliced: boolean;
  insets?: NineSliceInsets;
  mimeType: 'image/png';
  width: number;
  height: number;
}

export interface SharedAssetCatalogItemMapping extends CocosSharedAsset {
  componentNodeId: string;
  figmaImageRef: string;
  updatedAt: string;
}

export interface SharedAssetCatalogMapping {
  schemaVersion: 1;
  figma: {
    fileKey: string;
    fileName: string;
    catalogNodeId: string;
  };
  assets: Record<string, SharedAssetCatalogItemMapping>;
  updatedAt: string;
}

export interface ProjectSettings {
  schemaVersion: 8;
  bundleRoot: string;
  sharedTextureRoots: string[];
  fontMap: Record<string, string>;
  frames: Record<string, FrameMapping>;
  adoptions: Record<string, AdoptionMapping>;
  sharedAssetCatalogs: Record<string, SharedAssetCatalogMapping>;
  pendingOrphans: string[];
}

export type ManagedSyncTargetAdoptionState = 'active' | 'released' | 'missing' | 'none';

export interface ManagedSyncTargetSummary {
  frameKey: string;
  kind: AdoptionKind;
  fileKey: string;
  nodeId: string;
  frameName: string;
  visualPrefabUrl: string;
  logicPrefabUrl: string;
  ownedAssetCount: number;
  adoptionState: ManagedSyncTargetAdoptionState;
}

export interface RetireManagedSyncTargetInput {
  frameKey: string;
}

export interface RetireManagedSyncTargetResult {
  target: ManagedSyncTargetSummary;
  orphanAssets: string[];
  pendingOrphans: string[];
}

export interface OrphanCleanupStatus {
  assets: string[];
}

export interface OrphanCleanupBlocked {
  path: string;
  reason: string;
  dependents?: string[];
}

export interface OrphanCleanupResult {
  deletedAssets: string[];
  missingAssets: string[];
  blockedAssets: OrphanCleanupBlocked[];
  pendingAssets: string[];
}

export interface UserSettingsView {
  project: ProjectSettings;
}

export interface SaveSettingsInput {
  project?: Partial<Pick<ProjectSettings, 'bundleRoot' | 'sharedTextureRoots' | 'fontMap'>>;
}

export interface FigmaRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

export interface FigmaPaint {
  type: string;
  visible?: boolean;
  opacity?: number;
  color?: FigmaColor;
  imageRef?: string;
  scaleMode?: string;
  imageTransform?: number[][];
  gradientStops?: unknown[];
}

export interface FigmaEffect {
  type: string;
  visible?: boolean;
  color?: FigmaColor;
  offset?: { x: number; y: number };
  radius?: number;
  spread?: number;
  blendMode?: string;
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  opacity?: number;
  rotation?: number;
  relativeTransform?: [[number, number, number], [number, number, number]];
  absoluteBoundingBox?: FigmaRectangle;
  absoluteRenderBounds?: FigmaRectangle;
  size?: { x: number; y: number };
  children?: FigmaNode[];
  constraints?: { horizontal?: string; vertical?: string };
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID';
  layoutWrap?: 'NO_WRAP' | 'WRAP';
  primaryAxisSizingMode?: 'FIXED' | 'AUTO';
  counterAxisSizingMode?: 'FIXED' | 'AUTO';
  primaryAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  counterAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'BASELINE';
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemSpacing?: number;
  itemReverseZIndex?: boolean;
  strokesIncludedInLayout?: boolean;
  layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL';
  layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL';
  layoutPositioning?: 'AUTO' | 'ABSOLUTE';
  layoutAlign?: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'INHERIT';
  layoutGrow?: number;
  clipsContent?: boolean;
  fills?: FigmaPaint[] | symbol;
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  cornerRadius?: number;
  rectangleCornerRadii?: number[];
  effects?: FigmaEffect[];
  blendMode?: string;
  characters?: string;
  style?: Record<string, unknown>;
  styleOverrideTable?: Record<string, unknown>;
  characterStyleOverrides?: number[];
  componentId?: string;
  componentSetId?: string;
  componentProperties?: Record<string, { type?: string; value?: string | boolean; preferredValues?: unknown[] }>;
  overrides?: Array<{ id: string; overriddenFields: string[] }>;
  isAsset?: boolean;
  isMask?: boolean;
  maskType?: string;
  textAutoResize?: string;
  textTruncation?: string;
  maxLines?: number;
  textDecoration?: string;
}

export interface FigmaComponentMetadata {
  key?: string;
  name?: string;
  description?: string;
  componentSetId?: string;
  remote?: boolean;
  documentationLinks?: Array<{ uri: string }>;
}

export interface FigmaComponentSetMetadata {
  key?: string;
  name?: string;
  description?: string;
  remote?: boolean;
}

export interface FigmaPushPayload {
  protocolVersion: 12;
  fileKey: string;
  fileName: string;
  targets: Array<{
    kind: AdoptionKind;
    normalizedUrl?: string;
    document: FigmaNode;
  }>;
  components?: Record<string, FigmaComponentMetadata>;
  componentSets?: Record<string, FigmaComponentSetMetadata>;
}

export interface CocosAdoptionText {
  characters: string;
  fontFamily?: string;
  fontStyle?: string;
  fontSize: number;
  lineHeight: number;
  color: RGBA;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  overflow: 'none' | 'clamp' | 'shrink' | 'resize-height';
  wrap: boolean;
  outline?: {
    color: RGBA;
    width: number;
  };
  shadow?: {
    color: RGBA;
    offsetX: number;
    offsetY: number;
    blur: number;
  };
  horizontalAlign: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'center' | 'bottom';
}

export interface LinearLayoutSpec {
  direction: 'horizontal' | 'vertical';
  resizeMode: 'none' | 'container';
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
  paddingBottom: number;
  spacing: number;
}

export interface SceneAdoptionSprite {
  imageUuid?: string;
  spriteFrameUuid?: string;
  color: RGBA;
  solidWhite?: boolean;
  sliced?: boolean;
  insets?: NineSliceInsets;
}

export interface AdoptionConstraints {
  horizontal: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE';
  vertical: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE';
}

export interface SceneAdoptionNode {
  sourceFileId: string;
  name: string;
  kind: 'frame' | 'text' | 'sprite';
  visible: boolean;
  opacity: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  cornerRadius?: number;
  text?: CocosAdoptionText;
  sprite?: SceneAdoptionSprite;
  button: boolean;
  layout?: LinearLayoutSpec;
  constraints?: AdoptionConstraints;
  children: SceneAdoptionNode[];
}

export interface CocosAdoptionNode extends Omit<SceneAdoptionNode, 'sprite' | 'children'> {
  sprite?: Omit<SceneAdoptionSprite, 'imageUuid'> & { assetKey?: string };
  children: CocosAdoptionNode[];
}

export interface CocosAdoptionAsset extends CocosSharedAsset {
  sourceNodeFileIds: string[];
}

export interface CocosAdoptionDocument {
  protocolVersion: 12;
  kind: AdoptionKind;
  sessionId: string;
  prefabUrl: string;
  prefabName: string;
  root: CocosAdoptionNode;
  assets: CocosAdoptionAsset[];
  warnings: string[];
  createdAt: string;
  expiresAt: string;
}

export interface CocosAdoptionNodeSummary {
  path: string;
  name: string;
  kind: CocosAdoptionNode['kind'];
}

export interface CocosAdoptionSessionSummary {
  kind: AdoptionKind;
  sessionId: string;
  prefabUrl: string;
  prefabName: string;
  nodeCount: number;
  assetCount: number;
  warningCount: number;
  nodes?: CocosAdoptionNodeSummary[];
  assets?: CocosAdoptionAsset[];
  warnings?: string[];
  status: 'ready' | 'imported';
  createdAt: string;
  expiresAt: string;
  importedNode?: {
    fileKey: string;
    fileName: string;
    nodeId: string;
    nodeType: AdoptionFigmaNodeType;
  };
}

export interface CocosAdoptionBindingSummary {
  kind: AdoptionKind;
  sourcePrefabUrl: string;
  sourcePrefabUuid: string;
  fileKey: string;
  fileName: string;
  nodeId: string;
  nodeType: AdoptionFigmaNodeType;
  normalizedUrl?: string;
  createdAt: string;
}

export interface ReleaseCocosAdoptionBindingInput {
  fileKey: string;
  nodeId: string;
}

export interface CreateCocosAdoptionInput {
  prefabUrl: string;
  kind?: AdoptionKind;
}

export interface CompleteCocosAdoptionInput {
  fileKey: string;
  fileName: string;
  nodeId: string;
  nodeType: AdoptionFigmaNodeType;
  normalizedUrl?: string;
  nodes: Record<string, AdoptionNodeMapping>;
  images: Record<string, string>;
}

export interface AdoptionAssetMapping extends CocosAdoptionAsset {
  figmaImageRef: string;
}

export interface SharedAssetSelectionItem {
  selectionUuid: string;
  sourceUrl: string;
  sourceImageUuid: string;
  sourceSpriteFrameUuid: string;
  sliced: boolean;
  insets?: NineSliceInsets;
}

export interface SharedAssetSelectionSummary {
  selectedCount: number;
  items: SharedAssetSelectionItem[];
  errors: string[];
}

export interface CocosSharedAssetCatalogDocument {
  protocolVersion: 12;
  sessionId: string;
  assets: CocosSharedAsset[];
  createdAt: string;
  expiresAt: string;
}

export interface CocosSharedAssetCatalogSessionSummary {
  sessionId: string;
  assetCount: number;
  assets: CocosSharedAsset[];
  status: 'ready' | 'imported';
  createdAt: string;
  expiresAt: string;
  importedCatalog?: {
    fileKey: string;
    fileName: string;
    catalogNodeId: string;
  };
}

export interface CompleteSharedAssetCatalogInput {
  fileKey: string;
  fileName: string;
  catalogNodeId: string;
  retainedSourceSpriteFrameUuids: string[];
  items: Record<string, {
    componentNodeId: string;
    figmaImageRef: string;
  }>;
}

export interface SceneAdoptionExportRequest {
  prefabUuid: string;
  prefabName: string;
}

export interface SceneAdoptionExportResult {
  root: SceneAdoptionNode;
  warnings: string[];
}

export interface SceneSpriteFrameInspection {
  spriteFrameUuid: string;
  imageUuid?: string;
  insets?: NineSliceInsets;
  exists: boolean;
}

export interface SceneSpriteFrameInspectionRequest {
  spriteFrameUuids: string[];
}

export interface PushAssetRequest {
  key: string;
  kind: 'image-fill' | 'raster';
  nodeId?: string;
  imageRef?: string;
}

export interface PushPrepareResult {
  preview: SyncPreview;
  assetRequests: PushAssetRequest[];
  requiresComplete: boolean;
}

export interface PushServiceStatus {
  running: boolean;
  endpoint: string;
  pairingCode: string;
  paired: boolean;
  error?: string;
  lastPush?: {
    targetLabel: string;
    receivedAt: string;
    planId?: string;
    error?: string;
  };
  activeAdoption?: CocosAdoptionSessionSummary;
  activeSharedAssets?: CocosSharedAssetCatalogSessionSummary;
}

export interface CocosSyncStatusResponse {
  protocolVersion: 12;
  running: boolean;
  endpoint: string;
  activeAdoption: CocosAdoptionSessionSummary | null;
  activeSharedAssets: CocosSharedAssetCatalogSessionSummary | null;
}

export type PushServiceEvent =
  | { type: 'status'; status: PushServiceStatus }
  | { type: 'preview'; status: PushServiceStatus; preview: SyncPreview; targetLabel: string }
  | { type: 'error'; status: PushServiceStatus; message: string };

export type NormalizedNodeKind = 'container' | 'label' | 'sprite' | 'instance' | 'ignored';
export type RenderMode = 'none' | 'label' | 'image-fill' | 'raster';

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface NineSliceInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface WidgetSpec {
  alignLeft?: boolean;
  alignRight?: boolean;
  alignTop?: boolean;
  alignBottom?: boolean;
  alignHorizontalCenter?: boolean;
  alignVerticalCenter?: boolean;
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  horizontalCenter?: number;
  verticalCenter?: number;
  absoluteLeft?: boolean;
  absoluteRight?: boolean;
  absoluteTop?: boolean;
  absoluteBottom?: boolean;
  absoluteHorizontalCenter?: boolean;
  absoluteVerticalCenter?: boolean;
}

export interface LabelSpec {
  text: string;
  fontSize: number;
  lineHeight: number;
  color: RGBA;
  horizontalAlign: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'center' | 'bottom';
  overflow: 'none' | 'resize-height' | 'clamp';
  wrap: boolean;
  fontKey?: string;
  fontUrl?: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  outline?: { color: RGBA; width: number };
  shadow?: { color: RGBA; offsetX: number; offsetY: number; blur: number };
}

export interface SpriteSpec {
  assetKey: string;
  source: 'image-fill' | 'raster';
  color: RGBA;
  nineSlice?: NineSliceInsets;
}

export type ButtonTransition = 'none' | 'color' | 'sprite' | 'scale';

export interface ButtonSpec {
  transition: ButtonTransition;
  targetFigmaId?: string;
  normalAssetKey?: string;
  hoverAssetKey?: string;
  pressedAssetKey?: string;
  disabledAssetKey?: string;
  normalColor?: RGBA;
  hoverColor?: RGBA;
  pressedColor?: RGBA;
  disabledColor?: RGBA;
  zoomScale?: number;
}

export interface NormalizedNode {
  id: string;
  fileId: string;
  name: string;
  sourceType: string;
  kind: NormalizedNodeKind;
  renderMode: RenderMode;
  visible: boolean;
  opacity: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  hash: string;
  children: NormalizedNode[];
  layout?: LinearLayoutSpec;
  widget?: WidgetSpec;
  label?: LabelSpec;
  sprite?: SpriteSpec;
  button?: ButtonSpec;
  componentId?: string;
  componentSetId?: string;
  componentAssetKey?: string;
  variantProperties?: Record<string, string | boolean>;
  remoteComponent?: boolean;
}

export interface AssetTask {
  key: string;
  kind: 'generated-solid' | 'image-fill' | 'raster';
  hash: string;
  nodeId?: string;
  imageRef?: string;
  sourceUrl?: string;
  targetUrl: string;
  nineSlice?: NineSliceInsets;
  importSettingsHash: string;
  sharedSource?: AdoptionAssetMapping;
}

export interface NormalizeResult {
  root: NormalizedNode;
  issues: SyncIssue[];
  assets: AssetTask[];
  components: Record<string, FigmaComponentMetadata>;
  componentSets: Record<string, FigmaComponentSetMetadata>;
}

export interface SceneAssetReference {
  key: string;
  url: string;
  uuid: string;
  spriteFrameUuid?: string;
}

export interface SceneBuildRequest {
  mode: 'visual' | 'logic';
  logicKind?: 'view' | 'item';
  prefabName: string;
  root?: NormalizedNode;
  visualPrefabUuid?: string;
  existingPrefabUuid?: string;
  assetReferences: Record<string, SceneAssetReference>;
  fontReferences: Record<string, SceneAssetReference>;
}

export interface SceneBuildResult {
  serialized: string;
  nodeFileIds: Record<string, string>;
}

export interface SceneLogicComponentInspection {
  className: string;
  prefabProperties: Record<string, string>;
}

export interface SceneLogicNodeInspection {
  path: string;
  components: SceneLogicComponentInspection[];
}

export interface SceneLogicInspectionRequest {
  logicPrefabUuid: string;
}

export interface SceneLogicInspectionResult {
  nestedVisualPrefabUuid?: string;
  nodes: SceneLogicNodeInspection[];
}

export interface ComponentPrefabPlan {
  key: string;
  componentName: string;
  url: string;
  logicUrl: string;
  hash: string;
  root: NormalizedNode;
  instanceIds: string[];
}

export interface PreparedSync {
  kind: AdoptionKind;
  request: SyncRequest;
  source: FigmaSource;
  frameKey: string;
  frameName: string;
  fileVersion: string;
  normalized: NormalizeResult;
  preview: SyncPreview;
  mapping?: FrameMapping;
  adoption?: AdoptionMapping;
  visualPrefabUrl: string;
  logicPrefabUrl: string;
  componentPlans: ComponentPrefabPlan[];
  configurationHash: string;
  outputPaths: ResolvedOutputPaths;
  bindingContract: BindingContractEntry[];
  itemPrefabs: ItemPrefabBinding[];
  expiresAt: number;
  abortController: AbortController;
  pushedAssets: Map<string, Buffer>;
  requiredPushAssetKeys: Set<string>;
  referenceComponentPlans?: ComponentPrefabPlan[];
}

export interface PreparedPushBatch {
  preview: SyncPreview;
  targets: PreparedSync[];
  expiresAt: number;
  abortController: AbortController;
  pushedAssets: Map<string, Buffer>;
  requiredPushAssetKeys: Set<string>;
}
