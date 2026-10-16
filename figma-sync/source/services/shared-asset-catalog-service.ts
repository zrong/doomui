import { randomBytes } from 'crypto';
import type {
  CocosSharedAsset,
  CocosSharedAssetCatalogDocument,
  CocosSharedAssetCatalogSessionSummary,
  CompleteSharedAssetCatalogInput,
  SharedAssetCatalogItemMapping,
  SharedAssetCatalogMapping,
  SharedAssetSelectionItem,
  SharedAssetSelectionSummary,
} from '../types';
import { getProjectSettings, saveProjectSettings } from './settings';
import {
  nineSliceInsets,
  prepareSharedImageAsset,
  spriteFrameMeta,
  spriteFrameSubAsset,
  type SharedImageAssetInfo,
  type SharedImageAssetMeta,
} from './shared-image-source';

const CATALOG_TTL_MS = 30 * 60 * 1000;

interface StoredCatalogSession {
  document: CocosSharedAssetCatalogDocument;
  buffers: Map<string, Buffer>;
  status: CocosSharedAssetCatalogSessionSummary['status'];
  importedCatalog?: CocosSharedAssetCatalogSessionSummary['importedCatalog'];
}

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function notFound(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 404 });
}

function conflict(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 409 });
}

function normalizedNodeId(value: string, label: string): string {
  if (!/^\d+[:\-]\d+$/.test(value ?? '')) throw badRequest(`${label}不合法`);
  return value.replace('-', ':');
}

function validFileKey(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,256}$/.test(value);
}

function isWithinRoot(url: string, root: string): boolean {
  return url === root || url.startsWith(`${root}/`);
}

function matchingRoot(url: string, roots: string[]): string | undefined {
  return roots
    .filter((root) => isWithinRoot(url, root))
    .sort((left, right) => right.length - left.length)[0];
}

function summary(session: StoredCatalogSession): CocosSharedAssetCatalogSessionSummary {
  return {
    sessionId: session.document.sessionId,
    assetCount: session.document.assets.length,
    assets: session.document.assets.map((asset) => ({ ...asset })),
    status: session.status,
    createdAt: session.document.createdAt,
    expiresAt: session.document.expiresAt,
    importedCatalog: session.importedCatalog,
  };
}

async function queryAssetInfo(value: string): Promise<SharedImageAssetInfo | null> {
  return Editor.Message.request('asset-db', 'query-asset-info', value) as Promise<SharedImageAssetInfo | null>;
}

async function resolveSelectedAsset(selectionUuid: string): Promise<SharedAssetSelectionItem> {
  const selected = await queryAssetInfo(selectionUuid);
  if (!selected?.uuid || selected.invalid) throw new Error('资源不存在或尚未完成导入');

  let image = selected;
  let spriteFrameUuid = '';
  if (selected.type === 'cc.SpriteFrame') {
    spriteFrameUuid = selected.uuid;
    const source = typeof selected.source === 'string' ? selected.source : '';
    const parentUrl = selected.url?.replace(/\/spriteFrame$/, '') ?? '';
    image = await queryAssetInfo(source || parentUrl) ?? selected;
  } else {
    spriteFrameUuid = spriteFrameSubAsset(selected)?.uuid ?? '';
    if (!spriteFrameUuid && selected.source && selected.source !== selected.url) {
      const parent = await queryAssetInfo(selected.source);
      const parentSpriteFrame = parent ? spriteFrameSubAsset(parent) : undefined;
      if (parent?.uuid && parentSpriteFrame?.uuid) {
        image = parent;
        spriteFrameUuid = parentSpriteFrame.uuid;
      }
    }
  }
  if (!image.url?.startsWith('db://assets/') || !image.file || image.invalid) {
    throw new Error('只支持工程 assets 下已导入的图片资源');
  }
  if (!spriteFrameUuid) throw new Error('图片没有可用的 cc.SpriteFrame 子资源');

  const meta = await Editor.Message.request(
    'asset-db',
    'query-asset-meta',
    image.url,
  ) as SharedImageAssetMeta | null;
  const insets = nineSliceInsets(spriteFrameMeta(meta, spriteFrameUuid));
  return {
    selectionUuid,
    sourceUrl: image.url,
    sourceImageUuid: image.uuid,
    sourceSpriteFrameUuid: spriteFrameUuid,
    sliced: Boolean(insets),
    insets,
  };
}

