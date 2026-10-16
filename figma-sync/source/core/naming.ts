const RESERVED = /[\\/:*?"<>|]/g;

export function sanitizeName(name: string, fallback = 'unnamed'): string {
  const normalized = name
    .normalize('NFKC')
    .replace(RESERVED, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_\.]+|[_\.]+$/g, '');
  return normalized || fallback;
}

export function sanitizeNodeName(name: string, fallback = 'Node'): string {
  return name.normalize('NFKC').replace(/[\r\n\t]/g, ' ').trim() || fallback;
}

export function isButtonName(name: string): boolean {
  const normalized = name.trim().toLowerCase().replace(/^\$/, '');
  return normalized.startsWith('btn_') || normalized === 'button' || normalized.startsWith('button/') || normalized.startsWith('button /');
}

export function isSemanticName(name: string): boolean {
  return /^\$?(btn_|lab_|txt_|img_|bg_|node_|sp_|list_|item_template$)/i.test(name.trim());
}

export function mappingKey(fileKey: string, nodeId: string): string {
  return `${fileKey}:${nodeId}`;
}
