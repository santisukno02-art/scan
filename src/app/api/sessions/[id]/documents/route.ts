import { authorizedUser } from '@/lib/auth';

const BUCKET = 'receiving-documents';
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

type ReviewRow = {
  pageName?: unknown;
  rowNumber?: unknown;
  rawText?: unknown;
  transfer_number?: unknown;
  source_branch?: unknown;
  destination_branch?: unknown;
  expected_quantity?: unknown;
  sequenceNumber?: unknown;
  confidence?: unknown;
  flags?: unknown;
  userDecision?: unknown;
  userVerified?: unknown;
  geometryValid?: unknown;
  evidence?: unknown;
};

type DocumentMetadata = {
  document_id?: unknown;
  original_file_path?: unknown;
  original_filename?: unknown;
  document_type?: unknown;
  ocr_raw_text?: unknown;
  reviewed_items?: unknown;
};

function safeFilename(filename: string) {
  return filename.split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'document';
}

function sanitizeRows(value: unknown) {
  if (!Array.isArray(value)) return [];
  return (value as ReviewRow[]).slice(0, 500).map(row => {
    const evidence = row.evidence && typeof row.evidence === 'object' ? row.evidence as Record<string, unknown> : {};
    const image = (name: string) => typeof evidence[name] === 'string' && /^data:image\/(jpeg|png);base64,/.test(evidence[name] as string)
      ? (evidence[name] as string).slice(0, 220000) : '';
    const flags = Array.isArray(row.flags) ? row.flags.filter(flag => ['CROSSED_OUT', 'HANDWRITING_DETECTED', 'NEEDS_REVIEW'].includes(String(flag))).slice(0, 3) : [];
    return {
      pageName: String(row.pageName ?? '').slice(0, 200),
      rowNumber: Number.isInteger(row.rowNumber) ? row.rowNumber : null,
      sequenceNumber: Number.isInteger(row.sequenceNumber) ? row.sequenceNumber : null,
      rawText: String(row.rawText ?? '').slice(0, 2000),
      transfer_number: String(row.transfer_number ?? '').slice(0, 60),
      source_branch: String(row.source_branch ?? '').slice(0, 80),
      destination_branch: String(row.destination_branch ?? '').slice(0, 80),
      expected_quantity: Number.isInteger(row.expected_quantity) ? row.expected_quantity : null,
      confidence: Number.isFinite(row.confidence) ? Math.max(0, Math.min(100, Number(row.confidence))) : 0,
      flags,
      userDecision: ['UNDECIDED', 'INCLUDE', 'EXCLUDE'].includes(String(row.userDecision)) ? row.userDecision : 'UNDECIDED',
      userVerified: row.userVerified === true,
      geometryValid: row.geometryValid === true,
      evidence: {
        rowCrop: image('rowCrop'), tfsCrop: image('tfsCrop'), sourceCrop: image('sourceCrop'),
        destinationCrop: image('destinationCrop'), quantityCrop: image('quantityCrop'),
        highlight: evidence.highlight && typeof evidence.highlight === 'object' ? evidence.highlight : null,
      },
    };
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user, response } = await authorizedUser();
  if (response || !user) return response!;

  const { id: sessionId } = await params;
  const { data: session, error: sessionError } = await supabase
    .from('receiving_sessions')
    .select('id,status')
    .eq('id', sessionId)
    .eq('created_by', user.id)
    .maybeSingle();
  if (sessionError) return Response.json({ error: 'ตรวจสอบรอบตรวจรับไม่สำเร็จ' }, { status: 500 });
  if (!session || session.status !== 'OPEN') return Response.json({ error: 'ไม่พบรอบตรวจรับที่ยังเปิดอยู่' }, { status: 404 });

  const payload = await request.json().catch(() => null);
  if (!Array.isArray(payload?.documents) || payload.documents.length < 1 || payload.documents.length > 30) {
    return Response.json({ error: 'ข้อมูลเอกสารไม่ถูกต้อง (รองรับ 1–30 ไฟล์)' }, { status: 400 });
  }

  const stored: string[] = [];
  for (const meta of payload.documents as DocumentMetadata[]) {
    const documentId = String(meta.document_id ?? '');
    const documentType = String(meta.document_type ?? '');
    const filename = safeFilename(String(meta.original_filename ?? ''));
    const path = String(meta.original_file_path ?? '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(documentId)
      || !ALLOWED_TYPES.has(documentType)
      || path !== `${user.id}/${sessionId}/${documentId}_${filename}`) {
      return Response.json({ error: 'ข้อมูลไฟล์เอกสารไม่ถูกต้อง' }, { status: 400 });
    }
    const { data: prior } = await supabase.from('receiving_documents').select('id').eq('id', documentId).eq('session_id', sessionId).maybeSingle();
    if (prior) { stored.push(documentId); continue; }
    const folder = `${user.id}/${sessionId}`;
    const { data: objects, error: listError } = await supabase.storage.from(BUCKET).list(folder, { search: `${documentId}_` });
    if (listError) return Response.json({ error: 'ตรวจสอบไฟล์ในพื้นที่จัดเก็บไม่สำเร็จ' }, { status: 502 });
    if (!objects?.some(object => object.name === `${documentId}_${filename}`)) {
      return Response.json({ error: `ยังไม่พบไฟล์ ${filename} ในพื้นที่จัดเก็บ กรุณาลองอัปโหลดอีกครั้ง` }, { status: 409 });
    }

    const rawText = typeof meta.ocr_raw_text === 'string' ? meta.ocr_raw_text.slice(0, 100000) : '';
    const rows = sanitizeRows(meta.reviewed_items);
    const { error: insertError } = await supabase.from('receiving_documents').insert({
      id: documentId,
      session_id: sessionId,
      original_file_path: path,
      document_type: documentType,
      original_filename: filename,
      ocr_status: rawText ? 'REVIEWED' : 'NOT_STARTED',
      ocr_raw_text: rawText,
      reviewed_items: rows,
    });
    if (insertError) return Response.json({ error: `บันทึกข้อมูลเอกสาร ${filename} ไม่สำเร็จ: ${insertError.message}` }, { status: 502 });
    stored.push(documentId);
  }

  return Response.json({ stored: stored.length });
}
