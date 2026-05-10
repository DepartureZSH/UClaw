import { dirname } from 'node:path';

export interface StorageDiagnosticsInput {
  platform: NodeJS.Platform;
  exePath: string;
  appPath: string;
  dataRoot: string;
  uclawDir: string;
  openclawDir: string;
  workspaceDir?: string | null;
  settingsPath: string;
  providerStorePath: string;
}

export interface StorageDiagnostics {
  platform: NodeJS.Platform;
  dataRoot: string;
  uclawDir: string;
  openclawDir: string;
  workspaceDir: string | null;
  settingsPath: string;
  providerStorePath: string;
  exePath: string;
  appPath: string;
  isAppTranslocated: boolean;
  appBundlePath: string | null;
  recommendedLaunchCommand: string | null;
  translocationFixCommands: string[];
}

const APP_TRANSLOCATION_SEGMENT = '/AppTranslocation/';

function normalizePathForDetection(pathValue: string): string {
  return pathValue.replace(/\\/g, '/');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function isAppTranslocatedPath(pathValue: string): boolean {
  return normalizePathForDetection(pathValue).includes(APP_TRANSLOCATION_SEGMENT);
}

export function extractAppBundlePath(pathValue: string): string | null {
  const normalized = normalizePathForDetection(pathValue);
  const marker = '.app/';
  const idx = normalized.indexOf(marker);
  if (idx === -1) return null;
  return pathValue.slice(0, idx + '.app'.length);
}

export function buildStorageDiagnostics(input: StorageDiagnosticsInput): StorageDiagnostics {
  const workspaceDir = input.workspaceDir?.trim() || null;
  const isAppTranslocated = input.platform === 'darwin' && isAppTranslocatedPath(input.exePath);
  const appBundlePath = input.platform === 'darwin'
    ? extractAppBundlePath(input.exePath) ?? extractAppBundlePath(input.appPath)
    : null;
  const appForCommands = appBundlePath || '/Volumes/MAC_APPS_APFS/UClaw.app';
  const appParent = dirname(appForCommands);
  const recommendedLaunchCommand = input.platform === 'darwin'
    ? `open ${shellQuote(appForCommands)}`
    : null;

  return {
    platform: input.platform,
    dataRoot: input.dataRoot,
    uclawDir: input.uclawDir,
    openclawDir: input.openclawDir,
    workspaceDir,
    settingsPath: input.settingsPath,
    providerStorePath: input.providerStorePath,
    exePath: input.exePath,
    appPath: input.appPath,
    isAppTranslocated,
    appBundlePath,
    recommendedLaunchCommand,
    translocationFixCommands: input.platform === 'darwin'
      ? [
        `sudo xattr -dr com.apple.quarantine ${shellQuote(appForCommands)}`,
        `sudo xattr -d com.apple.quarantine ${shellQuote(appParent)} 2>/dev/null || true`,
        `/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f ${shellQuote(appForCommands)}`,
        'killall Finder',
        `open ${shellQuote(appForCommands)}`,
      ]
      : [],
  };
}
