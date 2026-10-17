import { LOCAL_FILE_ID_KEY } from './protocol';

interface FileIdentityHost {
  readonly fileKey?: string;
  readonly root: {
    readonly name: string;
    getPluginData(key: string): string;
    setPluginData(key: string, value: string): void;
  };
}

/** Keep the existing file identity key usable without private-plugin access. */
export function resolveSourceFileKey(host: FileIdentityHost): string {
  try {
    if (host.fileKey) return host.fileKey;
  } catch {
    // Community plugins cannot rely on the private fileKey getter.
  }
  const existing = host.root.getPluginData(LOCAL_FILE_ID_KEY);
  if (existing) return `local-${existing}`;
  const generated = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  try {
    host.root.setPluginData(LOCAL_FILE_ID_KEY, generated);
  } catch {
    return `local-name-${host.root.name}`;
  }
  return `local-${generated}`;
}

export function resolveSourceUrl(fileKey: string, fileName: string, nodeId: string): string | undefined {
  if (fileKey.startsWith('local-') || !/^[A-Za-z0-9_-]+$/.test(fileKey)) return undefined;
  return `https://www.figma.com/design/${fileKey}/${encodeURIComponent(fileName)}?node-id=${nodeId.replace(/:/g, '-')}`;
}
