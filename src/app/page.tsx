import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight, Boxes, ClipboardCheck, ScanLine, Truck } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { signOut } from '@/app/signout';

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: sessions } = await supabase.from('receiving_sessions').select('*').order('created_at', { ascending: false }).limit(5);
  const recent = sessions ?? [];
  const openCount = recent.filter(session => session.status === 'OPEN').length;
  const expected = recent.reduce((sum, session) => sum + session.total_expected_boxes, 0);
  const scanned = recent.reduce((sum, session) => sum + session.total_actual_scanned_boxes, 0);

  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/">BOXCHECK</Link>
        <nav className="nav" aria-label="เมนูหลัก">
          <Link className="active" href="/">ภาพรวม</Link>
          <Link href="/receive">สร้างรอบตรวจรับ</Link>
          <Link href="/history">ประวัติ</Link>
          <form action={signOut}><button className="button" type="submit">ออกจากระบบ</button></form>
        </nav>
      </header>

      <section className="dashboard-hero">
        <div><div className="eyebrow">ศูนย์ตรวจรับสินค้า</div><h1 className="heading" style={{ fontSize: 28, marginTop: 8 }}>ภาพรวมการตรวจรับ</h1><p className="muted" style={{ margin: '5px 0 0' }}>ยินดีต้อนรับ {user?.email ?? ''} · ดูสถานะรอบล่าสุดและเริ่มตรวจรับรอบใหม่</p></div>
        <Link className="button" href="/receive"><ScanLine size={16}/> สแกนใบโอนใหม่ <ArrowRight size={15}/></Link>
      </section>

      <section className="grid">
        <Stat icon={<ClipboardCheck size={18}/>} label="รอบล่าสุดในรายการ" value={recent.length} note="แสดงสูงสุด 5 รอบ"/>
        <Stat icon={<Truck size={18}/>} label="กำลังตรวจรับ" value={openCount} note="จาก 5 รอบล่าสุด"/>
        <Stat icon={<Boxes size={18}/>} label="กล่องตามใบโอน" value={expected} note="จาก 5 รอบล่าสุด"/>
        <Stat icon={<ScanLine size={18}/>} label="สแกนพบแล้ว" value={scanned} note="จาก 5 รอบล่าสุด"/>
      </section>

      <section className="card space">
        <div className="split mobile-stack"><div><h2 className="section-title">รายการตรวจรับล่าสุด</h2><p className="muted small" style={{ margin: '4px 0 0' }}>ติดตามยอดรับและความคลาดเคลื่อน</p></div><Link className="button" href="/history">ประวัติทั้งหมด <ArrowRight size={15}/></Link></div>
        {recent.length === 0 ? <div className="empty-state"><div className="empty-icon"><ClipboardCheck size={22}/></div><strong>ยังไม่มีรอบตรวจรับ</strong><p className="muted small">เริ่มต้นด้วยการถ่ายใบโอนหรือเลือกเอกสารจากอุปกรณ์</p><Link className="button primary" href="/receive">เริ่มรอบแรก</Link></div> : <div className="tablewrap space"><table><thead><tr><th>รหัสรอบ</th><th>วันเวลาเริ่ม</th><th>รายการ TFS</th><th>ตามใบโอน</th><th>สแกนพบ</th><th>สถานะ</th></tr></thead><tbody>{recent.map(session => <tr key={session.id}><td><Link className="session-link" href={`/session/${session.id}`}>{session.session_code}</Link></td><td>{new Date(session.started_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}</td><td>{session.total_items}</td><td>{session.total_expected_boxes}</td><td>{session.total_actual_scanned_boxes}</td><td><Status status={session.status}/></td></tr>)}</tbody></table></div>}
      </section>
      <footer className="app-footer"><span>BOXCHECK</span><span>ระบบตรวจรับสินค้า</span></footer>
    </main>
  );
}

function Stat({ icon, label, value, note }: { icon: ReactNode; label: string; value: number; note: string }) {
  return <div className="card stat-card"><div className="stat-head"><span className="stat-icon">{icon}</span><span className="stat-label">{label}</span></div><div className="metric">{value.toLocaleString('th-TH')}</div><div className="muted small" style={{ marginTop: 7 }}>{note}</div></div>;
}
function Status({ status }: { status: string }) {
  const tone = status === 'COMPLETED' ? 'good' : status === 'OPEN' ? 'warn' : status.includes('DISCREPANCY') || status === 'INCOMPLETE' ? 'bad' : '';
  const label = status === 'OPEN' ? 'กำลังตรวจรับ' : status === 'COMPLETED' ? 'รับครบ' : status === 'INCOMPLETE' ? 'ยังขาด' : status === 'DISCREPANCY' ? 'มีจำนวนเกิน' : status === 'INCOMPLETE_WITH_DISCREPANCY' ? 'ขาดและเกิน' : status;
  return <span className={`tag ${tone}`}>{label}</span>;
}
