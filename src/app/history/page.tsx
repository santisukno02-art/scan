import Link from 'next/link';
import { ArrowRight, ClipboardList } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';

export default async function History() {
  const supabase = await createClient();
  const { data: sessions } = await supabase.from('receiving_sessions').select('*').order('created_at', { ascending: false }).limit(200);

  return (
    <main className="shell">
      <header className="topbar"><Link className="brand" href="/">BOXCHECK</Link><nav className="nav" aria-label="เมนูหลัก"><Link href="/">ภาพรวม</Link><Link href="/receive">สร้างรอบตรวจรับ</Link><Link className="active" href="/history">ประวัติ</Link></nav></header>
      <div className="page-kicker"><ClipboardList size={15}/><span>บันทึกการทำงาน</span></div>
      <div className="split mobile-stack space"><div><h1 className="heading">ประวัติการตรวจรับ</h1><p className="muted" style={{ margin: 0 }}>ค้นดูผลตรวจย้อนหลัง 200 รอบล่าสุด</p></div><Link className="button primary" href="/receive">สร้างรอบตรวจรับ <ArrowRight size={15}/></Link></div>
      <section className="card space">
        {!sessions?.length ? <div className="empty-state"><div className="empty-icon"><ClipboardList size={22}/></div><strong>ยังไม่มีประวัติ</strong><p className="muted small">รอบตรวจรับที่จบแล้วจะแสดงในหน้านี้</p></div> : <div className="tablewrap"><table><thead><tr><th>รหัสรอบ</th><th>วันที่เริ่ม</th><th>จำนวน TFS</th><th>ตามใบโอน</th><th>พบจริง</th><th>ขาด</th><th>เกิน</th><th>สถานะ</th></tr></thead><tbody>{sessions.map(session => <tr key={session.id}><td><Link className="session-link" href={`/session/${session.id}`}>{session.session_code}</Link></td><td>{new Date(session.started_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}</td><td>{session.total_items}</td><td>{session.total_expected_boxes}</td><td>{session.total_actual_scanned_boxes}</td><td>{session.total_missing_boxes}</td><td>{session.total_over_boxes}</td><td><Status status={session.status}/></td></tr>)}</tbody></table></div>}
      </section>
      <footer className="app-footer"><span>BOXCHECK</span><span>แสดงสูงสุด 200 รายการล่าสุด</span></footer>
    </main>
  );
}

function Status({ status }: { status: string }) {
  const tone = status === 'COMPLETED' ? 'good' : status === 'OPEN' ? 'warn' : status.includes('DISCREPANCY') || status === 'INCOMPLETE' ? 'bad' : '';
  const label = status === 'OPEN' ? 'กำลังตรวจรับ' : status === 'COMPLETED' ? 'รับครบ' : status === 'INCOMPLETE' ? 'ยังขาด' : status === 'DISCREPANCY' ? 'มีจำนวนเกิน' : status === 'INCOMPLETE_WITH_DISCREPANCY' ? 'ขาดและเกิน' : status;
  return <span className={`tag ${tone}`}>{label}</span>;
}
