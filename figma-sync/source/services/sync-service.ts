import type {
  AdoptionAssetMapping,
  AdoptionMapping,
  AssetTask,
  BindingContractEntry,
  FigmaComponentMetadata,
  FigmaComponentSetMetadata,
  FigmaNode,
  FigmaPushPayload,
  FrameMapping,
  GeneratedAssetIdentity,
  ItemPrefabBinding,
  ManagedSyncTargetSummary,
  NormalizeResult,
  NormalizedNode,
  OrphanCleanupResult,
  OrphanCleanupStatus,
  PreparedPushBatch,
  PreparedSync,
  ProjectSettings,
  PushAssetRequest,
  PushPrepareResult,
  RetireManagedSyncTargetInput,
  RetireManagedSyncTargetResult,
  SceneAssetReference,
  SceneBuildRequest,
  SceneBuildResult,
  SceneLogicInspectionResult,
  SceneSpriteFrameInspection,
  SyncChange,
  SyncIssue,
  SyncPreview,
  SyncReport,
  SyncRequest,
} from '../types';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { resolve, sep } from 'path';
import { mappingKey } from '../core/naming';
import { normalizeFigmaFrame } from '../core/normalizer';
import { applyButtonSemantics } from '../core/variants';
import { collectNodeMapping, diffNormalized } from '../core/diff';
import { shortHash } from '../core/hash';
import { applyComponentReferences, planComponentPrefabs } from '../core/components';
import {
  mappingBundleIssues,
  normalizeBundleRoot,
  normalizeSyncRequest,
  resolveOutputPaths,
} from '../core/output-path';
import { validateUIView } from '../core/uiview';
import { stripLegacyItemTemplates } from '../core/list-items';
import { collectDependencyConflicts } from '../core/dependency-conflicts';
import {
  AssetWriteTransaction,
  generatedAssetBuffer,
  isOpaqueWhiteTexture,
  normalizeTextureBuffer,
  toSceneAssetReference,
} from './asset-writer';
import { getProjectSettings, PACKAGE_NAME, saveProjectSettings } from './settings';

interface AssetInfoLike {
  uuid: string;
  url?: string;
  source?: string;
  file?: string;
  invalid?: boolean;
  imported?: boolean;
  depends?: string[];
  type?: string;
  name?: string;
  subAssets?: Record<string, AssetInfoLike>;
}

interface AssetMetaLike {
  userData?: { isBundle?: boolean };
}

interface ApplyResult {
  report: SyncReport;
  mapping: FrameMapping;
}

const INTERNAL_DEFAULT_UI_PREFIX = 'db://internal/default_ui/';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function queryAsset(url: string): Promise<AssetInfoLike | null> {
  return Editor.Message.request('asset-db', 'query-asset-info', url) as Promise<AssetInfoLike | null>;
}

function assetSourceExists(url: string, asset: AssetInfoLike | null): boolean {
  const projectPath = Editor.Project?.path;
  const projectAssets = projectPath ? resolve(projectPath, 'assets') : undefined;
  if (projectPath && projectAssets && url.startsWith('db://assets/')) {
    const physicalPath = resolve(projectPath, url.slice('db://'.length));
    if (physicalPath === projectAssets || physicalPath.startsWith(`${projectAssets}${sep}`)) {
      return existsSync(physicalPath);
    }
  }
  return Boolean(asset && !asset.invalid && (!asset.file || existsSync(asset.file)));
}

function isGeneratedOrphanPath(url: string): boolean {
  return /^db:\/\/assets\/.+\/textures\/figma\/[^/]+\.png$/i.test(url)
    || /^db:\/\/assets\/.+\/prefabs\/(?:view\/figma|item\/figma)\/[^/]+\.root\.prefab$/i.test(url);
}

function managedSyncTargetSummary(
  frameKey: string,
  mapping: FrameMapping,
  settings: ProjectSettings,
): ManagedSyncTargetSummary {
  const adoptionKey = mapping.adoptionKey;
  const adoption = adoptionKey ? settings.adoptions[adoptionKey] : undefined;
  return {
    frameKey,
    kind: mapping.kind ?? (mapping.visualPrefabUrl.includes('/prefabs/item/') ? 'item' : 'view'),
    fileKey: mapping.source.fileKey,
    nodeId: mapping.source.nodeId,
    frameName: mapping.frameName,
    visualPrefabUrl: mapping.visualPrefabUrl,
    logicPrefabUrl: mapping.logicPrefabUrl,
    ownedAssetCount: [...new Set(mapping.ownedAssets)].length,
    adoptionState: !adoptionKey ? 'none' : !adoption ? 'missing' : adoption.releasedAt ? 'released' : 'active',
  };
}

function assetUuidSet(asset: AssetInfoLike): Set<string> {
  const values = new Set<string>([asset.uuid]);
  const visit = (subAssets: AssetInfoLike['subAssets']): void => {
    for (const subAsset of Object.values(subAssets ?? {})) {
      if (subAsset.uuid) values.add(subAsset.uuid);
      visit((subAsset as AssetInfoLike).subAssets);
    }
  };
  visit(asset.subAssets);
  return values;
}

async function emptyOutputBaseline(mapping: FrameMapping | undefined): Promise<{ rebuild: boolean; trackedCount: number }> {
  if (!mapping) return { rebuild: false, trackedCount: 0 };
  const tracked = [...new Set([
    mapping.visualPrefabUrl,
    mapping.logicPrefabUrl,
    ...mapping.ownedAssets,
  ].filter(Boolean))];
  if (!tracked.length) return { rebuild: false, trackedCount: 0 };
  const assets = await Promise.all(tracked.map((url) => queryAsset(url)));
  return {
    // Cocos AssetDB can retain imported/library records after a source
    // directory was removed outside the editor. db://assets source files are
    // the final authority; the AssetDB record is only a compatibility fallback.
    rebuild: assets.every((asset, index) => !assetSourceExists(tracked[index], asset)),
    trackedCount: tracked.length,
  };
}

function findFontUrls(root: NormalizedNode): Set<string> {
  const urls = new Set<string>();
  const visit = (node: NormalizedNode): void => {
    if (node.label?.fontUrl) urls.add(node.label.fontUrl);
    node.children.forEach(visit);
  };
  visit(root);
  return urls;
}

function collectRemoteIssues(root: NormalizedNode): SyncIssue[] {
  const issues: SyncIssue[] = [];
  const visit = (node: NormalizedNode): void => {
    if (node.kind === 'instance' && node.remoteComponent) {
      issues.push({
        severity: 'warning',
        code: 'REMOTE_COMPONENT_EXPANDED',
        nodeId: node.id,
        message: `远程组件 ${node.name} 无本地 Component Prefab 定义，将展开当前解析结构`,
      });
    }
    node.children.forEach(visit);
  };
  visit(root);
  return issues;
}

const EMPTY_SPRITE_FRAME_ASSET_KEY = '__cocos_empty_sprite_frame';

export function applyAdoptionFileIds(
  root: NormalizedNode,
  adoption: AdoptionMapping | undefined,
  assets: AssetTask[] = [],
): SyncIssue[] {
  if (!adoption) return [];
  const remaining = new Set(Object.keys(adoption.nodes));
  const seenFileIds = new Set<string>();
  const issues: SyncIssue[] = [];
  const assetTasks = new Map(assets.map((task) => [task.key, task]));
  const sourceAssetNodeFileIds = new Set(
    Object.values(adoption.assets ?? {}).flatMap((asset) => asset.sourceNodeFileIds),
  );
  const releasedGeneratedSolidKeys = new Set<string>();
  const isDefaultLeftTopWidget = (node: NormalizedNode): boolean => Boolean(
    node.widget
    && node.widget.alignLeft
    && node.widget.alignTop
    && node.widget.absoluteLeft
    && node.widget.absoluteTop
    && !node.widget.alignRight
    && !node.widget.alignBottom
    && !node.widget.alignHorizontalCenter
    && !node.widget.alignVerticalCenter,
  );
  const sameDimension = (left: number, right: number): boolean => Math.abs(left - right) <= 0.01;
  const refreshHash = (node: NormalizedNode): void => {
    const { hash: _hash, ...draft } = node;
    node.hash = shortHash({ ...draft, fileId: undefined }, 20);
  };
  const visit = (node: NormalizedNode): void => {
    const adopted = adoption.nodes[node.id];
    if (adopted) {
      remaining.delete(node.id);
      if (seenFileIds.has(adopted.cocosFileId)) {
        issues.push({
          severity: 'blocker',
          code: 'ADOPTION_FILE_ID_DUPLICATE',
          nodeId: node.id,
          message: `一次性导入映射包含重复的 Cocos fileId：${adopted.cocosFileId}`,
        });
      } else {
        node.fileId = adopted.cocosFileId;
        seenFileIds.add(adopted.cocosFileId);
      }
      if (adopted.sourceWidgetMapped === false && isDefaultLeftTopWidget(node)) {
        node.widget = undefined;
      }
      if (
        adopted.sourceText
        && node.label
        && sameDimension(node.width, adopted.sourceText.importedWidth)
        && sameDimension(node.height, adopted.sourceText.importedHeight)
      ) {
        const widthDelta = adopted.sourceText.width - node.width;
        const heightDelta = adopted.sourceText.height - node.height;
        node.x += widthDelta / 2;
        node.y -= heightDelta / 2;
        node.width = adopted.sourceText.width;
        node.height = adopted.sourceText.height;
        node.label = {
          ...node.label,
          overflow: adopted.sourceText.overflow,
          wrap: adopted.sourceText.wrap,
        };
      }
      const generatedSolid = node.sprite ? assetTasks.get(node.sprite.assetKey) : undefined;
      // Some schema-3 mappings produced before the adoption provenance fix
      // marked every Sprite as empty because the public adoption tree omitted
      // spriteFrameUuid. An asset whose sourceNodeFileIds contains this node is
      // definitive evidence that the source SpriteFrame was not empty.
      const sourceEmptySpriteFrame = adopted.sourceEmptySpriteFrame;
      const sourceWasEmpty = Boolean(
        sourceEmptySpriteFrame
        && !sourceAssetNodeFileIds.has(adopted.cocosFileId),
      );
      const unchangedTransparentPlaceholder = Boolean(
        node.sprite
        && generatedSolid?.kind === 'generated-solid'
        && node.sprite.color.a === 0,
      );
      const legacyEmptySpriteFrame = Boolean(
        !adopted.sourceEmptySpriteFrame
        && unchangedTransparentPlaceholder
        && /^\$sp_/i.test(adopted.cocosNodeName.trim())
        && !sourceAssetNodeFileIds.has(adopted.cocosFileId),
      );
      if (sourceWasEmpty && sourceEmptySpriteFrame && !node.sprite) {
        node.sprite = {
          assetKey: EMPTY_SPRITE_FRAME_ASSET_KEY,
          source: 'image-fill',
          color: sourceEmptySpriteFrame.color,
          nineSlice: sourceEmptySpriteFrame.sliced
            ? { left: 0, right: 0, top: 0, bottom: 0 }
            : undefined,
        };
        node.renderMode = 'none';
      } else if ((sourceWasEmpty || legacyEmptySpriteFrame) && unchangedTransparentPlaceholder && node.sprite) {
        releasedGeneratedSolidKeys.add(node.sprite.assetKey);
        node.sprite = {
          ...node.sprite,
          assetKey: EMPTY_SPRITE_FRAME_ASSET_KEY,
          color: sourceEmptySpriteFrame?.color ?? { ...node.sprite.color, a: 255 },
          nineSlice: sourceEmptySpriteFrame?.sliced
            ? { left: 0, right: 0, top: 0, bottom: 0 }
            : undefined,
        };
        node.renderMode = 'none';
      }
    }
    node.children.forEach(visit);
    refreshHash(node);
  };
  visit(root);
  if (releasedGeneratedSolidKeys.size) {
    const stillReferenced = new Set<string>();
    const collectReferences = (node: NormalizedNode): void => {
      if (node.sprite) stillReferenced.add(node.sprite.assetKey);
      if (node.button) {
        for (const key of [
          node.button.normalAssetKey,
          node.button.hoverAssetKey,
          node.button.pressedAssetKey,
          node.button.disabledAssetKey,
        ]) {
          if (key) stillReferenced.add(key);
        }
      }
      node.children.forEach(collectReferences);
    };
    collectReferences(root);
    for (let index = assets.length - 1; index >= 0; index -= 1) {
      const task = assets[index];
      if (
        task.kind === 'generated-solid'
        && releasedGeneratedSolidKeys.has(task.key)
        && !stillReferenced.has(task.key)
      ) assets.splice(index, 1);
    }
  }
  for (const nodeId of remaining) {
    issues.push({
      severity: 'warning',
      code: 'ADOPTION_FIGMA_NODE_MISSING',
      nodeId,
      message: `一次性导入时建立的 Figma 节点已不存在，将不再复用对应的 Cocos fileId`,
    });
  }
  return issues;
}

