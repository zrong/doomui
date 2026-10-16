import { readFileSync } from 'fs-extra';
import { join } from 'path';
import { createApp, defineComponent, type App } from 'vue';
import packageJSON from '../../../package.json';
import type {
  AdoptionKind,
  ApplySyncInput,
  CocosAdoptionSessionSummary,
  CocosSharedAssetCatalogSessionSummary,
  CreateCocosAdoptionInput,
  ManagedSyncTargetSummary,
  OrphanCleanupBlocked,
  OrphanCleanupResult,
  RetireManagedSyncTargetResult,
  SaveSettingsInput,
  PushServiceEvent,
  PushServiceStatus,
  SharedAssetSelectionSummary,
  SyncChange,
  SyncPreview,
  SyncReport,
  UserSettingsView,
} from '../../types';
import {
  ADOPTION_PREFAB_CONTEXT_BROADCAST,
  PACKAGE_NAME,
  PUSH_BROADCAST,
} from '../../services/settings';
import { presentPanelStatus, type PanelStatusKind } from '../../core/panel-status';
import { stableSelectionKey } from '../../core/selection-key';

type WorkflowTab = 'sync' | 'adoption' | 'shared-assets';

interface ChangeGroup {
  key: 'nodes' | 'components' | 'assets' | 'orphans' | 'other';
  label: string;
  items: SyncChange[];
}

const CHANGE_GROUPS: Array<Pick<ChangeGroup, 'key' | 'label'>> = [
  { key: 'nodes', label: '节点' },
  { key: 'components', label: 'Component Prefab' },
  { key: 'assets', label: '贴图资源' },
  { key: 'orphans', label: '解除管理（不删除文件）' },
  { key: 'other', label: 'Prefab 与其他' },
];

const SHARED_ASSET_SELECTION_POLL_INTERVAL_MS = 500;

function changeGroupKey(item: SyncChange): ChangeGroup['key'] {
  if (item.key.startsWith('orphan:')) return 'orphans';
  if (item.key.startsWith('node:')) return 'nodes';
  if (item.key.startsWith('component:')) return 'components';
  if (item.key.startsWith('asset:')) return 'assets';
  return 'other';
}

function displayName(item: SyncChange): string {
  if (item.key.startsWith('node:')) return item.path;
  const normalized = item.path.replace(/\\/g, '/').replace(/\/$/, '');
  return normalized.slice(normalized.lastIndexOf('/') + 1) || item.path;
}

const panelApps = new WeakMap<object, App>();
const broadcastMessage = Editor.Message as typeof Editor.Message & {
  addBroadcastListener(name: string, listener: (...args: any[]) => void): void;
  removeBroadcastListener(name: string, listener: (...args: any[]) => void): void;
};

function eventValue(event: Event | CustomEvent): string {
  const target = event.target as HTMLInputElement & { value?: string };
  const detail = (event as CustomEvent).detail;
  if (typeof detail === 'string' || typeof detail === 'number') return String(detail);
  if (detail && typeof detail.value !== 'undefined') return String(detail.value);
  return String(target?.value ?? '');
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function suggestedAdoptionKind(prefabUrl: string): AdoptionKind | undefined {
  if (/\/prefabs\/item\/[^/]+\.prefab$/.test(prefabUrl)) return 'item';
  if (/\/prefabs\/view\/[^/]+\.prefab$/.test(prefabUrl)) return 'view';
  return undefined;
}

function parseFontMap(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error(`字体映射格式错误：${line}`);
    const key = line.slice(0, separator).trim();
    const url = line.slice(separator + 1).trim();
    if (!url.startsWith('db://assets/')) throw new Error(`字体必须位于 db://assets/：${url}`);
    result[key] = url;
  }
  return result;
}

