'use server';

import { cookies } from 'next/headers';
import type { ApiResponse, ActionResult } from '@/server/contracts/common';
import { SessionExpiredError } from '@/server/errors';
import { SERVER_API_BASE_URL } from '@/config/env';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  clearSessionCookies,
  serverFetch,
  setSessionCookies,
} from '@/server/http';
import type {
  LoginRequest,
  SignupRequest,
  TokenResponse,
  UserResponse,
} from './auth.contracts';

export async function loginAction(
  request: LoginRequest,
): Promise<ActionResult<TokenResponse>> {
  let response: Response;
  try {
    response = await fetch(`${SERVER_API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  } catch {
    return { ok: false, error: `Cannot reach server at ${SERVER_API_BASE_URL}` };
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Login failed' }));
    return { ok: false, error: error.message || 'Invalid credentials' };
  }

  const result: ApiResponse<TokenResponse> = await response.json();
  await setSessionCookies(result.data);
  return { ok: true, data: result.data };
}

export async function signupAction(
  request: SignupRequest,
): Promise<ActionResult<UserResponse>> {
  let response: Response;
  try {
    response = await fetch(`${SERVER_API_BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  } catch {
    return { ok: false, error: `Cannot reach server at ${SERVER_API_BASE_URL}` };
  }

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: 'Signup failed' }));
    if (error.fieldErrors) {
      const fieldErrorMessages = Object.entries(error.fieldErrors)
        .map(([field, msgs]) => `${field}: ${(msgs as string[]).join(', ')}`)
        .join('; ');
      return {
        ok: false,
        error: `${error.message || 'Validation failed'}: ${fieldErrorMessages}`,
      };
    }
    return { ok: false, error: error.message || 'Signup failed' };
  }

  const result: ApiResponse<UserResponse> = await response.json();
  return { ok: true, data: result.data };
}

/**
 * Read the session from the HttpOnly access cookie. Source of truth for
 * "is the user logged in?" on the client — the cookie is, not localStorage.
 *
 * Returns `{ ok: true, data: null }` for "definitely logged out" so
 * AuthContext can clear stale localStorage in lock-step with the cookie
 * state. Returns `{ ok: false }` only on transient network failure so the
 * caller can keep the current session optimistically.
 */
export async function getSessionAction(): Promise<ActionResult<UserResponse | null>> {
  try {
    const result = await serverFetch<ApiResponse<UserResponse>>('/api/auth/me');
    return { ok: true, data: result.data };
  } catch (err) {
    if (err instanceof SessionExpiredError) {
      // serverFetch already cleared cookies in the terminal-failure branch.
      return { ok: true, data: null };
    }
    // Transient network failure — keep the session optimistically.
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/**
 * Returns the current access token for use as a WebSocket `Authorization`
 * Bearer header. The STOMP/SockJS client can't read HttpOnly cookies, so
 * the token has to be handed over via JS — it lives in memory only on
 * the consumer side (no localStorage), and is short-lived (minutes).
 */
export async function getAccessTokenAction(): Promise<ActionResult<string | null>> {
  try {
    const jar = await cookies();
    return { ok: true, data: jar.get(ACCESS_COOKIE)?.value ?? null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function logoutAction(): Promise<{ ok: true }> {
  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;

  if (refreshToken) {
    try {
      await fetch(`${SERVER_API_BASE_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // Best-effort. The cookies are cleared regardless so the client is
      // logged out locally even if the backend revoke call fails.
    }
  }

  await clearSessionCookies();
  return { ok: true };
}
