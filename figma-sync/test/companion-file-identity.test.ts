import { describe, expect, it } from 'vitest';
import { resolveSourceFileKey, resolveSourceUrl } from '../../cocos-sync/src/file-identity';
import { LOCAL_FILE_ID_KEY } from '../../cocos-sync/src/protocol';

function documentStore() {
  const data = new Map<string, string>();
  return {
    data,
    root: {
      name: 'Example design',
      getPluginData: (key: string) => data.get(key) ?? '',
      setPluginData: (key: string, value: string) => { data.set(key, value); },
    },
  };
}

describe('Community plugin file identity', () => {
  it('keeps an existing persisted local identity across runs and file renames', () => {
    const store = documentStore();
    store.data.set(LOCAL_FILE_ID_KEY, 'persisted-file');
    expect(resolveSourceFileKey(store)).toBe('local-persisted-file');
    store.root.name = 'Renamed design';
    expect(resolveSourceFileKey(store)).toBe('local-persisted-file');
  });

  it('persists one identity when the private getter throws', () => {
    const store = documentStore();
    const host = { ...store, get fileKey(): string { throw new Error('Private plugin API unavailable'); } };
    const first = resolveSourceFileKey(host);
    expect(first).toMatch(/^local-.+/);
    expect(store.data.get(LOCAL_FILE_ID_KEY)).toBe(first.slice('local-'.length));
    expect(resolveSourceFileKey(host)).toBe(first);
  });

  it('supports a host without the private API and preserves existing private-plugin keys', () => {
    const store = documentStore();
    expect(resolveSourceFileKey(store)).toMatch(/^local-.+/);
    expect(resolveSourceFileKey({ ...store, fileKey: 'example-file' })).toBe('example-file');
  });

  it('omits a design link for local identifiers and encodes real file links', () => {
    expect(resolveSourceUrl('local-persisted-file', 'Example design', '1:2')).toBeUndefined();
    expect(resolveSourceUrl('example-file', 'Example design', '1:2')).toBe('https://www.figma.com/design/example-file/Example%20design?node-id=1-2');
    expect(resolveSourceUrl('invalid/key', 'Example design', '1:2')).toBeUndefined();
  });
});
