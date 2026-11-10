import { cookies } from 'next/headers';
import { ACCESS_COOKIE } from '@/server/http';
import { SERVER_API_BASE_URL } from '@/config/env';

/**
 * Proxies WSD sense/annotation exports from the API to the browser.
 * Server actions cannot stream binary, so downloads live in a route handler.
 * Middleware refreshes the access cookie before this runs (`/api/wsd` is in
 * the protected prefix list).
 */

const EXPORT_KINDS = new Set(['senses', 'annotations']);
const FORMATS = new Set(['csv', 'xlsx']);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; kind: string }> },
) {
  const { workspaceId, kind } = await params;
  if (!EXPORT_KINDS.has(kind)) {
    return new Response('Not found', { status: 404 });
  }

  const format = new URL(request.url).searchParams.get('format') ?? 'csv';
  if (!FORMATS.has(format)) {
    return new Response('Unsupported format', { status: 400 });
  }

  const jar = await cookies();
  const accessToken = jar.get(ACCESS_COOKIE)?.value;
  if (!accessToken) {
    return new Response('Unauthorized', { status: 401 });
  }

  const upstream = await fetch(
    `${SERVER_API_BASE_URL}/api/workspaces/${workspaceId}/wsd/export/${kind}?format=${format}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!upstream.ok) {
    return new Response(`Export failed (${upstream.status})`, { status: upstream.status });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/octet-stream',
      'Content-Disposition': upstream.headers.get('Content-Disposition') ?? '',
      'Cache-Control': 'no-store',
    },
  });
}
