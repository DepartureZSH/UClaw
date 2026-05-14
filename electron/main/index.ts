/**
 * Electron Main Process Entry
 * Manages window creation, system tray, and IPC handlers
 */
import { app, BrowserWindow, nativeImage, session, shell } from 'electron';
import type { Server } from 'node:http';
import { join } from 'path';
import { GatewayManager } from '../gateway/manager';
import { registerIpcHandlers } from './ipc-handlers';
import { createTray } from './tray';
import { createMenu } from './menu';

import { appUpdater, registerUpdateHandlers } from './updater';
import { logger } from '../utils/logger';
import { warmupNetworkOptimization } from '../utils/uv-env';
import { initTelemetry } from '../utils/telemetry';

import { ClawHubService } from '../gateway/clawhub';
import { extensionRegistry } from '../extensions/registry';
import { loadExtensionsFromManifest } from '../extensions/loader';
import { registerAllBuiltinExtensions } from '../extensions/builtin';
import { loadExternalMainExtensions } from '../extensions/_ext-bridge.generated';
import { ensureUClawContext, repairUClawOnlyBootstrapFiles } from '../utils/openclaw-workspace';
import { autoInstallCliIfNeeded, generateCompletionCache, installCompletionToProfile } from '../utils/openclaw-cli';
import { isQuitting, setQuitting } from './app-state';
import { applyProxySettings } from './proxy';
import { syncLaunchAtStartupSettingFromStore } from './launch-at-startup';
import {
  clearPendingSecondInstanceFocus,
  consumeMainWindowReady,
  createMainWindowFocusState,
  requestSecondInstanceFocus,
} from './main-window-focus';
import {
  createQuitLifecycleState,
  markQuitCleanupCompleted,
  requestQuitLifecycleAction,
} from './quit-lifecycle';
import { createSignalQuitHandler } from './signal-quit';
import { acquireProcessInstanceFileLock } from './process-instance-lock';
import { ensureBuiltinSkillsInstalled, ensurePreinstalledSkillsInstalled } from '../utils/skill-config';
import { startHostApiServer } from '../api/server';
import { HostEventBus } from '../api/event-bus';
import { deviceOAuthManager } from '../utils/device-oauth';
import { browserOAuthManager } from '../utils/browser-oauth';
import { whatsAppLoginManager } from '../utils/whatsapp-login';
import { initializeDataRoot, resolveDataRoot, type DataRootResolution } from '../utils/data-root';
import { buildStorageDiagnostics } from '../utils/storage-diagnostics';
import { StartupProgressService } from './startup-progress-service';

// On Windows, set console output code page to UTF-8 (65001) early so that
// CJK characters in gateway stderr logs are not garbled when displayed in
// the terminal. chcp.com shares the parent's console and calls
// SetConsoleOutputCP(65001) on the shared console window.
if (process.platform === 'win32') {
  try {
    // Use spawnSync imported below — child_process is a CJS built-in available via require
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { spawnSync } = require('child_process') as typeof import('child_process');
    // Inherit stdin so the child process shares the parent's console handle,
    // allowing SetConsoleOutputCP(65001) to take effect on the shared console.
    spawnSync('chcp.com', ['65001'], { stdio: ['inherit', 'ignore', 'ignore'], windowsHide: true });
  } catch {
    // non-fatal — best effort
  }
}

const WINDOWS_APP_USER_MODEL_ID = 'app.uclaw.desktop';
const isE2EMode = process.env.UCLAW_E2E === '1';
let dataRootResolution: DataRootResolution;
let earlyStartupError: unknown = null;

function shouldUseInstalledWindowsAppUserModelId(): boolean {
  if (process.platform !== 'win32') return false;
  if (!app.isPackaged) return true;
  return dataRootResolution?.source === 'default';
}

// Disable GPU hardware acceleration globally for maximum stability across
// all GPU configurations (no GPU, integrated, discrete).
//
// Rationale (following VS Code's philosophy):
// - Page/file loading is async data fetching — zero GPU dependency.
// - The original per-platform GPU branching was added to avoid CPU rendering
//   competing with sync I/O on Windows, but all file I/O is now async
//   (fs/promises), so that concern no longer applies.
// - Software rendering is deterministic across all hardware; GPU compositing
//   behaviour varies between vendors (Intel, AMD, NVIDIA, Apple Silicon) and
//   driver versions, making it the #1 source of rendering bugs in Electron.
//
// Users who want GPU acceleration can pass `--enable-gpu` on the CLI or
// set `"disable-hardware-acceleration": false` in the app config (future).
app.disableHardwareAcceleration();

