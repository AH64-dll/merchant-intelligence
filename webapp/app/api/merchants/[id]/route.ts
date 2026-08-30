import { renderCacheGet, renderCacheSet } from '../../../../src/lib/render-cache';
import { getDb } from '../../../../src/lib/singletons';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const key = `api-merchant:${id}`;
  const cached = renderCacheGet(key);
  if (cached !== undefined) {
    return new Response(cached.body, { headers: { 'content-type': cached.contentType } });
  }
  const db = getDb();
  const detail = db.getMerchantDetail(id);
  if (detail === null) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const body = JSON.stringify({ ...detail, snapshot: db.getSnapshotInfo() });
  renderCacheSet(key, body, 'application/json');
  return new Response(body, { headers: { 'content-type': 'application/json' } });
}
