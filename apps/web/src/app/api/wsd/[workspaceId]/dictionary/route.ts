import { cookies } from 'next/headers';
import { ACCESS_COOKIE } from '@/server/http';
import { SERVER_API_BASE_URL } from '@/config/env';

/**
 * Streams the workspace's sense dictionary (JSONL or CSV) to the browser. The access token
 * lives in an HttpOnly cookie, so a plain <a href> can't reach the API directly. The file
 * is exactly what the bulk importer reads back. Middleware refreshes the cookie first.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params;
  const format = new URL(request.url).searchParams.get('format') === 'csv' ? 'csv' : 'jsonl';

  const accessToken = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!accessToken) {
    return new Response('Unauthorized', { status: 401 });
  }

  const upstream = await fetch(
    `${SERVER_API_BASE_URL}/api/workspaces/${encodeURIComponent(workspaceId)}/wsd/senses/export?format=${format}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!upstream.ok) {
    return new Response(`Export failed (${upstream.status})`, { status: upstream.status });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/octet-stream',
      'Content-Disposition': upstream.headers.get('Content-Disposition') ?? '',
    },
  });
}
