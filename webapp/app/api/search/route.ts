import { getIndex } from '../../../src/lib/singletons';
import { SEARCH_PAGE_SIZE } from '../../../src/lib/types';

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
  const pageRaw = url.searchParams.get('page');
  const parsedPage = pageRaw === null ? 1 : Number.parseInt(pageRaw, 10);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;
  const result = getIndex().search(q, page, SEARCH_PAGE_SIZE);
  return Response.json(result);
}
