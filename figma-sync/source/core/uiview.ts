import type {
  BindingComponentKind,
  BindingContractEntry,
  FigmaNode,
  FrameMapping,
  NormalizedNode,
  SyncIssue,
} from '../types';
import { stripNineSliceMarker } from './nine-slice';

const SUPPORTED_BINDING = /^\$(node|btn|txt|sp|list)_([A-Za-z0-9_]+)$/;
const ANY_BINDING = /^\$([^_]+)_/;
const VIEW_NAME = /^UI_[A-Za-z0-9_]+$/;

interface ContractResult {
  bindings: BindingContractEntry[];
  issues: SyncIssue[];
  requiresConfirmation: boolean;
}

function normalizedById(root: NormalizedNode): Map<string, { node: NormalizedNode; path: string }> {
  const result = new Map<string, { node: NormalizedNode; path: string }>();
  const visit = (node: NormalizedNode, path: string): void => {
    result.set(node.id, { node, path });
    node.children.forEach((child) => visit(child, `${path}/${child.name}`));
  };
  visit(root, 'root');
  return result;
}

function expectedComponent(prefix: string): BindingComponentKind {
  return ({ node: 'Node', btn: 'Button', txt: 'Label', sp: 'Sprite', list: 'ListExtent' } as const)[prefix as 'node' | 'btn' | 'txt' | 'sp' | 'list'];
}

function componentMatches(node: NormalizedNode, expected: BindingComponentKind): boolean {
  if (expected === 'Node' || expected === 'ListExtent') return true;
  if (expected === 'Button') return Boolean(node.button);
  if (expected === 'Label') return Boolean(node.label);
  return Boolean(node.sprite);
}

function bindingDiff(
  previous: BindingContractEntry[],
  current: BindingContractEntry[],
  mapping: FrameMapping | undefined,
  normalizedNodes: Map<string, { node: NormalizedNode; path: string }>,
): { issues: SyncIssue[]; requiresConfirmation: boolean } {
  const issues: SyncIssue[] = [];
  let requiresConfirmation = false;
  const previousStableFileIds = new Set(
    previous
      .map((entry) => mapping?.nodes[entry.nodeId]?.fileId)
      .filter((fileId): fileId is string => Boolean(fileId)),
  );
  const previousIdentity = (entry: BindingContractEntry): string => (
    mapping?.nodes[entry.nodeId]?.fileId
      ? `file:${mapping.nodes[entry.nodeId].fileId}`
      : `node:${entry.nodeId}`
  );
  const currentIdentity = (entry: BindingContractEntry): string => {
    const fileId = normalizedNodes.get(entry.nodeId)?.node.fileId;
    return fileId && previousStableFileIds.has(fileId)
      ? `file:${fileId}`
      : `node:${entry.nodeId}`;
  };
  const currentByIdentity = new Map(current.map((entry) => [currentIdentity(entry), entry]));
  const previousIdentities = new Set(previous.map(previousIdentity));
  for (const old of previous) {
    const next = currentByIdentity.get(previousIdentity(old));
    if (!next) {
      requiresConfirmation = true;
      issues.push({ severity: 'warning', code: 'UIVIEW_BINDING_REMOVED', nodeId: old.nodeId, path: old.path, message: `绑定 ${old.property} 已删除；现有业务 getter 将失效` });
      continue;
    }
    if (old.property !== next.property) {
      requiresConfirmation = true;
      issues.push({ severity: 'warning', code: 'UIVIEW_BINDING_RENAMED', nodeId: old.nodeId, path: next.path, message: `绑定已改名：${old.property} → ${next.property}` });
    }
    if (old.component !== next.component) {
      requiresConfirmation = true;
      issues.push({ severity: 'warning', code: 'UIVIEW_BINDING_TYPE_CHANGED', nodeId: old.nodeId, path: next.path, message: `绑定 ${next.property} 类型已改变：${old.component} → ${next.component}` });
    }
    if (old.path !== next.path) {
      requiresConfirmation = true;
      issues.push({ severity: 'warning', code: 'UIVIEW_BINDING_PATH_CHANGED', nodeId: old.nodeId, path: next.path, message: `绑定 ${next.property} 路径已改变：${old.path} → ${next.path}` });
    }
  }
  if (previous.length) {
    for (const entry of current) {
      if (!previousIdentities.has(currentIdentity(entry))) {
        issues.push({ severity: 'warning', code: 'UIVIEW_BINDING_ADDED', nodeId: entry.nodeId, path: entry.path, message: `新增绑定 ${entry.property}（${entry.component}）` });
      }
    }
  }
  return { issues, requiresConfirmation };
}

