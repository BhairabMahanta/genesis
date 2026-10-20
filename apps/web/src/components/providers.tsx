'use client';

import { Toaster } from 'sonner';
import { DevConsoleLogger } from '@/components/dev-console-logger';

/**
 * Root providers — available on every route. Only truly global, render-agnostic
 * providers belong here. `AuthProvider` is mounted per route group instead so
 * each can seed it from a server-resolved session: `(app)` with the logged-in
 * user (no auth loader flash), `(auth)` with `null`. `NotificationProvider` is
 * likewise scoped to `(app)` so no STOMP socket opens on auth pages.
 */
export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <>
            <DevConsoleLogger />
            {children}
            <Toaster position="top-right" richColors closeButton />
        </>
    );
}
