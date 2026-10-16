import { readFile } from 'fs/promises';
import sharp from 'sharp';
import type { AssetTask, SceneAssetReference } from '../types';

interface AssetInfoLike {
  uuid: string;
  file?: string;
  invalid?: boolean;
  imported?: boolean;
  subAssets?: Record<string, { uuid: string; type?: string; name?: string }>;
}

interface AssetMetaLike {
  userData?: Record<string, unknown>;
  subMetas?: Record<string, { uuid?: string; importer?: string; userData?: Record<string, unknown> }>;
  [key: string]: unknown;
}

interface RollbackEntry {
  url: string;
  existed: boolean;
  content?: Buffer;
  meta?: AssetMetaLike;
}

async function request<T>(message: string, ...args: unknown[]): Promise<T> {
  return Editor.Message.request('asset-db', message, ...args) as Promise<T>;
}

async function queryAsset(url: string): Promise<AssetInfoLike | null> {
  return request<AssetInfoLike | null>('query-asset-info', url);
}

function parentUrls(url: string): string[] {
  const prefix = 'db://assets';
  if (!url.startsWith(`${prefix}/`)) throw new Error(`输出必须位于 db://assets：${url}`);
  const parts = url.slice(prefix.length + 1).split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error(`资源路径不合法：${url}`);
  parts.pop();
  const result: string[] = [];
  let current = prefix;
  for (const part of parts) {
    current += `/${part}`;
    result.push(current);
  }
  return result;
}

export class AssetWriteTransaction {
  private readonly journal: RollbackEntry[] = [];
  private readonly createdFolders = new Set<string>();
  private finished = false;

  async ensureParents(url: string): Promise<void> {
    for (const folder of parentUrls(url)) {
      if (await queryAsset(folder)) continue;
      const created = await request<AssetInfoLike | null>('create-asset', folder, null);
      if (!created) throw new Error(`无法创建资源目录：${folder}`);
      this.createdFolders.add(folder);
    }
  }

  async write(url: string, content: string | Buffer): Promise<AssetInfoLike> {
    if (this.finished) throw new Error('资源事务已经结束');
    await this.ensureParents(url);
    const existing = await queryAsset(url);
    const previousContent = existing?.file ? await readFile(existing.file) : undefined;
    const previousMeta = existing ? await request<AssetMetaLike | null>('query-asset-meta', url) ?? undefined : undefined;
    this.journal.push({ url, existed: Boolean(existing), content: previousContent, meta: previousMeta });
    const info = existing
      ? await request<AssetInfoLike | null>('save-asset', url, content)
      : await request<AssetInfoLike | null>('create-asset', url, content);
    if (!info) throw new Error(`asset-db 写入失败：${url}`);
    return this.waitImported(url);
  }

  async ensureSpriteFrame(url: string): Promise<AssetInfoLike> {
    const meta = await request<AssetMetaLike | null>('query-asset-meta', url);
    if (!meta) throw new Error(`无法读取图片 meta：${url}`);
    const existingSprite = meta.subMetas?.f9941
      ?? Object.values(meta.subMetas ?? {}).find((item) => item.importer === 'sprite-frame');
    if (!existingSprite) {
      const existing = await queryAsset(url);
      if (!existing) throw new Error(`图片资源不存在：${url}`);
      if (!this.journal.some((entry) => entry.url === url)) {
        const content = existing.file ? await readFile(existing.file) : undefined;
        this.journal.push({ url, existed: true, content, meta });
      }
      meta.userData = { ...(meta.userData ?? {}), type: 'sprite-frame' };
      const saved = await request<AssetInfoLike | null>('save-asset-meta', url, JSON.stringify(meta, null, 2));
      if (!saved) throw new Error(`无法把图片配置成 SpriteFrame：${url}`);
      await request<boolean>('reimport-asset', url);
      await this.waitImported(url);
    }
    const spriteMeta = await this.waitSpriteMeta(url);
    if (!spriteMeta) throw new Error(`图片重导入后仍没有 SpriteFrame 子资源：${url}`);
    return this.waitImported(url);
  }

