'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

const PREFIX = '[FRONTEND]';
const isDev = process.env.NODE_ENV === 'development';

/**
 * Development-only browser console breadcrumbs.
 *
 * Server Actions and RSC calls run in the Next server, so they normally show
 * up in the terminal (prefixed `[FRONTEND]` by `pnpm dev`) rather than in the
 * browser console. This logger adds the client-side view: route changes,
 * browser fetch calls, and uncaught errors. It is a no-op in production.
 */
export function DevConsoleLogger() {
  const pathname = usePathname();
  const lastPathname = useRef<string | null>(null);

  useEffect(() => {
    if (!isDev || lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    console.log(`${PREFIX} route ${pathname}`);
  }, [pathname]);

  useEffect(() => {
    if (!isDev) return;

    const onError = (event: ErrorEvent) => {
      console.error(`${PREFIX} window error`, event.error ?? event.message);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      console.error(`${PREFIX} unhandled rejection`, event.reason);
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  useEffect(() => {
    if (!isDev) return;

    const originalFetch = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = (
        init?.method ?? (input instanceof Request ? input.method : 'GET')
      ).toUpperCase();
      const started = performance.now();

      try {
        const response = await originalFetch(input, init);
        const duration = Math.round(performance.now() - started);
        console.log(`${PREFIX} ${method} ${url} -> ${response.status} (${duration}ms)`);
        return response;
      } catch (error) {
        console.error(`${PREFIX} ${method} ${url} failed`, error);
        throw error;
      }
    };

    console.log(`${PREFIX} client logger ready`);

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}
