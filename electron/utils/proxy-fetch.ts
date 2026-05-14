/**
 * Use Electron's network stack when available so requests honor
 * session.defaultSession.setProxy(...). Fall back to the Node global fetch
 * for non-Electron test environments.
 */

export async function proxyAwareFetch(
  input: string | URL,
  init?: RequestInit
): Promise<Response> {
  let electronFetchError: unknown;

  if (process.versions.electron) {
    try {
      const { net } = await import('electron');
      return await net.fetch(input, init);
    } catch (error) {
      electronFetchError = error;
      // Fall through to the global fetch.
    }
  }

  try {
    return await fetch(input, init);
  } catch (error) {
    if (error instanceof Error && electronFetchError && !error.cause) {
      error.cause = electronFetchError;
    }
    throw error;
  }
}
