import {
  ENDPOINT,
  LOCAL_FILE_ID_KEY,
  PROTOCOL_VERSION,
  SERVICE_ID,
  TOKEN_STORAGE_KEY,
  type AdoptionFigmaNodeType,
  type AdoptionNodeMapping,
  type CocosAdoptionBindingSummary,
  type CocosAdoptionDocument,
  type CocosAdoptionNode,
  type CocosAdoptionSessionSummary,
  type CocosSharedAsset,
  type CocosSharedAssetCatalogDocument,
  type CocosSharedAssetCatalogSessionSummary,
  type CocosSyncStatusResponse,
  type FigmaPushPayload,
  type FigmaPushTarget,
  type PushAssetRequest,
  type PushPrepareResult,
} from './protocol';

interface PluginState {
  connected: boolean;
  endpoint: string;
  selections: Array<{ id: string; name: string; type: 'FRAME' | 'COMPONENT' }>;
  selectionError?: string;
  pages: Array<{ id: string; name: string }>;
  currentPageId: string;
  adoption?: CocosAdoptionSessionSummary;
  sharedAssets?: CocosSharedAssetCatalogSessionSummary;
  staleAdoptions: CocosAdoptionBindingSummary[];
}

interface RestExport {
  document?: unknown;
  components?: Record<string, unknown>;
  componentSets?: Record<string, unknown>;
  nodes?: Record<string, {
    document?: unknown;
    components?: Record<string, unknown>;
    componentSets?: Record<string, unknown>;
  } | null>;
}

let sessionToken = '';
let busy = false;
let connectionAvailable = false;
let activeAdoption: CocosAdoptionSessionSummary | undefined;
let activeSharedAssets: CocosSharedAssetCatalogSessionSummary | undefined;
let staleAdoptions: CocosAdoptionBindingSummary[] = [];
let connectionCheckPromise: Promise<boolean> | undefined;
let adoptionBindingCheckPromise: Promise<void> | undefined;
let adoptionBindingCheckTimer: ReturnType<typeof setTimeout> | undefined;
const CONNECTION_CHECK_INTERVAL_MS = 10_000;
const ADOPTION_BINDING_CHECK_DEBOUNCE_MS = 1_000;
const SHARED_CATALOG_ROLE_KEY = 'cocos-ui-sync-shared-catalog-v1';
const SHARED_CATALOG_ROLE_VALUE = 'true';
const SHARED_CATALOG_ASSET_KEY = 'cocos-ui-sync-shared-sprite-frame-v1';

figma.showUI(__html__, { width: 400, height: 660, themeColors: true });

function post(type: string, payload: Record<string, unknown> = {}): void {
  figma.ui.postMessage({ type, ...payload });
}

function selectedTargets(): Array<FrameNode | ComponentNode> {
  const selection = figma.currentPage.selection;
  if (!selection.length) return [];
  return selection.filter((node): node is FrameNode | ComponentNode => (
    node.type === 'FRAME' || (node.type === 'COMPONENT' && node.parent?.type === 'PAGE')
  ));
}

function publishState(): void {
  const selection = figma.currentPage.selection;
  const targets = selectedTargets();
  const invalid = selection.find((node) => (
    node.type !== 'FRAME' && node.type !== 'COMPONENT'
  ) || (node.type === 'COMPONENT' && node.parent?.type !== 'PAGE'));
  const state: PluginState = {
    connected: Boolean(sessionToken) && connectionAvailable,
    endpoint: ENDPOINT,
    selections: targets.map((node) => ({ id: node.id, name: node.name, type: node.type })),
    selectionError: selection.length === 0
      ? '请选择一个或多个 Frame / Page 直属 Component'
      : invalid
        ? invalid.type === 'COMPONENT'
          ? `Item Component ${invalid.name} 必须位于 Page 直属层级`
          : `当前选择包含 ${invalid.type}；只能选择 Frame / Component`
        : undefined,
    pages: figma.root.children.map((page) => ({ id: page.id, name: page.name })),
    currentPageId: figma.currentPage.id,
    adoption: activeAdoption,
    sharedAssets: activeSharedAssets,
    staleAdoptions,
  };
  post('state', { state });
}

async function clearSession(): Promise<void> {
  sessionToken = '';
  connectionAvailable = false;
  activeAdoption = undefined;
  activeSharedAssets = undefined;
  staleAdoptions = [];
  if (adoptionBindingCheckTimer) clearTimeout(adoptionBindingCheckTimer);
  adoptionBindingCheckTimer = undefined;
  await figma.clientStorage.deleteAsync(TOKEN_STORAGE_KEY);
}

