import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { AssetWriteTransaction, generatedAssetBuffer, isOpaqueWhiteTexture, normalizeTextureBuffer } from '../source/services/asset-writer';

describe('asset-db transaction', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).Editor;
  });

  it('deletes newly created assets during rollback', async () => {
    const assets = new Map<string, { uuid: string; imported: boolean }>();
    const calls: Array<[string, ...unknown[]]> = [];
    (globalThis as any).Editor = {
      Message: {
        request: vi.fn(async (_channel: string, message: string, ...args: unknown[]) => {
          calls.push([message, ...args]);
          const url = String(args[0]);
          if (message === 'query-asset-info') return assets.get(url) ?? null;
          if (message === 'create-asset') {
            const info = { uuid: `uuid-${assets.size}`, imported: true };
            assets.set(url, info);
            return info;
          }
          if (message === 'delete-asset') {
            assets.delete(url);
            return true;
          }
          throw new Error(`unexpected ${message}`);
        }),
      },
    };
    const transaction = new AssetWriteTransaction();
    await transaction.write('db://assets/figma-ui/textures/a.png', Buffer.from('png'));
    expect(assets.has('db://assets/figma-ui/textures/a.png')).toBe(true);
    await transaction.rollback();
    expect(assets.has('db://assets/figma-ui/textures/a.png')).toBe(false);
    expect(calls).toContainEqual(['delete-asset', 'db://assets/figma-ui/textures/a.png']);
  });

  it('normalizes downloaded images to PNG before asset-db writes', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="white"/></svg>');
    const result = await normalizeTextureBuffer(svg);
    expect(result).toMatchObject({ width: 1, height: 1 });
    expect(result.buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  it('creates a large-enough white texture for solid 9-slice sprites', async () => {
    const task = {
      key: 'solid', kind: 'generated-solid' as const, hash: 'solid', targetUrl: 'db://assets/solid.png', scale: 1 as const, importSettingsHash: 'solid',
      nineSlice: { left: 4, right: 5, top: 6, bottom: 7 },
    };
    const buffer = await generatedAssetBuffer(task);
    const normalized = await normalizeTextureBuffer(buffer!);
    expect(normalized).toMatchObject({ width: 10, height: 14 });
  });

  it('detects only fully opaque white textures as semantic solid fills', async () => {
    const white = await generatedAssetBuffer({
      key: 'white', kind: 'generated-solid', hash: 'white', targetUrl: 'db://assets/white.png', scale: 1, importSettingsHash: 'white',
    });
    expect(await isOpaqueWhiteTexture(white!)).toBe(true);
    const transparent = await sharp({
      create: { width: 1, height: 1, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0.5 } },
    }).png().toBuffer();
    const tinted = await sharp({
      create: { width: 1, height: 1, channels: 4, background: { r: 254, g: 255, b: 255, alpha: 1 } },
    }).png().toBuffer();
    expect(await isOpaqueWhiteTexture(transparent)).toBe(false);
    expect(await isOpaqueWhiteTexture(tinted)).toBe(false);
  });

  it('switches a newly imported PNG from Texture to SpriteFrame', async () => {
    const info = { uuid: 'image-uuid', imported: true };
    let meta: any = { importer: 'image', userData: { type: 'texture' }, subMetas: { '6c48a': { importer: 'texture' } } };
    (globalThis as any).Editor = {
      Message: {
        request: vi.fn(async (_channel: string, message: string, ...args: unknown[]) => {
          if (message === 'query-asset-info') return info;
          if (message === 'query-asset-meta') return structuredClone(meta);
          if (message === 'save-asset-meta') {
            meta = JSON.parse(String(args[1]));
            return info;
          }
          if (message === 'reimport-asset') {
            meta.subMetas.f9941 ??= { importer: 'sprite-frame', userData: {} };
            return true;
          }
          throw new Error(`unexpected ${message}`);
        }),
      },
    };
    const transaction = new AssetWriteTransaction();
    await expect(transaction.ensureSpriteFrame('db://assets/figma-ui/a.png')).resolves.toMatchObject(info);
    expect(meta.userData.type).toBe('sprite-frame');
    expect(meta.subMetas.f9941.importer).toBe('sprite-frame');
    await transaction.setNineSlice('db://assets/figma-ui/a.png', {
      key: 'a', kind: 'generated-solid', hash: 'a', targetUrl: 'db://assets/figma-ui/a.png', scale: 1, importSettingsHash: 'a',
      nineSlice: { left: 1, right: 2, top: 3, bottom: 4 },
    });
    expect(meta.subMetas.f9941.userData).toMatchObject({ borderLeft: 1, borderRight: 2, borderTop: 3, borderBottom: 4 });
  });
});