export class SharedAssetCatalogService {
  private active?: StoredCatalogSession;
  private onChange: () => void = () => {};

  setOnChange(callback: () => void): void {
    this.onChange = callback;
  }

  getActiveSummary(): CocosSharedAssetCatalogSessionSummary | undefined {
    this.expireIfNeeded();
    return this.active ? summary(this.active) : undefined;
  }

  async inspectSelection(): Promise<SharedAssetSelectionSummary> {
    const selection = [...new Set(Editor.Selection.getSelected('asset'))];
    if (!selection.length) return { selectedCount: 0, items: [], errors: ['请在资源管理器中选择一张或多张图片'] };
    if (selection.length > 100) return { selectedCount: selection.length, items: [], errors: ['共享素材单次最多选择 100 项'] };
    const settings = await getProjectSettings();
    if (!settings.sharedTextureRoots.length) {
      return { selectedCount: selection.length, items: [], errors: ['请先配置“共享纹理 Bundle 根目录”'] };
    }

    const items: SharedAssetSelectionItem[] = [];
    const errors: string[] = [];
    const verifiedRoots = new Map<string, boolean>();
    for (const uuid of selection) {
      try {
        const item = await resolveSelectedAsset(uuid);
        const root = matchingRoot(item.sourceUrl, settings.sharedTextureRoots);
        if (!root) throw new Error(`不在共享纹理 Bundle 根目录内：${item.sourceUrl}`);
        let validBundle = verifiedRoots.get(root);
        if (validBundle === undefined) {
          const meta = await Editor.Message.request('asset-db', 'query-asset-meta', root) as SharedImageAssetMeta | null;
          validBundle = meta?.userData?.isBundle === true;
          verifiedRoots.set(root, validBundle);
        }
        if (!validBundle) throw new Error(`配置路径不是 Asset Bundle 根目录：${root}`);
        if (!items.some((candidate) => candidate.sourceSpriteFrameUuid === item.sourceSpriteFrameUuid)) items.push(item);
      } catch (error) {
        errors.push(`${uuid}：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { selectedCount: selection.length, items, errors };
  }

  async create(): Promise<CocosSharedAssetCatalogSessionSummary> {
    this.expireIfNeeded();
    if (this.active?.status === 'ready') throw conflict('已有待导入的共享素材会话，请先导入或取消');
    const selection = await this.inspectSelection();
    if (selection.errors.length) throw badRequest(selection.errors.join('；'));
    if (!selection.items.length) throw badRequest('当前选择没有可导入的共享素材');

    const assets: CocosSharedAsset[] = [];
    const buffers = new Map<string, Buffer>();
    for (const item of selection.items) {
      const prepared = await prepareSharedImageAsset({
        imageUuid: item.sourceImageUuid,
        spriteFrameUuid: item.sourceSpriteFrameUuid,
        sliced: item.sliced,
        insets: item.insets,
      });
      if (buffers.has(prepared.asset.key)) throw conflict(`共享素材 key 冲突：${prepared.asset.key}`);
      assets.push(prepared.asset);
      buffers.set(prepared.asset.key, prepared.buffer);
    }

    const createdAt = new Date();
    const document: CocosSharedAssetCatalogDocument = {
      protocolVersion: 12,
      sessionId: randomBytes(12).toString('base64url'),
      assets,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + CATALOG_TTL_MS).toISOString(),
    };
    this.active = { document, buffers, status: 'ready' };
    this.onChange();
    return summary(this.active);
  }

  cancel(sessionId?: string): boolean {
    this.expireIfNeeded();
    if (!this.active || (sessionId && this.active.document.sessionId !== sessionId)) return false;
    this.active = undefined;
    this.onChange();
    return true;
  }

  getDocument(sessionId: string): CocosSharedAssetCatalogDocument {
    return this.requireSession(sessionId).document;
  }

  getAsset(sessionId: string, key: string): Buffer {
    const buffer = this.requireSession(sessionId).buffers.get(key);
    if (!buffer) throw notFound(`共享素材不存在：${key}`);
    return Buffer.from(buffer);
  }

  async complete(
    sessionId: string,
    input: CompleteSharedAssetCatalogInput,
  ): Promise<CocosSharedAssetCatalogSessionSummary> {
    const session = this.requireSession(sessionId);
    if (session.status !== 'ready') throw badRequest('该共享素材会话已完成，不能重复写入 Catalog');
    if (!validFileKey(input.fileKey ?? '')) throw badRequest('Figma fileKey 不合法');
    if (!input.fileName?.trim()) throw badRequest('Figma 文件名不能为空');
    const catalogNodeId = normalizedNodeId(input.catalogNodeId, 'Catalog Frame node ID');
    const expectedKeys = new Set(session.document.assets.map((asset) => asset.key));
    const items = input.items && typeof input.items === 'object' ? input.items : {};
    if (Object.keys(items).length !== expectedKeys.size) throw badRequest('共享素材返回的 Component 映射不完整');
    const componentIds = new Set<string>();
    for (const [key, item] of Object.entries(items)) {
      if (!expectedKeys.has(key)) throw badRequest(`Component 映射引用了未知共享素材：${key}`);
      const componentNodeId = normalizedNodeId(item.componentNodeId, `Component node ID（${key}）`);
      if (componentIds.has(componentNodeId)) throw badRequest(`多个共享素材不能映射到同一个 Component：${componentNodeId}`);
      componentIds.add(componentNodeId);
      if (typeof item.figmaImageRef !== 'string' || !item.figmaImageRef.trim() || item.figmaImageRef.length > 256) {
        throw badRequest(`共享素材缺少合法的 Figma imageRef：${key}`);
      }
    }

    const retained = new Set((Array.isArray(input.retainedSourceSpriteFrameUuids)
      ? input.retainedSourceSpriteFrameUuids
      : []).filter((uuid): uuid is string => typeof uuid === 'string' && Boolean(uuid.trim())));
    const settings = await getProjectSettings();
    const previous = settings.sharedAssetCatalogs[input.fileKey];
    const sameCatalog = previous?.figma.catalogNodeId === catalogNodeId;
    const now = new Date().toISOString();
    const mappedAssets: Record<string, SharedAssetCatalogItemMapping> = sameCatalog
      ? Object.fromEntries(Object.entries(previous.assets).filter(([uuid]) => retained.has(uuid)))
      : {};
    for (const asset of session.document.assets) {
      const mapped = items[asset.key];
      mappedAssets[asset.sourceSpriteFrameUuid] = {
        ...asset,
        componentNodeId: normalizedNodeId(mapped.componentNodeId, `Component node ID（${asset.key}）`),
        figmaImageRef: mapped.figmaImageRef,
        updatedAt: now,
      };
    }
    const mapping: SharedAssetCatalogMapping = {
      schemaVersion: 1,
      figma: {
        fileKey: input.fileKey,
        fileName: input.fileName.trim(),
        catalogNodeId,
      },
      assets: mappedAssets,
      updatedAt: now,
    };
    await saveProjectSettings({
      ...settings,
      sharedAssetCatalogs: { ...settings.sharedAssetCatalogs, [input.fileKey]: mapping },
    });
    session.status = 'imported';
    session.importedCatalog = mapping.figma;
    this.onChange();
    return summary(session);
  }

  private requireSession(sessionId: string): StoredCatalogSession {
    this.expireIfNeeded();
    if (!this.active || this.active.document.sessionId !== sessionId) {
      throw notFound('共享素材导入会话不存在或已过期');
    }
    return this.active;
  }

  private expireIfNeeded(): void {
    if (this.active && Date.parse(this.active.document.expiresAt) <= Date.now()) this.active = undefined;
  }
}
