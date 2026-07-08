import { existsSync, mkdirSync } from 'fs';
import { isAbsolute, join, relative, resolve } from 'path';
import type { AppSettings } from '../utils/store';
import { getSetting, setSetting } from '../utils/store';
import {
  getConfiguredDataRoot,
  getConfiguredPortableDataRootConfig,
  type PortableDataRootConfig,
} from '../utils/data-root';

type SettingsReader = <K extends keyof AppSettings>(key: K) => Promise<AppSettings[K]>;
type SettingsWriter = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;

export interface StartupWorkspaceState {
  setupComplete: boolean;
  workspaceDir: string;
  storedWorkspaceDir?: string;
  mode?: 'portable-workbench' | 'legacy';
  repaired?: boolean;
  resetReason?: 'missing-workspace' | 'empty-workspace';
  resetWorkspaceDir?: string;
}

function isPortableWorkbench(config: PortableDataRootConfig | null | undefined): boolean {
  return config?.workspaceMode === 'portable-workbench';
}

export function resolvePortableWorkspaceDir(
  dataRoot = getConfiguredDataRoot(),
  config = getConfiguredPortableDataRootConfig(),
): { stored: string; resolved: string } | null {
  if (!isPortableWorkbench(config)) return null;
  const stored = config.workspaceDir?.trim() || 'workspace';
  if (isAbsolute(stored)) {
    throw new Error(`portable workspaceDir must be relative: ${stored}`);
  }
  const resolved = resolve(dataRoot, stored);
  const relativeFromRoot = relative(resolve(dataRoot), resolved);
  if (relativeFromRoot.startsWith('..') || isAbsolute(relativeFromRoot)) {
    throw new Error(`portable workspaceDir escapes dataRoot: ${stored}`);
  }
  return { stored, resolved };
}

function ensurePortableWorkspace(workspaceDir: string): void {
  try {
    mkdirSync(join(workspaceDir, '.openclaw'), { recursive: true });
  } catch (error) {
    throw new Error(`portable workspace repair failed: ${workspaceDir}`, { cause: error });
  }
}

export async function resolveStartupWorkspaceState(options: {
  getSetting?: SettingsReader;
  setSetting?: SettingsWriter;
  pathExists?: (path: string) => boolean;
  dataRoot?: string;
  portableConfig?: PortableDataRootConfig | null;
  ensureWorkspace?: (workspaceDir: string) => void;
} = {}): Promise<StartupWorkspaceState> {
  const readSetting = options.getSetting ?? getSetting;
  const writeSetting = options.setSetting ?? setSetting;
  const pathExists = options.pathExists ?? existsSync;
  const ensureWorkspace = options.ensureWorkspace ?? ensurePortableWorkspace;
  const dataRoot = options.dataRoot ?? getConfiguredDataRoot();
  const portableConfig = options.portableConfig ?? getConfiguredPortableDataRootConfig();

  let setupComplete = await readSetting('setupComplete');
  let workspaceDir = await readSetting('workspaceDir');

  if (isPortableWorkbench(portableConfig)) {
    const portableWorkspace = resolvePortableWorkspaceDir(dataRoot, portableConfig);
    if (!portableWorkspace) {
      throw new Error('portable workspace resolution failed');
    }
    ensureWorkspace(portableWorkspace.resolved);
    if (!setupComplete) {
      await writeSetting('setupComplete', true);
      setupComplete = true;
    }
    if (workspaceDir !== portableWorkspace.stored) {
      await writeSetting('workspaceDir', portableWorkspace.stored);
    }
    return {
      setupComplete: true,
      workspaceDir: portableWorkspace.resolved,
      storedWorkspaceDir: portableWorkspace.stored,
      mode: 'portable-workbench',
      repaired: true,
    };
  }

  if (setupComplete && (!workspaceDir || !pathExists(workspaceDir))) {
    const resetWorkspaceDir = workspaceDir || undefined;
    await writeSetting('setupComplete', false);
    await writeSetting('workspaceDir', '');
    const resetReason = workspaceDir ? 'missing-workspace' : 'empty-workspace';
    setupComplete = false;
    workspaceDir = '';
    return { setupComplete, workspaceDir, mode: 'legacy', resetReason, resetWorkspaceDir };
  }

  return { setupComplete, workspaceDir, mode: 'legacy' };
}