// On Linux, set CHROME_DESKTOP so Chromium can find the correct .desktop file.
// On Wayland this maps the running window to uclaw.desktop (→ icon + app grouping);
// on X11 it supplements the StartupWMClass matching.
// Must be called before app.whenReady() / before any window is created.
if (process.platform === 'linux') {
  app.setDesktopName('uclaw.desktop');
}

// Prevent multiple instances of the app from running simultaneously.
// Without this, two instances each spawn their own gateway process on the
// same port, then each treats the other's gateway as "orphaned" and kills
// it — creating an infinite kill/restart loop on Windows.
// The losing process must exit immediately so it never reaches Gateway startup.
const gotElectronLock = isE2EMode ? true : app.requestSingleInstanceLock();
if (!gotElectronLock) {
  console.info('[UClaw] Another instance already holds the single-instance lock; exiting duplicate process');
  app.exit(0);
}
if (gotElectronLock) {
  try {
    dataRootResolution = initializeDataRoot(app);
  } catch (error) {
    earlyStartupError = error;
    dataRootResolution = resolveDataRoot({
      defaultUserDataDir: app.getPath('userData'),
      exePath: app.getPath('exe'),
    });
    console.error('[UClaw] Failed to initialize data root; startup repair page will be shown', error);
  }
}
let releaseProcessInstanceFileLock: () => void = () => {};
let gotFileLock = true;
if (gotElectronLock && !isE2EMode) {
  try {
    const fileLock = acquireProcessInstanceFileLock({
      userDataDir: app.getPath('userData'),
      lockName: 'uclaw',
      force: true, // Electron lock already guarantees exclusivity; force-clean orphan/recycled-PID locks
    });
    gotFileLock = fileLock.acquired;
    releaseProcessInstanceFileLock = fileLock.release;
    if (!fileLock.acquired) {
      const ownerDescriptor = fileLock.ownerPid
        ? `${fileLock.ownerFormat ?? 'legacy'} pid=${fileLock.ownerPid}`
        : fileLock.ownerFormat === 'unknown'
          ? 'unknown lock format/content'
          : 'unknown owner';
      console.info(
        `[UClaw] Another instance already holds process lock (${fileLock.lockPath}, ${ownerDescriptor}); exiting duplicate process`,
      );
      app.exit(0);
    }
  } catch (error) {
    console.warn('[UClaw] Failed to acquire process instance file lock; continuing with Electron single-instance lock only', error);
  }
}
const gotTheLock = gotElectronLock && gotFileLock;

// Global references
let mainWindow: BrowserWindow | null = null;
let gatewayManager!: GatewayManager;
let clawHubService!: ClawHubService;
let hostEventBus!: HostEventBus;
let startupProgressService!: StartupProgressService;
let hostApiServer: Server | null = null;
const mainWindowFocusState = createMainWindowFocusState();
const quitLifecycleState = createQuitLifecycleState();

/**
 * Resolve the icons directory path (works in both dev and packaged mode)
 */
function getIconsDir(): string {
  if (app.isPackaged) {
    // Packaged: icons are in extraResources → process.resourcesPath/resources/icons
    return join(process.resourcesPath, 'resources', 'icons');
  }
  // Development: relative to dist-electron/main/
  return join(__dirname, '../../resources/icons');
}

/**
 * Get the app icon for the current platform
 */
function getAppIcon(): Electron.NativeImage | undefined {
  if (process.platform === 'darwin') return undefined; // macOS uses the app bundle icon

  const iconsDir = getIconsDir();
  const primaryIconPath =
    process.platform === 'win32'
      ? join(iconsDir, 'icon.ico')
      : join(iconsDir, 'icon.png');
  const fallbackIconPath = join(iconsDir, 'icon.png');
  const primaryIcon = nativeImage.createFromPath(primaryIconPath);
  if (!primaryIcon.isEmpty()) return primaryIcon;

  const fallbackIcon = nativeImage.createFromPath(fallbackIconPath);
  if (!fallbackIcon.isEmpty()) {
    logger.warn(`App icon ${primaryIconPath} could not be loaded; using ${fallbackIconPath}`);
    return fallbackIcon;
  }

  logger.warn(`App icons could not be loaded from ${iconsDir}`);
  return undefined;
}

