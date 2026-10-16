import type {
  AdoptionMapping,
  FrameMapping,
  ProjectSettings,
  SaveSettingsInput,
  SharedAssetCatalogMapping,
  UserSettingsView,
} from '../types';
import { normalizeBundleRoot } from '../core/output-path';

export const PACKAGE_NAME = 'figma-sync';
export const LEGACY_PACKAGE_NAME = 'figma-ui-sync';
export const PUSH_BROADCAST = 'figma-sync:push-event';
export const ADOPTION_PREFAB_CONTEXT_BROADCAST = 'figma-sync:adoption-prefab-context-changed';

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  schemaVersion: 8,
  bundleRoot: '',
  sharedTextureRoots: [],
  fontMap: {},
  frames: {},
  adoptions: {},
  sharedAssetCatalogs: {},
  pendingOrphans: [],
};

function normalizeSharedAssetCatalogMapping(value: unknown): SharedAssetCatalogMapping | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<SharedAssetCatalogMapping>;
  if (
    candidate.schemaVersion !== 1
    || !candidate.figma
    || typeof candidate.figma.fileKey !== 'string'
    || typeof candidate.figma.fileName !== 'string'
    || typeof candidate.figma.catalogNodeId !== 'string'
    || !candidate.assets
    || typeof candidate.assets !== 'object'
    || typeof candidate.updatedAt !== 'string'
  ) return undefined;
  const assets = Object.fromEntries(Object.entries(candidate.assets).filter(([spriteFrameUuid, value]) => {
    const asset = value as unknown as Record<string, unknown> | undefined;
    return Boolean(
      asset
      && asset.sourceSpriteFrameUuid === spriteFrameUuid
      && typeof asset.key === 'string'
      && typeof asset.sourceUrl === 'string'
      && asset.sourceUrl.startsWith('db://assets/')
      && typeof asset.sourceImageUuid === 'string'
      && typeof asset.contentHash === 'string'
      && typeof asset.componentNodeId === 'string'
      && typeof asset.figmaImageRef === 'string'
      && typeof asset.updatedAt === 'string'
    );
  }));
  return { ...candidate, assets } as SharedAssetCatalogMapping;
}

function normalizeAdoptionMapping(value: unknown): AdoptionMapping | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, any>;
  const figma = candidate.figma;
  if (!figma || typeof figma !== 'object') return undefined;
  if (candidate.schemaVersion === 3) {
    if (
      (candidate.kind !== 'view' && candidate.kind !== 'item')
      || typeof figma.nodeId !== 'string'
    ) return undefined;
    return candidate as AdoptionMapping;
  }
  if (candidate.schemaVersion !== 2 || typeof figma.frameNodeId !== 'string') return undefined;
  const { frameNodeId, ...figmaWithoutLegacyId } = figma;
  return {
    ...candidate,
    schemaVersion: 3,
    kind: 'view',
    figma: {
      ...figmaWithoutLegacyId,
      nodeId: frameNodeId,
    },
  } as AdoptionMapping;
}

export function normalizeProjectSettings(value: unknown): ProjectSettings {
  const candidate = (value && typeof value === 'object' ? value : {}) as Partial<ProjectSettings>;
  let bundleRoot = '';
  if (typeof candidate.bundleRoot === 'string' && candidate.bundleRoot.trim()) {
    try {
      bundleRoot = normalizeBundleRoot(candidate.bundleRoot);
    } catch {
      bundleRoot = '';
    }
  }
  const frames = candidate.frames && typeof candidate.frames === 'object'
    ? Object.fromEntries(Object.entries(candidate.frames).filter((entry): entry is [string, FrameMapping] => {
      const mapping = entry[1] as Partial<FrameMapping> | undefined;
      return mapping?.schemaVersion === 4 && typeof mapping.bundleRoot === 'string';
    }))
    : {};
  return {
    schemaVersion: 8,
    bundleRoot,
    sharedTextureRoots: [...new Set((Array.isArray(candidate.sharedTextureRoots) ? candidate.sharedTextureRoots : [])
      .flatMap((root) => {
        if (typeof root !== 'string' || !root.trim()) return [];
        try {
          return [normalizeBundleRoot(root)];
        } catch {
          return [];
        }
      }))],
    fontMap: candidate.fontMap && typeof candidate.fontMap === 'object' ? candidate.fontMap : {},
    frames,
    adoptions: candidate.adoptions && typeof candidate.adoptions === 'object'
      ? Object.fromEntries(Object.entries(candidate.adoptions).flatMap(([key, value]) => {
        const mapping = normalizeAdoptionMapping(value);
        return mapping ? [[key, mapping]] : [];
      }))
      : {},
    sharedAssetCatalogs: candidate.sharedAssetCatalogs && typeof candidate.sharedAssetCatalogs === 'object'
      ? Object.fromEntries(Object.entries(candidate.sharedAssetCatalogs).flatMap(([key, value]) => {
        const mapping = normalizeSharedAssetCatalogMapping(value);
        return mapping?.figma.fileKey === key ? [[key, mapping]] : [];
      }))
      : {},
    pendingOrphans: Array.isArray(candidate.pendingOrphans)
      ? [...new Set(candidate.pendingOrphans.filter((url): url is string => typeof url === 'string' && Boolean(url.trim())))]
      : [],
  };
}

function hasProjectOverrides(settings: ProjectSettings): boolean {
  return settings.bundleRoot !== DEFAULT_PROJECT_SETTINGS.bundleRoot
    || settings.sharedTextureRoots.length > 0
    || Object.keys(settings.fontMap).length > 0
    || Object.keys(settings.frames).length > 0
    || Object.keys(settings.adoptions).length > 0
    || Object.keys(settings.sharedAssetCatalogs).length > 0
    || settings.pendingOrphans.length > 0;
}

async function migrateLegacyProjectProfile(): Promise<ProjectSettings> {
  const [currentProjectRaw, legacyProjectRaw] = await Promise.all([
    Editor.Profile.getProject(PACKAGE_NAME, 'settings'),
    Editor.Profile.getProject(LEGACY_PACKAGE_NAME, 'settings'),
  ]);
  const currentProject = normalizeProjectSettings(currentProjectRaw);
  const legacyProject = normalizeProjectSettings(legacyProjectRaw);
  if (!hasProjectOverrides(currentProject) && hasProjectOverrides(legacyProject)) {
    // Keep the legacy profile intact so users can roll back the package rename.
    await Editor.Profile.setProject(PACKAGE_NAME, 'settings', legacyProject, 'project');
    return legacyProject;
  }
  return currentProject;
}

export async function migrateLegacyProfile(): Promise<void> {
  await migrateLegacyProjectProfile();
}

export async function getProjectSettings(): Promise<ProjectSettings> {
  return migrateLegacyProjectProfile();
}

export async function loadSettings(): Promise<UserSettingsView> {
  return { project: await getProjectSettings() };
}

export async function saveSettings(input: SaveSettingsInput): Promise<UserSettingsView> {
  await migrateLegacyProfile();
  if (input.project) {
    const current = await getProjectSettings();
    const next = normalizeProjectSettings({ ...current, ...input.project, frames: current.frames });
    await Editor.Profile.setProject(PACKAGE_NAME, 'settings', next, 'project');
  }
  return loadSettings();
}

export async function saveProjectSettings(settings: ProjectSettings): Promise<void> {
  await migrateLegacyProjectProfile();
  await Editor.Profile.setProject(PACKAGE_NAME, 'settings', normalizeProjectSettings(settings), 'project');
}
