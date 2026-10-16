interface SelectedAssetInfo {
  url?: string;
  invalid?: boolean;
}

export function isAdoptionSourcePrefabUrl(value: string | undefined): value is string {
  if (!value?.startsWith('db://assets/') || value.split('/').some((part) => part === '.' || part === '..')) {
    return false;
  }
  return value.endsWith('.prefab');
}

async function resolveAssetUrl(uuid: string): Promise<string | undefined> {
  const info = await Editor.Message.request(
    'asset-db',
    'query-asset-info',
    uuid,
  ) as SelectedAssetInfo | null;
  if (!info || info.invalid || !isAdoptionSourcePrefabUrl(info.url)) return undefined;
  return info.url;
}

/**
 * Resolve one unambiguous AssetDB selection without guessing from scene nodes
 * or stale paths. Invalid selections deliberately return undefined so the
 * panel can preserve a URL the user entered manually.
 */
export async function getCurrentAdoptionPrefabUrl(): Promise<string | undefined> {
  try {
    const currentPrefabUuid = await Editor.Message.request(
      'scene',
      'execute-scene-script',
      { name: 'figma-sync', method: 'queryCurrentPrefabUuid', args: [] },
    ) as string | undefined;
    if (currentPrefabUuid) {
      const currentPrefabUrl = await resolveAssetUrl(currentPrefabUuid);
      if (currentPrefabUrl) return currentPrefabUrl;
    }
  } catch {
    // The Scene process may still be loading. Asset selection remains a safe,
    // unambiguous fallback and scene:ready will retry once loading completes.
  }

  const selected = Editor.Selection.getSelected('asset');
  if (selected.length !== 1) return undefined;
  return resolveAssetUrl(selected[0]);
}