async function responseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: any = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Cocos 服务返回无效 JSON（HTTP ${response.status}）`);
  }
  if (!response.ok) throw new Error(String(payload.error ?? `Cocos 服务请求失败（HTTP ${response.status}）`));
  return payload as T;
}

async function request(path: string, init: RequestInit = {}, authenticated = true): Promise<Response> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (authenticated) {
    if (!sessionToken) throw new Error('请先与 Cocos 插件配对');
    headers.Authorization = `Bearer ${sessionToken}`;
  }
  try {
    const response = await fetch(`${ENDPOINT}${path}`, { ...init, headers });
    if (authenticated && response.status === 401) {
      await clearSession();
      publishState();
    }
    return response;
  } catch (error) {
    const detail = error instanceof Error && error.message ? `（${error.message}）` : '';
    throw new Error(`无法连接 Cocos${detail}。请确认 Creator 已打开目标工程，且 Figma Sync 面板显示“监听中”`);
  }
}

async function performConnectionCheck(): Promise<boolean> {
  if (!sessionToken) {
    connectionAvailable = false;
    publishState();
    return false;
  }
  const checkedToken = sessionToken;
  try {
    const response = await request('/v1/status');
    const status = await responseJson<CocosSyncStatusResponse>(response);
    if (status.protocolVersion !== PROTOCOL_VERSION) {
      await revokeSessionToken(checkedToken);
      if (sessionToken === checkedToken) await clearSession();
      throw new Error(`Cocos Sync 协议版本不兼容：Cocos ${status.protocolVersion}，Figma ${PROTOCOL_VERSION}`);
    }
    if (sessionToken !== checkedToken) return false;
    activeAdoption = status.activeAdoption ?? undefined;
    activeSharedAssets = status.activeSharedAssets ?? undefined;
    connectionAvailable = true;
  } catch {
    if (sessionToken === checkedToken) connectionAvailable = false;
  }
  publishState();
  return connectionAvailable && sessionToken === checkedToken;
}

function verifyConnection(): Promise<boolean> {
  if (connectionCheckPromise) return connectionCheckPromise;
  connectionCheckPromise = (async () => {
    try {
      return await performConnectionCheck();
    } finally {
      connectionCheckPromise = undefined;
    }
  })();
  return connectionCheckPromise;
}

async function currentAdoptionBindings(): Promise<CocosAdoptionBindingSummary[]> {
  const fileKey = sourceFileKey();
  const response = await request(`/v1/adoptions/bindings?fileKey=${encodeURIComponent(fileKey)}`);
  if (response.status === 404) return [];
  const payload = await responseJson<{ bindings: CocosAdoptionBindingSummary[] }>(response);
  return payload.bindings ?? [];
}

async function findStaleAdoptionBindings(): Promise<CocosAdoptionBindingSummary[]> {
  const bindings = await currentAdoptionBindings();
  const stale: CocosAdoptionBindingSummary[] = [];
  for (const binding of bindings) {
    const node = await figma.getNodeByIdAsync(binding.nodeId);
    const validType = node?.type === binding.nodeType;
    const validLocation = binding.kind !== 'item' || node?.parent?.type === 'PAGE';
    if (!node || !validType || !validLocation) stale.push(binding);
  }
  return stale;
}

async function performAdoptionBindingCheck(reason: string, reportError: boolean): Promise<void> {
  if (!sessionToken || !connectionAvailable) return;
  try {
    staleAdoptions = await findStaleAdoptionBindings();
    publishState();
  } catch (error) {
    if (reportError) {
      const detail = error instanceof Error ? error.message : String(error);
      try {
        post('error', { message: `${reason}时无法检查接管映射：${detail}` });
      } catch {
        // A Figma host callback failure must not turn a valid Cocos token into a disconnect.
      }
    }
  }
}

function refreshAdoptionBindings(reason: string, reportError = false): Promise<void> {
  if (adoptionBindingCheckPromise) return adoptionBindingCheckPromise;
  adoptionBindingCheckPromise = (async () => {
    try {
      await performAdoptionBindingCheck(reason, reportError);
    } finally {
      adoptionBindingCheckPromise = undefined;
    }
  })();
  return adoptionBindingCheckPromise;
}

function scheduleAdoptionBindingCheck(): void {
  if (!sessionToken) return;
  if (adoptionBindingCheckTimer) clearTimeout(adoptionBindingCheckTimer);
  adoptionBindingCheckTimer = setTimeout(() => {
    adoptionBindingCheckTimer = undefined;
    if (busy) {
      scheduleAdoptionBindingCheck();
      return;
    }
    void refreshAdoptionBindings('Figma 文档变更');
  }, ADOPTION_BINDING_CHECK_DEBOUNCE_MS);
}

async function releaseStaleAdoptionBindings(): Promise<void> {
  if (busy) return;
  busy = true;
  post('busy', { busy: true, message: '正在重新检查已删除或失效的 Figma 设计节点…' });
  try {
    const stale = await findStaleAdoptionBindings();
    if (!stale.length) {
      staleAdoptions = [];
      post('result', { message: '没有需要清理的失效映射' });
      return;
    }
    for (const binding of stale) {
      const response = await request('/v1/adoptions/bindings/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileKey: binding.fileKey, nodeId: binding.nodeId }),
      });
      await responseJson(response);
    }
    staleAdoptions = [];
    post('result', { message: `已清理 ${stale.length} 个失效映射，可以重新准备对应 Prefab` });
  } finally {
    busy = false;
    post('busy', { busy: false });
    await verifyConnection();
  }
}

function color(value: { r: number; g: number; b: number }): RGB {
  return { r: value.r / 255, g: value.g / 255, b: value.b / 255 };
}

function solidPaint(value: { r: number; g: number; b: number; a: number }): SolidPaint {
  return { type: 'SOLID', color: color(value), opacity: value.a / 255 };
}

function rgba(value: { r: number; g: number; b: number; a: number }): RGBA {
  return { ...color(value), a: value.a / 255 };
}

function applyAdoptionLayout(frame: FrameNode | ComponentNode, source: CocosAdoptionNode): void {
  const layout = source.layout;
  if (!layout) return;
  frame.layoutMode = layout.direction === 'horizontal' ? 'HORIZONTAL' : 'VERTICAL';
  if (layout.direction === 'horizontal') frame.layoutWrap = 'NO_WRAP';
  frame.primaryAxisSizingMode = 'FIXED';
  frame.counterAxisSizingMode = 'FIXED';
  frame.primaryAxisAlignItems = 'MIN';
  frame.counterAxisAlignItems = 'CENTER';
  frame.paddingLeft = layout.paddingLeft;
  frame.paddingRight = layout.paddingRight;
  frame.paddingTop = layout.paddingTop;
  frame.paddingBottom = layout.paddingBottom;
  frame.itemSpacing = layout.spacing;
  frame.itemReverseZIndex = false;
  frame.strokesIncludedInLayout = false;
  frame.resize(Math.max(0.01, source.width), Math.max(0.01, source.height));
  for (const child of frame.children as ReadonlyArray<FrameNode | TextNode>) {
    child.layoutPositioning = 'AUTO';
    child.layoutAlign = 'INHERIT';
    child.layoutGrow = 0;
    child.layoutSizingHorizontal = 'FIXED';
    child.layoutSizingVertical = 'FIXED';
  }
  if (layout.resizeMode === 'container') frame.primaryAxisSizingMode = 'AUTO';
}

function standardAdoptionName(source: CocosAdoptionNode): string {
  const name = source.name.trim();
  if (!name.startsWith('$')) return source.name;
  if (/^\$(node|btn|txt|sp)_/i.test(name)) return name;
  const original = name.slice(1).replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+/, '') || 'node';
  if (/^(progress|list|layout|edit|slider|spine|ctrl)_/i.test(original)) return `$node_${original}`;
  if (source.button) return `$btn_${original}`;
  if (source.kind === 'text') return `$txt_${original}`;
  if (source.kind === 'sprite') return `$sp_${original}`;
  return `$node_${original}`;
}

function adoptionNodeName(source: CocosAdoptionNode): string {
  const name = standardAdoptionName(source);
  // A null SpriteFrame is a runtime binding slot, not a visual nine-slice
  // source. Adding a zero-inset marker would make its transparent placeholder
  // conflict with the shared non-sliced placeholder texture on the way back.
  if (!source.sprite?.sliced || !source.sprite.assetKey) return name;
  const insets = source.sprite.insets ?? { left: 0, right: 0, top: 0, bottom: 0 };
  const safeInset = (value: number): number => Number.isFinite(value) ? Math.max(0, value) : 0;
  return `${name} @9slice{l:${safeInset(insets.left)},r:${safeInset(insets.right)},t:${safeInset(insets.top)},b:${safeInset(insets.bottom)}}`;
}

function findPage(pageId: string | undefined): PageNode {
  const page = figma.root.children.find((candidate) => candidate.id === pageId);
  if (!page) throw new Error('目标 Figma Page 不存在，请重新选择');
  return page;
}

async function loadFont(text: CocosAdoptionNode['text']): Promise<FontName> {
  const available = await figma.listAvailableFontsAsync();
  const preferredFamily = text?.fontFamily?.trim();
  const preferredStyle = text?.fontStyle?.trim();
  const styleMatchesFlags = (style: string): boolean => {
    const bold = /(?:semi|demi)?bold|black|heavy/i.test(style);
    const italic = /italic|oblique/i.test(style);
    return bold === Boolean(text?.bold) && italic === Boolean(text?.italic);
  };
  const exact = available.find(({ fontName }) => (
    preferredFamily
    && fontName.family === preferredFamily
    && (!preferredStyle || fontName.style === preferredStyle)
  ));
  const familyWithFlags = available.find(({ fontName }) => (
    preferredFamily && fontName.family === preferredFamily && styleMatchesFlags(fontName.style)
  ));
  const familyFallback = available.find(({ fontName }) => preferredFamily && fontName.family === preferredFamily);
  const inter = available.find(({ fontName }) => fontName.family === 'Inter' && fontName.style === 'Regular');
  const chosen = exact?.fontName ?? familyWithFlags?.fontName ?? familyFallback?.fontName ?? inter?.fontName ?? available[0]?.fontName;
  if (!chosen) throw new Error('Figma 没有可用字体，无法创建文字节点');
  await figma.loadFontAsync(chosen);
  return chosen;
}

async function downloadAdoptionImages(document: CocosAdoptionDocument): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  for (let index = 0; index < document.assets.length; index += 1) {
    const asset = document.assets[index];
    post('busy', { busy: true, message: `正在读取 Cocos 图片 ${index + 1}/${document.assets.length}…` });
    const response = await request(`/v1/adoptions/${encodeURIComponent(document.sessionId)}/assets/${encodeURIComponent(asset.key)}`);
    if (!response.ok) await responseJson(response);
    const bytes = new Uint8Array(await response.arrayBuffer());
    hashes.set(asset.key, figma.createImage(bytes).hash);
  }
  return hashes;
}

async function downloadSharedAssetImages(
  document: CocosSharedAssetCatalogDocument,
): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  for (let index = 0; index < document.assets.length; index += 1) {
    const asset = document.assets[index];
    post('busy', { busy: true, message: `正在读取共享素材 ${index + 1}/${document.assets.length}…` });
    const response = await request(`/v1/shared-assets/${encodeURIComponent(document.sessionId)}/assets/${encodeURIComponent(asset.key)}`);
    if (!response.ok) await responseJson(response);
    const bytes = new Uint8Array(await response.arrayBuffer());
    hashes.set(asset.key, figma.createImage(bytes).hash);
  }
  return hashes;
}

function visitSceneNodes(parent: ChildrenMixin, visit: (node: SceneNode) => void): void {
  for (const child of parent.children) {
    visit(child);
    if ('children' in child) visitSceneNodes(child as SceneNode & ChildrenMixin, visit);
  }
}

function sharedCatalogFrames(): FrameNode[] {
  const frames: FrameNode[] = [];
  for (const page of figma.root.children) {
    visitSceneNodes(page, (node) => {
      if (node.type === 'FRAME' && node.getPluginData(SHARED_CATALOG_ROLE_KEY) === SHARED_CATALOG_ROLE_VALUE) {
        frames.push(node);
      }
    });
  }
  return frames;
}

function sharedAssetName(asset: CocosSharedAsset): string {
  const fileName = asset.sourceUrl.slice(asset.sourceUrl.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '') || 'SharedAsset';
  if (!asset.sliced) return fileName;
  const insets = asset.insets ?? { left: 0, right: 0, top: 0, bottom: 0 };
  return `${fileName} @9slice{l:${insets.left},r:${insets.right},t:${insets.top},b:${insets.bottom}}`;
}

function configureSharedCatalog(frame: FrameNode): void {
  frame.name = 'DoomUI Shared Assets';
  frame.setPluginData(SHARED_CATALOG_ROLE_KEY, SHARED_CATALOG_ROLE_VALUE);
  frame.layoutMode = 'HORIZONTAL';
  frame.layoutWrap = 'WRAP';
  frame.primaryAxisSizingMode = 'FIXED';
  frame.counterAxisSizingMode = 'AUTO';
  frame.primaryAxisAlignItems = 'MIN';
  frame.counterAxisAlignItems = 'MIN';
  frame.paddingLeft = 32;
  frame.paddingRight = 32;
  frame.paddingTop = 32;
  frame.paddingBottom = 32;
  frame.itemSpacing = 24;
  frame.clipsContent = false;
  frame.fills = [];
  frame.resize(Math.max(1200, frame.width), Math.max(1, frame.height));
}

function configureSharedAssetComponent(
  component: ComponentNode,
  asset: CocosSharedAsset,
  imageHash: string,
): void {
  component.name = sharedAssetName(asset);
  component.setPluginData(SHARED_CATALOG_ASSET_KEY, asset.sourceSpriteFrameUuid);
  component.layoutPositioning = 'AUTO';
  component.fills = [{ type: 'IMAGE', imageHash, scaleMode: 'FILL' }];
  component.strokes = [];
  component.clipsContent = false;
  component.resize(Math.max(0.01, asset.width), Math.max(0.01, asset.height));
}

async function importSharedAssets(): Promise<void> {
  if (busy) return;
  if (!activeSharedAssets || activeSharedAssets.status !== 'ready') {
    throw new Error('Cocos 当前没有可导入的共享素材会话');
  }
  busy = true;
  post('busy', { busy: true, message: '正在读取 Cocos 共享素材清单…' });
  let createdCatalog: FrameNode | undefined;
  const createdComponents: ComponentNode[] = [];
  const snapshots: Array<{
    component: ComponentNode;
    name: string;
    width: number;
    height: number;
    fills: readonly Paint[];
    spriteFrameUuid: string;
  }> = [];
  try {
    const response = await request(`/v1/shared-assets/${encodeURIComponent(activeSharedAssets.sessionId)}`);
    const document = await responseJson<CocosSharedAssetCatalogDocument>(response);
    if (document.protocolVersion !== PROTOCOL_VERSION) throw new Error(`共享素材协议版本不兼容：${document.protocolVersion}`);
    await figma.loadAllPagesAsync();
    const catalogs = sharedCatalogFrames();
    if (catalogs.length > 1) throw new Error('当前 Figma 文件存在多个 DoomUI Shared Assets Catalog；请合并为一个后重试');
    const images = await downloadSharedAssetImages(document);
    const targetX = catalogs.length ? 0 : nextFrameX(figma.currentPage);
    const catalog = catalogs[0] ?? figma.createFrame();
    if (!catalogs.length) {
      createdCatalog = catalog;
      figma.currentPage.appendChild(catalog);
      configureSharedCatalog(catalog);
      catalog.x = targetX;
      catalog.y = 0;
    }
    if (catalog.parent?.type !== 'PAGE') throw new Error('DoomUI Shared Assets Catalog 必须是 Page 直属 Frame');

    const components = catalog.children.filter((node): node is ComponentNode => node.type === 'COMPONENT');
    const componentsBySource = new Map<string, ComponentNode>();
    for (const component of components) {
      const sourceUuid = component.getPluginData(SHARED_CATALOG_ASSET_KEY);
      if (!sourceUuid) continue;
      if (componentsBySource.has(sourceUuid)) {
        throw new Error(`Catalog 内存在重复 SpriteFrame Component：${sourceUuid}`);
      }
      componentsBySource.set(sourceUuid, component);
    }

    const completedItems: Record<string, { componentNodeId: string; figmaImageRef: string }> = {};
    for (const asset of document.assets) {
      const imageHash = images.get(asset.key);
      if (!imageHash) throw new Error(`共享素材缺少 Figma 图片：${asset.key}`);
      let component = componentsBySource.get(asset.sourceSpriteFrameUuid);
      if (component) {
        snapshots.push({
          component,
          name: component.name,
          width: component.width,
          height: component.height,
          fills: Array.isArray(component.fills) ? [...component.fills] : [],
          spriteFrameUuid: component.getPluginData(SHARED_CATALOG_ASSET_KEY),
        });
      } else {
        component = figma.createComponent();
        catalog.appendChild(component);
        createdComponents.push(component);
        componentsBySource.set(asset.sourceSpriteFrameUuid, component);
      }
      configureSharedAssetComponent(component, asset, imageHash);
      completedItems[asset.key] = { componentNodeId: component.id, figmaImageRef: imageHash };
    }

    const retainedSourceSpriteFrameUuids = catalog.children
      .filter((node): node is ComponentNode => node.type === 'COMPONENT')
      .map((node) => node.getPluginData(SHARED_CATALOG_ASSET_KEY))
      .filter(Boolean);
    const completeResponse = await request(`/v1/shared-assets/${encodeURIComponent(document.sessionId)}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileKey: sourceFileKey(),
        fileName: figma.root.name,
        catalogNodeId: catalog.id,
        retainedSourceSpriteFrameUuids,
        items: completedItems,
      }),
    });
    const completed = await responseJson<{ sharedAssets: CocosSharedAssetCatalogSessionSummary }>(completeResponse);
    activeSharedAssets = completed.sharedAssets;
    if (catalog.parent?.type === 'PAGE') await figma.setCurrentPageAsync(catalog.parent);
    figma.currentPage.selection = [catalog];
    figma.viewport.scrollAndZoomIntoView([catalog]);
    post('result', { message: `已更新 DoomUI Shared Assets Catalog（${document.assets.length} 项）` });
  } catch (error) {
    for (const snapshot of snapshots) {
      snapshot.component.name = snapshot.name;
      snapshot.component.resize(snapshot.width, snapshot.height);
      snapshot.component.fills = [...snapshot.fills];
      snapshot.component.setPluginData(SHARED_CATALOG_ASSET_KEY, snapshot.spriteFrameUuid);
    }
    createdComponents.forEach((component) => component.remove());
    createdCatalog?.remove();
    throw error;
  } finally {
    busy = false;
    post('busy', { busy: false });
    publishState();
  }
}

