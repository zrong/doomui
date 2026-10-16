import { createHash } from 'crypto';

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function shortHash(value: unknown, length = 12): string {
  return sha256(typeof value === 'string' ? value : stableStringify(value)).slice(0, length);
}

export function stableFileId(figmaId: string): string {
  // Compatibility contract: changing this legacy salt would invalidate every
  // existing Figma node ID -> Cocos file ID mapping after the package rename.
  return createHash('sha256').update(`figma-ui-sync:${figmaId}`).digest('base64url').slice(0, 22);
}
