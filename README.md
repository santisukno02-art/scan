# BOXCHECK

เว็บแอปตรวจรับกล่องจากรายการ TFS สร้างด้วย Next.js, TypeScript และ Supabase รองรับมือถือและ Safari

## ความสามารถในชุดนี้

- เข้าสู่ระบบด้วย Supabase Auth แบบ email/password; ปิด public sign-up และกำหนดผู้ใช้ผ่าน allowlist
- สร้างรอบจากข้อมูล TFS ที่ผู้ใช้ตรวจทานแล้ว และตรวจรายการซ้ำ/จำนวนไม่ถูกต้อง
- อ่านประวัติรอบและรายการ TFS ที่มี RLS จำกัดข้อมูลตามผู้สร้าง
- สแกน Barcode ต่อเนื่องด้วยกล้องบน browser ที่รองรับ หรือกรอกเลขด้วยมือ
- บันทึกการสแกนผ่าน PostgreSQL transaction/RPC; ทุกกล่องที่ตรงกับ TFS จะนับเพิ่ม แม้จะเกินจำนวนเอกสาร
- คำนวณขาด/เกินแยกตาม TFS และจบรอบด้วยสถานะ COMPLETED, INCOMPLETE, DISCREPANCY หรือ INCOMPLETE_WITH_DISCREPANCY
- เก็บ scan/audit แบบ append-only และใช้ request UUID ป้องกัน retry เพิ่มจำนวนซ้ำ

## สิ่งที่ยังไม่รวม

OCR จากภาพ/PDF และการตรวจแก้ OCR, การอัปโหลดไฟล์เอกสารจริง, ไฟฉายที่อาจไม่มีในบาง browser, MFA, export XLSX/PDF และระบบ retry queue/offline ยังไม่ได้เชื่อมบริการจริง จึงไม่มีการแสดงว่าฟีเจอร์เหล่านี้ทำงานแล้ว ในระหว่างนี้ให้ตรวจข้อมูลจากใบโอนและกรอก TFS/จำนวนก่อนสร้างรอบ

## เริ่มใช้งาน

1. สร้างโปรเจกต์ Supabase และรัน `supabase/migrations/202611060001_boxcheck.sql` ใน SQL Editor
2. ใน Supabase Auth ปิดการสมัครสมาชิกสาธารณะ แล้วสร้างผู้ใช้ email/password ที่ต้องการ
3. เพิ่ม UUID ผู้ใช้ที่อนุญาตใน SQL Editor:

   ```sql
   insert into public.user_access(user_id) values ('UUID-จาก-Supabase-Auth');
   ```

   ตารางนี้ไม่มีสิทธิ์อ่าน/เขียนจาก browser; เพิ่มหรือลบสิทธิ์ผ่าน SQL Editor ในฐานะผู้ดูแลเท่านั้น
4. คัดลอก `.env.example` เป็น `.env.local` แล้วใส่ Supabase Project URL, anon/publishable key และ UUID เดียวกันใน `ALLOWED_USER_IDS` (คั่นหลาย UUID ด้วย comma)
5. ติดตั้ง Node.js 20.9 ขึ้นไป แล้วรัน `npm install`, `npm run dev`

ห้ามใส่ `service_role` key หรือ database password ในตัวแปร `NEXT_PUBLIC_*` หรือใน GitHub

## Deploy ด้วย GitHub และ Vercel

1. สร้าง repository ใหม่ แล้ว commit/push ไฟล์โปรเจกต์นี้ (อย่า commit `.env.local`)
2. ใน Vercel เลือก **Add New Project** แล้ว import repository จาก GitHub
3. ตั้ง environment variables ใน Vercel Project Settings: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ALLOWED_USER_IDS`
4. ตั้ง Supabase Auth URL Configuration ให้ Site URL เป็นโดเมน Vercel จริง และเพิ่ม Preview/Production redirect URL ตามโดเมนที่จะใช้
5. Deploy; กล้องต้องเปิดผ่าน HTTPS และผู้ใช้ต้องอนุญาตสิทธิ์กล้อง

## ค่าใช้จ่าย/ข้อจำกัด

ค่าใช้จ่าย Vercel, Supabase และบริการ OCR (เมื่อเพิ่มในอนาคต) ขึ้นกับแผนและปริมาณใช้งาน กรุณาตรวจ pricing ปัจจุบันของผู้ให้บริการก่อนเลือกแผน; ชุดนี้ยังไม่เรียก OCR ภายนอก

## โครงสร้างสำคัญ

```text
src/app/                 หน้าภาพรวม, login, สร้างรอบ, history, หน้าสแกน และ API
src/lib/supabase/        client/server Supabase helpers
supabase/migrations/     schema, indexes, RLS, RPC และ append-only policies
```

ระบบนี้เป็นจุดเริ่มต้นที่พร้อม deploy สำหรับแกนรับสินค้า ไม่ควรใช้กับเอกสารจริงจนกว่าจะตรวจสอบ config, account allowlist, backup/restore และทดสอบกล้องกับ barcode ของสถานที่ใช้งาน