function clearNineSlice(root: NormalizedNode, assetKey: string): void {
  const visit = (node: NormalizedNode): void => {
    if (node.sprite?.assetKey === assetKey) node.sprite = { ...node.sprite, nineSlice: undefined };
    node.children.forEach(visit);
  };
  visit(root);
}

function configurationHash(
  request: SyncRequest,
  settings: ProjectSettings,
  frameName: string,
  kind: 'view' | 'item' = 'view',
): string {
  const paths = resolveOutputPaths(request, frameName);
  return shortHash({
    bundleRoot: normalizeBundleRoot(request.bundleRoot),
    targetPaths: kind === 'view' ? paths : {
      ...paths,
      visualPrefabUrl: `${paths.itemVisualRoot}/${paths.visualPrefabUrl.split('/').pop()!.replace(/\.root\.prefab$/, '')}.root.prefab`,
      logicPrefabUrl: `${paths.itemRoot}/${paths.logicPrefabUrl.split('/').pop()}`,
    },
    fontMap: settings.fontMap,
    sharedTextureRoots: settings.sharedTextureRoots,
  }, 20);
}

function assetNodeFileIds(root: NormalizedNode, assetKey: string): Set<string> {
  const result = new Set<string>();
  const visit = (node: NormalizedNode): void => {
    if (node.sprite?.assetKey === assetKey) result.add(node.fileId);
    node.children.forEach(visit);
  };
  visit(root);
  return result;
}

function nodesUsingAsset(root: NormalizedNode, assetKey: string): NormalizedNode[] {
  const result: NormalizedNode[] = [];
  const visit = (node: NormalizedNode): void => {
    if (node.sprite?.assetKey === assetKey) result.push(node);
    node.children.forEach(visit);
  };
  visit(root);
  return result;
}

function replaceNodeAssetKey(node: NormalizedNode, from: string, to: string): void {
  if (node.sprite?.assetKey === from) node.sprite = { ...node.sprite, assetKey: to };
  if (!node.button) return;
  node.button = {
    ...node.button,
    normalAssetKey: node.button.normalAssetKey === from ? to : node.button.normalAssetKey,
    hoverAssetKey: node.button.hoverAssetKey === from ? to : node.button.hoverAssetKey,
    pressedAssetKey: node.button.pressedAssetKey === from ? to : node.button.pressedAssetKey,
    disabledAssetKey: node.button.disabledAssetKey === from ? to : node.button.disabledAssetKey,
  };
}

function assetReferenced(root: NormalizedNode, assetKey: string): boolean {
  let referenced = false;
  const visit = (node: NormalizedNode): void => {
    if (referenced) return;
    referenced = node.sprite?.assetKey === assetKey || Boolean(node.button && [
      node.button.normalAssetKey,
      node.button.hoverAssetKey,
      node.button.pressedAssetKey,
      node.button.disabledAssetKey,
    ].includes(assetKey));
    node.children.forEach(visit);
  };
  visit(root);
  return referenced;
}

function refreshNormalizedHashes(root: NormalizedNode): void {
  const visit = (node: NormalizedNode): void => {
    node.children.forEach(visit);
    const { hash: _hash, ...draft } = node;
    node.hash = shortHash({ ...draft, fileId: undefined }, 20);
  };
  visit(root);
}

function matchingSharedRoot(url: string, roots: string[]): string | undefined {
  return [...roots]
    .sort((left, right) => right.length - left.length)
    .find((root) => url === root || url.startsWith(`${root}/`));
}

function isInternalDefaultUiSource(url: string): boolean {
  return url.startsWith(INTERNAL_DEFAULT_UI_PREFIX);
}

function sameInsets(
  left: AssetTask['nineSlice'],
  right: AssetTask['nineSlice'],
): boolean {
  if (!left) return true;
  if (!right) return false;
  return left.left === right.left
    && left.right === right.right
    && left.top === right.top
    && left.bottom === right.bottom;
}

async function inspectSpriteFrames(spriteFrameUuids: string[]): Promise<Map<string, SceneSpriteFrameInspection>> {
  if (!spriteFrameUuids.length) return new Map();
  const result = await Editor.Message.request('scene', 'execute-scene-script', {
    name: PACKAGE_NAME,
    method: 'inspectSpriteFrames',
    args: [{ spriteFrameUuids }],
  }) as SceneSpriteFrameInspection[];
  return new Map(result.map((item) => [item.spriteFrameUuid, item]));
}

interface SourceContentInspection {
  buffer: Buffer;
  hash: string;
  opaqueWhite?: boolean;
}

async function currentSourceContent(
  source: AdoptionAssetMapping,
  cache: Map<string, SourceContentInspection | undefined>,
  inspectOpaqueWhite = false,
): Promise<SourceContentInspection | undefined> {
  if (cache.has(source.sourceUrl)) {
    const cached = cache.get(source.sourceUrl);
    if (cached && inspectOpaqueWhite && cached.opaqueWhite === undefined) {
      cached.opaqueWhite = await isOpaqueWhiteTexture(cached.buffer);
    }
    return cached;
  }
  const info = await queryAsset(source.sourceUrl);
  if (!assetSourceExists(source.sourceUrl, info) || !info?.file) {
    cache.set(source.sourceUrl, undefined);
    return undefined;
  }
  const normalized = await normalizeTextureBuffer(await readFile(info.file));
  const result: SourceContentInspection = {
    buffer: normalized.buffer,
    hash: createHash('sha256').update(normalized.buffer).digest('hex'),
    opaqueWhite: inspectOpaqueWhite ? await isOpaqueWhiteTexture(normalized.buffer) : undefined,
  };
  cache.set(source.sourceUrl, result);
  return result;
}

function sharedCandidateIssue(task: AssetTask, code: string, message: string): SyncIssue {
  return { severity: 'warning', code, nodeId: task.nodeId, path: task.targetUrl, message };
}

function uniqueAdoptionSources(sources: AdoptionAssetMapping[]): AdoptionAssetMapping[] {
  return sources.filter((source, index, all) => all.findIndex((candidate) => (
    candidate.figmaImageRef === source.figmaImageRef
      && candidate.sourceUrl === source.sourceUrl
      && candidate.sourceImageUuid === source.sourceImageUuid
      && candidate.sourceSpriteFrameUuid === source.sourceSpriteFrameUuid
      && candidate.contentHash === source.contentHash
  )) === index);
}

function sharedSourcesForFile(
  settings: ProjectSettings,
  fileKey: string | undefined,
  adoption: AdoptionMapping | undefined,
): AdoptionAssetMapping[] {
  const localSources = Object.values(adoption?.assets ?? {});
  if (!fileKey) return localSources;
  const fileSources = Object.values(settings.adoptions)
    .filter((candidate) => candidate.figma.fileKey === fileKey)
    .flatMap((candidate) => Object.values(candidate.assets));
  const catalogSources: AdoptionAssetMapping[] = Object.values(
    settings.sharedAssetCatalogs?.[fileKey]?.assets ?? {},
  ).map((asset) => ({ ...asset, sourceNodeFileIds: [] }));
  return uniqueAdoptionSources([...localSources, ...fileSources, ...catalogSources]);
}

