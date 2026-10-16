export type PanelStatusKind = 'info' | 'success' | 'error';

export interface PanelStatusPresentation {
  title: string;
  detail?: string;
  path?: string;
  recovery?: 'sync-from-figma';
}

const MISSING_PREFAB_PREFIX = 'Prefab 不存在或尚未完成导入：';

export function presentPanelStatus(
  message: string,
  kind: PanelStatusKind,
): PanelStatusPresentation {
  if (kind === 'error' && message.startsWith(MISSING_PREFAB_PREFIX)) {
    const path = message.slice(MISSING_PREFAB_PREFIX.length).trim();
    return {
      title: '找不到源 Prefab',
      detail: '“创建 Figma 起点”只能读取当前已存在、且已由 Cocos 完成导入的 Prefab。',
      path: path || undefined,
      recovery: 'sync-from-figma',
    };
  }
  if (kind === 'error' && message.startsWith('这份 Cocos 预览由 Figma Desktop Push 生成')) {
    return {
      title: 'Desktop Push 的 Apply 计划已过期',
      detail: '过期的是 Cocos 中保存的 10 分钟短期计划，不是 Figma 设计节点。请回到 Figma Desktop 的 Cocos Sync，重新推送所选内容，再在这里检查预览并应用。',
    };
  }
  if (kind === 'error' && message.startsWith('当前页面中的 Cocos 预览已不能用于 Apply')) {
    return {
      title: '当前 Cocos 预览已失效',
      detail: '旧计划可能已取消、被新的推送替换，或因插件重载而丢失。请在 Figma Desktop 的 Cocos Sync 中重新推送所选内容。',
    };
  }
  return { title: message };
}
