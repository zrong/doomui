import { describe, expect, it } from 'vitest';
import { presentPanelStatus } from '../source/core/panel-status';

describe('panel status presentation', () => {
  it('extracts a missing Prefab path and exposes the Figma recovery route', () => {
    expect(presentPanelStatus(
      'Prefab 不存在或尚未完成导入：db://assets/subpackages/subgame_doomui/prefabs/view/UI_TreasureGame.prefab',
      'error',
    )).toEqual({
      title: '找不到源 Prefab',
      detail: '“创建 Figma 起点”只能读取当前已存在、且已由 Cocos 完成导入的 Prefab。',
      path: 'db://assets/subpackages/subgame_doomui/prefabs/view/UI_TreasureGame.prefab',
      recovery: 'sync-from-figma',
    });
  });

  it('keeps ordinary messages unchanged', () => {
    expect(presentPanelStatus('同步完成', 'success')).toEqual({ title: '同步完成' });
  });

  it('explains that Desktop Push expiry belongs to the Cocos Apply plan', () => {
    expect(presentPanelStatus(
      '这份 Cocos 预览由 Figma Desktop Push 生成，已超过 10 分钟，不能继续 Apply。请回到 Figma Desktop 的 Cocos Sync，重新推送所选内容，再在 Cocos 中检查预览并应用。',
      'error',
    )).toEqual({
      title: 'Desktop Push 的 Apply 计划已过期',
      detail: '过期的是 Cocos 中保存的 10 分钟短期计划，不是 Figma 设计节点。请回到 Figma Desktop 的 Cocos Sync，重新推送所选内容，再在这里检查预览并应用。',
    });
  });

  it('explains the Desktop Push replaced-plan recovery route', () => {
    expect(presentPanelStatus(
      '当前页面中的 Cocos 预览已不能用于 Apply：计划可能已取消。',
      'error',
    )).toMatchObject({
      title: '当前 Cocos 预览已失效',
      detail: expect.stringContaining('Figma Desktop 的 Cocos Sync 中重新推送所选内容'),
    });
  });
});
