import { createClient } from '@/lib/supabase/server';
export async function authorizedUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, response: Response.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 }) };
  const allowed = (process.env.ALLOWED_USER_IDS ?? '').split(',').map(x => x.trim()).filter(Boolean);
  if (!allowed.includes(user.id)) return { supabase, user: null, response: Response.json({ error: 'บัญชีนี้ไม่มีสิทธิ์ใช้งาน' }, { status: 403 }) };
  return { supabase, user, response: null };
}
