import { existsSync } from 'fs';
import type { AppSettings } from '../utils/store';
import { getSetting, setSetting } from '../utils/store';

type SettingsReader = <K extends keyof AppSettings>(key: K) => Promise<AppSettings[K]>;
type SettingsWriter = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;

export interface StartupWorkspaceState {
  setupComplete: boolean;
  workspaceDir: string;
  resetReason?: 'missing-workspace' | 'empty-workspace';
  resetWorkspaceDir?: string;
}

export async function resolveStartupWorkspaceState(options: {
  getSetting?: SettingsReader;
  setSetting?: SettingsWriter;
  pathExists?: (path: string) => boolean;
} = {}): Promise<StartupWorkspaceState> {
  const readSetting = options.getSetting ?? getSetting;
  const writeSetting = options.setSetting ?? setSetting;
  const pathExists = options.pathExists ?? existsSync;

  let setupComplete = await readSetting('setupComplete');
  let workspaceDir = setupComplete ? await readSetting('workspaceDir') : '';

  if (setupComplete && (!workspaceDir || !pathExists(workspaceDir))) {
    const resetWorkspaceDir = workspaceDir || undefined;
    await writeSetting('setupComplete', false);
    await writeSetting('workspaceDir', '');
    const resetReason = workspaceDir ? 'missing-workspace' : 'empty-workspace';
    setupComplete = false;
    workspaceDir = '';
    return { setupComplete, workspaceDir, resetReason, resetWorkspaceDir };
  }

  return { setupComplete, workspaceDir };
}
