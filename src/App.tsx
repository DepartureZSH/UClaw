/**
 * Root Application Component
 * Handles routing and global providers
 */
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Component, useEffect, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Toaster } from 'sonner';
import i18n from './i18n';
import { MainLayout } from './components/layout/MainLayout';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Models } from './pages/Models';
import { Chat } from './pages/Chat';
import { Agents } from './pages/Agents';
import { Channels } from './pages/Channels';
import { Skills } from './pages/Skills';
import { Cron } from './pages/Cron';
import { Settings } from './pages/Settings';
import { Setup } from './pages/Setup';
import { StartupLoadingPage } from './pages/StartupLoadingPage';
import { ErrorRepairPage } from './pages/ErrorRepairPage';
import { useSettingsStore } from './stores/settings';
import { useGatewayStore } from './stores/gateway';
import { useProviderStore } from './stores/providers';
import { useStartupStore } from './stores/startup';
import { applyGatewayTransportPreference, invokeIpc } from './lib/api-client';
import { classifyRendererError, stringifyRepairError } from './lib/error-repair';
import { rendererExtensionRegistry } from './extensions/registry';
import { loadExternalRendererExtensions } from './extensions/_ext-bridge.generated';

type StorageDiagnostics = {
  platform: string;
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
};


/**
 * Error Boundary to catch and display React rendering errors
 */
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null; componentStack: string }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error, componentStack: '' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('React Error Boundary caught error:', error, info);
    this.setState({ componentStack: info.componentStack ?? '' });
  }

  render() {
    if (this.state.hasError) {
      const model = classifyRendererError(this.state.error);
      return (
        <ErrorRepairPage
          title="UClaw 界面遇到问题"
          message={model.message}
          issue={model.issue}
          actions={model.actions}
          detail={stringifyRepairError(this.state.error, this.state.componentStack)}
          onRetry={() => this.setState({ hasError: false, error: null, componentStack: '' })}
        />
      );
    }
    return this.props.children;
  }
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [storageDiagnostics, setStorageDiagnostics] = useState<StorageDiagnostics | null>(null);
  const [storageDiagnosticsLoaded, setStorageDiagnosticsLoaded] = useState(false);
  const [globalError, setGlobalError] = useState<{ error: unknown; detail?: string } | null>(null);
  const skipSetupForE2E = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('e2eSkipSetup') === '1';
  const initSettings = useSettingsStore((state) => state.init);
  const theme = useSettingsStore((state) => state.theme);
  const language = useSettingsStore((state) => state.language);
  const setupComplete = useSettingsStore((state) => state.setupComplete);
  const initGateway = useGatewayStore((state) => state.init);
  const initProviders = useProviderStore((state) => state.init);
  const initStartup = useStartupStore((state) => state.init);
  const startupSnapshot = useStartupStore((state) => state.snapshot);

  useEffect(() => {
    initSettings();
  }, [initSettings]);

  useEffect(() => {
    initStartup();
  }, [initStartup]);

  useEffect(() => {
    let cancelled = false;
    invokeIpc<StorageDiagnostics>('app:getStorageDiagnostics')
      .then((diagnostics) => {
        if (!cancelled) setStorageDiagnostics(diagnostics);
      })
      .catch(() => {
        if (!cancelled) setStorageDiagnostics(null);
      })
      .finally(() => {
        if (!cancelled) setStorageDiagnosticsLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  // Sync i18n language with persisted settings on mount
  useEffect(() => {
    if (language && language !== i18n.language) {
      i18n.changeLanguage(language);
    }
  }, [language]);

  // Initialize Gateway connection on mount
  useEffect(() => {
    if (!storageDiagnosticsLoaded || storageDiagnostics?.isAppTranslocated) return;
    if (startupSnapshot?.status !== 'ready') return;
    initGateway();
  }, [initGateway, storageDiagnosticsLoaded, storageDiagnostics?.isAppTranslocated, startupSnapshot?.status]);

  // Initialize provider snapshot on mount
  useEffect(() => {
    if (!storageDiagnosticsLoaded || storageDiagnostics?.isAppTranslocated) return;
    if (startupSnapshot?.status !== 'ready') return;
    initProviders();
  }, [initProviders, storageDiagnosticsLoaded, storageDiagnostics?.isAppTranslocated, startupSnapshot?.status]);

  // Redirect to setup wizard if not complete
  useEffect(() => {
    if (storageDiagnostics?.isAppTranslocated) return;
    if (
      (startupSnapshot?.status === 'blockedBySetup' || (!setupComplete && !skipSetupForE2E))
      && !location.pathname.startsWith('/setup')
    ) {
      navigate('/setup');
    }
  }, [setupComplete, skipSetupForE2E, location.pathname, navigate, storageDiagnostics?.isAppTranslocated, startupSnapshot?.status]);

  // Listen for navigation events from main process
  useEffect(() => {
    const handleNavigate = (...args: unknown[]) => {
      const path = args[0];
      if (typeof path === 'string') {
        navigate(path);
      }
    };

    const unsubscribe = window.electron.ipcRenderer.on('navigate', handleNavigate);

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [navigate]);

  // Apply theme
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
  }, [theme]);

  useEffect(() => {
    applyGatewayTransportPreference();
  }, []);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      setGlobalError({ error: event.error ?? event.message, detail: `${event.filename}:${event.lineno}:${event.colno}` });
    };
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      setGlobalError({ error: event.reason ?? 'Unhandled promise rejection' });
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  // Load external renderer extensions (generated by scripts/generate-ext-bridge.mjs)
  // and initialize all registered extensions.
  useEffect(() => {
    loadExternalRendererExtensions();
    void rendererExtensionRegistry.initializeAll();
    return () => rendererExtensionRegistry.teardownAll();
  }, []);

  const extraRoutes = rendererExtensionRegistry.getExtraRoutes();

  if (globalError) {
    const model = classifyRendererError(globalError.error);
    return (
      <TooltipProvider delayDuration={300}>
        <ErrorRepairPage
          title="UClaw 遇到运行错误"
          message={model.message}
          issue={model.issue}
          actions={model.actions}
          detail={stringifyRepairError(globalError.error, globalError.detail)}
          onRetry={() => setGlobalError(null)}
        />
        <Toaster position="bottom-right" richColors closeButton style={{ zIndex: 99999 }} />
      </TooltipProvider>
    );
  }

  if (storageDiagnostics?.isAppTranslocated) {
    return (
      <ErrorBoundary>
        <TooltipProvider delayDuration={300}>
          <ErrorRepairPage
            title="UClaw 启动已阻止"
            message="检测到 macOS App Translocation。为避免写入错误位置，UClaw 已停止继续启动。"
            issue={{
              type: 'external',
              severity: 'S0',
              code: 'MACOS_APP_TRANSLOCATION',
              title: 'macOS App Translocation',
              suggestion: '请把 UClaw 移到固定位置后重新打开，必要时清理 quarantine 属性。数据目录可以放在移动盘，但 macOS app 不建议直接放在 ExFAT 上运行。',
            }}
            actions={[
              { id: 'copy-diagnostics', label: '复制修复命令', variant: 'primary' },
              { id: 'relaunch-app', label: '重启 UClaw' },
              { id: 'quit-app', label: '退出应用', variant: 'danger' },
            ]}
            detail={[
              `exePath: ${storageDiagnostics.exePath}`,
              `appPath: ${storageDiagnostics.appPath}`,
              `dataRoot: ${storageDiagnostics.dataRoot}`,
              `recommendedLaunchCommand: ${storageDiagnostics.recommendedLaunchCommand ?? '-'}`,
              'fixCommands:',
              storageDiagnostics.translocationFixCommands.join('\n'),
            ].join('\n')}
          />
          <Toaster position="bottom-right" richColors closeButton style={{ zIndex: 99999 }} />
        </TooltipProvider>
      </ErrorBoundary>
    );
  }

  if (startupSnapshot?.status === 'blockedBySetup') {
    return (
      <ErrorBoundary>
        <TooltipProvider delayDuration={300}>
          <Routes>
            <Route path="*" element={<Setup />} />
          </Routes>
          <Toaster position="bottom-right" richColors closeButton style={{ zIndex: 99999 }} />
        </TooltipProvider>
      </ErrorBoundary>
    );
  }

  if (startupSnapshot?.status !== 'ready') {
    return (
      <ErrorBoundary>
        <TooltipProvider delayDuration={300}>
          <StartupLoadingPage snapshot={startupSnapshot} />
          <Toaster position="bottom-right" richColors closeButton style={{ zIndex: 99999 }} />
        </TooltipProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <TooltipProvider delayDuration={300}>
        <Routes>
          {/* Setup wizard (shown on first launch) */}
          <Route path="/setup/*" element={<Setup />} />

          {/* Main application routes */}
          <Route element={<MainLayout />}>
            <Route path="/" element={<Chat />} />
            <Route path="/models" element={<Models />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/channels" element={<Channels />} />
            <Route path="/skills" element={<Skills />} />
            <Route path="/cron" element={<Cron />} />
            <Route path="/settings/*" element={<Settings />} />
            {extraRoutes.map((r) => (
              <Route key={r.path} path={r.path} element={<r.component />} />
            ))}
          </Route>
        </Routes>

        {/* Global toast notifications */}
        <Toaster
          position="bottom-right"
          richColors
          closeButton
          style={{ zIndex: 99999 }}
        />
      </TooltipProvider>
    </ErrorBoundary>
  );
}

export default App;
