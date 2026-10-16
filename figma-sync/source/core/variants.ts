import type { ButtonSpec, ButtonTransition, NormalizedNode, RGBA, SyncIssue } from '../types';
import { shortHash } from './hash';
import { isButtonName } from './naming';

export type ButtonState = 'normal' | 'hover' | 'pressed' | 'disabled';

const STATE_ALIASES: Record<string, ButtonState> = {
  default: 'normal',
  normal: 'normal',
  hover: 'hover',
  pressed: 'pressed',
  down: 'pressed',
  disabled: 'disabled',
};

export interface VariantGroup {
  key: string;
  properties: Record<string, string | boolean>;
  states: Partial<Record<ButtonState, NormalizedNode>>;
  issues: SyncIssue[];
}

function findStateProperty(properties: Record<string, string | boolean> | undefined): [string, string] | undefined {
  if (!properties) return undefined;
  const entry = Object.entries(properties).find(([key]) => key.trim().toLowerCase() === 'state');
  return entry ? [entry[0], String(entry[1])] : undefined;
}

function nonStateKey(properties: Record<string, string | boolean> | undefined): string {
  return Object.entries(properties ?? {})
    .filter(([key]) => key.trim().toLowerCase() !== 'state')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(',') || 'default';
}

export function groupButtonVariants(componentSet: NormalizedNode): VariantGroup[] {
  if (!isButtonName(componentSet.name)) return [];
  const groups = new Map<string, VariantGroup>();
  for (const variant of componentSet.children) {
    const stateProperty = findStateProperty(variant.variantProperties);
    const key = nonStateKey(variant.variantProperties);
    const group = groups.get(key) ?? { key, properties: {}, states: {}, issues: [] };
    group.properties = Object.fromEntries(Object.entries(variant.variantProperties ?? {}).filter(([name]) => name.toLowerCase() !== 'state'));
    if (!stateProperty) {
      group.issues.push({ severity: 'blocker', code: 'BUTTON_STATE_MISSING', nodeId: variant.id, message: `${variant.name} 缺少 State Variant 属性` });
    } else {
      const state = STATE_ALIASES[stateProperty[1].trim().toLowerCase()];
      if (!state) {
        group.issues.push({ severity: 'warning', code: 'BUTTON_STATE_UNKNOWN', nodeId: variant.id, message: `无法识别 Button State=${stateProperty[1]}` });
      } else if (group.states[state]) {
        group.issues.push({ severity: state === 'normal' ? 'blocker' : 'warning', code: 'BUTTON_STATE_DUPLICATE', nodeId: variant.id, message: `Button 状态 ${state} 重复` });
      } else {
        group.states[state] = variant;
      }
    }
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (!group.states.normal) {
      group.issues.push({ severity: 'blocker', code: 'BUTTON_NORMAL_MISSING', message: `Variant 组合 ${group.key} 缺少 Default/Normal` });
    } else {
      const missing = (['hover', 'pressed', 'disabled'] as ButtonState[]).filter((state) => !group.states[state]);
      if (missing.length) {
        group.issues.push({ severity: 'warning', code: 'BUTTON_STATE_FALLBACK', message: `Variant 组合 ${group.key} 缺少 ${missing.join('/')}，这些状态将显式回退到 Normal` });
      }
    }
  }
  return [...groups.values()];
}

interface TransitionTarget {
  node: NormalizedNode;
  path: number[];
}

function findTransitionTarget(root: NormalizedNode): TransitionTarget | undefined {
  if (root.sprite) return { node: root, path: [] };
  const candidates: TransitionTarget[] = [];
  const visit = (node: NormalizedNode, path: number[]): void => {
    if (node.sprite && ['bg', 'background'].includes(node.name.toLowerCase())) candidates.push({ node, path });
    node.children.forEach((child, index) => visit(child, [...path, index]));
  };
  root.children.forEach((child, index) => visit(child, [index]));
  return candidates.length === 1 ? candidates[0] : undefined;
}

