import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile } from '@vue/compiler-dom';
import { describe, expect, it } from 'vitest';

const template = readFileSync(resolve(__dirname, '../static/template/vue/app.html'), 'utf8');
const panelSource = readFileSync(resolve(__dirname, '../source/panels/default/index.ts'), 'utf8');
const panelStyle = readFileSync(resolve(__dirname, '../static/style/default/index.css'), 'utf8');
const companionUi = readFileSync(resolve(__dirname, '../../cocos-sync/src/ui.html'), 'utf8');
const companionCode = readFileSync(resolve(__dirname, '../../cocos-sync/src/code.ts'), 'utf8');
const companionManifest = JSON.parse(
  readFileSync(resolve(__dirname, '../../cocos-sync/manifest.json'), 'utf8'),
) as { id?: string; name?: string };
const companionPackage = JSON.parse(
  readFileSync(resolve(__dirname, '../../cocos-sync/package.json'), 'utf8'),
) as { name?: string };

describe('Cocos panel information architecture', () => {
  it('compiles as a Vue template and uses the new visible title', () => {
    expect(() => compile(template)).not.toThrow();
    expect(template).toContain('<h1>Figma Sync</h1>');
  });

  it('separates daily sync, one-time adoption, and shared assets into three workflows', () => {
    expect(template).toContain('id="sync-workflow-tab"');
    expect(template).toContain('id="adoption-workflow-tab"');
    expect(template).toContain('id="shared-assets-workflow-tab"');
    expect(template).toContain('<strong>同步到 Cocos</strong>');
    expect(template).toContain('<strong>创建 Figma 起点</strong>');
    expect(template).toContain('<strong>共享素材</strong>');
    expect(template).toContain('id="sync-workflow-panel"');
    expect(template).toContain('id="adoption-workflow-panel"');
    expect(template).toContain('id="shared-assets-workflow-panel"');

    const syncPanel = template.slice(
      template.indexOf('id="sync-workflow-panel"'),
      template.indexOf('id="adoption-workflow-panel"'),
    );
    const adoptionPanel = template.slice(template.indexOf('id="adoption-workflow-panel"'));
    expect(syncPanel).toContain('<strong>输出设置</strong>');
    expect(syncPanel).not.toContain('API 拉取');
    expect(syncPanel).not.toContain('id="desktop-panel"');
    expect(syncPanel).not.toContain('<h2>从 Figma Desktop 推送</h2>');
    expect(syncPanel).not.toContain('只有所选目标会进入下方预览');
    expect(syncPanel).not.toContain('源 Prefab 路径');
    expect(adoptionPanel).toContain('源 Prefab 路径');
    expect(adoptionPanel).toContain('自动读取当前正在编辑的任意工程 Prefab');
    expect(adoptionPanel).toContain('在 Figma 中创建为');
    expect(adoptionPanel).toContain('v-model="adoptionKind"');
    expect(adoptionPanel).toContain('不会复制或修改源 Prefab');
    expect(panelSource).toContain("'create-cocos-adoption'");
    expect(panelSource).toContain('kind: this.adoptionKind');
    expect(panelSource).toContain("'get-current-adoption-prefab-url'");
    expect(panelSource).toContain("addBroadcastListener('selection:change'");
    expect(panelSource).toContain('refreshSharedAssetSelectionFromHost(true)');
    expect(panelSource).toContain('SHARED_ASSET_SELECTION_POLL_INTERVAL_MS');
    expect(panelSource).toContain('if (!this.panelActive) return;');
    expect(panelSource).toContain('window.clearInterval(this.sharedAssetSelectionTimer)');
    expect(panelSource).toContain('operation === this.sharedAssetSelectionSerial');
    expect(panelSource).toContain('ADOPTION_PREFAB_CONTEXT_BROADCAST');
    expect(panelSource).toContain("'get-current-shared-asset-selection'");
    expect(panelSource).toContain("'create-shared-asset-catalog'");
    expect(panelStyle).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
  });

  it('keeps Desktop connection compact and reusable', () => {
    expect(template).toContain('class="card connection-card"');
    expect(template).toContain(':open="!pushStatus?.paired"');
    expect(template).toContain('aria-label="复制配对码"');
    expect(template).toContain('aria-label="重置配对"');
    expect(template.indexOf('aria-label="复制配对码"')).toBeLessThan(template.indexOf('aria-label="重置配对"'));
    expect(template).toContain('@click="resetPushPairing"');
    expect(template).not.toContain('<ui-button @confirm="resetPushPairing">重置配对</ui-button>');
    expect(panelStyle).toContain('.pairing-icon:focus-visible');
    expect(template).toContain('在 Cocos Sync 中输入配对码');
    expect(panelSource).toContain("Editor.Clipboard.write('text', pairingCode)");
  });

  it('keeps both shared panels above the workflow tabs', () => {
    const connectionIndex = template.indexOf('class="card connection-card"');
    const sharedSettingsIndex = template.indexOf('<details class="card settings-card shared-texture-settings-card">');
    const workflowTabsIndex = template.indexOf('<nav class="workflow-tabs"');
    const workflowContentIndex = template.indexOf('<div class="workflow-content">');
    const firstWorkflowPanelIndex = template.indexOf('id="sync-workflow-panel"');
    expect(connectionIndex).toBeGreaterThanOrEqual(0);
    expect(sharedSettingsIndex).toBeGreaterThan(connectionIndex);
    expect(workflowTabsIndex).toBeGreaterThan(sharedSettingsIndex);
    expect(workflowContentIndex).toBeGreaterThan(workflowTabsIndex);
    expect(firstWorkflowPanelIndex).toBeGreaterThan(workflowContentIndex);
    expect(template.match(/<strong>共享纹理 Bundle 根目录<\/strong>/g)).toHaveLength(1);
    expect(template).toContain('三个工作流共用');
    expect(template).toContain('同步、Prefab 接管和 Shared Assets Catalog 共用此白名单');
    expect(template).toContain('db://assets/subpackages/common');
    expect(panelSource).toContain('setSharedTextureRoots');
    expect(panelSource).toContain('sharedTextureRoots: [...this.form.sharedTextureRoots]');
  });

  it('distinguishes offline, waiting, and paired Desktop connection states', () => {
    expect(panelSource).toContain("desktopConnectionState(): 'offline' | 'waiting' | 'paired'");
    expect(template).toContain(':class="desktopConnectionState"');
    expect(panelStyle).toContain('.status-dot.paired');
    expect(panelStyle).toContain('.status-dot.waiting');
    expect(panelStyle).toContain('.status-dot.offline');
    expect(panelStyle).toMatch(/\.status-dot\.waiting\s*\{[^}]*var\(--color-warn-contrast\)/s);
    expect(panelStyle).toMatch(/\.status-dot\.paired\s*\{[^}]*var\(--color-success-contrast\)/s);
  });

  it('keeps generated output settings in a collapsed summary', () => {
    expect(template).toContain('<details class="card settings-card">');
    expect(template).toContain('class="settings-summary"');
    expect(template).toContain('<strong>输出设置</strong>');
    expect(template).toContain('Desktop Push');
    expect(template).toContain('Asset Bundle 根目录');
    expect(template).toContain('prefabs/view/UI_Name.prefab');
    expect(template).toContain('prefabs/view/figma/UI_Name.root.prefab');
    expect(template).toContain('prefabs/item/figma/item_Name.root.prefab');
    expect(template).toContain('textures/figma/');
    expect(template).not.toContain('value="standalone"');
    expect(template).not.toContain('value="uiview"');
    expect(panelSource).not.toContain('outputLayout');
    expect(panelSource).not.toContain('outputRoot');
  });

  it('exposes only Desktop Push and no REST credential controls', () => {
    expect(template).not.toContain('API 拉取');
    expect(template).not.toContain('Personal Access Token');
    expect(template).not.toContain('REST / PAT');
    expect(panelSource).not.toContain("'preview-sync'");
    expect(panelSource).not.toContain('clearToken');
  });

  it('keeps workflow tabs outside the scrollable panel content', () => {
    expect(panelStyle).toMatch(/:host\s*\{[^}]*height:\s*100%/s);
    expect(panelStyle).toContain('#app { height: 100%; min-height: 0; }');
    expect(panelStyle).toMatch(/\.sync-panel\s*\{[^}]*display:\s*flex[^}]*overflow:\s*hidden/s);
    expect(template).toContain('<div class="workflow-content">');
    expect(template.indexOf('class="workflow-tabs"')).toBeLessThan(template.indexOf('class="workflow-content"'));
    expect(template.indexOf('class="shared-texture-settings-card"')).toBeLessThan(template.indexOf('class="workflow-tabs"'));
    expect(panelStyle).toContain('.connection-card, .shared-texture-settings-card, .workflow-tabs { flex: 0 0 auto; }');
    expect(panelStyle).toMatch(/\.workflow-content\s*\{[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/s);
    expect(panelStyle).toContain('overscroll-behavior: contain');
  });

  it('keeps one live status message near the panel header', () => {
    const statusMarker = 'class="status"';
    expect(template.match(new RegExp(statusMarker, 'g'))).toHaveLength(1);
    expect(template.indexOf(statusMarker)).toBeLessThan(template.indexOf('class="workflow-tabs"'));
    expect(template).toContain('role="status"');
    expect(template).toContain('aria-live="polite"');
    expect(panelStyle).toContain('.panel-header, .status, .connection-card, .shared-texture-settings-card, .workflow-tabs { flex: 0 0 auto; }');
  });

  it('turns a missing Prefab error into a wrapped, actionable recovery state', () => {
    expect(template).toContain('class="status-path"');
    expect(template).toContain('class="status-recovery"');
    expect(template).toContain('如果 Figma 中仍有对应 Frame');
    expect(template).toContain('转到同步到 Cocos');
    expect(template).toContain('@confirm="recoverMissingPrefabFromFigma"');
    expect(panelSource).toContain("this.activeWorkflow = 'sync'");
    expect(panelStyle).toMatch(/\.status-path\s*\{[^}]*overflow-wrap:\s*anywhere/s);
    expect(panelStyle).toMatch(/\.status-path\s*\{[^}]*white-space:\s*normal/s);
    expect(template).toContain('class="adoption-input-preview"');
    expect(template).toContain('当前完整路径');
  });

  it('shows a standard disclosure chevron for collapsed and expanded details', () => {
    expect(panelStyle).toContain('details > summary::before');
    expect(panelStyle).toContain('transform: rotate(-45deg)');
    expect(panelStyle).toContain('details[open] > summary::before { transform: rotate(45deg); }');
    expect(panelStyle).toContain('details > summary:focus-visible');
  });

  it('shows the full adoption Prefab URL and expandable node, image, and warning details', () => {
    expect(template).toContain('class="adoption-prefab-url"');
    expect(template).toContain('<span>节点</span>');
    expect(template).toContain('<span>图片</span>');
    expect(template).toContain('<span>警告</span>');
    expect(template).toContain('pushStatus.activeAdoption.nodes');
    expect(template).toContain('pushStatus.activeAdoption.assets');
    expect(template).toContain('pushStatus.activeAdoption.warnings');
    expect(panelStyle).toMatch(/\.adoption-prefab-url\s*\{[^}]*overflow-wrap:\s*anywhere/s);
    expect(panelStyle).toMatch(/\.adoption-prefab-url\s*\{[^}]*white-space:\s*normal/s);
    expect(panelStyle).toContain('.detail-card > summary');
    expect(panelStyle).toMatch(/\.adoption-warning-list li > span:last-child\s*\{[^}]*overflow-wrap:\s*anywhere/s);
    expect(panelStyle).toMatch(/\.adoption-warning-list li > span:last-child\s*\{[^}]*word-break:\s*break-word/s);
  });

  it('keeps Apply in the shared review area and gates binding changes', () => {
    expect(template).toContain('解析后的输出路径');
    expect(template).toContain('previewData.outputPaths.logicPrefabUrl');
    expect(template).toContain('previewData.requiresBindingConfirmation');
    expect(template).toContain('bindingChangesConfirmed');
    const results = template.slice(template.indexOf('class="card results"'));
    expect(results).toContain('>应用同步</ui-button>');
  });

  it('explains empty-output rebuilds and presents readable grouped changes', () => {
    expect(template).toContain('检测到输出已清空，本次按全新重建');
    expect(template).toContain('previewData.rebuildFromEmptyOutput.previousTrackedAssets');
    expect(template).toContain('不会把旧节点计为删除');
    expect(template).toContain('解除管理 {{ countOrphans() }}');
    expect(template).toContain('v-for="group in changeGroups"');
    expect(template).toContain('{{ changeDisplayName(item) }}');
    expect(template).toContain('class="change-path"');
    expect(panelSource).toContain("if (item.key.startsWith('orphan:')) return 'ORPHAN';");
    expect(panelSource).toContain("delete: 'REMOVE'");
    expect(panelSource).toContain("reuse: 'REUSE'");
    expect(template).toContain("共享复用 {{ countChange('reuse') }}");
    expect(panelStyle).toMatch(/\.change-path\s*\{[^}]*overflow-wrap:\s*anywhere/s);
    expect(panelStyle).toMatch(/\.change-path\s*\{[^}]*white-space:\s*normal/s);
  });

  it('wraps long warning and blocker messages inside the disclosure card', () => {
    expect(panelStyle).toMatch(/\.preview-detail-content\s*\{[^}]*min-width:\s*0/s);
    expect(panelStyle).toMatch(/\.issue-list\s*\{[^}]*min-width:\s*0/s);
    expect(panelStyle).toMatch(/\.issue-list p\s*\{[^}]*min-width:\s*0/s);
    expect(panelStyle).toMatch(/\.issue-list p\s*\{[^}]*overflow-wrap:\s*anywhere/s);
    expect(panelStyle).toMatch(/\.issue-list p\s*\{[^}]*white-space:\s*normal/s);
    expect(panelStyle).toMatch(/\.issue-list p\s*\{[^}]*word-break:\s*break-word/s);
  });

  it('keeps unchanged counts in the summary but hides SAME rows from change details', () => {
    expect(panelSource).toContain("filter((item) => item.kind !== 'unchanged')");
    expect(panelSource).toContain('for (const item of this.meaningfulChanges)');
    expect(template).toContain('v-if="meaningfulChanges.length"');
    expect(template).toContain('变更详情（{{ meaningfulChanges.length }}）');
    expect(template).toContain("已隐藏 SAME {{ countChange('unchanged') }} 项");
    expect(template).toContain("<span>未变 {{ countChange('unchanged') }}</span>");
  });

  it('keeps orphan cleanup visible across previews and requires explicit confirmation', () => {
    expect(template).toContain('孤儿资源维护');
    expect(template).toContain('扫描旧输出');
    expect(template).toContain('查看完整资源路径');
    expect(template).toContain('v-model="orphanCleanupConfirmed"');
    expect(template).toContain('>清理孤儿资源</ui-button>');
    expect(template).toContain('逻辑 Prefab、非插件目录和仍被引用的文件不会删除');
    expect(panelSource).toContain("'get-orphan-cleanup-status'");
    expect(panelSource).toContain("'discover-legacy-orphans'");
    expect(panelSource).toContain("'cleanup-orphans'");
    expect(panelStyle).toContain('.orphan-confirmation');
    expect(panelStyle).toMatch(/\.orphan-paths code\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  });

  it('provides an explicit non-deleting workflow for retiring stale sync targets', () => {
    expect(template).toContain('同步目标映射');
    expect(template).toContain('v-for="target in managedSyncTargets"');
    expect(template).toContain('@confirm="selectRetireTarget(target.frameKey)"');
    expect(template).toContain('v-model="retireTargetConfirmed"');
    expect(template).toContain('@confirm="retireManagedSyncTarget"');
    expect(template).toContain('退役只移除 Figma 同步身份和插件所有权');
    expect(panelSource).toContain("'get-managed-sync-targets'");
    expect(panelSource).toContain("'retire-managed-sync-target'");
    expect(panelStyle).toContain('.retire-target-confirmation');
  });

  it('uses one disclosure-card treatment for preview and adoption details', () => {
    expect(template).toContain('class="detail-card preview-detail output-paths"');
    expect(template).toContain('class="detail-card preview-detail blockers"');
    expect(template).toContain('class="detail-card preview-detail warnings"');
    expect(template).toContain('class="detail-card preview-detail changes"');
    expect(template).toContain('class="detail-card adoption-detail"');
    expect(panelStyle).toMatch(/\.detail-card\s*\{[^}]*border:\s*1px solid var\(--color-normal-border\)[^}]*border-radius:\s*5px/s);
    expect(panelStyle).toMatch(/\.detail-card > summary\s*\{[^}]*min-height:\s*34px[^}]*padding:\s*0 9px/s);
    expect(panelStyle).toContain('.detail-card[open] > summary { border-bottom: 1px solid var(--color-normal-border); }');
    expect(panelStyle).not.toMatch(/\.(?:blockers|warnings|output-paths)\s*\{[^}]*border-left/s);
  });
});