function configureAdoptionContainer(
  container: FrameNode | ComponentNode,
  source: CocosAdoptionNode,
  imageHashes: Map<string, string>,
): void {
  container.layoutMode = 'NONE';
  container.clipsContent = false;
  const imageHash = source.sprite?.assetKey ? imageHashes.get(source.sprite.assetKey) : undefined;
  if (imageHash && source.sprite?.solidWhite) {
    container.fills = [solidPaint(source.sprite.color)];
  } else if (imageHash) {
    container.fills = [{
      type: 'IMAGE',
      imageHash,
      scaleMode: source.sprite?.sliced ? 'FILL' : 'FIT',
      opacity: source.sprite?.color.a === undefined ? 1 : source.sprite.color.a / 255,
    }];
  } else if (source.sprite && /^\$sp_/i.test(source.name.trim())) {
    // A Cocos Sprite with a null SpriteFrame is commonly a runtime slot.
    // A transparent Figma fill preserves the Sprite binding semantic without
    // displaying the white placeholder image.
    container.fills = [solidPaint({ ...source.sprite.color, a: 0 })];
  } else {
    container.fills = [];
  }
  if (typeof source.cornerRadius === 'number') container.cornerRadius = source.cornerRadius;
}

async function createAdoptionNode(
  source: CocosAdoptionNode,
  parent: BaseNode & ChildrenMixin,
  imageHashes: Map<string, string>,
  mappings: Record<string, AdoptionNodeMapping>,
  rootNodeType?: AdoptionFigmaNodeType,
): Promise<SceneNode> {
  let node: FrameNode | ComponentNode | TextNode;
  if (rootNodeType === 'COMPONENT') {
    const component = figma.createComponent();
    configureAdoptionContainer(component, source, imageHashes);
    node = component;
  } else if (source.kind === 'text' && source.text) {
    const text = figma.createText();
    text.fontName = await loadFont(source.text);
    text.characters = source.text.characters;
    text.fontSize = source.text.fontSize;
    text.lineHeight = { unit: 'PIXELS', value: source.text.lineHeight };
    text.textAlignHorizontal = ({ left: 'LEFT', center: 'CENTER', right: 'RIGHT' } as const)[source.text.horizontalAlign];
    text.textAlignVertical = ({ top: 'TOP', center: 'CENTER', bottom: 'BOTTOM' } as const)[source.text.verticalAlign];
    text.fills = [solidPaint(source.text.color)];
    text.textDecoration = source.text.underline ? 'UNDERLINE' : 'NONE';
    if (source.text.outline && source.text.outline.width > 0) {
      text.strokes = [solidPaint(source.text.outline.color)];
      text.strokeWeight = source.text.outline.width;
    }
    if (source.text.shadow) {
      text.effects = [{
        type: 'DROP_SHADOW',
        color: rgba(source.text.shadow.color),
        offset: { x: source.text.shadow.offsetX, y: -source.text.shadow.offsetY },
        radius: Math.max(0, source.text.shadow.blur),
        spread: 0,
        visible: true,
        blendMode: 'NORMAL',
      }];
    }
    // Keep the source Cocos UITransform box stable. Figma font metrics differ
    // from Cocos, so WIDTH_AND_HEIGHT/HEIGHT here would silently change the
    // node bounds and therefore its center position on the return trip.
    text.textAutoResize = 'NONE';
    node = text;
  } else {
    const frame = figma.createFrame();
    configureAdoptionContainer(frame, source, imageHashes);
    node = frame;
  }
  parent.appendChild(node);
  // JSON_REST_V1 does not include private plugin data. Keep the existing,
  // user-visible nine-slice marker in the node name so a Cocos-origin SLICED
  // Sprite can make a lossless round trip through Figma Desktop.
  node.name = adoptionNodeName(source);
  node.resize(Math.max(0.01, source.width), Math.max(0.01, source.height));
  if (node.type === 'TEXT' && source.text) {
    const clampLines = source.text.wrap
      ? Math.max(1, Math.floor(source.height / Math.max(1, source.text.lineHeight)))
      : 1;
    node.textTruncation = source.text.overflow === 'clamp' ? 'ENDING' : 'DISABLED';
    node.maxLines = source.text.overflow === 'clamp' ? clampLines : null;
  }
  if (source.constraints) node.constraints = source.constraints;
  node.x = source.x;
  node.y = source.y;
  node.rotation = source.rotation;
  node.opacity = Math.max(0, Math.min(1, source.opacity));
  node.visible = source.visible;
  node.setPluginData(LOCAL_FILE_ID_KEY, source.sourceFileId);
  node.setPluginData('cocos-ui-sync-kind-v1', source.kind);
  if (source.button) node.setPluginData('cocos-ui-sync-button-v1', 'true');
  mappings[node.id] = { cocosFileId: source.sourceFileId, cocosNodeName: source.name };
  if (node.type === 'FRAME' || node.type === 'COMPONENT') {
    for (const child of source.children) await createAdoptionNode(child, node, imageHashes, mappings);
    applyAdoptionLayout(node, source);
  }
  return node;
}

