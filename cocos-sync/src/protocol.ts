export const ENDPOINT = 'http://localhost:38638';
export const PROTOCOL_VERSION = 12 as const;
export const SERVICE_ID = 'cocos-sync' as const;
// These keys are scoped to the persistent Figma plugin ID and imported files.
// Keep their legacy values so an npm/package rename does not lose pairing or mappings.
export const TOKEN_STORAGE_KEY = 'cocos-push-token-v1';
export const LOCAL_FILE_ID_KEY = 'cocos-ui-sync-file-id-v1';

export type AdoptionKind = 'view' | 'item';
export type AdoptionFigmaNodeType = 'FRAME' | 'COMPONENT';

export interface PushAssetRequest {
  key: string;
  kind: 'image-fill' | 'raster';
  nodeId?: string;
  imageRef?: string;
}

export interface SyncPreviewSummary {
  planId: string;
  changes: unknown[];
  warnings: unknown[];
  blockers: unknown[];
  unchangedByMetadata?: boolean;
  rebuildFromEmptyOutput?: {
    previousTrackedAssets: number;
  };
}

export interface PushPrepareResult {
  preview: SyncPreviewSummary;
  assetRequests: PushAssetRequest[];
  requiresComplete: boolean;
}

export interface FigmaPushTarget {
  kind: AdoptionKind;
  normalizedUrl?: string;
  document: unknown;
}

export interface FigmaPushPayload {
  protocolVersion: 12;
  fileKey: string;
  fileName: string;
  targets: FigmaPushTarget[];
  components?: Record<string, unknown>;
  componentSets?: Record<string, unknown>;
}

export interface AdoptionNodeMapping {
  cocosFileId: string;
  cocosNodeName: string;
}

export interface CocosAdoptionText {
  characters: string;
  fontFamily?: string;
  fontStyle?: string;
  fontSize: number;
  lineHeight: number;
  color: { r: number; g: number; b: number; a: number };
  bold: boolean;
  italic: boolean;
  underline: boolean;
  overflow: 'none' | 'clamp' | 'shrink' | 'resize-height';
  wrap: boolean;
  outline?: {
    color: { r: number; g: number; b: number; a: number };
    width: number;
  };
  shadow?: {
    color: { r: number; g: number; b: number; a: number };
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

export interface CocosAdoptionNode {
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
  sprite?: {
    color: { r: number; g: number; b: number; a: number };
    solidWhite?: boolean;
    sliced?: boolean;
    insets?: { left: number; right: number; top: number; bottom: number };
    assetKey?: string;
  };
  button: boolean;
  layout?: LinearLayoutSpec;
  constraints?: {
    horizontal: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE';
    vertical: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE';
  };
  children: CocosAdoptionNode[];
}

export interface CocosAdoptionAsset extends CocosSharedAsset {
  sourceNodeFileIds: string[];
}

export interface CocosSharedAsset {
  key: string;
  sourceUrl: string;
  sourceImageUuid: string;
  sourceSpriteFrameUuid: string;
  contentHash: string;
  solidWhite?: boolean;
  sourceCreatorVersion?: string;
  sliced: boolean;
  insets?: { left: number; right: number; top: number; bottom: number };
  mimeType: 'image/png';
  width: number;
  height: number;
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

export interface CocosSyncStatusResponse {
  protocolVersion: 12;
  running: boolean;
  endpoint: string;
  activeAdoption: CocosAdoptionSessionSummary | null;
  activeSharedAssets: CocosSharedAssetCatalogSessionSummary | null;
}

export interface ReleaseCocosAdoptionBindingInput {
  fileKey: string;
  nodeId: string;
}
