import type { FigmaNode, NormalizedNode, SyncIssue } from '../types';
import { shortHash } from './hash';
import { stripNineSliceMarker } from './nine-slice';

const LEGACY_ITEM_TEMPLATE_NAME = '$item_template';

export interface LegacyItemTemplateAnalysis {
  issues: SyncIssue[];
  runtimeRoot: NormalizedNode;
}

function withoutNodes(node: NormalizedNode, omittedIds: Set<string>): NormalizedNode {
  const children = node.children
    .filter((child) => !omittedIds.has(child.id))
    .map((child) => withoutNodes(child, omittedIds));
  const draft = { ...node, children, hash: undefined };
  return {
    ...node,
    children,
    hash: shortHash({ ...draft, fileId: undefined }, 20),
  };
}

/**
 * `$item_template` was the old UI -> Item association marker. Item Prefabs are
 * now generated from standalone Figma Components, while Cocos owns the
 * ListExtent.tmpPrefab relation. Keep omitting legacy samples so upgrading a
 * design does not accidentally serialize a static list item into the UI.
 */
export function stripLegacyItemTemplates(
  document: FigmaNode,
  normalizedRoot: NormalizedNode,
): LegacyItemTemplateAnalysis {
  const omittedIds = new Set<string>();
  const issues: SyncIssue[] = [];
  const visit = (node: FigmaNode): void => {
    if (stripNineSliceMarker(node.name.trim()) === LEGACY_ITEM_TEMPLATE_NAME) {
      omittedIds.add(node.id);
      issues.push({
        severity: 'warning',
        code: 'ITEM_TEMPLATE_DEPRECATED',
        nodeId: node.id,
        message: '$item_template 已弃用并从运行时 UI 中移除；请删除该样例，Item 现在由 Page 直属 Component 独立生成',
      });
      return;
    }
    node.children?.forEach(visit);
  };
  document.children?.forEach(visit);
  return {
    issues,
    runtimeRoot: omittedIds.size ? withoutNodes(normalizedRoot, omittedIds) : normalizedRoot,
  };
}
