import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ClipboardCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import Scanner from './scanner';

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: session } = await supabase.from('receiving_sessions').select('*').eq('id', id).single();
  if (!session) notFound();
  const { data: items } = await supabase.from('transfer_items').select('*').eq('session_id', id).order('transfer_number');
  const { data: scans } = await supabase.from('box_scans').select('id,scanned_code,scan_result,scanned_at').eq('session_id', id).order('scanned_at', { ascending: false }).limit(30);

  return (
    <main className="shell">
      <header className="topbar"><Link className="brand" href="/">BOXCHECK</Link><nav className="nav" aria-label="เมนูหลัก"><Link href="/">ภาพรวม</Link><Link href="/receive">สร้างรอบตรวจรับ</Link><Link href="/history">ประวัติ</Link></nav></header>
      <div className="page-kicker"><Link href="/history" aria-label="กลับประวัติ"><ArrowLeft size={15}/></Link><span>รายละเอียดรอบตรวจรับ</span></div>
      <div className="split mobile-stack space"><div><h1 className="heading">{session.session_code}</h1><p className="muted" style={{ margin: 0 }}>เริ่ม {new Date(session.started_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}</p></div><span className={`tag ${session.status === 'COMPLETED' ? 'good' : session.status === 'OPEN' ? 'warn' : 'bad'}`}>{statusLabel(session.status)}</span></div>
      <Scanner sessionId={id} initialItems={items ?? []} initialStatus={session.status}/>
      <section className="grid space"><Metric title="ตามใบโอน" value={session.total_expected_boxes}/><Metric title="สแกนพบจริง" value={session.total_actual_scanned_boxes}/><Metric title="จำนวนที่ยังขาด" value={session.total_missing_boxes}/><Metric title="จำนวนที่เกิน" value={session.total_over_boxes}/></section>
      <section className="card space"><div className="split"><h2 className="section-title">ผลตรวจแยกตาม TFS</h2><ClipboardCheck size={18} color="var(--green)"/></div><div className="tablewrap space"><table><thead><tr><th>เลข TFS</th><th>ตามใบโอน</th><th>สแกนจริง</th><th>ขาด</th><th>เกิน</th><th>สถานะ</th></tr></thead><tbody>{(items ?? []).map(item => <tr key={item.id}><td className="session-link">{item.transfer_number}</td><td>{item.expected_quantity}</td><td>{item.actual_scanned_quantity}</td><td>{item.missing_quantity}</td><td>{item.over_quantity}</td><td><span className={`tag ${item.status === 'RECEIVED' ? 'good' : item.status === 'OVER_RECEIVED' ? 'bad' : item.status === 'PARTIAL' ? 'warn' : ''}`}>{itemStatusLabel(item.status)}</span></td></tr>)}</tbody></table></div></section>
      <section className="card space"><h2 className="section-title">รายการสแกนล่าสุด</h2>{!scans?.length ? <p className="muted small">ยังไม่มีรายการสแกน</p> : <div className="tablewrap space"><table><thead><tr><th>เลขที่อ่านได้</th><th>ผลการสแกน</th><th>วันเวลา</th></tr></thead><tbody>{scans.map(scan => <tr key={scan.id}><td>{scan.scanned_code}</td><td><span className={`tag ${scan.scan_result === 'MATCH' ? 'good' : scan.scan_result === 'UNEXPECTED' ? 'bad' : 'warn'}`}>{scanLabel(scan.scan_result)}</span></td><td>{new Date(scan.scanned_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}</td></tr>)}</tbody></table></div>}</section>
      <footer className="app-footer"><span>BOXCHECK</span><span>ประวัติรอบตรวจรับ</span></footer>
    </main>
  );
}

function Metric({ title, value }: { title: string; value: number }) { return <div className="card stat-card"><div className="stat-label">{title}</div><div className="metric">{value.toLocaleString('th-TH')}</div></div>; }
function statusLabel(status: string) { return ({ OPEN: 'กำลังตรวจรับ', COMPLETED: 'รับครบ', INCOMPLETE: 'ยังขาด', DISCREPANCY: 'มีจำนวนเกิน', INCOMPLETE_WITH_DISCREPANCY: 'มีทั้งขาดและเกิน' } as Record<string, string>)[status] ?? status; }
function itemStatusLabel(status: string) { return ({ RECEIVED: 'รับครบ', OVER_RECEIVED: 'รับเกิน', PARTIAL: 'รับบางส่วน', PENDING: 'ยังไม่รับ' } as Record<string, string>)[status] ?? status; }
function scanLabel(status: string) { return ({ MATCH: 'ตรงกับรายการ', OVER_RECEIVED: 'รับเกิน', UNEXPECTED: 'ไม่พบในรายการ', DUPLICATE_REQUEST: 'คำขอซ้ำ' } as Record<string, string>)[status] ?? status; }