async function allowedSharedSources(
  candidates: AdoptionAssetMapping[],
  settings: ProjectSettings,
  verifiedBundleRoots: Map<string, boolean>,
): Promise<{
  allowed: AdoptionAssetMapping[];
  issue?: { code: string; message: string };
}> {
  const allowed: AdoptionAssetMapping[] = [];
  let internalVersionMismatch: AdoptionAssetMapping | undefined;
  let rootNotAllowed: AdoptionAssetMapping | undefined;
  let rootNotBundle: { source: AdoptionAssetMapping; root: string } | undefined;
  for (const source of candidates) {
    if (isInternalDefaultUiSource(source.sourceUrl)) {
      if (
        source.sourceCreatorVersion
        && source.sourceCreatorVersion === Editor.App?.version
      ) {
        allowed.push(source);
      } else {
        internalVersionMismatch ??= source;
      }
      continue;
    }
    const bundleRoot = matchingSharedRoot(source.sourceUrl, settings.sharedTextureRoots);
    if (!bundleRoot) {
      rootNotAllowed ??= source;
      continue;
    }
    let isBundle = verifiedBundleRoots.get(bundleRoot);
    if (isBundle === undefined) {
      const meta = await Editor.Message.request('asset-db', 'query-asset-meta', bundleRoot) as AssetMetaLike | null;
      isBundle = meta?.userData?.isBundle === true;
      verifiedBundleRoots.set(bundleRoot, isBundle);
    }
    if (isBundle) allowed.push(source);
    else rootNotBundle ??= { source, root: bundleRoot };
  }
  if (allowed.length) return { allowed };
  if (internalVersionMismatch) {
    return {
      allowed,
      issue: {
        code: 'INTERNAL_DEFAULT_UI_VERSION_CHANGED',
        message: `引擎内置图片 ${internalVersionMismatch.sourceUrl} 来自 Cocos Creator ${internalVersionMismatch.sourceCreatorVersion ?? '未知版本'}，当前为 ${Editor.App?.version ?? '未知版本'}；本次将生成项目自有贴图`,
      },
    };
  }
  if (rootNotAllowed) {
    return {
      allowed,
      issue: {
        code: 'SHARED_TEXTURE_ROOT_NOT_ALLOWED',
        message: `原图 ${rootNotAllowed.sourceUrl} 不在“共享纹理 Bundle 根目录”白名单内；本次将生成 Figma 管理的贴图`,
      },
    };
  }
  return {
    allowed,
    issue: {
      code: 'SHARED_TEXTURE_ROOT_NOT_BUNDLE',
      message: `配置路径不是 Cocos Asset Bundle 根目录；本次将生成 Figma 管理的贴图：${rootNotBundle?.root ?? candidates[0]?.sourceUrl ?? ''}`,
    },
  };
}

async function resolveExactSharedSource(
  task: AssetTask,
  candidates: AdoptionAssetMapping[],
  settings: ProjectSettings,
  inspections: Map<string, SceneSpriteFrameInspection>,
  contentCache: Map<string, SourceContentInspection | undefined>,
  verifiedBundleRoots: Map<string, boolean>,
  requireOpaqueWhite = false,
): Promise<{ source?: AdoptionAssetMapping; issue?: SyncIssue }> {
  const authorization = await allowedSharedSources(candidates, settings, verifiedBundleRoots);
  if (!authorization.allowed.length) {
    return {
      issue: sharedCandidateIssue(
        task,
        authorization.issue!.code,
        authorization.issue!.message,
      ),
    };
  }
  const compatible = authorization.allowed.filter((source) => {
    const inspection = inspections.get(source.sourceSpriteFrameUuid);
    return inspection?.exists
      && inspection.imageUuid === source.sourceImageUuid
      && sameInsets(task.nineSlice, inspection.insets);
  });
  if (!compatible.length) {
    return {
      issue: sharedCandidateIssue(
        task,
        'SHARED_SPRITEFRAME_CHANGED',
        `原始 SpriteFrame 已不存在或九宫格参数与 Figma 不一致；本次将生成 Figma 管理的贴图：${authorization.allowed[0].sourceUrl}`,
      ),
    };
  }
  const contentCompatible: AdoptionAssetMapping[] = [];
  let rejectedNonWhite = false;
  for (const source of compatible) {
    if (requireOpaqueWhite && source.solidWhite === false) {
      rejectedNonWhite = true;
      continue;
    }
    const current = await currentSourceContent(source, contentCache, requireOpaqueWhite);
    if (current && current.hash === source.contentHash) {
      if (!requireOpaqueWhite || current.opaqueWhite === true) contentCompatible.push(source);
      else rejectedNonWhite = true;
    }
  }
  if (!contentCompatible.length) {
    return {
      issue: sharedCandidateIssue(
        task,
        rejectedNonWhite ? 'ADOPTED_SOLID_SOURCE_INVALID' : 'SHARED_TEXTURE_CONTENT_CHANGED',
        rejectedNonWhite
          ? `Figma SOLID 的接管来源不再是全不透明纯白图片；本次将生成项目自有贴图：${compatible[0].sourceUrl}`
          : `原始图片内容已变化或不可读取；本次将生成 Figma 管理的贴图：${compatible[0].sourceUrl}`,
      ),
    };
  }
  const exactSources = uniqueAdoptionSources(contentCompatible);
  if (exactSources.length > 1) {
    return {
      issue: sharedCandidateIssue(
        task,
        'SHARED_SPRITEFRAME_AMBIGUOUS',
        '同一 Figma 图片对应多个仍有效的共享 SpriteFrame，无法确认唯一来源；本次将生成 Figma 管理的贴图',
      ),
    };
  }
  return { source: exactSources[0] };
}

export async function resolveSharedTextureSources(
  normalized: NormalizeResult,
  adoption: AdoptionMapping | undefined,
  settings: ProjectSettings,
  fileKey: string | undefined = adoption?.figma.fileKey,
): Promise<SyncIssue[]> {
  normalized.assets.forEach((task) => { task.sharedSource = undefined; });
  const warnings: SyncIssue[] = [];
  const localSources = Object.values(adoption?.assets ?? {});
  const sources = sharedSourcesForFile(settings, fileKey, adoption);
  if (!sources.length) return warnings;
  const imageRefs = new Set(normalized.assets.flatMap((task) => task.imageRef ? [task.imageRef] : []));
  const relevantSources = uniqueAdoptionSources([
    ...localSources,
    ...sources.filter((source) => imageRefs.has(source.figmaImageRef)),
  ]);
  if (!relevantSources.length) return warnings;
  let inspections = new Map<string, SceneSpriteFrameInspection>();
  try {
    inspections = await inspectSpriteFrames(relevantSources.map((source) => source.sourceSpriteFrameUuid));
  } catch {
    for (const task of normalized.assets.filter((asset) => (
      (asset.kind === 'image-fill'
        && Boolean(asset.imageRef)
        && sources.some((source) => source.figmaImageRef === asset.imageRef))
      || (asset.kind === 'generated-solid'
        && nodesUsingAsset(normalized.root, asset.key).some((node) => localSources.some((source) => (
          source.sourceNodeFileIds.includes(node.fileId)
        ))))
    ))) {
      warnings.push(sharedCandidateIssue(task, 'SHARED_SPRITEFRAME_INSPECTION_FAILED', '无法验证原始 SpriteFrame；本次将生成 Figma 管理的贴图'));
    }
    return warnings;
  }
  const contentCache = new Map<string, SourceContentInspection | undefined>();
  const verifiedBundleRoots = new Map<string, boolean>();

  const clonedSolidTasks = new Map<string, AssetTask>();
  let rewroteSolidAssetKeys = false;
  for (const task of [...normalized.assets]) {
    if (task.kind !== 'generated-solid') continue;
    for (const node of nodesUsingAsset(normalized.root, task.key)) {
      const nodeCandidates = uniqueAdoptionSources(localSources.filter((source) => (
        source.sourceNodeFileIds.includes(node.fileId)
      )));
      if (!nodeCandidates.length) continue;
      const candidateTask: AssetTask = {
        ...task,
        nodeId: node.id,
        nineSlice: node.sprite?.nineSlice ?? task.nineSlice,
      };
      const resolved = await resolveExactSharedSource(
        candidateTask,
        nodeCandidates,
        settings,
        inspections,
        contentCache,
        verifiedBundleRoots,
        true,
      );
      if (resolved.issue) {
        warnings.push(resolved.issue);
        continue;
      }
      const source = resolved.source!;
      const key = `adopted-solid:${shortHash({
        spriteFrameUuid: source.sourceSpriteFrameUuid,
        importSettingsHash: task.importSettingsHash,
      }, 20)}`;
      if (!clonedSolidTasks.has(key)) {
        clonedSolidTasks.set(key, {
          ...task,
          key,
          nodeId: node.id,
          hash: source.contentHash,
          targetUrl: source.sourceUrl,
          nineSlice: candidateTask.nineSlice,
          sharedSource: source,
        });
      }
      replaceNodeAssetKey(node, task.key, key);
      rewroteSolidAssetKeys = true;
    }
  }
  if (clonedSolidTasks.size) {
    normalized.assets = [
      ...normalized.assets.filter((task) => assetReferenced(normalized.root, task.key)),
      ...clonedSolidTasks.values(),
    ];
  }
  if (rewroteSolidAssetKeys) refreshNormalizedHashes(normalized.root);

  for (const task of normalized.assets) {
    if (task.kind !== 'image-fill' || !task.imageRef) continue;
    const nodeFileIds = assetNodeFileIds(normalized.root, task.key);
    const nodeCandidates = localSources.filter((source) => (
      source.sourceNodeFileIds.some((fileId) => nodeFileIds.has(fileId))
    ));
    const imageCandidates = sources.filter((source) => source.figmaImageRef === task.imageRef);
    const matchingNodeCandidates = nodeCandidates.filter((source) => source.figmaImageRef === task.imageRef);
    if (nodeCandidates.length && !matchingNodeCandidates.length && !imageCandidates.length) {
      warnings.push(sharedCandidateIssue(
        task,
        'ADOPTED_IMAGE_CHANGED',
        'Figma 图片已不同于 Cocos 接管时的原图；本次将生成 Figma 管理的贴图',
      ));
      continue;
    }
    // A node-local match has the strongest provenance. Otherwise, a copied
    // Figma image may recover its identity from another adoption in this file.
    const candidates = uniqueAdoptionSources(matchingNodeCandidates.length ? matchingNodeCandidates : imageCandidates);
    if (!candidates.length) continue;
    const resolved = await resolveExactSharedSource(
      task,
      candidates,
      settings,
      inspections,
      contentCache,
      verifiedBundleRoots,
    );
    if (resolved.issue) warnings.push(resolved.issue);
    else task.sharedSource = resolved.source;
  }
  return warnings;
}

