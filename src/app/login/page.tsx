'use client';
import { useState } from 'react';
import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
export default function Login() {
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{if(new URLSearchParams(location.search).has('denied'))setError('บัญชีนี้ไม่มีสิทธิ์ใช้งาน กรุณาติดต่อผู้ดูแลระบบ');},[]);
 async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{const {error}=await createClient().auth.signInWithPassword({email,password});if(error)throw error;location.href='/';}catch(err){setError(err instanceof Error?err.message:'เข้าสู่ระบบไม่สำเร็จ');}finally{setBusy(false)}}
 return <main className="shell"><form className="card login stack" onSubmit={submit}><div><div className="brand">BOXCHECK</div><p className="muted">ลงชื่อเข้าใช้ระบบตรวจรับสินค้า</p></div><label className="field">อีเมล<input required type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)}/></label><label className="field">รหัสผ่าน<input required type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<div className="error">{error}</div>}<button className="button primary" disabled={busy}>{busy?'กำลังเข้าสู่ระบบ…':'เข้าสู่ระบบ'}</button><small className="muted">บัญชีผู้ใช้ต้องถูกสร้างใน Supabase Auth โดยผู้ดูแล</small></form></main>
}