/**
 * Create the main application window
 */
function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';
  const useCustomTitleBar = isWindows;
  const shouldSkipSetupForE2E = process.env.UCLAW_E2E_SKIP_SETUP === '1';

  const appIcon = getAppIcon();
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webviewTag: true, // Enable <webview> for embedding OpenClaw Control UI
    },
    titleBarStyle: isMac ? 'hiddenInset' : useCustomTitleBar ? 'hidden' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 16 } : undefined,
    frame: isMac || !useCustomTitleBar,
    show: false,
  });
  if (appIcon && process.platform === 'win32') {
    win.setIcon(appIcon);
  }

  // Handle external links — only allow safe protocols to prevent arbitrary
  // command execution via shell.openExternal() (e.g. file://, ms-msdt:, etc.)
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        shell.openExternal(url);
      } else {
        logger.warn(`Blocked openExternal for disallowed protocol: ${parsed.protocol}`);
      }
    } catch {
      logger.warn(`Blocked openExternal for malformed URL: ${url}`);
    }
    return { action: 'deny' };
  });

  // Load the app
  if (process.env.VITE_DEV_SERVER_URL) {
    const rendererUrl = new URL(process.env.VITE_DEV_SERVER_URL);
    if (shouldSkipSetupForE2E) {
      rendererUrl.searchParams.set('e2eSkipSetup', '1');
    }
    const devUrl = rendererUrl.toString();
    win.loadURL(devUrl);
    // Vite dev server may not be ready when Electron first opens the window.
    // Retry on ERR_CONNECTION_REFUSED until the server is up.
    win.webContents.on('did-fail-load', (_event, errorCode) => {
      if (errorCode === -102 && !win.isDestroyed()) {
        setTimeout(() => { if (!win.isDestroyed()) win.loadURL(devUrl); }, 1000);
      }
    });
    if (!isE2EMode) {
      win.webContents.openDevTools();
    }
  } else {
    win.loadFile(join(__dirname, '../../dist/index.html'), {
      query: shouldSkipSetupForE2E
        ? { e2eSkipSetup: '1' }
        : undefined,
    });
  }

  return win;
}

function focusWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) {
    return;
  }

  if (win.isMinimized()) {
    win.restore();
  }

  win.show();
  win.focus();
}

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  clearPendingSecondInstanceFocus(mainWindowFocusState);
  focusWindow(mainWindow);
}

