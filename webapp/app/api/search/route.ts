import { getIndex } from '../../../src/lib/singletons';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  if (q === '') {
    return Response.json({ error: 'missing_query' }, { status: 400 });
  }
  if (q.length > 300) {
    return Response.json({ error: 'query_too_long' }, { status: 400 });
  }
  const { detectedType, hits } = getIndex().search(q);
  return Response.json({ query: q, detectedType, hits });
}
