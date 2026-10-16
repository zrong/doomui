import { createHash, randomBytes } from 'crypto';
import { readFile } from 'fs/promises';
import { mappingKey } from '../core/naming';
import type {
  AdoptionFigmaNodeType,
  AdoptionKind,
  AdoptionMapping,
  CocosAdoptionAsset,
  CocosAdoptionBindingSummary,
  CocosAdoptionDocument,
  CocosAdoptionNode,
  CocosAdoptionSessionSummary,
  CompleteCocosAdoptionInput,
  CreateCocosAdoptionInput,
  NineSliceInsets,
  ReleaseCocosAdoptionBindingInput,
  SceneAdoptionExportRequest,
  SceneAdoptionExportResult,
  SceneAdoptionNode,
} from '../types';
import { getProjectSettings, PACKAGE_NAME, saveProjectSettings } from './settings';
import { prepareSharedImageAsset, type SharedImageAssetInfo } from './shared-image-source';

const ADOPTION_TTL_MS = 30 * 60 * 1000;
type AssetInfoLike = SharedImageAssetInfo;

interface StoredAdoption {
  document: CocosAdoptionDocument;
  sourcePrefabUuid: string;
  sourcePrefabHash: string;
  assets: Map<string, Buffer>;
  status: CocosAdoptionSessionSummary['status'];
  importedNode?: CocosAdoptionSessionSummary['importedNode'];
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

function expectedNodeType(kind: AdoptionKind): AdoptionFigmaNodeType {
  return kind === 'item' ? 'COMPONENT' : 'FRAME';
}

function normalizePrefabUrl(value: string): string {
  const url = value.trim().replace(/\/$/, '');
  if (!url.startsWith('db://assets/') || !url.endsWith('.prefab')) {
    throw badRequest('Prefab 路径必须是 db://assets 下的 .prefab 资源');
  }
  if (url.split('/').some((part) => part === '.' || part === '..')) throw badRequest('Prefab 路径不合法');
  return url;
}

function normalizeAdoptionKind(value: AdoptionKind | undefined, prefabUrl: string): AdoptionKind {
  if (value === 'view' || value === 'item') return value;
  if (value !== undefined) throw badRequest('Prefab 导入类型必须是 view 或 item');
  // Keep callers from older panel builds compatible while the current panel
  // always sends an explicit kind. Arbitrary paths default to a UI Frame.
  return /\/prefabs\/item\/[^/]+\.prefab$/.test(prefabUrl) ? 'item' : 'view';
}

function countNodes(root: CocosAdoptionNode): number {
  return 1 + root.children.reduce((sum, child) => sum + countNodes(child), 0);
}

function summarizeNodes(root: CocosAdoptionNode): CocosAdoptionSessionSummary['nodes'] {
  const nodes: NonNullable<CocosAdoptionSessionSummary['nodes']> = [];
  const visit = (node: CocosAdoptionNode, parentPath = ''): void => {
    const path = parentPath ? `${parentPath}/${node.name}` : node.name;
    nodes.push({ path, name: node.name, kind: node.kind });
    node.children.forEach((child) => visit(child, path));
  };
  visit(root);
  return nodes;
}

function sourceFileIds(root: CocosAdoptionNode): Set<string> {
  const result = new Set<string>();
  const visit = (node: CocosAdoptionNode): void => {
    result.add(node.sourceFileId);
    node.children.forEach(visit);
  };
  visit(root);
  return result;
}

function sourceNodesByFileId(root: CocosAdoptionNode): Map<string, CocosAdoptionNode> {
  const result = new Map<string, CocosAdoptionNode>();
  const visit = (node: CocosAdoptionNode): void => {
    result.set(node.sourceFileId, node);
    node.children.forEach(visit);
  };
  visit(root);
  return result;
}

function summary(session: StoredAdoption): CocosAdoptionSessionSummary {
  const { document } = session;
  return {
    kind: document.kind,
    sessionId: document.sessionId,
    prefabUrl: document.prefabUrl,
    prefabName: document.prefabName,
    nodeCount: countNodes(document.root),
    assetCount: document.assets.length,
    warningCount: document.warnings.length,
    nodes: summarizeNodes(document.root),
    assets: document.assets.map((asset) => ({ ...asset })),
    warnings: [...document.warnings],
    status: session.status,
    createdAt: document.createdAt,
    expiresAt: document.expiresAt,
    importedNode: session.importedNode,
  };
}

function bindingSummary(mapping: AdoptionMapping): CocosAdoptionBindingSummary {
  return {
    kind: mapping.kind,
    sourcePrefabUrl: mapping.sourcePrefabUrl,
    sourcePrefabUuid: mapping.sourcePrefabUuid,
    fileKey: mapping.figma.fileKey,
    fileName: mapping.figma.fileName,
    nodeId: mapping.figma.nodeId,
    nodeType: expectedNodeType(mapping.kind),
    normalizedUrl: mapping.figma.normalizedUrl,
    createdAt: mapping.createdAt,
  };
}

export class AdoptionService {
  private active?: StoredAdoption;
  private onChange: () => void = () => {};

