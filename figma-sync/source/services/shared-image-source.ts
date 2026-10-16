import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { shortHash } from '../core/hash';
import type { CocosSharedAsset, NineSliceInsets } from '../types';
import { isOpaqueWhiteTexture, normalizeTextureBuffer } from './asset-writer';

export const INTERNAL_DEFAULT_UI_PREFIX = 'db://internal/default_ui/';

export interface SharedImageAssetInfo {
  uuid: string;
  url?: string;
  source?: string;
  file?: string;
  type?: string;
  name?: string;
  invalid?: boolean;
  subAssets?: Record<string, SharedImageAssetInfo>;
}

export interface SharedImageAssetMeta {
  importer?: string;
  userData?: Record<string, unknown>;
  subMetas?: Record<string, {
    uuid?: string;
    importer?: string;
    userData?: Record<string, unknown>;
  }>;
}

export function isSupportedSharedImageSource(url: string | undefined): url is string {
  return Boolean(url && (
    url.startsWith('db://assets/')
    || url.startsWith(INTERNAL_DEFAULT_UI_PREFIX)
  ));
}

export function currentCreatorVersion(): string | undefined {
  const value = Editor.App?.version?.trim();
  return value || undefined;
}

export function spriteFrameSubAsset(info: SharedImageAssetInfo): SharedImageAssetInfo | undefined {
  return Object.values(info.subAssets ?? {}).find((asset) => (
    asset.type === 'cc.SpriteFrame' || asset.name === 'spriteFrame'
  ));
}

export function spriteFrameMeta(
  meta: SharedImageAssetMeta | null | undefined,
  spriteFrameUuid?: string,
): NonNullable<SharedImageAssetMeta['subMetas']>[string] | undefined {
  const values = Object.values(meta?.subMetas ?? {});
  return values.find((item) => item.uuid === spriteFrameUuid)
    ?? meta?.subMetas?.f9941
    ?? values.find((item) => item.importer === 'sprite-frame');
}

export function nineSliceInsets(
  meta: NonNullable<SharedImageAssetMeta['subMetas']>[string] | undefined,
): NineSliceInsets | undefined {
  const data = meta?.userData;
  if (!data) return undefined;
  const insets = {
    left: Number(data.borderLeft ?? 0),
    right: Number(data.borderRight ?? 0),
    top: Number(data.borderTop ?? 0),
    bottom: Number(data.borderBottom ?? 0),
  };
  if (Object.values(insets).some((value) => !Number.isFinite(value) || value < 0)) return undefined;
  return Object.values(insets).some((value) => value > 0) ? insets : undefined;
}

export async function prepareSharedImageAsset(input: {
  imageUuid: string;
  spriteFrameUuid: string;
  sliced: boolean;
  insets?: NineSliceInsets;
}): Promise<{ asset: CocosSharedAsset; buffer: Buffer }> {
  const imageInfo = await Editor.Message.request(
    'asset-db',
    'query-asset-info',
    input.imageUuid,
  ) as SharedImageAssetInfo | null;
  if (!imageInfo?.file || !isSupportedSharedImageSource(imageInfo.url) || imageInfo.invalid) {
    throw new Error(`图片资源无法导出：${input.imageUuid}`);
  }
  const normalized = await normalizeTextureBuffer(await readFile(imageInfo.file));
  const solidWhite = await isOpaqueWhiteTexture(normalized.buffer);
  return {
    asset: {
      key: `sprite-frame-${shortHash(input.spriteFrameUuid, 16)}`,
      sourceUrl: imageInfo.url,
      sourceImageUuid: input.imageUuid,
      sourceSpriteFrameUuid: input.spriteFrameUuid,
      contentHash: createHash('sha256').update(normalized.buffer).digest('hex'),
      solidWhite,
      sourceCreatorVersion: imageInfo.url.startsWith(INTERNAL_DEFAULT_UI_PREFIX)
        ? currentCreatorVersion()
        : undefined,
      sliced: input.sliced,
      insets: input.insets,
      mimeType: 'image/png',
      width: normalized.width,
      height: normalized.height,
    },
    buffer: normalized.buffer,
  };
}
