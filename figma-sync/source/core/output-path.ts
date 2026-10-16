import type {
  FrameMapping,
  ResolvedOutputPaths,
  SyncIssue,
  SyncRequest,
} from '../types';
import { sanitizeName } from './naming';

export function normalizeBundleRoot(input: string): string {
  const normalized = input.trim().replace(/\/$/, '');
  if (!normalized.startsWith('db://assets/')) throw new Error('Asset Bundle 根目录必须位于 db://assets/');
  const relative = normalized.slice('db://assets/'.length);
  const segments = relative.split('/');
  if (!relative || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Asset Bundle 根目录不能包含空路径、. 或 ..');
  }
  if (/[\\?#]/.test(relative)) throw new Error('Asset Bundle 根目录不能包含反斜杠、查询参数或片段');
  return normalized;
}

export function normalizeSyncRequest(request: SyncRequest): SyncRequest {
  if (!request.bundleRoot?.trim()) throw new Error('必须填写 Asset Bundle 根目录');
  return { ...request, bundleRoot: normalizeBundleRoot(request.bundleRoot) };
}

export function resolveOutputPaths(
  request: Pick<SyncRequest, 'bundleRoot'>,
  frameName: string,
): ResolvedOutputPaths {
  const root = normalizeBundleRoot(request.bundleRoot);
  const safeName = sanitizeName(frameName, 'frame');
  return {
    root,
    logicPrefabUrl: `${root}/prefabs/view/${safeName}.prefab`,
    visualPrefabUrl: `${root}/prefabs/view/figma/${safeName}.root.prefab`,
    itemVisualRoot: `${root}/prefabs/item/figma`,
    itemRoot: `${root}/prefabs/item`,
    textureRoot: `${root}/textures/figma`,
  };
}

export function mappingBundleIssues(mapping: FrameMapping | undefined, currentRoot: string): SyncIssue[] {
  if (!mapping || mapping.bundleRoot === currentRoot) return [];
  return [{
    severity: 'blocker',
    code: 'BUNDLE_ROOT_LOCKED',
    message: `该目标首次同步到 ${mapping.bundleRoot}；后续不能迁移 Asset Bundle 根目录`,
  }];
}