  setOnChange(callback: () => void): void {
    this.onChange = callback;
  }

  getActiveSummary(): CocosAdoptionSessionSummary | undefined {
    this.expireIfNeeded();
    return this.active ? summary(this.active) : undefined;
  }

  async listBindings(fileKey: string): Promise<CocosAdoptionBindingSummary[]> {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(fileKey)) throw badRequest('Figma fileKey 不合法');
    const settings = await getProjectSettings();
    return Object.values(settings.adoptions)
      .filter((mapping) => !mapping.releasedAt && mapping.figma.fileKey === fileKey)
      .map(bindingSummary);
  }

  async releaseBinding(input: ReleaseCocosAdoptionBindingInput): Promise<CocosAdoptionBindingSummary> {
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(input.fileKey ?? '')) throw badRequest('Figma fileKey 不合法');
    if (!/^\d+[:\-]\d+$/.test(input.nodeId ?? '')) throw badRequest('Figma node ID 不合法');
    const normalizedNodeId = input.nodeId.replace('-', ':');
    const key = mappingKey(input.fileKey, normalizedNodeId);
    const settings = await getProjectSettings();
    const mapping = settings.adoptions[key];
    if (!mapping || mapping.releasedAt) throw notFound('Cocos 中没有可释放的 Figma 节点映射');
    const releasedAt = new Date().toISOString();
    await saveProjectSettings({
      ...settings,
      adoptions: {
        ...settings.adoptions,
        [key]: { ...mapping, releasedAt },
      },
    });
    if (
      this.active?.status === 'imported'
      && this.active.importedNode?.fileKey === input.fileKey
      && this.active.importedNode.nodeId === normalizedNodeId
    ) {
      this.active = undefined;
    }
    this.onChange();
    return bindingSummary(mapping);
  }

  async create(input: CreateCocosAdoptionInput): Promise<CocosAdoptionSessionSummary> {
    const prefabUrl = normalizePrefabUrl(input.prefabUrl ?? '');
    const kind = normalizeAdoptionKind(input.kind, prefabUrl);
    this.expireIfNeeded();
    if (this.active?.document.prefabUrl === prefabUrl && this.active.status === 'ready') {
      throw conflict('该 Prefab 已有待导入会话，不能重复准备');
    }
    const info = await Editor.Message.request('asset-db', 'query-asset-info', prefabUrl) as AssetInfoLike | null;
    if (!info?.uuid || !info.file || info.invalid) throw badRequest(`Prefab 不存在或尚未完成导入：${prefabUrl}`);
    const settings = await getProjectSettings();
    const existing = Object.values(settings.adoptions)
      .find((mapping) => !mapping.releasedAt && mapping.sourcePrefabUuid === info.uuid);
    if (existing) {
      const location = existing.figma.normalizedUrl
        ? `${existing.figma.fileName}（${existing.figma.normalizedUrl}）`
        : `${existing.figma.fileName}（${expectedNodeType(existing.kind)} ${existing.figma.nodeId}）`;
      throw conflict(`该 Prefab 已导入 Figma：${location}。禁止重复导入；若设计节点已删除，请在原 Figma 文件的 Cocos Sync 中清理失效映射`);
    }
    const prefabBytes = await readFile(info.file);
    const prefabName = prefabUrl.slice(prefabUrl.lastIndexOf('/') + 1, -'.prefab'.length);
    const exported = await Editor.Message.request('scene', 'execute-scene-script', {
      name: PACKAGE_NAME,
      method: 'exportPrefabForFigma',
      args: [{ prefabUuid: info.uuid, prefabName } satisfies SceneAdoptionExportRequest],
    }) as SceneAdoptionExportResult;
    if (!exported?.root) throw badRequest('Scene Script 未返回可导入的 Prefab 结构');

    const sourceAssets = new Map<string, {
      imageUuid: string;
      spriteFrameUuid: string;
      sliced: boolean;
      insets?: NineSliceInsets;
      sourceNodeFileIds: Set<string>;
    }>();
    const collectImages = (node: SceneAdoptionNode): void => {
      if (node.sprite?.imageUuid && node.sprite.spriteFrameUuid) {
        const current = sourceAssets.get(node.sprite.spriteFrameUuid) ?? {
          imageUuid: node.sprite.imageUuid,
          spriteFrameUuid: node.sprite.spriteFrameUuid,
          sliced: Boolean(node.sprite.sliced),
          insets: node.sprite.insets,
          sourceNodeFileIds: new Set<string>(),
        };
        current.sourceNodeFileIds.add(node.sourceFileId);
        sourceAssets.set(node.sprite.spriteFrameUuid, current);
      } else if (node.sprite?.imageUuid) {
        exported.warnings.push(`SpriteFrame 身份无法导出（节点 ${node.name}）；该图片不能自动复用共享资源`);
      }
      node.children.forEach(collectImages);
    };
    collectImages(exported.root);

    const assetKeyBySpriteFrameUuid = new Map<string, string>();
    const solidWhiteByAssetKey = new Map<string, boolean>();
    const assetBuffers = new Map<string, Buffer>();
    const assets: CocosAdoptionAsset[] = [];
    for (const sourceAsset of sourceAssets.values()) {
      try {
        const prepared = await prepareSharedImageAsset({
          imageUuid: sourceAsset.imageUuid,
          spriteFrameUuid: sourceAsset.spriteFrameUuid,
          sliced: sourceAsset.sliced,
          insets: sourceAsset.insets,
        });
        const asset: CocosAdoptionAsset = {
          ...prepared.asset,
          sourceNodeFileIds: [...sourceAsset.sourceNodeFileIds],
        };
        assetKeyBySpriteFrameUuid.set(sourceAsset.spriteFrameUuid, asset.key);
        solidWhiteByAssetKey.set(asset.key, Boolean(asset.solidWhite));
        assetBuffers.set(asset.key, prepared.buffer);
        assets.push(asset);
      } catch {
        exported.warnings.push(`图片资源无法导出：${sourceAsset.imageUuid}`);
      }
    }

    const publicNode = (node: SceneAdoptionNode, parentPath = ''): CocosAdoptionNode => {
      const path = parentPath ? `${parentPath}/${node.name}` : node.name;
      const assetKey = node.sprite?.spriteFrameUuid
        ? assetKeyBySpriteFrameUuid.get(node.sprite.spriteFrameUuid)
        : undefined;
      const solidWhite = assetKey ? solidWhiteByAssetKey.get(assetKey) : undefined;
      if (
        node.sprite?.imageUuid
        && solidWhite === false
        && (node.sprite.color.r !== 255 || node.sprite.color.g !== 255 || node.sprite.color.b !== 255)
      ) {
        exported.warnings.push(`Sprite RGB 染色无法用 Figma IMAGE Fill 无损表达（节点 ${path}）；已保留图片与 alpha，RGB 染色需在 Figma 重新制作`);
      }
      return {
        sourceFileId: node.sourceFileId,
        name: node.name,
        kind: node.kind,
        visible: node.visible,
        opacity: node.opacity,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        rotation: node.rotation,
        cornerRadius: node.cornerRadius,
        text: node.text,
        sprite: node.sprite ? {
          spriteFrameUuid: node.sprite.spriteFrameUuid,
          color: node.sprite.color,
          solidWhite,
          sliced: node.sprite.sliced,
          insets: node.sprite.insets,
          assetKey,
        } : undefined,
        button: node.button,
        layout: node.layout,
        constraints: node.constraints,
        children: node.children.map((child) => publicNode(child, path)),
      };
    };

    const createdAt = new Date();
    const sessionId = randomBytes(12).toString('base64url');
    if (kind === 'item') {
      exported.warnings.push(`Item 接管不会修改源 Prefab。请先备份或迁移其中程序员维护的脚本与组件；确认 Figma Component 正确后，在首次 Figma → Cocos Apply 前删除旧 ${prefabUrl} 及对应旧视觉 Prefab，由同步重新生成标准 Item 双 Prefab`);
    }
    const document: CocosAdoptionDocument = {
      protocolVersion: 12,
      kind,
      sessionId,
      prefabUrl,
      prefabName,
      root: publicNode(exported.root),
      assets,
      warnings: [...new Set(exported.warnings)],
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + ADOPTION_TTL_MS).toISOString(),
    };
    this.active = {
      document,
      sourcePrefabUuid: info.uuid,
      sourcePrefabHash: createHash('sha256').update(prefabBytes).digest('hex'),
      assets: assetBuffers,
      status: 'ready',
    };
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

  getDocument(sessionId: string): CocosAdoptionDocument {
    const session = this.requireSession(sessionId);
    return session.document;
  }

  getAsset(sessionId: string, key: string): Buffer {
    const session = this.requireSession(sessionId);
    const buffer = session.assets.get(key);
    if (!buffer) throw notFound(`一次性导入资源不存在：${key}`);
    return Buffer.from(buffer);
  }

  async complete(sessionId: string, input: CompleteCocosAdoptionInput): Promise<CocosAdoptionSessionSummary> {
    const session = this.requireSession(sessionId);
    if (session.status !== 'ready') throw badRequest('该 Prefab 已完成一次性导入，不能重复绑定');
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(input.fileKey ?? '')) throw badRequest('Figma fileKey 不合法');
    if (!/^\d+[:\-]\d+$/.test(input.nodeId ?? '')) throw badRequest('Figma node ID 不合法');
    const requiredNodeType = expectedNodeType(session.document.kind);
    if (input.nodeType !== requiredNodeType) {
      throw badRequest(`${session.document.kind === 'item' ? 'Item' : 'UI'} 必须导入为 Figma ${requiredNodeType}`);
    }
    if (!input.fileName?.trim()) throw badRequest('Figma 文件名不能为空');
    const allowedIds = sourceFileIds(session.document.root);
    const nodes = input.nodes && typeof input.nodes === 'object' ? input.nodes : {};
    if (!Object.keys(nodes).length) throw badRequest('一次性导入没有返回节点映射');
    const mappedIds = new Set<string>();
    for (const [figmaNodeId, node] of Object.entries(nodes)) {
      if (!/^\d+[:\-]\d+$/.test(figmaNodeId)) throw badRequest(`Figma node ID 不合法：${figmaNodeId}`);
      if (!allowedIds.has(node.cocosFileId)) throw badRequest(`节点映射引用了未知 Cocos fileId：${node.cocosFileId}`);
      if (mappedIds.has(node.cocosFileId)) throw badRequest(`节点映射重复使用 Cocos fileId：${node.cocosFileId}`);
      mappedIds.add(node.cocosFileId);
    }
    if (mappedIds.size !== allowedIds.size) throw badRequest('一次性导入返回的节点映射不完整');
    const images = input.images && typeof input.images === 'object' ? input.images : {};
    const expectedAssetKeys = new Set(session.document.assets.map((asset) => asset.key));
    if (Object.keys(images).length !== expectedAssetKeys.size) throw badRequest('一次性导入返回的图片映射不完整');
    for (const [assetKey, imageRef] of Object.entries(images)) {
      if (!expectedAssetKeys.has(assetKey)) throw badRequest(`图片映射引用了未知资源：${assetKey}`);
      if (typeof imageRef !== 'string' || !imageRef.trim() || imageRef.length > 256) {
        throw badRequest(`图片映射缺少合法的 Figma imageRef：${assetKey}`);
      }
    }

    const normalizedNodeId = input.nodeId.replace('-', ':');
    const settings = await getProjectSettings();
    const adoptionKey = mappingKey(input.fileKey, normalizedNodeId);
    const sourceNodes = sourceNodesByFileId(session.document.root);
    const adoption: AdoptionMapping = {
      schemaVersion: 3,
      kind: session.document.kind,
      sourcePrefabUrl: session.document.prefabUrl,
      sourcePrefabUuid: session.sourcePrefabUuid,
      sourcePrefabHash: session.sourcePrefabHash,
      figma: {
        fileKey: input.fileKey,
        fileName: input.fileName.trim(),
        nodeId: normalizedNodeId,
        normalizedUrl: input.normalizedUrl,
      },
      nodes: Object.fromEntries(Object.entries(nodes).map(([id, node]) => {
        const source = sourceNodes.get(node.cocosFileId)!;
        return [id.replace('-', ':'), {
          ...node,
          sourceWidgetMapped: Boolean(source.constraints),
          sourceText: source.text ? {
            width: source.width,
            height: source.height,
            importedWidth: source.width,
            importedHeight: source.height,
            overflow: source.text.overflow === 'shrink' ? 'clamp' : source.text.overflow,
            wrap: source.text.wrap,
          } : undefined,
          sourceEmptySpriteFrame: source.sprite && !source.sprite.spriteFrameUuid ? {
            sliced: Boolean(source.sprite.sliced),
            color: source.sprite.color,
          } : undefined,
        }];
      })),
      assets: Object.fromEntries(session.document.assets.map((asset) => [asset.key, {
        ...asset,
        figmaImageRef: images[asset.key],
      }])),
      createdAt: new Date().toISOString(),
    };
    const releasedEntries = Object.entries(settings.adoptions)
      .filter(([, mapping]) => mapping.releasedAt && mapping.sourcePrefabUuid === session.sourcePrefabUuid)
      .sort(([, left], [, right]) => String(right.releasedAt).localeCompare(String(left.releasedAt)));
    const nextAdoptions = { ...settings.adoptions };
    releasedEntries.forEach(([key]) => delete nextAdoptions[key]);
    nextAdoptions[adoptionKey] = adoption;

    const nextFrames = { ...settings.frames };
    const transferable = releasedEntries.find(([key, mapping]) => (
      mapping.kind === session.document.kind && nextFrames[key]
    ));
    if (transferable) {
      const [previousKey] = transferable;
      const previous = nextFrames[previousKey];
      if (previousKey !== adoptionKey) delete nextFrames[previousKey];
      nextFrames[adoptionKey] = {
        ...previous,
        source: {
          ...previous.source,
          fileKey: input.fileKey,
          nodeId: normalizedNodeId,
          fileVersion: '',
        },
        adoptionKey,
      };
    }
    await saveProjectSettings({ ...settings, frames: nextFrames, adoptions: nextAdoptions });
    session.status = 'imported';
    session.importedNode = {
      fileKey: input.fileKey,
      fileName: input.fileName.trim(),
      nodeId: normalizedNodeId,
      nodeType: requiredNodeType,
    };
    this.onChange();
    return summary(session);
  }

  private requireSession(sessionId: string): StoredAdoption {
    this.expireIfNeeded();
    if (!this.active || this.active.document.sessionId !== sessionId) throw notFound('一次性 Prefab 导入会话不存在或已过期');
    return this.active;
  }

  private expireIfNeeded(): void {
    if (this.active && Date.parse(this.active.document.expiresAt) <= Date.now()) this.active = undefined;
  }
}
