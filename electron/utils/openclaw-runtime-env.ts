import { join } from 'path';
import { getConfiguredDataRoot } from './data-root';
import { getOpenClawConfigDir } from './paths';

export function buildOpenClawRuntimePathEnv(): Record<string, string> {
  const workspaceDir = process.env.UCLAW_WORKSPACE_DIR?.trim();
  const openClawStateDir = getOpenClawConfigDir();
  const openClawConfigPath = join(openClawStateDir, 'openclaw.json');

  return {
    OPENCLAW_HOME: workspaceDir || getConfiguredDataRoot(),
    OPENCLAW_STATE_DIR: openClawStateDir,
    CLAWDBOT_STATE_DIR: openClawStateDir,
    OPENCLAW_OAUTH_DIR: join(openClawStateDir, 'credentials'),
    OPENCLAW_CONFIG_PATH: openClawConfigPath,
    // Some external plugins still read OPENCLAW_CONFIG instead of the core
    // OPENCLAW_CONFIG_PATH variable.
    OPENCLAW_CONFIG: openClawConfigPath,
  };
}
