import { NextResponse, type NextRequest } from 'next/server';
import { SERVER_API_BASE_URL } from '@/config/env';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE_SECONDS,
  cookieOptions,
} from '@/server/cookies';

// Routes that require an authenticated session. Anything not matching here
// passes through; this is the primary route guard (the editor pages also
// re-check server-side when serverFetch hits a 401).
// `/api/export` is included so proactive refresh runs before the route
// handler proxies the blob download.
const PROTECTED_PREFIXES = ['/home', '/workspace', '/api/export'];

// Routes that should redirect to /home when the user already has a session.
const GUEST_ONLY_PREFIXES = ['/login', '/signup'];

const matches = (path: string, prefixes: string[]) =>
  prefixes.some((p) => path === p || path.startsWith(`${p}/`));

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const hasAccess = request.cookies.has(ACCESS_COOKIE);
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  const isProtected = matches(pathname, PROTECTED_PREFIXES);
  const isGuestOnly = matches(pathname, GUEST_ONLY_PREFIXES);

  // Proactive refresh: access TTL is short, refresh TTL is 30 days. When the
  // access cookie has expired but refresh is still alive, swap tokens here
  // — middleware is the only pre-render place that can both call the API and
  // mutate cookies.
  if (isProtected && !hasAccess && refreshToken) {
    let refreshResponse: Response | null = null;
    try {
      refreshResponse = await fetch(`${SERVER_API_BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // API unreachable. Send to login; cookies stay so a retry can
      // refresh once the backend is back.
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }

    if (refreshResponse.ok) {
      const { data } = (await refreshResponse.json()) as {
        data: { accessToken: string; refreshToken: string; expiresIn: number };
      };

      // Make the new access cookie visible to downstream RSC in this same
      // request — request.cookies.set mutates the Cookie header, which we
      // forward via NextResponse.next({ request: { headers } }).
      request.cookies.set(ACCESS_COOKIE, data.accessToken);
      request.cookies.set(REFRESH_COOKIE, data.refreshToken);

      const response = NextResponse.next({
        request: { headers: request.headers },
      });
      response.cookies.set(ACCESS_COOKIE, data.accessToken, cookieOptions(data.expiresIn));
      response.cookies.set(
        REFRESH_COOKIE,
        data.refreshToken,
        cookieOptions(REFRESH_MAX_AGE_SECONDS),
      );
      return response;
    }

    // Refresh rejected — clear both cookies and route to /login.
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    const response = NextResponse.redirect(url);
    response.cookies.delete(ACCESS_COOKIE);
    response.cookies.delete(REFRESH_COOKIE);
    return response;
  }

  const hasSession = hasAccess || !!refreshToken;

  if (isProtected && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (isGuestOnly && hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = '/home';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.svg|.*\\.png).*)'],
};
