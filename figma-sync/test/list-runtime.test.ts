import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateItemPrefabs, validateListRuntime } from '../source/services/sync-service';
import type { BindingContractEntry, ItemPrefabBinding } from '../source/types';

const listBinding: BindingContractEntry = {
  nodeId: 'list-node',
  property: 'list_HeadScrollView',
  path: 'root/panel/$list_HeadScrollView',
  component: 'ListExtent',
};

const itemBinding: ItemPrefabBinding = {
  componentKey: 'component:item-role-head',
  componentName: 'item_RoleHead',
  itemVisualPrefabUrl: 'db://assets/hall/prefabs/item/figma/item_RoleHead.root.prefab',
  itemLogicPrefabUrl: 'db://assets/hall/prefabs/item/item_RoleHead.prefab',
};

describe('manual $list_ and standalone Item runtime inspection', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).Editor;
  });

  function install(options: { hasListExtent?: boolean; nestedVisualPrefabUuid?: string } = {}) {
    const { hasListExtent = true, nestedVisualPrefabUuid = 'item-visual-uuid' } = options;
    (globalThis as any).Editor = {
      Message: {
        request: vi.fn(async (channel: string, message: string, value: any) => {
          if (channel === 'asset-db' && message === 'query-asset-info') {
            if (value === itemBinding.itemLogicPrefabUrl) return { uuid: 'item-logic-uuid' };
            if (value === itemBinding.itemVisualPrefabUrl) return { uuid: 'item-visual-uuid' };
            if (value === 'db://assets/hall/prefabs/view/UI_Role.prefab') return { uuid: 'view-logic-uuid' };
            return null;
          }
          if (channel === 'scene' && message === 'execute-scene-script') {
            const uuid = value.args[0].logicPrefabUuid;
            if (uuid === 'item-logic-uuid') return { nestedVisualPrefabUuid, nodes: [] };
            if (uuid === 'view-logic-uuid') {
              return {
                nodes: [{
                  path: listBinding.path,
                  components: hasListExtent ? [{ className: 'ListExtent', prefabProperties: {} }] : [],
                }],
              };
            }
          }
          throw new Error(`unexpected ${channel}:${message}`);
        }),
      },
    };
  }

  it('accepts a programmer-mounted ListExtent without inferring its Item Prefab', async () => {
    install();
    await expect(validateListRuntime(
      [listBinding],
      'db://assets/hall/prefabs/view/UI_Role.prefab',
    )).resolves.toEqual([]);
  });

  it('warns instead of blocking when the programmer has not mounted ListExtent yet', async () => {
    install({ hasListExtent: false });
    await expect(validateListRuntime(
      [listBinding],
      'db://assets/hall/prefabs/view/UI_Role.prefab',
    )).resolves.toContainEqual(expect.objectContaining({
      severity: 'warning',
      code: 'LIST_EXTENT_MISSING',
    }));
  });

  it('validates the standalone Item logic wrapper independently of every list', async () => {
    install({ nestedVisualPrefabUuid: 'other-visual-uuid' });
    await expect(validateItemPrefabs([itemBinding])).resolves.toContainEqual(expect.objectContaining({
      severity: 'blocker',
      code: 'ITEM_LOGIC_WRAPPER_MISMATCH',
    }));
  });
});
