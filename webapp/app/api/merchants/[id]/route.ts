import { getDb } from '../../../../src/lib/singletons';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const db = getDb();
  const detail = db.getMerchantDetail(id);
  if (detail === null) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  return Response.json({ ...detail, snapshot: db.getSnapshotInfo() });
}