function formatFontMap(fontMap: Record<string, string>): string {
  return Object.entries(fontMap)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key} = ${value}`)
    .join('\n');
}

function parseSharedTextureRoots(text: string): string[] {
  const roots = [...new Set(text.split(/\r?\n/).map((line) => line.trim().replace(/\/$/, '')).filter(Boolean))];
  for (const root of roots) {
    if (!root.startsWith('db://assets/') || root.split('/').some((part) => part === '.' || part === '..')) {
      throw new Error(`共享纹理 Bundle 根目录不合法：${root}`);
    }
  }
  return roots;
}

const PanelApp = defineComponent({
  template: readFileSync(join(__dirname, '../../../static/template/vue/app.html'), 'utf-8'),
  data() {
    return {
      form: {
        bundleRoot: '',
        sharedTextureRoots: [] as string[],
        fontMap: {} as Record<string, string>,
      },
      previewData: undefined as SyncPreview | undefined,
      lastReport: undefined as SyncReport | undefined,
      pushStatus: undefined as PushServiceStatus | undefined,
      adoptionPrefabUrl: '',
      adoptionKind: 'view' as AdoptionKind,
      sharedAssetSelection: {
        selectedCount: 0,
        items: [],
        errors: ['请在资源管理器中选择一张或多张图片'],
      } as SharedAssetSelectionSummary,
      pushListener: undefined as ((event: PushServiceEvent) => void) | undefined,
      selectionListener: undefined as (() => void) | undefined,
      sharedAssetSelectionTimer: undefined as number | undefined,
      sharedAssetSelectionKey: undefined as string | undefined,
      sharedAssetSelectionSerial: 0,
      panelActive: false,
      prefabContextListener: undefined as (() => void) | undefined,
      adoptionContextSerial: 0,
      activeWorkflow: 'sync' as WorkflowTab,
      bindingChangesConfirmed: false,
      managedSyncTargets: [] as ManagedSyncTargetSummary[],
      retireTargetKey: '',
      retireTargetConfirmed: false,
      pendingOrphans: [] as string[],
      orphanCleanupConfirmed: false,
      orphanCleanupBlocked: [] as OrphanCleanupBlocked[],
      busy: false,
      status: '',
      statusKind: 'info' as PanelStatusKind,
      operationSerial: 0,
      packageVersion: packageJSON.version,
    };
  },
  computed: {
    desktopConnectionState(): 'offline' | 'waiting' | 'paired' {
      if (!this.pushStatus?.running) return 'offline';
      return this.pushStatus.paired ? 'paired' : 'waiting';
    },
    statusPresentation() {
      return presentPanelStatus(this.status, this.statusKind);
    },
    canApply(): boolean {
      return Boolean(
        this.previewData?.planId
        && !this.previewData.blockers.length
        && !this.previewData.unchangedByMetadata
        && (!this.previewData.requiresBindingConfirmation || this.bindingChangesConfirmed)
        && !(this.previewData as SyncReport).applied,
      );
    },
    fontMapText(): string {
      return formatFontMap(this.form.fontMap);
    },
    sharedTextureRootsText(): string {
      return this.form.sharedTextureRoots.join('\n');
    },
    selectedRetireTarget(): ManagedSyncTargetSummary | undefined {
      return this.managedSyncTargets.find((target) => target.frameKey === this.retireTargetKey);
    },
    meaningfulChanges(): SyncChange[] {
      return (this.previewData?.changes ?? []).filter((item) => item.kind !== 'unchanged');
    },
    changeGroups(): ChangeGroup[] {
      const grouped = new Map<ChangeGroup['key'], SyncChange[]>(
        CHANGE_GROUPS.map((group) => [group.key, []]),
      );
      for (const item of this.meaningfulChanges) {
        grouped.get(changeGroupKey(item))?.push(item);
      }
      return CHANGE_GROUPS
        .map((group) => ({ ...group, items: grouped.get(group.key) ?? [] }))
        .filter((group) => group.items.length > 0);
    },
  },
  async mounted() {
    this.panelActive = true;
    this.pushListener = (event: PushServiceEvent): void => this.receivePushEvent(event);
    broadcastMessage.addBroadcastListener(PUSH_BROADCAST, this.pushListener);
    this.selectionListener = (): void => {
      void this.refreshAdoptionPrefabContext();
      void this.refreshSharedAssetSelectionFromHost(true);
    };
    broadcastMessage.addBroadcastListener('selection:change', this.selectionListener);
    this.prefabContextListener = (): void => { void this.refreshAdoptionPrefabContext(); };
    broadcastMessage.addBroadcastListener(ADOPTION_PREFAB_CONTEXT_BROADCAST, this.prefabContextListener);
    await this.load();
    await this.refreshAdoptionPrefabContext();
    await this.refreshSharedAssetSelection();
    if (!this.panelActive) return;
    this.sharedAssetSelectionTimer = window.setInterval(() => {
      void this.refreshSharedAssetSelectionFromHost();
    }, SHARED_ASSET_SELECTION_POLL_INTERVAL_MS);
  },
  beforeUnmount() {
    this.panelActive = false;
    this.sharedAssetSelectionSerial += 1;
    if (this.sharedAssetSelectionTimer !== undefined) {
      window.clearInterval(this.sharedAssetSelectionTimer);
      this.sharedAssetSelectionTimer = undefined;
    }
    if (this.pushListener) broadcastMessage.removeBroadcastListener(PUSH_BROADCAST, this.pushListener);
    if (this.selectionListener) broadcastMessage.removeBroadcastListener('selection:change', this.selectionListener);
    if (this.prefabContextListener) {
      broadcastMessage.removeBroadcastListener(ADOPTION_PREFAB_CONTEXT_BROADCAST, this.prefabContextListener);
    }
  },
  methods: {
    async load(): Promise<void> {
      try {
        const loaded = await Editor.Message.request(PACKAGE_NAME, 'load-settings') as UserSettingsView;
        this.form.bundleRoot = loaded.project.bundleRoot;
        this.form.sharedTextureRoots = [...loaded.project.sharedTextureRoots];
        this.form.fontMap = { ...loaded.project.fontMap };
        this.managedSyncTargets = await Editor.Message.request(
          PACKAGE_NAME,
          'get-managed-sync-targets',
        ) as ManagedSyncTargetSummary[];
        this.retireTargetKey = '';
        this.retireTargetConfirmed = false;
        this.pendingOrphans = [...loaded.project.pendingOrphans];
        this.orphanCleanupConfirmed = false;
        this.orphanCleanupBlocked = [];
        this.lastReport = await Editor.Message.request(PACKAGE_NAME, 'get-last-report') as SyncReport | undefined;
        this.pushStatus = await Editor.Message.request(PACKAGE_NAME, 'get-push-status') as PushServiceStatus;
        this.status = '';
        this.statusKind = 'info';
      } catch (error) {
        this.fail(error);
      }
    },
    receivePushEvent(event: PushServiceEvent): void {
      this.pushStatus = event.status;
      if (event.type === 'preview') {
        this.operationSerial += 1;
        this.activeWorkflow = 'sync';
        this.previewData = event.preview;
        this.bindingChangesConfirmed = false;
        this.busy = false;
        if (event.preview.blockers.length) this.fail(new Error(`已收到 ${event.targetLabel}，但有 ${event.preview.blockers.length} 个阻断项`));
        else if (event.preview.unchangedByMetadata) this.succeed(`已收到 ${event.targetLabel}：内容未变化`);
        else this.succeed(`已收到 Figma 所选内容：${event.targetLabel}（${event.preview.changes.length} 项结果）`);
      } else if (event.type === 'error') {
        this.fail(new Error(`Figma 本机操作失败：${event.message}`));
      }
    },
    async resetPushPairing(): Promise<void> {
      try {
        this.pushStatus = await Editor.Message.request(PACKAGE_NAME, 'reset-push-pairing') as PushServiceStatus;
        this.succeed('Figma Desktop 配对已重置');
      } catch (error) {
        this.fail(error);
      }
    },
    setAdoptionPrefabUrl(event: Event): void {
      this.adoptionContextSerial += 1;
      this.adoptionPrefabUrl = eventValue(event).trim();
      this.adoptionKind = suggestedAdoptionKind(this.adoptionPrefabUrl) ?? this.adoptionKind;
    },
    async refreshAdoptionPrefabContext(): Promise<void> {
      if (this.pushStatus?.activeAdoption) return;
      const operation = ++this.adoptionContextSerial;
      try {
        const selectedUrl = await Editor.Message.request(
          PACKAGE_NAME,
          'get-current-adoption-prefab-url',
        ) as string | undefined;
        if (operation === this.adoptionContextSerial && selectedUrl) {
          this.adoptionPrefabUrl = selectedUrl;
          this.adoptionKind = suggestedAdoptionKind(selectedUrl) ?? this.adoptionKind;
        }
      } catch {
        // Selection assistance must not replace the workflow's real status or
        // prevent the user from entering a URL manually.
      }
    },
    async createCocosAdoption(): Promise<void> {
      if (!this.adoptionPrefabUrl) return this.fail(new Error('请填写要一次性导入的 Prefab 资源路径'));
      this.busy = true;
      this.status = '正在读取 Prefab 并生成一次性导入会话…';
      this.statusKind = 'info';
      try {
        const activeAdoption = await Editor.Message.request(PACKAGE_NAME, 'create-cocos-adoption', {
          prefabUrl: this.adoptionPrefabUrl,
          kind: this.adoptionKind,
        } satisfies CreateCocosAdoptionInput) as CocosAdoptionSessionSummary;
        if (this.pushStatus) this.pushStatus = { ...this.pushStatus, activeAdoption };
        this.succeed(`已准备 ${activeAdoption.prefabName}；请在 Figma 的 Cocos Sync 中执行“从 Cocos 导入”`);
      } catch (error) {
        this.fail(error);
      } finally {
        this.busy = false;
      }
    },
    async cancelCocosAdoption(): Promise<void> {
      const sessionId = this.pushStatus?.activeAdoption?.sessionId;
      try {
        await Editor.Message.request(PACKAGE_NAME, 'cancel-cocos-adoption', sessionId);
        if (this.pushStatus) this.pushStatus = { ...this.pushStatus, activeAdoption: undefined };
        this.succeed('一次性导入会话已取消；源 Prefab 未被修改');
      } catch (error) {
        this.fail(error);
      }
    },
    async refreshSharedAssetSelection(): Promise<void> {
      if (this.pushStatus?.activeSharedAssets?.status === 'ready') return;
      const operation = ++this.sharedAssetSelectionSerial;
      const selectionKey = this.currentSharedAssetSelectionKey();
      if (selectionKey !== undefined) this.sharedAssetSelectionKey = selectionKey;
      try {
        const selection = await Editor.Message.request(
          PACKAGE_NAME,
          'get-current-shared-asset-selection',
        ) as SharedAssetSelectionSummary;
        if (operation === this.sharedAssetSelectionSerial) this.sharedAssetSelection = selection;
      } catch (error) {
        if (operation !== this.sharedAssetSelectionSerial) return;
        this.sharedAssetSelection = {
          selectedCount: 0,
          items: [],
          errors: [errorText(error)],
        };
      }
    },
    currentSharedAssetSelectionKey(): string | undefined {
      try {
        return stableSelectionKey(Editor.Selection.getSelected('asset'));
      } catch {
        return undefined;
      }
    },
    async refreshSharedAssetSelectionFromHost(force = false): Promise<void> {
      if (this.activeWorkflow !== 'shared-assets' || this.pushStatus?.activeSharedAssets?.status === 'ready') return;
      const selectionKey = this.currentSharedAssetSelectionKey();
      if (!force && (selectionKey === undefined || selectionKey === this.sharedAssetSelectionKey)) return;
      if (selectionKey !== undefined) this.sharedAssetSelectionKey = selectionKey;
      await this.refreshSharedAssetSelection();
    },
    async createSharedAssetCatalog(): Promise<void> {
      if (this.sharedAssetSelection.errors.length || !this.sharedAssetSelection.items.length) {
        return this.fail(new Error(this.sharedAssetSelection.errors[0] ?? '请选择共享素材'));
      }
      this.busy = true;
      this.status = '正在读取所选图片并生成共享素材会话…';
      this.statusKind = 'info';
      try {
        const activeSharedAssets = await Editor.Message.request(
          PACKAGE_NAME,
          'create-shared-asset-catalog',
        ) as CocosSharedAssetCatalogSessionSummary;
        if (this.pushStatus) this.pushStatus = { ...this.pushStatus, activeSharedAssets };
        this.succeed(`已准备 ${activeSharedAssets.assetCount} 项共享素材；请在 Figma 的 Cocos Sync 中导入到 Catalog`);
      } catch (error) {
        this.fail(error);
        await this.refreshSharedAssetSelection();
      } finally {
        this.busy = false;
      }
    },
    async cancelSharedAssetCatalog(): Promise<void> {
      const sessionId = this.pushStatus?.activeSharedAssets?.sessionId;
      try {
        await Editor.Message.request(PACKAGE_NAME, 'cancel-shared-asset-catalog', sessionId);
        if (this.pushStatus) this.pushStatus = { ...this.pushStatus, activeSharedAssets: undefined };
        this.succeed('共享素材会话已取消；Cocos 与 Figma 资源均未删除');
        await this.refreshSharedAssetSelection();
      } catch (error) {
        this.fail(error);
      }
    },
    copyPairingCode(): void {
      const pairingCode = this.pushStatus?.pairingCode;
      if (!pairingCode) return this.fail(new Error('当前没有可复制的配对码'));
      try {
        Editor.Clipboard.write('text', pairingCode);
        this.succeed('配对码已复制');
      } catch (error) {
        this.fail(new Error(`复制配对码失败：${errorText(error)}`));
      }
    },
    invalidatePreview(): void {
      this.previewData = undefined;
      this.bindingChangesConfirmed = false;
    },
    async selectWorkflow(workflow: WorkflowTab): Promise<void> {
      this.activeWorkflow = workflow;
      if (workflow === 'adoption') await this.refreshAdoptionPrefabContext();
      if (workflow === 'shared-assets') await this.refreshSharedAssetSelectionFromHost(true);
    },
    recoverMissingPrefabFromFigma(): void {
      this.activeWorkflow = 'sync';
      this.status = '已切换到“同步到 Cocos”：请在 Figma 的 Cocos Sync 中选择原 Frame 并推送，然后检查预览并应用同步。';
      this.statusKind = 'info';
    },
    async setBundleRoot(event: Event): Promise<void> {
      const root = eventValue(event).trim().replace(/\/$/, '');
      this.form.bundleRoot = root;
      this.invalidatePreview();
      try {
        await this.persistProjectSettings();
      } catch (error) {
        this.fail(error);
      }
    },
    async setFontMap(event: Event): Promise<void> {
      try {
        this.form.fontMap = parseFontMap(eventValue(event));
        this.invalidatePreview();
        await this.persistProjectSettings();
        this.succeed('字体映射已保存');
      } catch (error) {
        this.fail(error);
      }
    },
    async setSharedTextureRoots(event: Event): Promise<void> {
      try {
        this.form.sharedTextureRoots = parseSharedTextureRoots(eventValue(event));
        this.invalidatePreview();
        await this.persistProjectSettings();
        this.succeed('共享纹理 Bundle 根目录已保存；后续 Preview 会验证原始图片和 SpriteFrame');
        await this.refreshSharedAssetSelection();
      } catch (error) {
        this.fail(error);
      }
    },
    async persistProjectSettings(): Promise<void> {
      await Editor.Message.request(PACKAGE_NAME, 'save-settings', {
        project: {
          bundleRoot: this.form.bundleRoot,
          sharedTextureRoots: [...this.form.sharedTextureRoots],
          // Vue wraps component state in a Proxy, which Electron IPC cannot
          // structured-clone. Copy the string map before crossing processes.
          fontMap: { ...this.form.fontMap },
        },
      } satisfies SaveSettingsInput);
    },
    async apply(): Promise<void> {
      const planId = this.previewData?.planId;
      if (!planId || !this.canApply) return;
      const operation = ++this.operationSerial;
      this.busy = true;
      this.status = '正在下载资源、生成 Prefab 并写入工程…';
      this.statusKind = 'info';
      try {
        const input: ApplySyncInput = { planId, confirmBindingChanges: this.bindingChangesConfirmed };
        const result = await Editor.Message.request(PACKAGE_NAME, 'apply-sync', input) as { report: SyncReport };
        if (operation !== this.operationSerial) return;
        this.lastReport = result.report;
        this.previewData = result.report;
        try {
          await this.refreshOrphanCleanup();
        } catch {
          this.pendingOrphans = [...new Set([...this.pendingOrphans, ...result.report.orphanAssets])];
          this.orphanCleanupConfirmed = false;
        }
        await this.refreshManagedSyncTargets();
        const createdItemLogic = result.report.createdAssets.some((path) => (
          path.includes('/prefabs/item/') && !path.includes('/prefabs/item/figma/') && path.endsWith('.prefab')
        ));
        const createdViewLogic = result.report.createdAssets.some((path) => (
          path.includes('/prefabs/view/') && !path.includes('/prefabs/view/figma/') && path.endsWith('.prefab')
        ));
        const suffix = createdItemLogic && createdViewLogic
          ? '；View / Item 逻辑 Prefab 已创建，请分别挂载 UIView 与 Item 业务脚本'
          : createdItemLogic
            ? '；Item 逻辑 Prefab 已创建，请重新挂载业务脚本并配置使用方引用'
            : createdViewLogic
              ? '；逻辑 Prefab 已创建，请挂载 UIView、保存并注册 defineUIConfig'
            : result.report.requiresBindingConfirmation
              ? '；请同步修改业务绑定代码'
              : '';
        this.succeed(`同步完成：新增 ${result.report.createdAssets.length}，更新 ${result.report.updatedAssets.length}${suffix}`);
      } catch (error) {
        if (operation !== this.operationSerial) return;
        this.fail(error);
      } finally {
        if (operation === this.operationSerial) this.busy = false;
      }
    },
    async cancel(): Promise<void> {
      this.operationSerial += 1;
      await Editor.Message.request(PACKAGE_NAME, 'cancel-preview');
      this.busy = false;
      this.previewData = undefined;
      this.status = '已取消当前预览';
      this.statusKind = 'info';
    },
    async refreshOrphanCleanup(): Promise<void> {
      const result = await Editor.Message.request(
        PACKAGE_NAME,
        'get-orphan-cleanup-status',
      ) as { assets: string[] };
      this.pendingOrphans = [...result.assets];
      this.orphanCleanupConfirmed = false;
      this.orphanCleanupBlocked = [];
    },
    async refreshManagedSyncTargets(): Promise<void> {
      this.managedSyncTargets = await Editor.Message.request(
        PACKAGE_NAME,
        'get-managed-sync-targets',
      ) as ManagedSyncTargetSummary[];
      if (!this.managedSyncTargets.some((target) => target.frameKey === this.retireTargetKey)) {
        this.retireTargetKey = '';
        this.retireTargetConfirmed = false;
      }
    },
    selectRetireTarget(frameKey: string): void {
      this.retireTargetKey = frameKey;
      this.retireTargetConfirmed = false;
    },
    cancelRetireTarget(): void {
      this.retireTargetKey = '';
      this.retireTargetConfirmed = false;
    },
    async retireManagedSyncTarget(): Promise<void> {
      if (!this.retireTargetKey || !this.retireTargetConfirmed) return;
      this.busy = true;
      this.status = '正在退役同步目标映射并计算孤儿候选…';
      this.statusKind = 'info';
      try {
        const result = await Editor.Message.request(
          PACKAGE_NAME,
          'retire-managed-sync-target',
          { frameKey: this.retireTargetKey },
        ) as RetireManagedSyncTargetResult;
        this.invalidatePreview();
        this.pendingOrphans = [...result.pendingOrphans];
        this.orphanCleanupBlocked = [];
        this.orphanCleanupConfirmed = false;
        await this.refreshManagedSyncTargets();
        this.succeed(
          `已退役 ${result.target.frameName}；${result.orphanAssets.length} 个无人管理的生成资源已加入待清理列表，尚未删除文件`,
        );
      } catch (error) {
        this.fail(error);
      } finally {
        this.busy = false;
      }
    },
    async cleanupOrphans(): Promise<void> {
      if (!this.orphanCleanupConfirmed || !this.pendingOrphans.length) return;
      this.busy = true;
      this.status = `正在检查并清理 ${this.pendingOrphans.length} 个孤儿资源…`;
      this.statusKind = 'info';
      try {
        const result = await Editor.Message.request(PACKAGE_NAME, 'cleanup-orphans') as OrphanCleanupResult;
        this.pendingOrphans = [...result.pendingAssets];
        this.orphanCleanupBlocked = [...result.blockedAssets];
        this.orphanCleanupConfirmed = false;
        const parts = [
          `已删除 ${result.deletedAssets.length}`,
          `已清除不存在记录 ${result.missingAssets.length}`,
        ];
        if (result.blockedAssets.length) {
          this.status = `${parts.join('，')}；${result.blockedAssets.length} 项因安全检查未删除`;
          this.statusKind = 'error';
        } else {
          this.succeed(`${parts.join('，')}；孤儿清理完成`);
        }
      } catch (error) {
        this.fail(error);
      } finally {
        this.busy = false;
      }
    },
    async discoverLegacyOrphans(): Promise<void> {
      this.busy = true;
      this.status = '正在扫描标准生成目录并核对当前 Frame 所有权…';
      this.statusKind = 'info';
      try {
        const result = await Editor.Message.request(
          PACKAGE_NAME,
          'discover-legacy-orphans',
        ) as { assets: string[] };
        this.pendingOrphans = [...result.assets];
        this.orphanCleanupBlocked = [];
        this.orphanCleanupConfirmed = false;
        if (result.assets.length) this.succeed(`扫描完成：发现 ${result.assets.length} 个待确认的孤儿资源`);
        else this.succeed('扫描完成：标准生成目录中没有未被管理的资源');
      } catch (error) {
        this.fail(error);
      } finally {
        this.busy = false;
      }
    },
    countChange(kind: string, includeOrphans = true): number {
      return this.previewData?.changes.filter((item) => (
        item.kind === kind && (includeOrphans || !item.key.startsWith('orphan:'))
      )).length ?? 0;
    },
    countOrphans(): number {
      return this.previewData?.changes.filter((item) => item.key.startsWith('orphan:')).length ?? 0;
    },
    managedTargetStateLabel(state: ManagedSyncTargetSummary['adoptionState']): string {
      return ({
        active: '接管有效',
        released: '接管已释放',
        missing: '仅剩同步记录',
        none: '普通同步记录',
      } as const)[state];
    },
    changeDisplayName(item: SyncChange): string {
      return displayName(item);
    },
    changeKindLabel(item: SyncChange): string {
      if (item.key.startsWith('orphan:')) return 'ORPHAN';
      return ({ add: 'ADD', update: 'UPDATE', delete: 'REMOVE', unchanged: 'SAME', reuse: 'REUSE' } as const)[item.kind];
    },
    succeed(message: string): void {
      this.status = message;
      this.statusKind = 'success';
    },
    fail(error: unknown): void {
      this.status = errorText(error);
      this.statusKind = 'error';
    },
  },
});

module.exports = Editor.Panel.define({
  template: readFileSync(join(__dirname, '../../../static/template/default/index.html'), 'utf-8'),
  style: readFileSync(join(__dirname, '../../../static/style/default/index.css'), 'utf-8'),
  $: { app: '#app' },
  ready() {
    if (!this.$.app) return;
    const app = createApp(PanelApp);
    app.config.compilerOptions.isCustomElement = (tag) => tag.startsWith('ui-');
    app.mount(this.$.app);
    panelApps.set(this, app);
  },
  beforeClose() {},
  close() {
    panelApps.get(this)?.unmount();
    panelApps.delete(this);
  },
});