async function assertSharedTextureSources(tasks: AssetTask[], sharedTextureRoots: string[]): Promise<void> {
  const shared = tasks.filter((task): task is AssetTask & { sharedSource: AdoptionAssetMapping } => Boolean(task.sharedSource));
  if (!shared.length) return;
  const inspections = await inspectSpriteFrames(shared.map((task) => task.sharedSource.sourceSpriteFrameUuid));
  const contentCache = new Map<string, SourceContentInspection | undefined>();
  for (const task of shared) {
    const source = task.sharedSource;
    const bundleRoot = matchingSharedRoot(source.sourceUrl, sharedTextureRoots);
    const bundleMeta = bundleRoot
      ? await Editor.Message.request('asset-db', 'query-asset-meta', bundleRoot) as AssetMetaLike | null
      : null;
    const internalSourceAllowed = isInternalDefaultUiSource(source.sourceUrl)
      && Boolean(source.sourceCreatorVersion)
      && source.sourceCreatorVersion === Editor.App?.version;
    const inspection = inspections.get(source.sourceSpriteFrameUuid);
    const content = await currentSourceContent(source, contentCache, task.kind === 'generated-solid');
    if ((!internalSourceAllowed && (!bundleRoot || bundleMeta?.userData?.isBundle !== true))
      || !inspection?.exists
      || inspection.imageUuid !== source.sourceImageUuid
      || !sameInsets(task.nineSlice, inspection.insets)
      || content?.hash !== source.contentHash
      || (task.kind === 'generated-solid' && content?.opaqueWhite !== true)) {
      throw new Error(`共享 SpriteFrame 在 Preview 后发生变化，请重新推送并预览：${source.sourceUrl}`);
    }
  }
}

function fixedConfigurationIssues(mapping: FrameMapping | undefined, request: SyncRequest): SyncIssue[] {
  return mappingBundleIssues(mapping, normalizeBundleRoot(request.bundleRoot));
}

function mappedAsset(settings: ProjectSettings, key: string, preferred?: FrameMapping): GeneratedAssetIdentity | undefined {
  return preferred?.assets[key]
    ?? Object.values(settings.frames).map((frame) => frame.assets[key]).find(Boolean);
}

function hasSharedDependencies(mapping: FrameMapping | undefined): boolean {
  return Boolean(mapping && Object.values(mapping.assets).some((asset) => asset.ownership === 'shared'));
}

function hasRuntimeListContracts(mapping: FrameMapping | undefined): boolean {
  return Boolean(mapping?.items?.length || mapping?.bindings?.some((binding) => binding.component === 'ListExtent'));
}

async function executeSceneBuild(request: SceneBuildRequest): Promise<SceneBuildResult> {
  return Editor.Message.request('scene', 'execute-scene-script', {
    name: PACKAGE_NAME,
    method: 'buildPrefab',
    args: [request],
  }) as Promise<SceneBuildResult>;
}

async function inspectLogicPrefab(uuid: string): Promise<SceneLogicInspectionResult> {
  return Editor.Message.request('scene', 'execute-scene-script', {
    name: PACKAGE_NAME,
    method: 'inspectLogicPrefab',
    args: [{ logicPrefabUuid: uuid }],
  }) as Promise<SceneLogicInspectionResult>;
}

export async function validateItemPrefabs(itemPrefabs: ItemPrefabBinding[]): Promise<SyncIssue[]> {
  const issues: SyncIssue[] = [];
  for (const item of itemPrefabs) {
    const [logic, visual] = await Promise.all([
      queryAsset(item.itemLogicPrefabUrl),
      queryAsset(item.itemVisualPrefabUrl),
    ]);
    if (!logic) {
      issues.push({
        severity: 'warning',
        code: 'ITEM_LOGIC_PREFAB_PENDING',
        path: item.itemLogicPrefabUrl,
        message: `首次 Apply 将创建 Item 逻辑壳：${item.itemLogicPrefabUrl}`,
      });
      continue;
    }
    if (!visual) {
      issues.push({
        severity: 'warning',
        code: 'ITEM_VISUAL_PREFAB_PENDING',
        path: item.itemVisualPrefabUrl,
        message: `首次 Apply 后再校验 Item 逻辑壳：${item.itemVisualPrefabUrl}`,
      });
      continue;
    }
    let inspection: SceneLogicInspectionResult;
    try {
      inspection = await inspectLogicPrefab(logic.uuid);
    } catch (error) {
      issues.push({
        severity: 'blocker',
        code: 'ITEM_LOGIC_PREFAB_INSPECTION_FAILED',
        path: item.itemLogicPrefabUrl,
        message: `无法实例化 Item 逻辑 Prefab：${errorMessage(error)}`,
      });
      continue;
    }
    if (inspection.nestedVisualPrefabUuid !== visual.uuid) {
      issues.push({
        severity: 'blocker',
        code: 'ITEM_LOGIC_WRAPPER_MISMATCH',
        path: item.itemLogicPrefabUrl,
        message: `Item 逻辑 Prefab 必须直接实例化 ${item.itemVisualPrefabUrl} 并将实例命名为 root`,
      });
    }
  }
  return issues;
}

export async function validateListRuntime(
  listBindings: BindingContractEntry[],
  logicPrefabUrl: string,
): Promise<SyncIssue[]> {
  const issues: SyncIssue[] = [];
  if (!listBindings.length) return issues;
  const logic = await queryAsset(logicPrefabUrl);
  if (!logic) return issues;
  let inspection: SceneLogicInspectionResult;
  try {
    inspection = await inspectLogicPrefab(logic.uuid);
  } catch (error) {
    issues.push({ severity: 'blocker', code: 'LOGIC_PREFAB_INSPECTION_FAILED', path: logicPrefabUrl, message: `无法实例化 View 逻辑 Prefab：${errorMessage(error)}` });
    return issues;
  }
  const nodes = new Map(inspection.nodes.map((node) => [node.path, node]));
  for (const listBinding of listBindings) {
    const node = nodes.get(listBinding.path);
    const component = node?.components.find((item) => item.className === 'ListExtent' || item.className.endsWith('.ListExtent'));
    if (!component) {
      issues.push({
        severity: 'warning',
        code: 'LIST_EXTENT_MISSING',
        nodeId: listBinding.nodeId,
        path: listBinding.path,
        message: `${listBinding.path} 尚未在逻辑 Prefab 的 root 实例上挂载 ListExtent；该组件及 Item Prefab 引用由程序员维护`,
      });
    }
  }
  return issues;
}

interface PrepareDocumentInput {
  kind?: 'view' | 'item';
  request: SyncRequest;
  source: PreparedSync['source'];
  document: FigmaNode;
  itemComponents?: FigmaNode[];
  components?: Record<string, FigmaComponentMetadata>;
  componentSets?: Record<string, FigmaComponentSetMetadata>;
  fileVersion: string;
  settings: ProjectSettings;
  abortController: AbortController;
  shortCircuitUnchanged?: boolean;
}

interface PrepareDocumentResult {
  preview: SyncPreview;
  prepared?: PreparedSync;
}

