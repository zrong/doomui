import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getCurrentAdoptionPrefabUrl,
  isAdoptionSourcePrefabUrl,
} from '../source/services/selected-prefab';

describe('selected Cocos adoption Prefab', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).Editor;
  });

  it.each([
    'db://assets/subpackages/game/prefabs/view/UI_Role.prefab',
    'db://assets/subpackages/game/prefabs/item/Item_RoleHead.prefab',
    'db://assets/ui/custom/dialogs/LegacyDialog.prefab',
    'db://assets/subpackages/game/prefabs/view/figma/UI_Role.root.prefab',
  ])('accepts any project Prefab URL: %s', (url) => {
    expect(isAdoptionSourcePrefabUrl(url)).toBe(true);
  });

  it.each([
    'db://assets/subpackages/game/scenes/UI_Role.scene',
    'db://assets/subpackages/game/prefabs/view/../UI_Role.prefab',
    'file:///project/assets/UI_Role.prefab',
  ])('rejects a non-project-Prefab URL: %s', (url) => {
    expect(isAdoptionSourcePrefabUrl(url)).toBe(false);
  });

  it('prefers the Prefab currently open in Scene edit mode over stale AssetDB selection', async () => {
    const currentUrl = 'db://assets/ui/custom/Item_Current.prefab';
    const request = vi.fn(async (channel: string, message: string, value: unknown) => {
      if (channel === 'scene' && message === 'execute-scene-script') return 'current-prefab-uuid';
      if (channel === 'asset-db' && message === 'query-asset-info' && value === 'current-prefab-uuid') {
        return { uuid: 'current-prefab-uuid', url: currentUrl };
      }
      throw new Error(`unexpected request ${channel}:${message}:${String(value)}`);
    });
    (globalThis as any).Editor = {
      Selection: { getSelected: vi.fn(() => ['stale-prefab-uuid']) },
      Message: { request },
    };

    await expect(getCurrentAdoptionPrefabUrl()).resolves.toBe(currentUrl);
    expect(request).toHaveBeenCalledWith('scene', 'execute-scene-script', {
      name: 'figma-sync',
      method: 'queryCurrentPrefabUuid',
      args: [],
    });
    expect(request).not.toHaveBeenCalledWith('asset-db', 'query-asset-info', 'stale-prefab-uuid');
  });

  it('falls back to the only selected AssetDB Prefab outside Prefab edit mode', async () => {
    const selectedUrl = 'db://assets/ui/custom/UI_Selected.prefab';
    const request = vi.fn(async (channel: string, message: string, value: unknown) => {
      if (channel === 'scene' && message === 'execute-scene-script') return undefined;
      if (channel === 'asset-db' && message === 'query-asset-info' && value === 'selected-prefab-uuid') {
        return { uuid: 'selected-prefab-uuid', url: selectedUrl };
      }
      throw new Error(`unexpected request ${channel}:${message}:${String(value)}`);
    });
    (globalThis as any).Editor = {
      Selection: { getSelected: vi.fn(() => ['selected-prefab-uuid']) },
      Message: { request },
    };

    await expect(getCurrentAdoptionPrefabUrl()).resolves.toBe(selectedUrl);
  });

  it('does not guess when selection is empty, multiple, invalid, or not a Prefab', async () => {
    const assetInfo = vi.fn();
    const request = vi.fn(async (channel: string, message: string, value: unknown) => {
      if (channel === 'scene' && message === 'execute-scene-script') return undefined;
      if (channel === 'asset-db' && message === 'query-asset-info') return assetInfo(value);
      throw new Error(`unexpected request ${channel}:${message}:${String(value)}`);
    });
    (globalThis as any).Editor = {
      Selection: { getSelected: vi.fn(() => []) },
      Message: { request },
    };
    await expect(getCurrentAdoptionPrefabUrl()).resolves.toBeUndefined();

    (globalThis as any).Editor.Selection.getSelected.mockReturnValue(['one', 'two']);
    await expect(getCurrentAdoptionPrefabUrl()).resolves.toBeUndefined();
    expect(assetInfo).not.toHaveBeenCalled();

    (globalThis as any).Editor.Selection.getSelected.mockReturnValue(['visual']);
    assetInfo.mockResolvedValue({
      url: 'db://assets/subpackages/game/scenes/Hall.scene',
    });
    await expect(getCurrentAdoptionPrefabUrl()).resolves.toBeUndefined();

    assetInfo.mockResolvedValue({
      invalid: true,
      url: 'db://assets/subpackages/game/prefabs/item/Item.prefab',
    });
    await expect(getCurrentAdoptionPrefabUrl()).resolves.toBeUndefined();
  });
});