function createMainWindow(): BrowserWindow {
  const win = createWindow();

  win.once('ready-to-show', () => {
    if (mainWindow !== win) {
      return;
    }

    const action = consumeMainWindowReady(mainWindowFocusState);
    if (action === 'focus') {
      focusWindow(win);
      return;
    }

    win.show();
  });

  win.on('close', (event) => {
    if (!isQuitting() && !isE2EMode) {
      event.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  mainWindow = win;
  return win;
}

/**
 * Initialize the application
 */
async function initialize(): Promise<void> {
  // Initialize logger first
  logger.init();
  logger.info('=== UClaw Application Starting ===');
  logger.debug(
    `Runtime: platform=${process.platform}/${process.arch}, electron=${process.versions.electron}, node=${process.versions.node}, packaged=${app.isPackaged}, pid=${process.pid}, ppid=${process.ppid}`
  );

  const storageDiagnostics = buildStorageDiagnostics({
    platform: process.platform,
    exePath: app.getPath('exe'),
    appPath: app.getAppPath(),
    dataRoot: dataRootResolution.dataRoot,
    uclawDir: dataRootResolution.uclawDir,
    openclawDir: dataRootResolution.openclawDir,
    workspaceDir: process.env.UCLAW_WORKSPACE_DIR ?? null,
    settingsPath: join(dataRootResolution.uclawDir, 'settings.json'),
    providerStorePath: join(dataRootResolution.uclawDir, 'uclaw-providers.json'),
  });
  if (storageDiagnostics.isAppTranslocated) {
    logger.warn(`[storage] AppTranslocation detected at ${storageDiagnostics.exePath}; startup side effects will be skipped.`);
  }

  if (!earlyStartupError && !isE2EMode && !storageDiagnostics.isAppTranslocated) {
    // Warm up network optimization (non-blocking)
    void warmupNetworkOptimization();

    // Initialize Telemetry early
    await initTelemetry();

    // Apply persisted proxy settings before creating windows or network requests.
    await applyProxySettings();
    await syncLaunchAtStartupSettingFromStore();
  } else if (storageDiagnostics.isAppTranslocated) {
    logger.warn('Startup side effects minimized because macOS AppTranslocation is active');
  } else {
    logger.info('Running in E2E mode: startup side effects minimized');
  }

  // Set application menu
  createMenu();

  // Create the main window
  const window = createMainWindow();

  // Create system tray
  if (!earlyStartupError && !isE2EMode && !storageDiagnostics.isAppTranslocated) {
    createTray(window);
  }

  // Override security headers ONLY for the OpenClaw Gateway Control UI.
  // The URL filter ensures this callback only fires for gateway requests,
  // avoiding unnecessary overhead on every other HTTP response.
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['http://127.0.0.1:18789/*', 'http://localhost:18789/*'] },
    (details, callback) => {
      const headers = { ...details.responseHeaders };
      delete headers['X-Frame-Options'];
      delete headers['x-frame-options'];
      if (headers['Content-Security-Policy']) {
        headers['Content-Security-Policy'] = headers['Content-Security-Policy'].map(
          (csp) => csp.replace(/frame-ancestors\s+'none'/g, "frame-ancestors 'self' *")
        );
      }
      if (headers['content-security-policy']) {
        headers['content-security-policy'] = headers['content-security-policy'].map(
          (csp) => csp.replace(/frame-ancestors\s+'none'/g, "frame-ancestors 'self' *")
        );
      }
      callback({ responseHeaders: headers });
    },
  );

  // Register IPC handlers
  registerIpcHandlers(gatewayManager, clawHubService, window);
  startupProgressService.registerIpcHandlers();

  if (earlyStartupError) {
    await startupProgressService.runInitialStartup({ isE2EMode, storageDiagnostics, startupError: earlyStartupError });
    logger.error('Initialization stopped because data root startup failed:', earlyStartupError);
    return;
  }

  if (storageDiagnostics.isAppTranslocated) {
    await startupProgressService.runInitialStartup({ isE2EMode, storageDiagnostics });
    logger.warn('Initialization stopped before Host API, extensions, and Gateway startup because macOS AppTranslocation is active');
    return;
  }

  hostApiServer = startHostApiServer({
    gatewayManager,
    clawHubService,
    eventBus: hostEventBus,
    mainWindow: window,
  });

  // Initialize extension system
  await extensionRegistry.initialize({
    gatewayManager,
    eventBus: hostEventBus,
    getMainWindow: () => mainWindow,
  });

  // Wire marketplace provider to ClawHubService if an extension provides one
  const marketplaceProvider = extensionRegistry.getMarketplaceProvider();
  if (marketplaceProvider) {
    clawHubService.setMarketplaceProvider(marketplaceProvider);
  }

  // Register update handlers
  registerUpdateHandlers(appUpdater, window);

  // Note: Auto-check for updates is driven by the renderer (update store init)
  // so it respects the user's "Auto-check for updates" setting.

  // Repair any bootstrap files that only contain UClaw markers (no OpenClaw
  // template content). This fixes a race condition where ensureUClawContext()
  // previously created the file before the gateway could seed the full template.
  if (!isE2EMode && !storageDiagnostics.isAppTranslocated) {
    void repairUClawOnlyBootstrapFiles().catch((error) => {
      logger.warn('Failed to repair bootstrap files:', error);
    });
  }

  // Pre-deploy built-in skills (feishu-doc, feishu-drive, feishu-perm, feishu-wiki)
  // to ~/.openclaw/skills/ so they are immediately available without manual install.
  if (!isE2EMode && !storageDiagnostics.isAppTranslocated) {
    void ensureBuiltinSkillsInstalled().catch((error) => {
      logger.warn('Failed to install built-in skills:', error);
    });
  }

  // Pre-deploy bundled third-party skills from resources/preinstalled-skills.
  // This installs full skill directories (not only SKILL.md) in an idempotent,
  // non-destructive way and never blocks startup.
  if (!isE2EMode && !storageDiagnostics.isAppTranslocated) {
    void ensurePreinstalledSkillsInstalled().catch((error) => {
      logger.warn('Failed to install preinstalled skills:', error);
    });
  }

  // Bridge gateway and host-side events before any auto-start logic runs, so
  // renderer subscribers observe the full startup lifecycle.
  gatewayManager.on('status', (status: { state: string }) => {
    hostEventBus.emit('gateway:status', status);
    if (status.state === 'running' && !isE2EMode && !storageDiagnostics.isAppTranslocated) {
      void ensureUClawContext().catch((error) => {
        logger.warn('Failed to re-merge UClaw context after gateway reconnect:', error);
      });
    }
  });

  gatewayManager.on('error', (error) => {
    hostEventBus.emit('gateway:error', { message: error.message });
  });

  gatewayManager.on('notification', (notification) => {
    hostEventBus.emit('gateway:notification', notification);
  });

  gatewayManager.on('chat:message', (data) => {
    hostEventBus.emit('gateway:chat-message', data);
  });

  gatewayManager.on('channel:status', (data) => {
    hostEventBus.emit('gateway:channel-status', data);
  });

  gatewayManager.on('exit', (code) => {
    hostEventBus.emit('gateway:exit', { code });
  });

  deviceOAuthManager.on('oauth:code', (payload) => {
    hostEventBus.emit('oauth:code', payload);
  });

  deviceOAuthManager.on('oauth:start', (payload) => {
    hostEventBus.emit('oauth:start', payload);
  });

  deviceOAuthManager.on('oauth:success', (payload) => {
    hostEventBus.emit('oauth:success', { ...payload, success: true });
  });

  deviceOAuthManager.on('oauth:error', (error) => {
    hostEventBus.emit('oauth:error', error);
  });

  browserOAuthManager.on('oauth:start', (payload) => {
    hostEventBus.emit('oauth:start', payload);
  });

  browserOAuthManager.on('oauth:code', (payload) => {
    hostEventBus.emit('oauth:code', payload);
  });

  browserOAuthManager.on('oauth:success', (payload) => {
    hostEventBus.emit('oauth:success', { ...payload, success: true });
  });

  browserOAuthManager.on('oauth:error', (error) => {
    hostEventBus.emit('oauth:error', error);
  });

  whatsAppLoginManager.on('qr', (data) => {
    hostEventBus.emit('channel:whatsapp-qr', data);
  });

  whatsAppLoginManager.on('success', (data) => {
    hostEventBus.emit('channel:whatsapp-success', data);
  });

  whatsAppLoginManager.on('error', (error) => {
    hostEventBus.emit('channel:whatsapp-error', error);
  });

  await startupProgressService.runInitialStartup({ isE2EMode, storageDiagnostics });

  // Merge UClaw context snippets into the workspace bootstrap files.
  // The gateway seeds workspace files asynchronously after its HTTP server
  // is ready, so ensureUClawContext will retry until the target files appear.
  const startupStatus = startupProgressService.getSnapshot().status;
  if (!isE2EMode && !storageDiagnostics.isAppTranslocated && (startupStatus === 'ready' || startupStatus === 'warning')) {
    void ensureUClawContext().catch((error) => {
      logger.warn('Failed to merge UClaw context into workspace:', error);
    });
  }

  // Auto-install openclaw CLI and shell completions (non-blocking).
  if (!isE2EMode && !storageDiagnostics.isAppTranslocated) {
    void autoInstallCliIfNeeded((installedPath) => {
      mainWindow?.webContents.send('openclaw:cli-installed', installedPath);
    }).then(() => {
      generateCompletionCache();
      installCompletionToProfile();
    }).catch((error) => {
      logger.warn('CLI auto-install failed:', error);
    });
  }
}

if (gotTheLock) {
  const requestQuitOnSignal = createSignalQuitHandler({
    logInfo: (message) => logger.info(message),
    requestQuit: () => app.quit(),
  });

  process.on('exit', () => {
    dataRootResolution.releaseDataRootLock?.();
    releaseProcessInstanceFileLock();
  });

  process.once('SIGINT', () => requestQuitOnSignal('SIGINT'));
  process.once('SIGTERM', () => requestQuitOnSignal('SIGTERM'));

  app.on('will-quit', () => {
    dataRootResolution.releaseDataRootLock?.();
    releaseProcessInstanceFileLock();
  });

  if (shouldUseInstalledWindowsAppUserModelId()) {
    app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID);
  } else if (process.platform === 'win32') {
    logger.info(
      `Skipping installed AppUserModelId for portable/data-root launch (source=${dataRootResolution?.source ?? 'unknown'})`,
    );
  }

  gatewayManager = new GatewayManager();
  clawHubService = new ClawHubService();
  hostEventBus = new HostEventBus();
  startupProgressService = new StartupProgressService({
    gatewayManager,
    getMainWindow: () => mainWindow,
  });

  // Register builtin extensions and load manifest
  registerAllBuiltinExtensions();
  loadExternalMainExtensions();
  void loadExtensionsFromManifest().catch((err) => {
    logger.warn('Failed to load extensions from manifest:', err);
  });

  // When a second instance is launched, focus the existing window instead.
  app.on('second-instance', () => {
    logger.info('Second UClaw instance detected; redirecting to the existing window');

    const focusRequest = requestSecondInstanceFocus(
      mainWindowFocusState,
      Boolean(mainWindow && !mainWindow.isDestroyed()),
    );

    if (focusRequest === 'focus-now') {
      focusMainWindow();
      return;
    }

    logger.debug('Main window is not ready yet; deferring second-instance focus until ready-to-show');
  });

  // Application lifecycle
  app.whenReady().then(() => {
    void initialize().catch((error) => {
      logger.error('Application initialization failed:', error);
    });

    // Register activate handler AFTER app is ready to prevent
    // "Cannot create BrowserWindow before app is ready" on macOS.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      } else {
        focusMainWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' || isE2EMode) {
      app.quit();
    }
  });

  app.on('before-quit', (event) => {
    setQuitting();
    const action = requestQuitLifecycleAction(quitLifecycleState);

    if (action === 'allow-quit') {
      return;
    }

    event.preventDefault();

    if (action === 'cleanup-in-progress') {
      logger.debug('Quit requested while cleanup already in progress; waiting for shutdown task to finish');
      return;
    }

    hostEventBus.closeAll();
    hostApiServer?.close();
    void extensionRegistry.teardownAll();

    const stopPromise = gatewayManager.stop().catch((err) => {
      logger.warn('gatewayManager.stop() error during quit:', err);
    });
    const timeoutPromise = new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), 5000);
    });

    void Promise.race([stopPromise.then(() => 'stopped' as const), timeoutPromise]).then((result) => {
      if (result === 'timeout') {
        logger.warn('Gateway shutdown timed out during app quit; proceeding with forced quit');
        void gatewayManager.forceTerminateOwnedProcessForQuit().then((terminated) => {
          if (terminated) {
            logger.warn('Forced gateway process termination completed after quit timeout');
          }
        }).catch((err) => {
          logger.warn('Forced gateway termination failed after quit timeout:', err);
        });
      }
      markQuitCleanupCompleted(quitLifecycleState);
      app.quit();
    });
  });

  // Best-effort Gateway cleanup on unexpected crashes.
  // These handlers attempt to terminate the Gateway child process within a
  // short timeout before force-exiting, preventing orphaned processes.
  const emergencyGatewayCleanup = (reason: string, error: unknown): void => {
    logger.error(`${reason}:`, error);
    try {
      void gatewayManager?.stop().catch(() => { /* ignore */ });
    } catch {
      // ignore — stop() may not be callable if state is corrupted
    }
    // Give Gateway stop a brief window, then force-exit.
    setTimeout(() => {
      process.exit(1);
    }, 3000).unref();
  };

  process.on('uncaughtException', (error) => {
    emergencyGatewayCleanup('Uncaught exception in main process', error);
  });

  process.on('unhandledRejection', (reason) => {
    emergencyGatewayCleanup('Unhandled promise rejection in main process', reason);
  });
}

// Export for testing
export { mainWindow, gatewayManager };