async function prepareDocument(input: PrepareDocumentInput): Promise<PrepareDocumentResult> {
  const {
    request,
    source,
    document,
    components,
    componentSets,
    fileVersion,
    settings,
    abortController,
  } = input;
  const kind = input.kind ?? 'view';
  const currentConfigurationHash = configurationHash(request, settings, document.name, kind);
  const frameKey = mappingKey(source.fileKey, source.nodeId);
  const storedMapping = settings.frames[frameKey];
  const baseline = await emptyOutputBaseline(storedMapping);
  // Preview remains read-only. When every previously owned output is already
  // absent, compare and apply as a fresh rebuild; Apply will replace the stale
  // mapping instead of turning it into hundreds of synthetic deletions.
  const mapping = baseline.rebuild ? undefined : storedMapping;
  const candidateAdoption = settings.adoptions[frameKey];
  const adoption = candidateAdoption?.kind === kind ? candidateAdoption : undefined;
  const requestedOutputPaths = resolveOutputPaths(request, document.name);
  const safeTargetName = requestedOutputPaths.visualPrefabUrl.split('/').pop()!.replace(/\.root\.prefab$/, '');
  const visualPrefabUrl = kind === 'view'
    ? requestedOutputPaths.visualPrefabUrl
    : `${requestedOutputPaths.itemVisualRoot}/${safeTargetName}.root.prefab`;
  const logicPrefabUrl = kind === 'view'
    ? requestedOutputPaths.logicPrefabUrl
    : `${requestedOutputPaths.itemRoot}/${safeTargetName}.prefab`;
  const outputPaths = {
    ...requestedOutputPaths,
    visualPrefabUrl,
    logicPrefabUrl,
  };
  const fixedConfigurationBlockers = fixedConfigurationIssues(mapping, request);
  if (mapping && mapping.visualPrefabUrl !== visualPrefabUrl) {
    fixedConfigurationBlockers.push({
      severity: 'blocker',
      code: 'OUTPUT_LAYOUT_REQUIRES_REBUILD',
      path: mapping.visualPrefabUrl,
      message: `现有映射仍使用旧输出目录 ${mapping.visualPrefabUrl}；请删除该映射记录的全部旧产物后重新 Preview，DoomUI 不迁移旧 Prefab`,
    });
  }
  if (fixedConfigurationBlockers.length) {
    return {
      preview: {
        planId: shortHash({ frameKey, fileVersion, currentConfigurationHash, blocked: true }),
        fileVersion,
        changes: [],
        warnings: [],
        blockers: fixedConfigurationBlockers,
        outputPaths,
      },
    };
  }
  if (
    input.shortCircuitUnchanged
    && mapping
    && !hasSharedDependencies(mapping)
    && !hasRuntimeListContracts(mapping)
    && mapping.source.fileVersion === fileVersion
    && mapping.configHash === currentConfigurationHash
  ) {
    return {
      preview: {
        planId: shortHash({ frameKey, fileVersion, unchanged: true }),
        fileVersion,
        changes: [{ key: 'frame:unchanged', kind: 'unchanged', path: mapping.visualPrefabUrl, detail: 'Figma 推送内容未变化' }],
        warnings: [],
        blockers: [],
        unchangedByMetadata: true,
        outputPaths,
      },
    };
  }

  const normalized = normalizeFigmaFrame(document, {
    textureRoot: requestedOutputPaths.textureRoot,
    settings,
    components,
    componentSets,
  });
  if (kind === 'view') {
    const legacyTemplates = stripLegacyItemTemplates(document, normalized.root);
    normalized.root = legacyTemplates.runtimeRoot;
    normalized.issues.push(...legacyTemplates.issues);
  }
  const itemResults = (input.itemComponents ?? []).map((component) => normalizeFigmaFrame(component, {
    textureRoot: requestedOutputPaths.textureRoot,
    settings,
    components,
    componentSets,
  }));
  const itemAdoptions = new Map(itemResults.map((result) => {
    const candidate = settings.adoptions[mappingKey(source.fileKey, result.root.id)];
    return [result.root.id, candidate?.kind === 'item' ? candidate : undefined] as const;
  }));
  const contentRoots = [normalized.root, ...itemResults.map((result) => result.root)];
  for (const result of [normalized, ...itemResults]) {
    applyButtonSemantics(result.root, result.issues);
  }
  normalized.issues.push(...applyAdoptionFileIds(normalized.root, adoption, normalized.assets));
  normalized.issues.push(...await resolveSharedTextureSources(normalized, adoption, settings, source.fileKey));
  for (const result of itemResults) {
    const itemAdoption = itemAdoptions.get(result.root.id);
    result.issues.push(...applyAdoptionFileIds(result.root, itemAdoption, result.assets));
    result.issues.push(...await resolveSharedTextureSources(result, itemAdoption, settings, source.fileKey));
    normalized.issues.push(...result.issues);
  }
  const assetsByKey = new Map<string, AssetTask>();
  for (const task of [normalized, ...itemResults].flatMap((result) => result.assets)) {
    const previous = assetsByKey.get(task.key);
    if (previous && (previous.targetUrl !== task.targetUrl || previous.importSettingsHash !== task.importSettingsHash)) {
      normalized.issues.push({
        severity: 'blocker',
        code: 'ITEM_ASSET_CONFLICT',
        nodeId: task.nodeId,
        path: task.targetUrl,
        message: `UI 与 Item 对同一资源要求了不兼容的输出设置：${task.targetUrl}`,
      });
      continue;
    }
    if (!previous) assetsByKey.set(task.key, task);
  }
  normalized.assets = [...assetsByKey.values()];
  contentRoots.forEach((root) => normalized.issues.push(...collectRemoteIssues(root)));
  let bindingContract = mapping?.bindings ?? [];
  let requiresBindingConfirmation = false;
  const contract = kind === 'view'
    ? validateUIView(document, normalized.root, mapping)
    : { bindings: [] as BindingContractEntry[], issues: [] as SyncIssue[], requiresConfirmation: false };
  bindingContract = contract.bindings;
  requiresBindingConfirmation = contract.requiresConfirmation;
  normalized.issues.push(...contract.issues);
  const componentPlans = kind === 'view'
    ? planComponentPrefabs(
      itemResults.map((result) => result.root),
      [normalized.root],
      requestedOutputPaths.itemVisualRoot,
      requestedOutputPaths.itemRoot,
      normalized.components,
      normalized.componentSets,
    )
    : [];
  const itemPrefabs: ItemPrefabBinding[] = componentPlans.map((plan) => ({
    componentKey: plan.key,
    componentName: plan.componentName,
    itemVisualPrefabUrl: plan.url,
    itemLogicPrefabUrl: plan.logicUrl,
  }));
  if (kind === 'item') {
    itemPrefabs.push({
      componentKey: `component:${normalized.root.componentId ?? normalized.root.id}`,
      componentName: safeTargetName,
      itemVisualPrefabUrl: visualPrefabUrl,
      itemLogicPrefabUrl: logicPrefabUrl,
    });
  }
  const runtimeListBindings = bindingContract.filter((binding) => binding.component === 'ListExtent');
  normalized.issues.push(...await validateListRuntime(runtimeListBindings, outputPaths.logicPrefabUrl));
  normalized.issues.push(...await validateItemPrefabs(itemPrefabs));
  const urls = { visual: visualPrefabUrl, logic: logicPrefabUrl };
  const diff = diffNormalized(normalized, mapping);
  const otherOwned = new Set(Object.entries(settings.frames)
    .filter(([key]) => key !== frameKey)
    .flatMap(([, frame]) => frame.ownedAssets));
  const orphans = diff.orphans.filter((url) => !otherOwned.has(url));
  const changes = diff.changes.filter((change) => !(
    change.key.startsWith('orphan:') && otherOwned.has(change.path)
  ));
  const warnings = normalized.issues.filter((issue) => issue.severity === 'warning');
  const blockers = normalized.issues.filter((issue) => issue.severity === 'blocker');
  blockers.push(...collectDependencyConflicts(
    normalized.assets.filter((asset) => !asset.sharedSource),
    componentPlans,
    settings.frames,
    frameKey,
    [urls.visual, urls.logic],
  ));
  const owned = new Set(mapping?.ownedAssets ?? []);
  const globallyOwned = new Set(Object.values(settings.frames).flatMap((frame) => frame.ownedAssets));
  const frameTargets = [urls.visual];
  const dependencyTargets = [
    ...normalized.assets.filter((asset) => !asset.sharedSource).map((asset) => asset.targetUrl),
    ...componentPlans.map((plan) => plan.url),
  ];
  for (const target of frameTargets) {
    const existing = await queryAsset(target);
    if (existing && !owned.has(target) && !(kind === 'item' && globallyOwned.has(target))) {
      blockers.push({ severity: 'blocker', code: 'UNOWNED_ASSET_COLLISION', path: target, message: `目标路径已有非本插件资源，拒绝覆盖：${target}` });
    }
  }
  const logicTarget = await queryAsset(urls.logic);
  const primaryVisualOwnedGlobally = globallyOwned.has(urls.visual);
  if (logicTarget && mapping?.logicPrefabUrl !== urls.logic && !(kind === 'item' && primaryVisualOwnedGlobally)) {
    blockers.push({ severity: 'blocker', code: 'UNOWNED_ASSET_COLLISION', path: urls.logic, message: `目标路径已有非本插件逻辑 Prefab，拒绝接管：${urls.logic}` });
  }
  for (const target of dependencyTargets) {
    const existing = await queryAsset(target);
    if (existing && !globallyOwned.has(target)) {
      blockers.push({ severity: 'blocker', code: 'UNOWNED_ASSET_COLLISION', path: target, message: `目标路径已有非本插件资源，拒绝覆盖：${target}` });
    }
  }
  if (mapping && !await queryAsset(mapping.logicPrefabUrl)) {
    warnings.push({ severity: 'warning', code: 'LOGIC_PREFAB_MISSING', path: mapping.logicPrefabUrl, message: '逻辑 Prefab 已被删除；视觉同步会继续，但不会自动重建逻辑层' });
  }
  const fontUrls = new Set(contentRoots.flatMap((root) => [...findFontUrls(root)]));
  for (const fontUrl of fontUrls) {
    const font = await queryAsset(fontUrl);
    if (!font || font.invalid) {
      warnings.push({ severity: 'warning', code: 'FONT_ASSET_MISSING', path: fontUrl, message: `字体映射资源不存在或导入失败：${fontUrl}` });
    }
  }
  for (const plan of componentPlans) {
    const exists = await queryAsset(plan.url);
    const previous = mappedAsset(settings, plan.key, mapping);
    changes.push({
      key: `component:${plan.key}`,
      kind: exists ? previous?.hash === plan.hash ? 'unchanged' : 'update' : 'add',
      path: plan.url,
      detail: `Item 视觉 Prefab（${plan.instanceIds.length} 个 UI 实例复用）`,
    });
    const logicExists = await queryAsset(plan.logicUrl);
    changes.push({
      key: `item-logic:${plan.key}`,
      kind: logicExists ? 'unchanged' : 'add',
      path: plan.logicUrl,
      detail: logicExists ? `Item 逻辑 Prefab（${plan.componentName}，程序员维护）` : `首次创建 Item 逻辑壳（${plan.componentName}）`,
    });
  }
  if (kind === 'item') {
    const visualExists = await queryAsset(urls.visual);
    const logicExists = await queryAsset(urls.logic);
    changes.push({
      key: `component:${normalized.root.id}`,
      kind: visualExists ? mapping?.source.fileVersion === fileVersion ? 'unchanged' : 'update' : 'add',
      path: urls.visual,
      detail: 'Item 视觉 Prefab',
      nodeId: normalized.root.id,
    });
    changes.push({
      key: `item-logic:${normalized.root.id}`,
      kind: logicExists ? 'unchanged' : 'add',
      path: urls.logic,
      detail: logicExists ? `Item 逻辑 Prefab（${safeTargetName}，程序员维护）` : `首次创建 Item 逻辑壳（${safeTargetName}）`,
      nodeId: normalized.root.id,
    });
  }
  const currentOwned = new Set([
    urls.visual,
    ...normalized.assets.filter((asset) => !asset.sharedSource).map((asset) => asset.targetUrl),
    ...componentPlans.map((plan) => plan.url),
  ]);
  for (const previous of mapping?.ownedAssets ?? []) {
    if (!currentOwned.has(previous) && !orphans.includes(previous) && isGeneratedOrphanPath(previous)) {
      changes.push({ key: `orphan:${previous}`, kind: 'delete', path: previous, detail: '仅标记 orphan，不自动删除' });
    }
  }
  const planId = shortHash({
    source,
    fileVersion,
    root: normalized.root.hash,
    adoptions: [
      adoption && { kind: adoption.kind, nodeId: adoption.figma.nodeId, hash: adoption.sourcePrefabHash },
      ...itemResults.map((result) => {
        const itemAdoption = itemAdoptions.get(result.root.id);
        return itemAdoption && {
          kind: itemAdoption.kind,
          nodeId: itemAdoption.figma.nodeId,
          hash: itemAdoption.sourcePrefabHash,
        };
      }),
    ].filter(Boolean),
    request,
    outputPaths,
    fontMap: settings.fontMap,
    itemPrefabs,
  }, 24);
  const preview: SyncPreview = {
    planId,
    fileVersion,
    changes,
    warnings,
    blockers,
    outputPaths,
    requiresBindingConfirmation,
    rebuildFromEmptyOutput: baseline.rebuild
      ? { previousTrackedAssets: baseline.trackedCount }
      : undefined,
  };
  return {
    preview,
    prepared: {
      kind,
      request,
      source,
      frameKey,
      frameName: document.name,
      fileVersion,
      normalized,
      preview,
      mapping,
      adoption,
      visualPrefabUrl: urls.visual,
      logicPrefabUrl: urls.logic,
      componentPlans,
      configurationHash: currentConfigurationHash,
      outputPaths,
      bindingContract,
      itemPrefabs,
      expiresAt: Date.now() + 10 * 60 * 1000,
      abortController,
      pushedAssets: new Map(),
      requiredPushAssetKeys: new Set(),
    },
  };
}

export class SyncService {
  private prepared?: PreparedPushBatch;
  private lastReport?: SyncReport;
  private activeAbortController?: AbortController;

