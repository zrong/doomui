import type { AssetTask, FrameMapping, NormalizeResult, SyncChange } from '../types';

function flattenNodes(root: NormalizeResult['root']): Map<string, NormalizeResult['root']> {
  const result = new Map<string, NormalizeResult['root']>();
  const visit = (node: NormalizeResult['root']): void => {
    result.set(node.id, node);
    node.children.forEach(visit);
  };
  visit(root);
  return result;
}

export function diffNormalized(result: NormalizeResult, mapping: FrameMapping | undefined): { changes: SyncChange[]; orphans: string[] } {
  const changes: SyncChange[] = [];
  const nodes = flattenNodes(result.root);
  const previous = mapping?.nodes ?? {};
  const previousByFileId = new Map(Object.entries(previous).map(([id, node]) => [node.fileId, { id, node }]));
  const matchedPreviousNodeIds = new Set<string>();
  for (const [id, node] of nodes) {
    const matched = previous[id]
      ? { id, node: previous[id] }
      : previousByFileId.get(node.fileId);
    const old = matched?.node;
    if (matched) matchedPreviousNodeIds.add(matched.id);
    changes.push({
      key: `node:${id}`,
      kind: !old ? 'add' : old.hash === node.hash ? 'unchanged' : 'update',
      path: node.name,
      detail: !old ? `${node.sourceType} 节点` : old.hash === node.hash ? '结构与属性未变化' : `${old.kind} → ${node.kind}`,
      nodeId: id,
    });
  }
  for (const [id, old] of Object.entries(previous)) {
    if (!matchedPreviousNodeIds.has(id)) {
      changes.push({ key: `node:${id}`, kind: 'delete', path: old.name, detail: `删除 ${old.kind}`, nodeId: id });
    }
  }

  const previousAssets = mapping?.assets ?? {};
  const previousAssetsByUrl = new Map(Object.entries(previousAssets).map(([key, asset]) => [asset.url, { key, asset }]));
  const matchedPreviousAssetKeys = new Set<string>();
  for (const asset of result.assets) {
    const effectiveUrl = asset.sharedSource?.sourceUrl ?? asset.targetUrl;
    const matched = previousAssets[asset.key]
      ? { key: asset.key, asset: previousAssets[asset.key] }
      : previousAssetsByUrl.get(effectiveUrl);
    const old = matched?.asset;
    if (matched) matchedPreviousAssetKeys.add(matched.key);
    const unchanged = Boolean(old
      && old.url === effectiveUrl
      && old.hash === asset.hash
      && old.importSettingsHash === asset.importSettingsHash);
    changes.push({
      key: `asset:${asset.key}`,
      kind: asset.sharedSource ? 'reuse' : !old ? 'add' : unchanged ? 'unchanged' : 'update',
      path: effectiveUrl,
      detail: asset.sharedSource
        ? '共享 SpriteFrame（直接引用，不复制、不纳入插件所有权）'
        : `${asset.kind} 资源`,
      nodeId: asset.nodeId,
    });
  }
  const orphans = Object.entries(previousAssets)
    .filter(([key, value]) => (
      !key.startsWith('component:')
      && value.ownership !== 'shared'
      && !matchedPreviousAssetKeys.has(key)
    ))
    .map(([, value]) => value.url);
  for (const orphan of orphans) {
    changes.push({ key: `orphan:${orphan}`, kind: 'delete', path: orphan, detail: '仅标记 orphan，不自动删除' });
  }
  return { changes, orphans };
}

export function collectNodeMapping(result: NormalizeResult): FrameMapping['nodes'] {
  const output: FrameMapping['nodes'] = {};
  const visit = (node: NormalizeResult['root']): void => {
    output[node.id] = { fileId: node.fileId, hash: node.hash, kind: node.kind, name: node.name };
    node.children.forEach(visit);
  };
  visit(result.root);
  return output;
}

export function mapAssetTasks(tasks: AssetTask[], uuids: Record<string, { uuid?: string }>): FrameMapping['assets'] {
  return Object.fromEntries(tasks.map((task) => [task.key, {
    url: task.sharedSource?.sourceUrl ?? task.targetUrl,
    hash: task.hash,
    uuid: task.sharedSource?.sourceImageUuid ?? uuids[task.key]?.uuid,
    sourceNodeId: task.nodeId,
    importSettingsHash: task.importSettingsHash,
    ownership: task.sharedSource ? 'shared' : 'generated',
    spriteFrameUuid: task.sharedSource?.sourceSpriteFrameUuid,
  }]));
}
