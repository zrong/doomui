import type { FigmaNode, LinearLayoutSpec, SyncIssue } from '../types';

export interface CocosLayoutSnapshot {
  enabled: boolean;
  type: 'none' | 'horizontal' | 'vertical' | 'grid';
  resizeMode: 'none' | 'container' | 'children';
  forward: boolean;
  alignCrossAxis: boolean;
  affectedByScale: boolean;
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
  paddingBottom: number;
  spacingX: number;
  spacingY: number;
  children: Array<{
    active: boolean;
    hasUiTransform: boolean;
    fixedSize: boolean;
    scaleX: number;
    scaleY: number;
    rotation: number;
  }>;
}

export interface CocosLayoutConversion {
  layout?: LinearLayoutSpec;
  reason?: string;
}

export interface FigmaLayoutConversion {
  hasAutoLayout: boolean;
  layout?: LinearLayoutSpec;
  issue?: SyncIssue;
}

function finite(value: number | undefined, fallback = 0): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

export function cocosLayoutToFigma(input: CocosLayoutSnapshot): CocosLayoutConversion {
  if (!input.enabled || input.type === 'none') return {};
  if (input.type === 'grid') return { reason: 'Grid 不在双向布局子集内' };
  if (input.resizeMode === 'children') return { reason: 'ResizeMode.CHILDREN 与 Figma Fill 语义不等价' };
  if (!input.forward) return { reason: '反向排列不在双向布局子集内' };
  if (!input.alignCrossAxis) return { reason: '交叉轴必须使用居中对齐' };
  if (input.affectedByScale) return { reason: 'Affected By Scale 不在双向布局子集内' };
  const asymmetricCrossPadding = input.type === 'horizontal'
    ? Math.abs(input.paddingTop - input.paddingBottom) > 1e-6
    : Math.abs(input.paddingLeft - input.paddingRight) > 1e-6;
  if (asymmetricCrossPadding) return { reason: '交叉轴两侧 Padding 必须相等' };
  if (input.resizeMode === 'container' && !input.children.some((child) => child.active)) {
    return { reason: 'CONTAINER 布局至少需要一个启用的直接子节点' };
  }
  const unsupportedChild = input.children.find((child) => (
    child.active
    && (!child.hasUiTransform
      || !child.fixedSize
      || Math.abs(child.scaleX - 1) > 1e-6
      || Math.abs(child.scaleY - 1) > 1e-6
      || Math.abs(child.rotation) > 1e-6)
  ));
  if (unsupportedChild) return { reason: '直接子节点必须有 UITransform、固定尺寸，且不能缩放或旋转' };
  return {
    layout: {
      direction: input.type,
      resizeMode: input.resizeMode,
      paddingLeft: finite(input.paddingLeft),
      paddingRight: finite(input.paddingRight),
      paddingTop: finite(input.paddingTop),
      paddingBottom: finite(input.paddingBottom),
      spacing: finite(input.type === 'horizontal' ? input.spacingX : input.spacingY),
    },
  };
}

function parentSizing(node: FigmaNode, axis: 'primary' | 'counter'): 'FIXED' | 'AUTO' {
  const direct = axis === 'primary' ? node.primaryAxisSizingMode : node.counterAxisSizingMode;
  if (direct) return direct;
  const horizontal = node.layoutMode === 'HORIZONTAL';
  const sizing = axis === 'primary'
    ? (horizontal ? node.layoutSizingHorizontal : node.layoutSizingVertical)
    : (horizontal ? node.layoutSizingVertical : node.layoutSizingHorizontal);
  return sizing === 'HUG' ? 'AUTO' : 'FIXED';
}

function unsupportedAutoLayoutReason(node: FigmaNode): string | undefined {
  if (node.layoutMode === 'GRID') return 'Grid 不在双向布局子集内';
  if (node.layoutMode !== 'HORIZONTAL' && node.layoutMode !== 'VERTICAL') return '只支持横向或纵向 Auto Layout';
  if (node.layoutWrap === 'WRAP') return 'Wrap 不在双向布局子集内';
  if ((node.primaryAxisAlignItems ?? 'MIN') !== 'MIN') return '主轴必须使用起点对齐';
  if ((node.counterAxisAlignItems ?? 'MIN') !== 'CENTER') return '交叉轴必须使用居中对齐';
  if (parentSizing(node, 'counter') !== 'FIXED') return '交叉轴必须使用 Fixed 尺寸';
  const asymmetricCrossPadding = node.layoutMode === 'HORIZONTAL'
    ? Math.abs(finite(node.paddingTop) - finite(node.paddingBottom)) > 1e-6
    : Math.abs(finite(node.paddingLeft) - finite(node.paddingRight)) > 1e-6;
  if (asymmetricCrossPadding) return '交叉轴两侧 Padding 必须相等';
  if (node.itemReverseZIndex) return 'Reverse z-index 不在双向布局子集内';
  if (parentSizing(node, 'primary') === 'AUTO' && !(node.children ?? []).some((child) => child.visible !== false)) {
    return 'Hug 布局至少需要一个可见的直接子节点';
  }
  if (node.strokesIncludedInLayout && (node.strokes ?? []).some((stroke) => stroke.visible !== false)) {
    return '计入布局的 Stroke 无法映射到 cc.Layout';
  }
  const unsupportedChild = (node.children ?? []).find((child) => (
    child.layoutPositioning === 'ABSOLUTE'
    || (child.layoutSizingHorizontal !== undefined && child.layoutSizingHorizontal !== 'FIXED')
    || (child.layoutSizingVertical !== undefined && child.layoutSizingVertical !== 'FIXED')
    || (child.layoutAlign !== undefined && child.layoutAlign !== 'INHERIT')
    || (child.layoutGrow ?? 0) !== 0
    || Math.abs(child.rotation ?? 0) > 1e-6
  ));
  if (unsupportedChild) return `直接子节点 ${unsupportedChild.name} 必须使用 Auto positioning、Fixed sizing 且不能旋转`;
  return undefined;
}

export function figmaAutoLayoutToCocos(node: FigmaNode): FigmaLayoutConversion {
  const hasAutoLayout = node.layoutMode !== undefined && node.layoutMode !== 'NONE';
  if (!hasAutoLayout) return { hasAutoLayout: false };
  const reason = unsupportedAutoLayoutReason(node);
  if (reason) {
    return {
      hasAutoLayout: true,
      issue: {
        severity: 'warning',
        code: 'AUTO_LAYOUT_BAKED',
        nodeId: node.id,
        message: `${node.name} 的 Auto Layout 未生成 cc.Layout：${reason}；已保留最终绝对位置`,
      },
    };
  }
  const direction = node.layoutMode === 'HORIZONTAL' ? 'horizontal' : 'vertical';
  return {
    hasAutoLayout: true,
    layout: {
      direction,
      resizeMode: parentSizing(node, 'primary') === 'AUTO' ? 'container' : 'none',
      paddingLeft: finite(node.paddingLeft),
      paddingRight: finite(node.paddingRight),
      paddingTop: finite(node.paddingTop),
      paddingBottom: finite(node.paddingBottom),
      spacing: finite(node.itemSpacing),
    },
  };
}
