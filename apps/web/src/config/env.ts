/**
 * Validated, Edge-safe environment access.
 *
 * Imported by `src/middleware.ts` (Edge runtime), `src/server/http.ts`, and
 * client code. It must therefore NOT import `server-only` or `next/headers`.
 * `NEXT_PUBLIC_*` vars are inlined at build time, so this resolves on the
 * server, the Edge, and the client alike.
 */

if (!process.env.NEXT_PUBLIC_API_URL && process.env.NODE_ENV === 'production') {
    throw new Error('NEXT_PUBLIC_API_URL must be set in production builds');
}

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

/**
 * Base URL for calls that originate INSIDE the deployment — Server Actions,
 * Route Handlers, middleware refresh, and RSC `serverFetch`. In Docker the
 * browser-facing `NEXT_PUBLIC_API_URL` (e.g. `http://localhost:8080`) points at
 * the host and is wrong for container-to-container calls, where the backend is
 * reachable by its compose service name. Set `INTERNAL_API_URL` (e.g.
 * `http://backend:8080`) to override; it falls back to `API_BASE_URL` for local
 * dev and for production deploys where one public URL is reachable from both the
 * browser and the server.
 *
 * Not a `NEXT_PUBLIC_` var, so it is never inlined into the client bundle — the
 * internal hostname never leaks to the browser.
 */
export const SERVER_API_BASE_URL = process.env.INTERNAL_API_URL || API_BASE_URL;