  async previewPush(payload: FigmaPushPayload): Promise<PushPrepareResult> {
    this.cancelPreview();
    if (payload.protocolVersion !== 12) throw new Error(`不支持的 Cocos Sync 协议版本：${String(payload.protocolVersion)}`);
    if (!payload.fileKey || payload.fileKey.length > 256) throw new Error('Figma Push 缺少合法的 fileKey');
    if (!Array.isArray(payload.targets) || !payload.targets.length) throw new Error('Figma Push 至少需要一个明确选择的目标');
    if (payload.targets.length > 50) throw new Error('Figma Push 单次最多选择 50 个 Frame / Component');
    const seenTargetIds = new Set<string>();
    for (const target of payload.targets) {
      const expectedType = target.kind === 'view' ? 'FRAME' : target.kind === 'item' ? 'COMPONENT' : '';
      if (!expectedType || !target.document?.id || !target.document.name || target.document.type !== expectedType) {
        throw new Error('Figma Push 目标必须是与 kind 匹配的 Frame / Component');
      }
      if (seenTargetIds.has(target.document.id)) throw new Error(`Figma Push 包含重复目标：${target.document.id}`);
      seenTargetIds.add(target.document.id);
    }
    const settings = await getProjectSettings();
    const abortController = new AbortController();
    this.activeAbortController = abortController;
    try {
      const results: Array<PrepareDocumentResult & { target: FigmaPushPayload['targets'][number] }> = [];
      for (const target of payload.targets) {
        const request: SyncRequest = {
          sourceUrl: target.normalizedUrl ?? `figma-push://${encodeURIComponent(payload.fileKey)}/${encodeURIComponent(target.document.id)}`,
          bundleRoot: settings.bundleRoot,
        };
        const normalizedRequest = normalizeSyncRequest(request);
        const source = {
          fileKey: payload.fileKey,
          nodeId: target.document.id,
          normalizedUrl: normalizedRequest.sourceUrl,
        };
        const fileVersion = `push-${shortHash({
          kind: target.kind,
          document: target.document,
          components: payload.components ?? {},
          componentSets: payload.componentSets ?? {},
        }, 24)}`;
        const result = await prepareDocument({
          kind: target.kind,
          request: normalizedRequest,
          source,
          document: target.document,
          components: payload.components,
          componentSets: payload.componentSets,
          fileVersion,
          settings,
          abortController,
          shortCircuitUnchanged: true,
        });
        results.push({ ...result, target });
      }

      const preparedTargets = results.flatMap((result) => result.prepared ? [result.prepared] : []);
      const itemRoots = results
        .filter((result) => result.target.kind === 'item')
        .map((result) => result.prepared?.normalized.root ?? normalizeFigmaFrame(result.target.document, {
          textureRoot: resolveOutputPaths({ bundleRoot: settings.bundleRoot }, result.target.document.name).textureRoot,
          settings,
          components: payload.components,
          componentSets: payload.componentSets,
        }).root);
      for (const target of preparedTargets.filter((candidate) => candidate.kind === 'view')) {
        target.referenceComponentPlans = planComponentPrefabs(
          itemRoots,
          [target.normalized.root],
          target.outputPaths.itemVisualRoot,
          target.outputPaths.itemRoot,
          payload.components ?? {},
          payload.componentSets ?? {},
        ).filter((plan) => plan.instanceIds.length > 0);
      }

      const batchBlockers = results.flatMap((result) => result.preview.blockers);
      const visualTargets = new Map<string, PreparedSync>();
      const assetTargets = new Map<string, AssetTask>();
      for (const target of preparedTargets) {
        const previousTarget = visualTargets.get(target.visualPrefabUrl);
        if (previousTarget && previousTarget.frameKey !== target.frameKey) {
          batchBlockers.push({
            severity: 'blocker',
            code: 'TARGET_NAME_COLLISION',
            path: target.visualPrefabUrl,
            message: `多个所选 ${target.kind === 'view' ? 'Frame' : 'Component'} 会生成同一路径，请使用唯一名称：${target.visualPrefabUrl}`,
          });
        } else {
          visualTargets.set(target.visualPrefabUrl, target);
        }
        for (const asset of target.normalized.assets) {
          const previousAsset = assetTargets.get(asset.targetUrl);
          if (previousAsset && previousAsset.importSettingsHash !== asset.importSettingsHash) {
            batchBlockers.push({
              severity: 'blocker',
              code: 'TEXTURE_IMPORT_SETTINGS_CONFLICT',
              path: asset.targetUrl,
              message: `多个所选目标对同一图片使用了不同的九宫格设置：${asset.targetUrl}`,
            });
          } else if (!previousAsset) {
            assetTargets.set(asset.targetUrl, asset);
          }
        }
      }

      const targetSummaries = payload.targets.map((target) => ({
        kind: target.kind,
        nodeId: target.document.id,
        name: target.document.name,
      }));
      const unchangedByMetadata = results.every((result) => result.preview.unchangedByMetadata);
      const batchPreview: SyncPreview = {
        planId: shortHash({
          fileKey: payload.fileKey,
          targets: results.map((result) => ({
            kind: result.target.kind,
            nodeId: result.target.document.id,
            planId: result.preview.planId,
          })),
        }, 24),
        fileVersion: `push-batch-${shortHash(results.map((result) => result.preview.fileVersion), 24)}`,
        changes: results.flatMap((result) => result.preview.changes.map((change) => ({
          ...change,
          key: `${change.key}:${result.target.document.id}`,
        }))),
        warnings: results.flatMap((result) => result.preview.warnings),
        blockers: [...new Map(batchBlockers.map((issue) => [`${issue.code}:${issue.path ?? ''}:${issue.nodeId ?? ''}`, issue])).values()],
        unchangedByMetadata,
        requiresBindingConfirmation: results.some((result) => result.preview.requiresBindingConfirmation),
        outputPaths: payload.targets.length === 1 ? results[0].preview.outputPaths : undefined,
        rebuildFromEmptyOutput: payload.targets.length === 1 ? results[0].preview.rebuildFromEmptyOutput : undefined,
        targets: targetSummaries,
      };

      const canReceiveAssets = Boolean(
        preparedTargets.length
        && preparedTargets.length === results.filter((result) => !result.preview.unchangedByMetadata).length
        && !batchPreview.blockers.length
        && !unchangedByMetadata,
      );
      const assetRequests: PushAssetRequest[] = [];
      const requiredPushAssetKeys = new Set<string>();
      if (canReceiveAssets) {
        const requestsByKey = new Map<string, PushAssetRequest>();
        for (const target of preparedTargets) {
          const targetRequiredKeys = new Set<string>();
          for (const task of target.normalized.assets) {
            if (task.kind === 'generated-solid' || task.sharedSource) continue;
            const info = await queryAsset(task.targetUrl);
            const previous = mappedAsset(settings, task.key, target.mapping);
            const reusable = Boolean(info && previous?.hash === task.hash && previous.importSettingsHash === task.importSettingsHash);
            if (reusable) continue;
            const request = { key: task.key, kind: task.kind, nodeId: task.nodeId, imageRef: task.imageRef } satisfies PushAssetRequest;
            const existingRequest = requestsByKey.get(task.key);
            const sameSource = !existingRequest
              || (request.kind === 'image-fill' && existingRequest.kind === request.kind && existingRequest.imageRef === request.imageRef)
              || (request.kind === 'raster' && existingRequest.kind === request.kind && existingRequest.nodeId === request.nodeId);
            if (!sameSource) throw new Error(`多个所选目标对资源键 ${task.key} 提供了不同来源`);
            requestsByKey.set(task.key, existingRequest ?? request);
            targetRequiredKeys.add(task.key);
            requiredPushAssetKeys.add(task.key);
          }
          target.requiredPushAssetKeys = targetRequiredKeys;
          target.pushedAssets = new Map();
        }
        assetRequests.push(...requestsByKey.values());
      }
      this.prepared = canReceiveAssets || (preparedTargets.length && !batchPreview.blockers.length && !unchangedByMetadata)
        ? {
          preview: batchPreview,
          targets: preparedTargets,
          expiresAt: Date.now() + 10 * 60 * 1000,
          abortController,
          pushedAssets: new Map(),
          requiredPushAssetKeys,
        }
        : undefined;
      return {
        preview: batchPreview,
        assetRequests,
        requiresComplete: canReceiveAssets,
      };
    } finally {
      if (this.activeAbortController === abortController) this.activeAbortController = undefined;
    }
  }

  receivePushAsset(planId: string, key: string, buffer: Buffer): void {
    const prepared = this.prepared;
    if (!prepared || prepared.preview.planId !== planId) {
      throw new Error('Figma Push 计划不存在或已经过期');
    }
    if (prepared.expiresAt < Date.now()) throw new Error('Figma Push 计划超过 10 分钟，请重新推送');
    if (!prepared.requiredPushAssetKeys.has(key)) throw new Error(`Figma Push 包含未请求的资源：${key}`);
    if (!buffer.length) throw new Error(`Figma Push 资源为空：${key}`);
    prepared.pushedAssets.set(key, Buffer.from(buffer));
    for (const target of prepared.targets) {
      if (target.requiredPushAssetKeys.has(key)) target.pushedAssets.set(key, Buffer.from(buffer));
    }
  }

  completePush(planId: string): SyncPreview {
    const prepared = this.prepared;
    if (!prepared || prepared.preview.planId !== planId) {
      throw new Error('Figma Push 计划不存在或已经过期');
    }
    if (prepared.preview.blockers.length) return prepared.preview;
    const missing = [...prepared.requiredPushAssetKeys]
      .filter((key) => !prepared.pushedAssets.has(key));
    if (missing.length) throw new Error(`Figma Push 缺少 ${missing.length} 个资源：${missing.slice(0, 3).join(', ')}`);
    return prepared.preview;
  }

  cancelPreview(): void {
    this.activeAbortController?.abort();
    this.activeAbortController = undefined;
    this.prepared?.abortController.abort();
    this.prepared = undefined;
  }

  getLastReport(): SyncReport | undefined {
    return this.lastReport;
  }

  async getOrphanCleanupStatus(): Promise<OrphanCleanupStatus> {
    const settings = await getProjectSettings();
    return { assets: [...settings.pendingOrphans] };
  }

