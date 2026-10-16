import packageJSON from '../package.json';
import type {
  ApplySyncInput,
  CreateCocosAdoptionInput,
  RetireManagedSyncTargetInput,
  SaveSettingsInput,
} from './types';
import { loadSettings, saveSettings } from './services/settings';
import { ADOPTION_PREFAB_CONTEXT_BROADCAST, PUSH_BROADCAST } from './services/settings';
import { SyncService } from './services/sync-service';
import { LocalPushServer } from './services/local-push-server';
import { AdoptionService } from './services/adoption-service';
import { getCurrentAdoptionPrefabUrl } from './services/selected-prefab';
import { SharedAssetCatalogService } from './services/shared-asset-catalog-service';

const service = new SyncService();
const adoptionService = new AdoptionService();
const sharedAssetCatalogService = new SharedAssetCatalogService();
const pushServer = new LocalPushServer(service, (event) => {
  Editor.Message.broadcast(PUSH_BROADCAST, event);
}, {}, adoptionService, sharedAssetCatalogService);

export const methods: Record<string, (...args: any[]) => any> = {
  openPanel(): void {
    Editor.Panel.open(packageJSON.name);
  },
  loadSettings,
  saveSettings(input: SaveSettingsInput) {
    return saveSettings(input);
  },
  applySync(input: string | ApplySyncInput) {
    const request = typeof input === 'string' ? { planId: input } : input;
    return service.apply(request.planId, request.confirmBindingChanges === true);
  },
  cancelPreview(): boolean {
    service.cancelPreview();
    return true;
  },
  getLastReport() {
    return service.getLastReport();
  },
  getOrphanCleanupStatus() {
    return service.getOrphanCleanupStatus();
  },
  getManagedSyncTargets() {
    return service.getManagedSyncTargets();
  },
  retireManagedSyncTarget(input: RetireManagedSyncTargetInput) {
    return service.retireManagedSyncTarget(input);
  },
  discoverLegacyOrphans() {
    return service.discoverLegacyOrphans();
  },
  cleanupOrphans() {
    return service.cleanupOrphans();
  },
  getPushStatus() {
    return pushServer.getStatus();
  },
  resetPushPairing() {
    return pushServer.resetPairing();
  },
  getCurrentAdoptionPrefabUrl,
  handleSceneReady(): void {
    Editor.Message.broadcast(ADOPTION_PREFAB_CONTEXT_BROADCAST);
  },
  createCocosAdoption(input: CreateCocosAdoptionInput) {
    if (sharedAssetCatalogService.getActiveSummary()?.status === 'ready') {
      throw new Error('已有待导入的共享素材会话，请先在 Figma 导入或取消');
    }
    return adoptionService.create(input);
  },
  cancelCocosAdoption(sessionId?: string) {
    return adoptionService.cancel(sessionId);
  },
  getCurrentSharedAssetSelection() {
    return sharedAssetCatalogService.inspectSelection();
  },
  createSharedAssetCatalog() {
    if (adoptionService.getActiveSummary()?.status === 'ready') {
      throw new Error('已有待导入的 Prefab 会话，请先在 Figma 导入或取消');
    }
    return sharedAssetCatalogService.create();
  },
  cancelSharedAssetCatalog(sessionId?: string) {
    return sharedAssetCatalogService.cancel(sessionId);
  },
};

export async function load(): Promise<void> {
  await pushServer.start();
}

export async function unload(): Promise<void> {
  service.cancelPreview();
  await pushServer.stop();
}