function nextFrameX(page: PageNode): number {
  const right = page.children.reduce((value, node) => {
    if (!('x' in node) || !('width' in node)) return value;
    return Math.max(value, node.x + node.width);
  }, 0);
  return right ? right + 120 : 0;
}

async function importAdoption(pageId: string | undefined): Promise<void> {
  if (busy) return;
  if (!activeAdoption || activeAdoption.status !== 'ready') throw new Error('Cocos 当前没有可导入的一次性 Prefab 会话');
  busy = true;
  post('busy', { busy: true, message: '正在读取 Cocos Prefab 结构…' });
  let root: FrameNode | ComponentNode | undefined;
  try {
    const response = await request(`/v1/adoptions/${encodeURIComponent(activeAdoption.sessionId)}`);
    const document = await responseJson<CocosAdoptionDocument>(response);
    if (document.protocolVersion !== PROTOCOL_VERSION) throw new Error(`Cocos 导入协议版本不兼容：${document.protocolVersion}`);
    const page = findPage(pageId);
    await figma.setCurrentPageAsync(page);
    const targetX = nextFrameX(page);
    const images = await downloadAdoptionImages(document);
    const mappings: Record<string, AdoptionNodeMapping> = {};
    const rootNodeType: AdoptionFigmaNodeType = document.kind === 'item' ? 'COMPONENT' : 'FRAME';
    root = await createAdoptionNode(document.root, page, images, mappings, rootNodeType) as FrameNode | ComponentNode;
    if (root.type !== rootNodeType) throw new Error(`Prefab 根节点必须导入为 Figma ${rootNodeType}`);
    root.name = document.prefabName;
    root.x = targetX;
    root.y = 0;
    const fileKey = sourceFileKey();
    post('busy', { busy: true, message: '正在保存 Cocos ↔ Figma 节点映射…' });
    const completeResponse = await request(`/v1/adoptions/${encodeURIComponent(document.sessionId)}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileKey,
        fileName: figma.root.name,
        nodeId: root.id,
        nodeType: root.type,
        normalizedUrl: sourceUrl(fileKey, root),
        nodes: mappings,
        images: Object.fromEntries(images),
      }),
    });
    const completed = await responseJson<{ adoption: CocosAdoptionSessionSummary }>(completeResponse);
    activeAdoption = completed.adoption;
    await refreshAdoptionBindings('Prefab 导入完成', true);
    figma.currentPage.selection = [root];
    figma.viewport.scrollAndZoomIntoView([root]);
    const warningSuffix = document.warnings.length ? `；${document.warnings.length} 个不支持项请查看 Cocos 面板` : '';
    post('result', { message: `已从 Cocos 导入 ${document.prefabName}（${Object.keys(mappings).length} 个节点）${warningSuffix}` });
  } catch (error) {
    root?.remove();
    throw error;
  } finally {
    busy = false;
    post('busy', { busy: false });
    publishState();
  }
}

async function checkConnection(): Promise<void> {
  sessionToken = String(await figma.clientStorage.getAsync(TOKEN_STORAGE_KEY) ?? '');
  if (await verifyConnection()) await refreshAdoptionBindings('插件启动');
}

async function pair(code: string): Promise<void> {
  const protocolResponse = await request('/v1/protocol', {}, false);
  if (protocolResponse.status === 401 || protocolResponse.status === 404) {
    throw new Error(`Cocos Sync 协议版本不兼容：Cocos 服务未提供 v${PROTOCOL_VERSION} 版本握手，请在 Creator 中重载 Figma Sync`);
  }
  const protocol = await responseJson<{ protocolVersion: number; service?: string }>(protocolResponse);
  if (protocol.protocolVersion !== PROTOCOL_VERSION || protocol.service !== SERVICE_ID) {
    throw new Error(`Cocos Sync 协议版本不兼容：Cocos ${protocol.protocolVersion}，Figma ${PROTOCOL_VERSION}`);
  }
  const response = await request('/v1/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code.trim().toUpperCase(), protocolVersion: PROTOCOL_VERSION }),
  }, false);
  const result = await responseJson<{ token: string; protocolVersion: number }>(response);
  if (result.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error(`Cocos Sync 协议版本不兼容：Cocos ${result.protocolVersion}，Figma ${PROTOCOL_VERSION}`);
  }
  sessionToken = result.token;
  await figma.clientStorage.setAsync(TOKEN_STORAGE_KEY, sessionToken);
  if (!await verifyConnection()) {
    throw new Error('Cocos Sync 配对确认失败，请确认 Creator 中的 Figma Sync 已重载后重试');
  }
  await refreshAdoptionBindings('完成配对');
  post('result', { message: '已与 Cocos Creator 配对' });
}

async function revokeSessionToken(token: string): Promise<void> {
  try {
    await fetch(`${ENDPOINT}/v1/disconnect`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Local cleanup must still succeed when Creator has already stopped.
  }
}

async function disconnectSession(): Promise<void> {
  if (sessionToken) await revokeSessionToken(sessionToken);
  await clearSession();
}

function makeLocalFileId(): string {
  const existing = figma.root.getPluginData(LOCAL_FILE_ID_KEY);
  if (existing) return existing;
  const generated = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  try {
    figma.root.setPluginData(LOCAL_FILE_ID_KEY, generated);
  } catch {
    return `name-${figma.root.name}`;
  }
  return generated;
}

function sourceFileKey(): string {
  return figma.fileKey || `local-${makeLocalFileId()}`;
}

function sourceUrl(fileKey: string, node: FrameNode | ComponentNode): string | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(fileKey)) return undefined;
  const nodeId = node.id.replace(/:/g, '-');
  return `https://www.figma.com/design/${fileKey}/${encodeURIComponent(figma.root.name)}?node-id=${nodeId}`;
}

function extractRestExport(raw: RestExport, nodeId: string): {
  document: unknown;
  components?: Record<string, unknown>;
  componentSets?: Record<string, unknown>;
} {
  if (raw.document) return { document: raw.document, components: raw.components, componentSets: raw.componentSets };
  const record = raw.nodes?.[nodeId] ?? Object.values(raw.nodes ?? {}).find(Boolean);
  if (record?.document) return { document: record.document, components: record.components, componentSets: record.componentSets };
  throw new Error('Figma JSON_REST_V1 未返回所选同步目标');
}

async function exportSelectedTargets(targets: Array<FrameNode | ComponentNode>): Promise<{
  targets: FigmaPushTarget[];
  components: Record<string, unknown>;
  componentSets: Record<string, unknown>;
}> {
  const exportedTargets: FigmaPushTarget[] = [];
  const components: Record<string, unknown> = {};
  const componentSets: Record<string, unknown> = {};
  const fileKey = sourceFileKey();
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    post('busy', { busy: true, message: `正在导出 ${target.type === 'FRAME' ? 'UI Frame' : 'Item Component'} ${index + 1}/${targets.length}…` });
    const raw = await target.exportAsync({ format: 'JSON_REST_V1' }) as RestExport;
    const exported = extractRestExport(raw, target.id);
    exportedTargets.push({
      kind: target.type === 'FRAME' ? 'view' : 'item',
      normalizedUrl: sourceUrl(fileKey, target),
      document: exported.document,
    });
    Object.assign(components, exported.components ?? {});
    Object.assign(componentSets, exported.componentSets ?? {});
  }
  return { targets: exportedTargets, components, componentSets };
}

async function exportAsset(task: PushAssetRequest): Promise<Uint8Array> {
  if (task.kind === 'image-fill') {
    if (!task.imageRef) throw new Error(`图片填充缺少 imageRef：${task.key}`);
    const image = figma.getImageByHash(task.imageRef);
    if (!image) throw new Error(`找不到 Figma 图片填充：${task.imageRef}`);
    return image.getBytesAsync();
  }
  if (!task.nodeId) throw new Error(`栅格资源缺少 nodeId：${task.key}`);
  const node = await figma.getNodeByIdAsync(task.nodeId);
  if (!node || !('exportAsync' in node)) throw new Error(`无法导出 Figma 节点：${task.nodeId}`);
  return (node as SceneNode & ExportMixin).exportAsync({
    format: 'PNG',
    constraint: { type: 'SCALE', value: 1 },
    useAbsoluteBounds: true,
  });
}

async function uploadAsset(planId: string, task: PushAssetRequest, bytes: Uint8Array): Promise<void> {
  const path = `/v1/assets/${encodeURIComponent(planId)}/${encodeURIComponent(task.key)}`;
  // Figma Desktop's fetch bridge accepts Uint8Array but rejects ArrayBuffer,
  // even though browsers normally accept both BodyInit variants.
  const body = new Uint8Array(bytes);
  const response = await request(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: body as unknown as BodyInit,
  });
  await responseJson(response);
}