  async getManagedSyncTargets(): Promise<ManagedSyncTargetSummary[]> {
    const settings = await getProjectSettings();
    return Object.entries(settings.frames)
      .map(([frameKey, mapping]) => managedSyncTargetSummary(frameKey, mapping, settings))
      .sort((left, right) => (
        left.frameName.localeCompare(right.frameName)
        || left.fileKey.localeCompare(right.fileKey)
        || left.nodeId.localeCompare(right.nodeId)
      ));
  }

  async retireManagedSyncTarget(
    input: RetireManagedSyncTargetInput,
  ): Promise<RetireManagedSyncTargetResult> {
    const frameKey = input?.frameKey?.trim();
    if (!frameKey) throw new Error('退役同步目标缺少 Frame 映射标识');
    const settings = await getProjectSettings();
    const mapping = settings.frames[frameKey];
    if (!mapping) throw new Error('同步目标映射不存在或已退役，请刷新列表');

    const target = managedSyncTargetSummary(frameKey, mapping, settings);
    const frames = { ...settings.frames };
    delete frames[frameKey];
    const ownedByRemainingTargets = new Set(
      Object.values(frames).flatMap((frame) => frame.ownedAssets),
    );
    const orphanAssets = [...new Set(mapping.ownedAssets)]
      .filter((url) => isGeneratedOrphanPath(url) && !ownedByRemainingTargets.has(url))
      .sort();
    const adoptions = { ...settings.adoptions };
    for (const adoptionKey of new Set([frameKey, mapping.adoptionKey].filter(Boolean) as string[])) {
      delete adoptions[adoptionKey];
    }
    const pendingOrphans = [...new Set([...settings.pendingOrphans, ...orphanAssets])].sort();

    await saveProjectSettings({ ...settings, frames, adoptions, pendingOrphans });
    this.cancelPreview();
    return { target, orphanAssets, pendingOrphans };
  }

  async discoverLegacyOrphans(): Promise<OrphanCleanupStatus> {
    const settings = await getProjectSettings();
    const bundleRoots = new Set([
      settings.bundleRoot,
      ...Object.values(settings.frames).map((frame) => frame.bundleRoot),
    ].filter(Boolean).map((root) => root.replace(/\/$/, '')));
    if (!bundleRoots.size) return { assets: [...settings.pendingOrphans] };
    const currentlyOwned = new Set(Object.values(settings.frames).flatMap((frame) => frame.ownedAssets));
    const allAssets = await Editor.Message.request(
      'asset-db',
      'query-assets',
      undefined,
      ['uuid', 'url', 'source', 'file', 'invalid'],
    ) as AssetInfoLike[];
    const discovered = allAssets
      .map((asset) => ({ asset, path: asset.url ?? asset.source ?? '' }))
      .filter(({ asset, path }) => (
        isGeneratedOrphanPath(path)
        && [...bundleRoots].some((root) => path.startsWith(`${root}/`))
        && !currentlyOwned.has(path)
        && assetSourceExists(path, asset)
      ))
      .map(({ path }) => path);
    const assets = [...new Set([...settings.pendingOrphans, ...discovered])].sort();
    if (assets.length !== settings.pendingOrphans.length
      || assets.some((path, index) => path !== settings.pendingOrphans[index])) {
      await saveProjectSettings({ ...settings, pendingOrphans: assets });
    }
    return { assets };
  }

  async cleanupOrphans(): Promise<OrphanCleanupResult> {
    const settings = await getProjectSettings();
    const candidates = [...new Set(settings.pendingOrphans)];
    const currentlyOwned = new Set(Object.values(settings.frames).flatMap((frame) => frame.ownedAssets));
    const blockedAssets: OrphanCleanupResult['blockedAssets'] = [];
    const missingAssets: string[] = [];
    const deletable = new Map<string, AssetInfoLike>();

    for (const path of candidates) {
      if (!isGeneratedOrphanPath(path)) {
        blockedAssets.push({ path, reason: '路径不属于插件生成的视觉 Prefab 或贴图目录' });
        continue;
      }
      if (currentlyOwned.has(path)) {
        blockedAssets.push({ path, reason: '资源已重新被当前 Frame 映射管理' });
        continue;
      }
      const info = await queryAsset(path);
      if (!assetSourceExists(path, info)) {
        missingAssets.push(path);
        continue;
      }
      if (!info) {
        missingAssets.push(path);
        continue;
      }
      deletable.set(path, info);
    }

    if (deletable.size) {
      const allAssets = await Editor.Message.request(
        'asset-db',
        'query-assets',
        undefined,
        ['uuid', 'url', 'source', 'depends'],
      ) as AssetInfoLike[];
      let foundBlockedDependency = true;
      while (foundBlockedDependency) {
        foundBlockedDependency = false;
        for (const [path, info] of [...deletable]) {
          const uuids = assetUuidSet(info);
          const dependents = allAssets
            .filter((asset) => {
              const assetPath = asset.url ?? asset.source ?? '';
              return assetPath !== path
                && !deletable.has(assetPath)
                && asset.depends?.some((uuid) => uuids.has(uuid));
            })
            .map((asset) => asset.url ?? asset.source ?? asset.uuid)
            .filter(Boolean)
            .sort();
          if (!dependents.length) continue;
          deletable.delete(path);
          blockedAssets.push({ path, reason: '仍被工程中的其他资源引用', dependents });
          foundBlockedDependency = true;
        }
      }
    }

    const deletedAssets: string[] = [];
    const failedAssets: OrphanCleanupResult['blockedAssets'] = [];
    const ordered = [...deletable.keys()].sort((left, right) => (
      Number(right.endsWith('.root.prefab')) - Number(left.endsWith('.root.prefab'))
    ));
    for (const path of ordered) {
      try {
        await Editor.Message.request('asset-db', 'delete-asset', path);
        deletedAssets.push(path);
      } catch (error) {
        failedAssets.push({ path, reason: `AssetDB 删除失败：${errorMessage(error)}` });
      }
    }
    blockedAssets.push(...failedAssets);
    const pendingAssets = blockedAssets.map((item) => item.path);
    await saveProjectSettings({ ...settings, pendingOrphans: pendingAssets });
    return { deletedAssets, missingAssets, blockedAssets, pendingAssets };
  }

