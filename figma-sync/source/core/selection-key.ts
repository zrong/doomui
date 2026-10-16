export function stableSelectionKey(uuids: readonly string[]): string {
  return [...new Set(uuids)].sort().join('\n');
}