function nodeAtPath(root: NormalizedNode, path: number[]): NormalizedNode | undefined {
  return path.reduce<NormalizedNode | undefined>((node, index) => node?.children[index], root);
}

function shapeWithoutTransition(root: NormalizedNode, targetPath: number[], ignoreRootSize = false): unknown {
  const visit = (node: NormalizedNode, path: number[], isRoot: boolean): unknown => ({
    name: isRoot ? undefined : node.name,
    kind: node.kind,
    x: isRoot ? undefined : node.x,
    y: isRoot ? undefined : node.y,
    width: isRoot && ignoreRootSize ? undefined : node.width,
    height: isRoot && ignoreRootSize ? undefined : node.height,
    rotation: node.rotation,
    visible: node.visible,
    opacity: node.opacity,
    label: node.label,
    sprite: sameJson(path, targetPath) ? undefined : node.sprite,
    children: node.children.map((child, index) => visit(child, [...path, index], false)),
  });
  return visit(root, [], true);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function inferButtonSpec(group: VariantGroup): { spec?: ButtonSpec; issues: SyncIssue[] } {
  const issues = [...group.issues];
  const normal = group.states.normal;
  if (!normal || issues.some((issue) => issue.severity === 'blocker')) return { issues };
  const target = findTransitionTarget(normal);
  if (!target) {
    issues.push({ severity: 'warning', code: 'BUTTON_TARGET_AMBIGUOUS', nodeId: normal.id, message: `${normal.name} 无法唯一确定 Button Transition target` });
    return { spec: { transition: 'none' }, issues };
  }
  const states: Record<ButtonState, NormalizedNode> = {
    normal,
    hover: group.states.hover ?? normal,
    pressed: group.states.pressed ?? normal,
    disabled: group.states.disabled ?? normal,
  };
  const targets = Object.fromEntries(Object.entries(states).map(([state, root]) => [state, nodeAtPath(root, target.path)])) as Record<ButtonState, NormalizedNode | undefined>;
  if (Object.values(targets).some((item) => !item?.sprite)) {
    issues.push({ severity: 'warning', code: 'BUTTON_TARGET_INCONSISTENT', message: `Variant 组合 ${group.key} 的 Transition target 结构不一致` });
    return { spec: { transition: 'none', targetFigmaId: target.node.id }, issues };
  }
  const sameShapes = Object.values(states).every((root) => sameJson(
    shapeWithoutTransition(normal, target.path),
    shapeWithoutTransition(root, target.path),
  ));
  const sameShapesIgnoringRootSize = Object.values(states).every((root) => sameJson(
    shapeWithoutTransition(normal, target.path, true),
    shapeWithoutTransition(root, target.path, true),
  ));
  if (!sameShapes && !sameShapesIgnoringRootSize) {
    issues.push({ severity: 'warning', code: 'BUTTON_COMPLEX_STATE', message: `Variant 组合 ${group.key} 同时改变多个节点；仅导入 Normal 视觉` });
    return { spec: { transition: 'none', targetFigmaId: target.node.id }, issues };
  }

  const stateTargets = targets as Record<ButtonState, NormalizedNode>;
  const assets = Object.fromEntries(Object.entries(stateTargets).map(([state, node]) => [state, node.sprite?.assetKey])) as Record<ButtonState, string | undefined>;
  const colors = Object.fromEntries(Object.entries(stateTargets).map(([state, node]) => [state, node.sprite?.color])) as Record<ButtonState, RGBA | undefined>;
  const uniqueAssets = new Set(Object.values(assets).filter(Boolean));
  const uniqueColors = new Set(Object.values(colors).filter(Boolean).map((color) => JSON.stringify(color)));
  let transition: ButtonTransition = 'none';
  const rootScales = Object.values(states).map((state) => ({
    x: normal.width ? state.width / normal.width : 1,
    y: normal.height ? state.height / normal.height : 1,
  }));
  const hasRootScale = rootScales.some((scale) => Math.abs(scale.x - 1) > 0.0001 || Math.abs(scale.y - 1) > 0.0001);
  const uniformRootScale = rootScales.every((scale) => Math.abs(scale.x - scale.y) <= 0.01);
  const changedKinds = Number(uniqueAssets.size > 1) + Number(uniqueColors.size > 1) + Number(hasRootScale);
  if (changedKinds > 1 || (hasRootScale && (!sameShapesIgnoringRootSize || !uniformRootScale))) {
    issues.push({ severity: 'warning', code: 'BUTTON_COMPLEX_STATE', message: `Variant 组合 ${group.key} 同时改变多种属性；仅导入 Normal 视觉` });
    return { spec: { transition: 'none', targetFigmaId: target.node.id }, issues };
  }
  if (uniqueAssets.size > 1) transition = 'sprite';
  else if (uniqueColors.size > 1) transition = 'color';
  else if (hasRootScale) transition = 'scale';
  const pressedScale = rootScales[2]?.x ?? 1;
  return {
    spec: {
      transition,
      targetFigmaId: transition === 'scale' ? normal.id : target.node.id,
      normalAssetKey: assets.normal,
      hoverAssetKey: assets.hover ?? assets.normal,
      pressedAssetKey: assets.pressed ?? assets.normal,
      disabledAssetKey: assets.disabled ?? assets.normal,
      normalColor: colors.normal,
      hoverColor: colors.hover ?? colors.normal,
      pressedColor: colors.pressed ?? colors.normal,
      disabledColor: colors.disabled ?? colors.normal,
      zoomScale: transition === 'scale' ? pressedScale : undefined,
    },
    issues,
  };
}

export function applyButtonSemantics(root: NormalizedNode, issues: SyncIssue[]): void {
  const memberGroups = new Map<string, { normal: NormalizedNode; spec: ButtonSpec }>();
  const applySets = (node: NormalizedNode): void => {
    if (node.sourceType === 'COMPONENT_SET' || (isButtonName(node.name) && node.children.some((child) => findStateProperty(child.variantProperties)))) {
      for (const group of groupButtonVariants(node)) {
        const inferred = inferButtonSpec(group);
        issues.push(...inferred.issues);
        if (group.states.normal && inferred.spec) {
          group.states.normal.button = inferred.spec;
          for (const member of Object.values(group.states)) {
            if (member) memberGroups.set(member.id, { normal: group.states.normal, spec: inferred.spec });
          }
        }
      }
    }
    node.children.forEach(applySets);
  };
  applySets(root);

  const visit = (node: NormalizedNode): void => {
    if (node.kind === 'instance') {
      const definition = node.componentId ? memberGroups.get(node.componentId) : undefined;
      if (definition) {
        const definitionTarget = findTransitionTarget(definition.normal);
        const instanceTarget = definition.spec.transition === 'scale'
          ? node
          : definitionTarget ? nodeAtPath(node, definitionTarget.path) : undefined;
        node.button = {
          ...definition.spec,
          targetFigmaId: instanceTarget?.id,
        };
      } else if (isButtonName(node.name) && !node.button) {
        node.button = { transition: 'none', targetFigmaId: findTransitionTarget(node)?.node.id };
        issues.push({ severity: 'warning', code: 'BUTTON_VARIANTS_UNAVAILABLE', nodeId: node.id, message: `${node.name} 未在当前 Frame 子树中找到 Component Set 状态定义，按 Transition.NONE 导入` });
      }
    } else if (node.sourceType !== 'COMPONENT_SET' && isButtonName(node.name) && !node.button) {
      node.button = { transition: 'none', targetFigmaId: findTransitionTarget(node)?.node.id };
    }
    node.children.forEach(visit);
  };
  visit(root);

  const rehash = (node: NormalizedNode): void => {
    node.children.forEach(rehash);
    node.hash = shortHash({ ...node, hash: undefined, fileId: undefined }, 20);
  };
  rehash(root);
}
