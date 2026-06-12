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
import { CompanyKeyPage } from './pages/CompanyKeyPage';
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
  const [storageDiagnosticsLoaded, setStorageDiagnosticsLoaded] = useState(false);
  const [globalError, setGlobalError] = useState<{ error: unknown; detail?: string } | null>(null);
  const initSettings = useSettingsStore((state) => state.init);
  const theme = useSettingsStore((state) => state.theme);
  const language = useSettingsStore((state) => state.language);
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
    invokeIpc('app:getStorageDiagnostics')
      .catch(() => {})
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
    if (!storageDiagnosticsLoaded) return;
    if (startupSnapshot?.status !== 'ready') return;
    initGateway();
  }, [initGateway, storageDiagnosticsLoaded, startupSnapshot?.status]);

  // Initialize provider snapshot on mount
  useEffect(() => {
    if (!storageDiagnosticsLoaded) return;
    if (startupSnapshot?.status !== 'ready') return;
    initProviders();
  }, [initProviders, storageDiagnosticsLoaded, startupSnapshot?.status]);

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
  const isCompanyKeyRoute = location.pathname.startsWith('/company-key') || location.pathname.startsWith('/setup');

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

  if (startupSnapshot?.status === 'blockedBySetup') {
    return (
      <ErrorBoundary>
        <TooltipProvider delayDuration={300}>
          <Routes>
            <Route path="*" element={<CompanyKeyPage />} />
          </Routes>
          <Toaster position="bottom-right" richColors closeButton style={{ zIndex: 99999 }} />
        </TooltipProvider>
      </ErrorBoundary>
    );
  }

  if (isCompanyKeyRoute && startupSnapshot?.status !== 'ready') {
    return (
      <ErrorBoundary>
        <TooltipProvider delayDuration={300}>
          <CompanyKeyPage />
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
          <Route path="/setup/*" element={<CompanyKeyPage />} />
          <Route path="/company-key" element={<CompanyKeyPage />} />

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
