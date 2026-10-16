import type {
  ComponentPrefabPlan,
  FigmaComponentMetadata,
  FigmaComponentSetMetadata,
  NormalizedNode,
} from '../types';
import { shortHash, stableStringify } from './hash';
import { isButtonName, sanitizeName, sanitizeNodeName } from './naming';

type Metadata = Record<string, FigmaComponentMetadata>;
type SetMetadata = Record<string, FigmaComponentSetMetadata>;

function stateValue(node: NormalizedNode): string | undefined {
  const entry = Object.entries(node.variantProperties ?? {}).find(([key]) => key.toLowerCase() === 'state');
  return entry ? String(entry[1]).toLowerCase() : undefined;
}

function isNormalState(node: NormalizedNode): boolean {
  return ['default', 'normal'].includes(stateValue(node) ?? '');
}

function propertiesKey(node: NormalizedNode, omitState: boolean): string {
  const properties = Object.entries(node.variantProperties ?? {})
    .filter(([key]) => !omitState || key.toLowerCase() !== 'state')
    .sort(([left], [right]) => left.localeCompare(right));
  return properties.length ? stableStringify(Object.fromEntries(properties)) : 'default';
}

function appearance(node: NormalizedNode, isRoot = true): unknown {
  return {
    sourceType: node.sourceType,
    x: isRoot ? undefined : node.x,
    y: isRoot ? undefined : node.y,
    width: node.width,
    height: node.height,
    rotation: isRoot ? undefined : node.rotation,
    visible: node.visible,
    opacity: node.opacity,
    label: node.label,
    sprite: node.sprite,
    button: node.button,
    variantProperties: node.variantProperties,
    children: node.children.map((child) => appearance(child, false)),
  };
}

function canonicalSourceId(id: string): string {
  const nested = id.split(';').pop() ?? id;
  return nested.replace(/^I/, '');
}

function canonicalize(node: NormalizedNode, componentKey: string, isRoot = false): NormalizedNode {
  const id = `${componentKey}:${canonicalSourceId(node.id)}`;
  const children = node.children.map((child) => canonicalize(child, componentKey));
  const targetFigmaId = node.button?.targetFigmaId
    ? `${componentKey}:${canonicalSourceId(node.button.targetFigmaId)}`
    : undefined;
  const clone: NormalizedNode = {
    ...node,
    id,
    fileId: node.fileId,
    name: isRoot ? sanitizeNodeName(node.name) : node.name,
    x: isRoot ? 0 : node.x,
    y: isRoot ? 0 : node.y,
    rotation: isRoot ? 0 : node.rotation,
    widget: isRoot ? undefined : node.widget,
    kind: node.kind === 'instance' ? 'container' : node.kind,
    button: node.button ? { ...node.button, targetFigmaId } : undefined,
    componentAssetKey: undefined,
    children,
  };
  clone.hash = shortHash({ ...clone, hash: undefined }, 20);
  return clone;
}

interface Family {
  key: string;
  name: string;
  isButton: boolean;
}

function familyFor(
  node: NormalizedNode,
  components: Metadata,
  componentSets: SetMetadata,
  setNames: Map<string, string>,
): Family | undefined {
  const component = node.componentId ? components[node.componentId] : undefined;
  const setId = node.componentSetId ?? component?.componentSetId;
  const setName = setId ? componentSets[setId]?.name ?? setNames.get(setId) : undefined;
  const isButton = isButtonName(setName ?? '') || isButtonName(node.name);
  if (setId) {
    return {
      key: `${setId}:${propertiesKey(node, isButton)}`,
      name: setName ?? component?.name ?? node.name,
      isButton,
    };
  }
  if (!node.componentId) return undefined;
  return { key: node.componentId, name: component?.name ?? node.name, isButton };
}

export function planComponentPrefabs(
  definitionRoots: NormalizedNode[],
  usageRoots: NormalizedNode[],
  itemVisualRoot: string,
  itemRoot: string,
  components: Metadata,
  componentSets: SetMetadata = {},
): ComponentPrefabPlan[] {
  const instances: NormalizedNode[] = [];
  const setNames = new Map<string, string>();
  const collectInstances = (node: NormalizedNode): void => {
    if (node.sourceType === 'COMPONENT_SET') setNames.set(node.id, node.name);
    if (node.kind === 'instance' && node.componentId && !node.remoteComponent) instances.push(node);
    node.children.forEach(collectInstances);
  };
  usageRoots.forEach(collectInstances);

  const groups = new Map<string, { family: Family; instances: NormalizedNode[]; definitions: NormalizedNode[] }>();
  for (const definition of definitionRoots) {
    if (definition.sourceType !== 'COMPONENT') continue;
    const family = familyFor(definition, components, componentSets, setNames);
    if (!family) continue;
    const group = groups.get(family.key) ?? { family, instances: [], definitions: [] };
    group.definitions.push(definition);
    groups.set(family.key, group);
  }
  for (const instance of instances) {
    const family = familyFor(instance, components, componentSets, setNames);
    const group = family ? groups.get(family.key) : undefined;
    if (group) group.instances.push(instance);
  }

  return [...groups.values()].map((group) => {
    const candidates = group.definitions.length ? group.definitions : group.instances;
    const source = group.family.isButton
      ? candidates.find(isNormalState) ?? candidates[0]
      : candidates[0];
    const hash = shortHash(appearance(source), 20);
    const assetName = sanitizeName(group.family.name, 'component');
    const key = `component:${group.family.key}`;
    return {
      key,
      componentName: assetName,
      url: `${itemVisualRoot.replace(/\/$/, '')}/${assetName}.root.prefab`,
      logicUrl: `${itemRoot.replace(/\/$/, '')}/${assetName}.prefab`,
      hash,
      root: canonicalize({ ...source, name: group.family.name }, key, true),
      instanceIds: group.instances.map((instance) => instance.id),
    };
  });
}

export function applyComponentReferences(root: NormalizedNode, plans: ComponentPrefabPlan[]): NormalizedNode {
  const byInstance = new Map<string, string>();
  for (const plan of plans) {
    for (const id of plan.instanceIds) byInstance.set(id, plan.key);
  }
  const visit = (node: NormalizedNode): NormalizedNode => ({
    ...node,
    componentAssetKey: byInstance.get(node.id),
    children: node.children.map(visit),
  });
  return visit(root);
}