  async setNineSlice(url: string, task: AssetTask): Promise<AssetInfoLike> {
    if (!task.nineSlice) return this.waitImported(url);
    const meta = await request<AssetMetaLike | null>('query-asset-meta', url);
    if (!meta) throw new Error(`无法读取 SpriteFrame meta：${url}`);
    const spriteMeta = meta.subMetas?.f9941 ?? Object.values(meta.subMetas ?? {}).find((item) => item.importer === 'sprite-frame');
    if (!spriteMeta) throw new Error(`资源没有 SpriteFrame 子资源：${url}`);
    spriteMeta.userData = {
      ...(spriteMeta.userData ?? {}),
      borderLeft: task.nineSlice.left,
      borderRight: task.nineSlice.right,
      borderTop: task.nineSlice.top,
      borderBottom: task.nineSlice.bottom,
    };
    const saved = await request<AssetInfoLike | null>('save-asset-meta', url, JSON.stringify(meta, null, 2));
    if (!saved) throw new Error(`无法保存九宫格 meta：${url}`);
    await request<boolean>('reimport-asset', url);
    const expected = task.nineSlice;
    const refreshed = await this.waitSpriteMeta(url, (candidate) => (
      candidate.userData?.borderLeft === expected.left
      && candidate.userData?.borderRight === expected.right
      && candidate.userData?.borderTop === expected.top
      && candidate.userData?.borderBottom === expected.bottom
    ));
    if (!refreshed) throw new Error(`九宫格重导入超时：${url}`);
    return this.waitImported(url);
  }

  async rollback(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    for (const entry of [...this.journal].reverse()) {
      try {
        if (!entry.existed) {
          await request('delete-asset', entry.url);
          continue;
        }
        if (entry.content) await request('save-asset', entry.url, entry.content);
        if (entry.meta) await request('save-asset-meta', entry.url, JSON.stringify(entry.meta, null, 2));
        await request('reimport-asset', entry.url);
      } catch (error) {
        console.error(`[figma-sync] 回滚失败：${entry.url}`, error);
      }
    }
  }

  commit(): void {
    this.finished = true;
  }

  private async waitImported(url: string): Promise<AssetInfoLike> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const info = await queryAsset(url);
      if (info?.invalid) throw new Error(`资源导入失败：${url}`);
      if (info?.uuid && info.imported !== false) return info;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`等待资源导入超时：${url}`);
  }

  private async waitSpriteMeta(
    url: string,
    predicate: (meta: NonNullable<AssetMetaLike['subMetas']>[string]) => boolean = () => true,
  ): Promise<NonNullable<AssetMetaLike['subMetas']>[string] | undefined> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const refreshedMeta = await request<AssetMetaLike | null>('query-asset-meta', url);
      const spriteMeta = refreshedMeta?.subMetas?.f9941
        ?? Object.values(refreshedMeta?.subMetas ?? {}).find((item) => item.importer === 'sprite-frame');
      if (spriteMeta && predicate(spriteMeta)) return spriteMeta;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return undefined;
  }
}

export async function generatedAssetBuffer(task: AssetTask): Promise<Buffer | undefined> {
  if (task.kind !== 'generated-solid') return undefined;
  const width = task.nineSlice ? Math.max(1, Math.ceil(task.nineSlice.left + task.nineSlice.right + 1)) : 1;
  const height = task.nineSlice ? Math.max(1, Math.ceil(task.nineSlice.top + task.nineSlice.bottom + 1)) : 1;
  return sharp({ create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .png()
    .toBuffer();
}

export async function normalizeTextureBuffer(input: Buffer): Promise<{ buffer: Buffer; width: number; height: number }> {
  if (!input.length) throw new Error('下载的图片为空');
  const result = await sharp(input, { failOn: 'error' })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer({ resolveWithObject: true });
  if (!result.info.width || !result.info.height) throw new Error('无法识别图片尺寸');
  return { buffer: result.data, width: result.info.width, height: result.info.height };
}

export async function isOpaqueWhiteTexture(input: Buffer): Promise<boolean> {
  if (!input.length) return false;
  const stats = await sharp(input, { failOn: 'error' }).ensureAlpha().stats();
  return stats.channels.slice(0, 4).every((channel) => channel.min === 255 && channel.max === 255);
}

export function toSceneAssetReference(key: string, url: string, info: AssetInfoLike): SceneAssetReference {
  const spriteFrame = info.subAssets
    ? Object.values(info.subAssets).find((item) => item.type === 'cc.SpriteFrame' || item.name === 'spriteFrame')
    : undefined;
  return {
    key,
    url,
    uuid: info.uuid,
    spriteFrameUuid: spriteFrame?.uuid ?? `${info.uuid}@f9941`,
  };
}