describe('Figma companion information architecture', () => {
  it('permits only the paired local endpoint in Community and development builds', () => {
    expect(companionManifest.networkAccess.allowedDomains).toEqual(['http://localhost:38638']);
    expect(companionManifest.networkAccess.devAllowedDomains).toEqual(['http://localhost:38638']);
    expect(companionManifest.networkAccess.reasoning).toContain('paired');
    expect(companionManifest.enablePrivatePluginApi).not.toBe(true);
  });

  it('uses the Cocos Sync title in the manifest and UI', () => {
    expect(companionPackage.name).toBe('cocos-sync');
    expect(companionManifest.name).toBe('Cocos Sync');
    expect(companionManifest.id).toMatch(/^\d{10,24}$/);
    expect(companionUi).toContain('<h1>Cocos Sync</h1>');
  });

  it('shows one workflow panel at a time with focused actions', () => {
    expect(companionUi).toContain('id="syncTab"');
    expect(companionUi).toContain('id="adoptionTab"');
    expect(companionUi).toContain('id="sharedAssetsTab"');
    expect(companionUi).toContain('id="syncPanel"');
    expect(companionUi).toContain('id="adoptionPanel" class="workflow-panel hidden"');
    expect(companionUi).toContain('id="sharedAssetsPanel" class="workflow-panel hidden"');
    expect(companionUi).toContain('推送所选内容到 Cocos');
    expect(companionUi).toContain('从 Cocos 导入');
    expect(companionUi).toContain('导入到 Shared Assets Catalog');
    expect(companionUi).toContain("selectWorkflow('adoption')");
  });

  it('creates or reuses one marked Shared Assets Catalog without requiring a dedicated Page', () => {
    expect(companionUi).toContain('若当前文件还没有 Catalog Frame，则在当前 Page 创建');
    expect(companionCode).toContain("const SHARED_CATALOG_ROLE_KEY = 'cocos-ui-sync-shared-catalog-v1'");
    expect(companionCode).toContain('await figma.loadAllPagesAsync()');
    expect(companionCode).toContain('const catalogs = sharedCatalogFrames()');
    expect(companionCode).toContain('if (catalogs.length > 1)');
    expect(companionCode).toContain('figma.currentPage.appendChild(catalog)');
    expect(companionCode).not.toContain("figma.createPage()");
    expect(companionCode).not.toContain("findPage('DoomUI Shared Assets')");
    expect(companionUi).toContain("send({ type: 'import-shared-assets' })");
  });

  it('pushes only explicitly selected Frame and Component targets', () => {
    expect(companionUi).toContain('支持单选或多选 Frame / Page 直属 Component');
    expect(companionUi).toContain('id="selectionList"');
    expect(companionCode).toContain('function selectedTargets()');
    expect(companionCode).toContain('targets: exported.targets');
    expect(companionCode).toContain("kind: target.type === 'FRAME' ? 'view' : 'item'");
    expect(companionCode).not.toContain('exportTopLevelItemComponents');
    const pushWorkflow = companionCode.slice(
      companionCode.indexOf('async function pushSelectedTargets'),
      companionCode.indexOf("figma.on('selectionchange'"),
    );
    expect(pushWorkflow).not.toContain('figma.loadAllPagesAsync()');
  });

  it('collapses connection details after pairing and auto-opens a new adoption workflow', () => {
    expect(companionUi).toContain('id="connectionDetails"');
    expect(companionUi).toContain('elements.connectionDetails.open = !state.connected');
    expect(companionUi).toContain('state.adoption.sessionId !== lastReadyAdoption');
  });

  it('keeps workflow tabs outside the scrollable detail area', () => {
    const statusMarker = 'id="status" class="status"';
    expect(companionUi.match(new RegExp(statusMarker, 'g'))).toHaveLength(1);
    expect(companionUi.indexOf(statusMarker)).toBeLessThan(companionUi.indexOf('id="connectionDetails"'));
    expect(companionUi).toContain('role="status" aria-live="polite"');
    expect(companionUi).toMatch(/body\s*\{[^}]*display:\s*flex[^}]*height:\s*100%[^}]*overflow:\s*hidden/s);
    expect(companionUi).toContain('<main class="workflow-content">');
    expect(companionUi.indexOf('class="workflow-tabs"')).toBeLessThan(companionUi.indexOf('class="workflow-content"'));
    expect(companionUi).toMatch(/\.workflow-content\s*\{[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/s);
    expect(companionUi).toContain('details > summary::before');
    expect(companionUi).toContain('details[open] > summary::before { transform: rotate(45deg); }');
  });

  it('keeps the empty adoption state visibly actionable and exposes full adoption details', () => {
    expect(companionUi).toContain('id="adoptionEmpty" class="adoption-empty" role="status"');
    expect(companionUi).toContain('id="sharedAssetsEmpty" class="adoption-empty" role="status"');
    expect(companionUi).toContain('function renderStaticEmptyReminder(element, visible, message)');
    expect(companionUi).toContain('renderStaticEmptyReminder(\n        elements.adoptionEmpty,');
    expect(companionUi).toContain('renderStaticEmptyReminder(\n        elements.sharedAssetsEmpty,');
    expect(companionUi).toMatch(/\.adoption-empty\s*\{[^}]*border-left:\s*3px solid var\(--figma-color-icon-danger\)/s);
    expect(companionUi).toMatch(/\.adoption-empty\s*\{[^}]*background:\s*var\(--figma-color-bg-danger-tertiary\)/s);
    expect(companionUi).toMatch(/\.adoption-empty\s*\{[^}]*opacity:\s*1/s);
    expect(companionUi).toMatch(/\.adoption-meta code\s*\{[^}]*overflow-wrap:\s*anywhere/s);
    expect(companionUi).toMatch(/\.adoption-meta code\s*\{[^}]*white-space:\s*normal/s);
    expect(companionUi).toContain('id="adoptionNodes"');
    expect(companionUi).toContain('id="adoptionAssets"');
    expect(companionUi).toContain('id="adoptionWarnings"');
    expect(companionUi).toContain('renderDetailList(');
    expect(companionUi).toMatch(/\.adoption-detail-list \.warning-item > span:last-child\s*\{[^}]*overflow-wrap:\s*anywhere/s);
    expect(companionUi).toMatch(/\.adoption-detail-list \.warning-item > span:last-child\s*\{[^}]*word-break:\s*break-word/s);
  });

  it('requires explicit cleanup after an imported Frame or Component becomes invalid', () => {
    expect(companionUi).toContain('id="staleAdoptions"');
    expect(companionUi).toContain('检测到已删除或失效的导入节点');
    expect(companionUi).toContain('id="releaseStaleAdoptions"');
    expect(companionUi).toContain('确认清理失效映射');
    expect(companionUi).toContain("send({ type: 'release-stale-adoptions' })");
    expect(companionUi).toContain('state.staleAdoptions || []');
    expect(companionCode).toContain("'/v1/adoptions/bindings/release'");
    expect(companionCode).toContain('if (response.status === 404) return [];');
    expect(companionCode).toContain("figma.on('documentchange', scheduleAdoptionBindingCheck)");
    const documentChangeSetup = companionCode.slice(
      companionCode.indexOf('async function registerDocumentChangeHandler'),
      companionCode.indexOf('async function handleUiMessage'),
    );
    expect(documentChangeSetup.indexOf('await figma.loadAllPagesAsync()')).toBeLessThan(
      documentChangeSetup.indexOf("figma.on('documentchange', scheduleAdoptionBindingCheck)"),
    );
    expect(documentChangeSetup).toContain('void registerDocumentChangeHandler()');
    expect(companionUi).toContain("send({ type: 'refresh-workflow', workflow })");
  });

  it('imports view roots as Frames and Item roots as Page-direct Components', () => {
    expect(companionCode).toContain("document.kind === 'item' ? 'COMPONENT' : 'FRAME'");
    expect(companionCode).toContain('figma.createComponent()');
    expect(companionCode).toContain("binding.kind !== 'item' || node?.parent?.type === 'PAGE'");
    expect(companionUi).toContain('Item Component');
  });

  it('negotiates the Cocos Sync protocol before submitting a pairing code', () => {
    expect(companionCode).toContain("request('/v1/protocol', {}, false)");
    expect(companionCode).toContain('protocolVersion: PROTOCOL_VERSION');
    expect(companionCode).toContain("await fetch(`${ENDPOINT}/v1/disconnect`");
    expect(companionCode).toContain('await revokeSessionToken(checkedToken)');
    expect(companionCode).toContain('Cocos Sync 协议版本不兼容');
    expect(companionCode).toContain('if (!await verifyConnection())');
    expect(companionCode).toContain('Cocos Sync 配对确认失败');
    expect(companionCode).not.toContain('Cocos Push 协议版本不兼容');
  });

  it('keeps periodic connection checks lightweight and isolates Figma node validation', () => {
    expect(companionCode).toContain('const CONNECTION_CHECK_INTERVAL_MS = 10_000;');
    expect(companionCode).toContain('if (connectionCheckPromise) return connectionCheckPromise;');
    expect(companionCode).not.toContain("request('/v1/adoptions/active')");
    expect(companionCode).not.toContain("request('/v1/shared-assets/active')");

    const connectionCheck = companionCode.slice(
      companionCode.indexOf('async function performConnectionCheck'),
      companionCode.indexOf('async function currentAdoptionBindings'),
    );
    expect(connectionCheck).not.toContain('findStaleAdoptionBindings');
    expect(connectionCheck).not.toContain('figma.getNodeByIdAsync');

    const bindingCheck = companionCode.slice(
      companionCode.indexOf('async function performAdoptionBindingCheck'),
      companionCode.indexOf('async function releaseStaleAdoptionBindings'),
    );
    expect(bindingCheck).not.toContain('clearSession');
    expect(bindingCheck).not.toContain('revokeSessionToken');
  });
});