export function validateUIView(
  document: FigmaNode,
  normalized: NormalizedNode,
  mapping?: FrameMapping,
): ContractResult {
  const issues: SyncIssue[] = [];
  if (!VIEW_NAME.test(document.name.trim())) {
    issues.push({ severity: 'blocker', code: 'UIVIEW_NAME_INVALID', nodeId: document.id, message: '顶层 Frame 名必须匹配 UI_[A-Za-z0-9_]+' });
  }
  if (mapping && mapping.frameName !== document.name) {
    issues.push({ severity: 'blocker', code: 'UIVIEW_NAME_LOCKED', nodeId: document.id, message: `该 Frame 首次同步名为 ${mapping.frameName}；不能在后续同步中改名` });
  }
  const nestedRoot = document.children?.find((child) => child.name.trim() === 'root');
  if (nestedRoot) {
    issues.push({ severity: 'blocker', code: 'UIVIEW_NESTED_ROOT', nodeId: nestedRoot.id, message: '顶层 Frame 会被挂载为 root，内部不能再包含名为 root 的直接子节点' });
  }

  const normalizedNodes = normalizedById(normalized);
  const bindings: BindingContractEntry[] = [];
  const properties = new Map<string, string>();
  const visit = (node: FigmaNode): void => {
    const rawName = node.name.trim();
    const name = stripNineSliceMarker(rawName);
    if (name === '$item_template') return;
    if (name.startsWith('$')) {
      const match = name.match(SUPPORTED_BINDING);
      if (!match) {
        const prefix = name.match(ANY_BINDING)?.[1] ?? name;
        issues.push({ severity: 'blocker', code: 'UIVIEW_BINDING_PREFIX_UNSUPPORTED', nodeId: node.id, message: `不支持绑定前缀 ${prefix}：${rawName}；支持 $node_/$btn_/$txt_/$sp_/$list_` });
      } else {
        const property = name.slice(1);
        const duplicate = properties.get(property);
        if (duplicate) {
          issues.push({ severity: 'blocker', code: 'UIVIEW_BINDING_DUPLICATE', nodeId: node.id, message: `绑定属性 ${property} 重复（${duplicate}、${node.id}）` });
        } else {
          properties.set(property, node.id);
        }
        const normalizedEntry = normalizedNodes.get(node.id);
        const component = expectedComponent(match[1]);
        if (!normalizedEntry || !componentMatches(normalizedEntry.node, component)) {
          issues.push({ severity: 'blocker', code: 'UIVIEW_BINDING_COMPONENT_MISMATCH', nodeId: node.id, message: `${rawName} 必须生成 ${component} 组件` });
        } else {
          bindings.push({ nodeId: node.id, property, path: normalizedEntry.path, component });
        }
      }
    }
    node.children?.forEach(visit);
  };
  document.children?.forEach(visit);
  bindings.sort((left, right) => left.property.localeCompare(right.property));
  const diff = bindingDiff(mapping?.bindings ?? [], bindings, mapping, normalizedNodes);
  return { bindings, issues: [...issues, ...diff.issues], requiresConfirmation: diff.requiresConfirmation };
}