async function pushSelectedTargets(): Promise<void> {
  if (busy) return;
  const selection = figma.currentPage.selection;
  const targets = selectedTargets();
  if (!targets.length || targets.length !== selection.length) {
    throw new Error('请选择一个或多个 Frame / Page 直属 Component');
  }
  if (!sessionToken) throw new Error('请先与 Cocos 插件配对');
  busy = true;
  post('busy', { busy: true, message: `正在导出 ${targets.length} 个明确选择的目标…` });
  try {
    const exported = await exportSelectedTargets(targets);
    const fileKey = sourceFileKey();
    const payload = {
      protocolVersion: PROTOCOL_VERSION,
      fileKey,
      fileName: figma.root.name,
      targets: exported.targets,
      components: exported.components,
      componentSets: exported.componentSets,
    } satisfies FigmaPushPayload;
    const prepareResponse = await request('/v1/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const prepared = await responseJson<PushPrepareResult>(prepareResponse);
    if (prepared.requiresComplete) {
      for (let index = 0; index < prepared.assetRequests.length; index += 1) {
        const task = prepared.assetRequests[index];
        post('busy', { busy: true, message: `正在导出资源 ${index + 1}/${prepared.assetRequests.length}…` });
        const bytes = await exportAsset(task);
        await uploadAsset(prepared.preview.planId, task, bytes);
      }
      const completeResponse = await request('/v1/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: prepared.preview.planId }),
      });
      await responseJson(completeResponse);
    }
    const summary = prepared.preview.unchangedByMetadata
      ? '内容未变化'
      : `变更 ${prepared.preview.changes.length}，警告 ${prepared.preview.warnings.length}，阻断 ${prepared.preview.blockers.length}`;
    post('result', { message: `已推送 ${targets.length} 个目标：${summary}` });
  } finally {
    busy = false;
    post('busy', { busy: false });
    publishState();
  }
}