  async apply(planId: string, confirmBindingChanges = false): Promise<ApplyResult> {
    const active = this.prepared;
    if (!active || active.preview.planId !== planId) {
      throw new Error('当前页面中的 Cocos 预览已不能用于 Apply：计划可能已取消、被新的推送替换，或插件已经重载。请在 Figma Desktop 的 Cocos Sync 中重新推送所选内容。');
    }
    if (active.expiresAt < Date.now()) {
      this.prepared = undefined;
      throw new Error('这份 Cocos 预览由 Figma Desktop Push 生成，已超过 10 分钟，不能继续 Apply。请回到 Figma Desktop 的 Cocos Sync，重新推送所选内容，再在 Cocos 中检查预览并应用。');
    }
    if (active.preview.blockers.length) throw new Error('存在阻断项，不能应用同步');
    if (active.preview.requiresBindingConfirmation && !confirmBindingChanges) {
      throw new Error('本次同步包含破坏性绑定契约变更，必须显式确认后才能应用');
    }
    if (active.preview.unchangedByMetadata) throw new Error('Figma 版本未变化，无需应用');

    const preparedTargets = active.targets
      .slice()
      .sort((left, right) => Number(right.kind === 'item') - Number(left.kind === 'item'));
    const settingsAtApply = await getProjectSettings();
    for (const target of preparedTargets) {
      if (configurationHash(target.request, settingsAtApply, target.frameName, target.kind) !== target.configurationHash) {
        this.prepared = undefined;
        throw new Error('插件配置在 Preview 后发生变化，请重新预览');
      }
      const runtimeIssuesAtApply = [
        ...await validateListRuntime(
          target.bindingContract.filter((binding) => binding.component === 'ListExtent'),
          target.logicPrefabUrl,
        ),
        ...await validateItemPrefabs(target.itemPrefabs),
      ];
      const runtimeBlocker = runtimeIssuesAtApply.find((issue) => issue.severity === 'blocker');
      if (runtimeBlocker) {
        this.prepared = undefined;
        throw new Error(`逻辑 Prefab 在 Preview 后不再满足 Item 合同：${runtimeBlocker.message}`);
      }
    }

    const transaction = new AssetWriteTransaction();
    const startedAt = new Date().toISOString();
    const createdAssets: string[] = [];
    const updatedAssets: string[] = [];
    const applyWarnings: SyncIssue[] = [];
    const orphanAssets: string[] = [];
    const mappings: FrameMapping[] = [];
    const pendingByTarget = new Map<string, Map<string, {
      info: AssetInfoLike | null;
      reusable: boolean;
      existed: boolean;
      buffer?: Buffer;
    }>>();
    let settingsWorking = settingsAtApply;

    try {
      // Validate and decode every selected target before writing any project file.
      for (const target of preparedTargets) {
        await assertSharedTextureSources(target.normalized.assets, settingsAtApply.sharedTextureRoots);
        const pendingAssets = new Map<string, {
          info: AssetInfoLike | null;
          reusable: boolean;
          existed: boolean;
          buffer?: Buffer;
        }>();
        for (const task of target.normalized.assets) {
          if (task.sharedSource) continue;
          const info = await queryAsset(task.targetUrl);
          const previous = mappedAsset(settingsAtApply, task.key, target.mapping);
          const reusable = Boolean(info && previous?.hash === task.hash && previous.importSettingsHash === task.importSettingsHash);
          if (reusable) {
            pendingAssets.set(task.key, { info, reusable, existed: true });
            continue;
          }
          const generated = await generatedAssetBuffer(task);
          const pushed = target.pushedAssets.get(task.key);
          if (!generated && !pushed) throw new Error(`同步缺少 Desktop Push 资源数据：${task.nodeId ?? task.imageRef ?? task.key}`);
          const normalizedTexture = await normalizeTextureBuffer(generated ?? pushed!);
          if (task.nineSlice && (
            task.nineSlice.left + task.nineSlice.right > normalizedTexture.width
            || task.nineSlice.top + task.nineSlice.bottom > normalizedTexture.height
          )) {
            applyWarnings.push({
              severity: 'warning',
              code: 'NINE_SLICE_IMAGE_BOUNDS',
              nodeId: task.nodeId,
              path: task.targetUrl,
              message: `九宫格边距超过实际图片 ${normalizedTexture.width}×${normalizedTexture.height}，已按普通 Sprite 导入`,
            });
            task.nineSlice = undefined;
            clearNineSlice(target.normalized.root, task.key);
            target.componentPlans.forEach((plan) => clearNineSlice(plan.root, task.key));
          }
          pendingAssets.set(task.key, { info, reusable, existed: Boolean(info), buffer: normalizedTexture.buffer });
        }
        pendingByTarget.set(target.frameKey, pendingAssets);
      }

      const resolvedAssetsByUrl = new Map<string, {
        reference: SceneAssetReference;
        identity: GeneratedAssetIdentity;
      }>();
      for (const target of preparedTargets) {
        const assetReferences: Record<string, SceneAssetReference> = {};
        const assetIdentity: Record<string, GeneratedAssetIdentity> = {};
        const pendingAssets = pendingByTarget.get(target.frameKey)!;
        for (const task of target.normalized.assets) {
          if (task.sharedSource) {
            const source = task.sharedSource;
            assetReferences[task.key] = {
              key: task.key,
              url: source.sourceUrl,
              uuid: source.sourceImageUuid,
              spriteFrameUuid: source.sourceSpriteFrameUuid,
            };
            assetIdentity[task.key] = {
              url: source.sourceUrl,
              hash: task.hash,
              uuid: source.sourceImageUuid,
              spriteFrameUuid: source.sourceSpriteFrameUuid,
              sourceNodeId: task.nodeId,
              importSettingsHash: task.importSettingsHash,
              ownership: 'shared',
            };
            continue;
          }
          const resolved = resolvedAssetsByUrl.get(task.targetUrl);
          if (resolved) {
            assetReferences[task.key] = { ...resolved.reference, key: task.key };
            assetIdentity[task.key] = { ...resolved.identity, sourceNodeId: task.nodeId };
            continue;
          }
          const pending = pendingAssets.get(task.key)!;
          let info = pending.info;
          if (!pending.reusable) {
            info = await transaction.write(task.targetUrl, pending.buffer!);
            (pending.existed ? updatedAssets : createdAssets).push(task.targetUrl);
          }
          if (!info) throw new Error(`资源不存在：${task.targetUrl}`);
          info = await transaction.ensureSpriteFrame(task.targetUrl);
          if (task.nineSlice) info = await transaction.setNineSlice(task.targetUrl, task);
          const reference = toSceneAssetReference(task.key, task.targetUrl, info);
          const identity: GeneratedAssetIdentity = {
            url: task.targetUrl,
            hash: task.hash,
            uuid: info.uuid,
            sourceNodeId: task.nodeId,
            importSettingsHash: task.importSettingsHash,
            ownership: 'generated',
          };
          assetReferences[task.key] = reference;
          assetIdentity[task.key] = identity;
          resolvedAssetsByUrl.set(task.targetUrl, { reference, identity });
        }

        const fontReferences: Record<string, SceneAssetReference> = {};
        const fontUrls = new Set([
          ...findFontUrls(target.normalized.root),
          ...target.componentPlans.flatMap((plan) => [...findFontUrls(plan.root)]),
        ]);
        for (const fontUrl of fontUrls) {
          const info = await queryAsset(fontUrl);
          if (info && !info.invalid) fontReferences[fontUrl] = { key: fontUrl, url: fontUrl, uuid: info.uuid };
        }

        for (const componentPlan of target.componentPlans) {
          let info = await queryAsset(componentPlan.url);
          const previous = mappedAsset(settingsWorking, componentPlan.key, target.mapping);
          if (!info || previous?.hash !== componentPlan.hash) {
            const existed = Boolean(info);
            const built = await executeSceneBuild({
              mode: 'visual',
              prefabName: componentPlan.root.name,
              root: componentPlan.root,
              assetReferences,
              fontReferences,
            });
            info = await transaction.write(componentPlan.url, built.serialized);
            (existed ? updatedAssets : createdAssets).push(componentPlan.url);
          }
          assetReferences[componentPlan.key] = { key: componentPlan.key, url: componentPlan.url, uuid: info.uuid };
          assetIdentity[componentPlan.key] = {
            url: componentPlan.url,
            hash: componentPlan.hash,
            uuid: info.uuid,
            importSettingsHash: shortHash({ kind: 'component-prefab' }),
            ownership: 'generated',
          };
        }

        const itemIssuesAfterComponentWrite = await validateItemPrefabs(
          target.kind === 'view' ? target.itemPrefabs : [],
        );
        const componentBlocker = itemIssuesAfterComponentWrite.find((issue) => issue.severity === 'blocker');
        if (componentBlocker) {
          throw new Error(`Item 逻辑 Prefab 与刚生成的视觉 Prefab 不匹配：${componentBlocker.message}`);
        }
        for (const plan of target.componentPlans) {
          const existing = await queryAsset(plan.logicUrl);
          if (existing) continue;
          const visualReference = assetReferences[plan.key];
          if (!visualReference) throw new Error(`缺少 Item 视觉 Prefab 引用：${plan.key}`);
          const logicBuilt = await executeSceneBuild({
            mode: 'logic',
            logicKind: 'item',
            prefabName: plan.componentName,
            visualPrefabUuid: visualReference.uuid,
            assetReferences: {},
            fontReferences: {},
          });
          await transaction.write(plan.logicUrl, logicBuilt.serialized);
          createdAssets.push(plan.logicUrl);
        }

        for (const plan of target.referenceComponentPlans ?? []) {
          const info = await queryAsset(plan.url);
          if (!info) throw new Error(`所选 UI 引用了尚未生成的 Item：${plan.url}`);
          assetReferences[plan.key] = { key: plan.key, url: plan.url, uuid: info.uuid };
        }
        const frameRoot = applyComponentReferences(
          target.normalized.root,
          [...target.componentPlans, ...(target.referenceComponentPlans ?? [])],
        );
        const visualBuilt = await executeSceneBuild({
          mode: 'visual',
          prefabName: `${target.frameName}.root`,
          root: frameRoot,
          existingPrefabUuid: target.mapping ? (await queryAsset(target.visualPrefabUrl))?.uuid : undefined,
          assetReferences,
          fontReferences,
        });
        const visualExisted = Boolean(await queryAsset(target.visualPrefabUrl));
        const visualInfo = await transaction.write(target.visualPrefabUrl, visualBuilt.serialized);
        (visualExisted ? updatedAssets : createdAssets).push(target.visualPrefabUrl);

        const logicExisted = Boolean(await queryAsset(target.logicPrefabUrl));
        if (!target.mapping && !logicExisted) {
          const logicBuilt = await executeSceneBuild({
            mode: 'logic',
            logicKind: target.kind,
            prefabName: target.frameName,
            visualPrefabUuid: visualInfo.uuid,
            assetReferences: {},
            fontReferences: {},
          });
          await transaction.write(target.logicPrefabUrl, logicBuilt.serialized);
          createdAssets.push(target.logicPrefabUrl);
        }
        if (target.kind === 'item') {
          const itemBlocker = (await validateItemPrefabs(target.itemPrefabs))
            .find((issue) => issue.severity === 'blocker');
          if (itemBlocker) throw new Error(`Item 逻辑 Prefab 与刚生成的视觉 Prefab 不匹配：${itemBlocker.message}`);
        }

        const previousOwned = target.mapping?.ownedAssets ?? [];
        const ownedAssets = [
          target.visualPrefabUrl,
          ...target.normalized.assets.filter((asset) => !asset.sharedSource).map((asset) => asset.targetUrl),
          ...target.componentPlans.map((plan) => plan.url),
        ];
        const ownedByOtherTargets = new Set(Object.entries(settingsWorking.frames)
          .filter(([key]) => key !== target.frameKey)
          .flatMap(([, frame]) => frame.ownedAssets));
        orphanAssets.push(...previousOwned.filter((url) => (
          isGeneratedOrphanPath(url)
          && !ownedAssets.includes(url)
          && !ownedByOtherTargets.has(url)
        )));
        const mapping: FrameMapping = {
          schemaVersion: 4,
          kind: target.kind,
          configHash: target.configurationHash,
          source: { fileKey: target.source.fileKey, nodeId: target.source.nodeId, fileVersion: target.fileVersion },
          frameName: target.frameName,
          visualPrefabUrl: target.visualPrefabUrl,
          logicPrefabUrl: target.logicPrefabUrl,
          nodes: collectNodeMapping(target.normalized),
          assets: assetIdentity,
          ownedAssets: [...new Set(ownedAssets)],
          bundleRoot: target.outputPaths.root,
          bindings: target.kind === 'view' ? target.bindingContract : undefined,
          items: target.kind === 'view' ? target.itemPrefabs : undefined,
          adoptionKey: target.adoption ? target.frameKey : target.mapping?.adoptionKey,
        };
        mappings.push(mapping);
        settingsWorking = {
          ...settingsWorking,
          bundleRoot: target.request.bundleRoot,
          frames: { ...settingsWorking.frames, [target.frameKey]: mapping },
        };
      }

      const ownedAfterApply = new Set(Object.values(settingsWorking.frames).flatMap((frame) => frame.ownedAssets));
      settingsWorking = {
        ...settingsWorking,
        pendingOrphans: [...new Set([...settingsAtApply.pendingOrphans, ...orphanAssets])]
          .filter((url) => !ownedAfterApply.has(url)),
      };
      await saveProjectSettings(settingsWorking);
      transaction.commit();
      const report: SyncReport = {
        ...active.preview,
        warnings: [...active.preview.warnings, ...applyWarnings],
        source: preparedTargets[0].source,
        startedAt,
        finishedAt: new Date().toISOString(),
        applied: true,
        rolledBack: false,
        createdAssets: [...new Set(createdAssets)],
        updatedAssets: [...new Set(updatedAssets)],
        orphanAssets: [...new Set(orphanAssets)],
      };
      this.lastReport = report;
      this.prepared = undefined;
      return { report, mapping: mappings[0] };
    } catch (error) {
      await transaction.rollback();
      const report: SyncReport = {
        ...active.preview,
        warnings: [...active.preview.warnings, ...applyWarnings],
        source: preparedTargets[0].source,
        startedAt,
        finishedAt: new Date().toISOString(),
        applied: false,
        rolledBack: true,
        createdAssets: [...new Set(createdAssets)],
        updatedAssets: [...new Set(updatedAssets)],
        orphanAssets: [],
        blockers: [...active.preview.blockers, {
          severity: 'blocker',
          code: 'APPLY_FAILED',
          message: errorMessage(error),
        }],
      };
      this.lastReport = report;
      throw new Error(`同步失败，已回滚：${errorMessage(error)}`);
    }
  }
}
