import { create } from 'zustand';
import {
  getStartupSnapshot,
  runStartupAction,
  subscribeStartupProgress,
  type StartupActionRequest,
  type StartupActionResult,
  type StartupSnapshot,
} from '@/lib/startup';

interface StartupState {
  snapshot: StartupSnapshot | null;
  initialized: boolean;
  lastError: string | null;
  init: () => Promise<void>;
  runAction: (request: StartupActionRequest) => Promise<StartupActionResult | null>;
}

let startupInitPromise: Promise<void> | null = null;
let startupUnsubscribe: (() => void) | null = null;

export const useStartupStore = create<StartupState>((set) => ({
  snapshot: null,
  initialized: false,
  lastError: null,

  init: async () => {
    if (startupInitPromise) {
      await startupInitPromise;
      return;
    }

    startupInitPromise = (async () => {
      try {
        const snapshot = await getStartupSnapshot();
        set({ snapshot, initialized: true, lastError: null });

        if (!startupUnsubscribe) {
          startupUnsubscribe = subscribeStartupProgress((nextSnapshot) => {
            set({ snapshot: nextSnapshot, initialized: true, lastError: null });
          });
        }
      } catch (error) {
        set({ initialized: true, lastError: String(error) });
      } finally {
        startupInitPromise = null;
      }
    })();

    await startupInitPromise;
  },

  runAction: async (request) => {
    try {
      const result = await runStartupAction(request);
      set({ snapshot: result.snapshot, lastError: null });
      return result;
    } catch (error) {
      set({ lastError: String(error) });
      return null;
    }
  },
}));