figma.on('selectionchange', publishState);

async function registerDocumentChangeHandler(): Promise<void> {
  try {
    // dynamic-page manifests must load every page before Figma allows a
    // documentchange listener. This is a one-time host call, not polling.
    await figma.loadAllPagesAsync();
    figma.on('documentchange', scheduleAdoptionBindingCheck);
  } catch {
    // Mapping validation still runs on startup, workflow entry, import, and
    // explicit cleanup when the optional document-change signal is unavailable.
  }
}

void registerDocumentChangeHandler();

async function handleUiMessage(message: { type?: string; code?: string; pageId?: string; workflow?: string }): Promise<void> {
  try {
    if (message.type === 'init') await checkConnection();
    else if (message.type === 'pair') await pair(message.code ?? '');
    else if (message.type === 'disconnect') {
      await disconnectSession();
      publishState();
      post('result', { message: '已清除本机配对' });
    } else if (message.type === 'push') await pushSelectedTargets();
    else if (message.type === 'import-adoption') await importAdoption(message.pageId);
    else if (message.type === 'import-shared-assets') await importSharedAssets();
    else if (message.type === 'release-stale-adoptions') await releaseStaleAdoptionBindings();
    else if (message.type === 'refresh-workflow') {
      if (await verifyConnection() && message.workflow === 'adoption') {
        await refreshAdoptionBindings('打开创建 Figma 起点', true);
      }
    }
  } catch (error) {
    post('error', { message: error instanceof Error ? error.message : String(error) });
    busy = false;
    post('busy', { busy: false });
    publishState();
  }
}

// Figma invokes this callback through its RPC bridge and does not await a
// returned Promise. Keep the registered callback synchronous so the bridge
// never receives an async callback result; the actual workflow still reports
// errors back to the UI from handleUiMessage.
figma.ui.onmessage = (message): void => {
  void handleUiMessage(message);
};

setInterval(() => {
  if (sessionToken && !busy) void verifyConnection();
}, CONNECTION_CHECK_INTERVAL_MS);
