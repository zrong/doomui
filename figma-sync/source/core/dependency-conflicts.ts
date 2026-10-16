import type {
  AssetTask,
  ComponentPrefabPlan,
  FrameMapping,
  SyncIssue,
} from '../types';

export function collectDependencyConflicts(
  assets: AssetTask[],
  componentPlans: ComponentPrefabPlan[],
  frames: Record<string, FrameMapping>,
  currentFrameKey: string,
  reservedPrefabUrls: string[] = [],
): SyncIssue[] {
  const issues = new Map<string, SyncIssue>();
  const add = (issue: SyncIssue): void => {
    issues.set(`${issue.code}:${issue.path ?? ''}`, issue);
  };

  const currentAssetsByUrl = new Map<string, AssetTask>();
  for (const task of assets) {
    const previous = currentAssetsByUrl.get(task.targetUrl);
    if (previous && previous.importSettingsHash !== task.importSettingsHash) {
      add({
        severity: 'blocker',
        code: 'TEXTURE_IMPORT_SETTINGS_CONFLICT',
        path: task.targetUrl,
        message: `同一图片在当前 Frame 中使用了不同的九宫格导入设置：${task.targetUrl}`,
      });
    } else {
      currentAssetsByUrl.set(task.targetUrl, task);
    }
  }

  const componentPlansByUrl = new Map<string, ComponentPrefabPlan[]>();
  for (const plan of componentPlans) {
    const plans = componentPlansByUrl.get(plan.url) ?? [];
    plans.push(plan);
    componentPlansByUrl.set(plan.url, plans);
  }
  for (const [url, plans] of componentPlansByUrl) {
    if (new Set(plans.map((plan) => plan.key)).size > 1) {
      add({
        severity: 'blocker',
        code: 'COMPONENT_NAME_COLLISION',
        path: url,
        message: `多个 Figma Component 会生成同一 Prefab 路径；请为 Component 使用唯一名称：${url}`,
      });
    }
    if (reservedPrefabUrls.includes(url) || Object.values(frames).some((frame) => frame.visualPrefabUrl === url)) {
      add({
        severity: 'blocker',
        code: 'COMPONENT_NAME_COLLISION',
        path: url,
        message: `Component 名称与 UI Frame 名冲突；请为 Component 使用唯一名称：${url}`,
      });
    }
  }

  const currentComponentsByUrl = new Map(componentPlans.map((plan) => [plan.url, plan]));
  for (const [frameKey, frame] of Object.entries(frames)) {
    if (frameKey === currentFrameKey) continue;
    for (const [otherKey, identity] of Object.entries(frame.assets)) {
      const currentTexture = currentAssetsByUrl.get(identity.url);
      if (currentTexture && identity.importSettingsHash !== currentTexture.importSettingsHash) {
        add({
          severity: 'blocker',
          code: 'TEXTURE_IMPORT_SETTINGS_CONFLICT',
          path: identity.url,
          message: `同一图片已被其他 Frame 以不同九宫格设置使用；请统一设置后再同步：${identity.url}`,
        });
      }
      const currentComponent = currentComponentsByUrl.get(identity.url);
      if (currentComponent && currentComponent.key !== otherKey) {
        add({
          severity: 'blocker',
          code: 'COMPONENT_NAME_COLLISION',
          path: identity.url,
          message: `Component 名称与其他 Frame 的不同组件冲突；请使用唯一名称：${identity.url}`,
        });
      }
    }
  }
  return [...issues.values()];
}
