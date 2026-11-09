# BOXCHECK

เว็บแอปตรวจรับกล่องจากรายการ TFS สร้างด้วย Next.js, TypeScript และ Supabase รองรับมือถือและ Safari

## ความสามารถในชุดนี้

- เข้าสู่ระบบด้วย Supabase Auth แบบ email/password; ปิด public sign-up และกำหนดสิทธิ์ผ่าน `user_access`
- สร้างรอบจากข้อมูล TFS ที่ผู้ใช้ตรวจทานแล้ว และตรวจรายการซ้ำ/จำนวนไม่ถูกต้อง
- อ่านประวัติรอบและรายการ TFS ที่มี RLS จำกัดข้อมูลตามผู้สร้าง
- อ่าน OCR แบบพิกัด TSV แยกแถว ไม่ดึงต้นทาง/ปลายทาง/จำนวนข้ามแถว และให้ผู้ใช้ยืนยันทีละแถว
- เก็บข้อความ OCR ดิบแยกจากค่าที่ผู้ใช้ยืนยัน และเก็บไฟล์ต้นฉบับใน Supabase Storage แบบ private
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
   insert into public.user_access(user_id) values ('UUID-จาก-Supabase-Auth')
   on conflict (user_id) do update set enabled = true;
   ```

   ตารางนี้ไม่มีสิทธิ์อ่าน/เขียนจาก browser; เพิ่มหรือลบสิทธิ์ผ่าน SQL Editor ในฐานะผู้ดูแลเท่านั้น
4. เพิ่ม UUID ของผู้ใช้ใน `public.user_access` ผ่าน SQL Editor หลังสร้างบัญชี Auth แล้ว ผู้ใช้ที่ไม่มีแถวเปิดใช้งานจะเข้าไม่ได้
5. คัดลอก `.env.example` เป็น `.env.local` แล้วใส่ Supabase Project URL และ anon/publishable key
6. ติดตั้ง Node.js 20.9 ขึ้นไป แล้วรัน `npm install`, `npm run dev`

ห้ามใส่ `service_role` key หรือ database password ในตัวแปร `NEXT_PUBLIC_*` หรือใน GitHub

## Deploy ด้วย GitHub และ Vercel

1. สร้าง repository ใหม่ แล้ว commit/push ไฟล์โปรเจกต์นี้ (อย่า commit `.env.local`)
2. ใน Vercel เลือก **Add New Project** แล้ว import repository จาก GitHub
3. ตั้ง environment variables ใน Vercel Project Settings: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. ตั้ง Supabase Auth URL Configuration ให้ Site URL เป็นโดเมน Vercel จริง และเพิ่ม Preview/Production redirect URL ตามโดเมนที่จะใช้
5. Deploy; กล้องต้องเปิดผ่าน HTTPS และผู้ใช้ต้องอนุญาตสิทธิ์กล้อง

## ค่าใช้จ่าย/ข้อจำกัด

ค่าใช้จ่าย Vercel, Supabase และบริการ OCR (เมื่อเพิ่มในอนาคต) ขึ้นกับแผนและปริมาณใช้งาน กรุณาตรวจ pricing ปัจจุบันของผู้ให้บริการก่อนเลือกแผน; ชุดนี้ยังไม่เรียก OCR ภายนอก

## Database migration ใหม่

เมื่ออัปเดตจากชุดก่อนหน้า ให้รันไฟล์ `supabase/migrations/202611090001_boxcheck_hardening.sql` ใน Supabase SQL Editor **ก่อน deploy โค้ดใหม่** เพราะระบบเวอร์ชันใหม่นี้ตรวจสิทธิ์ผ่านฟังก์ชันและนโยบายที่ migration เพิ่ม:

1. เปิด Supabase Dashboard ของโปรเจกต์
2. เลือก **SQL Editor** จากแถบด้านซ้าย แล้วกด **New query**
3. เปิดไฟล์ migration นี้ใน GitHub แล้วคัดลอก SQL ทั้งไฟล์มาวาง
4. กด **Run** แล้วตรวจผลลัพธ์ `Success` และข้อความ `BOXCHECK database version` / `pgcrypto is installed in schema...`
5. ใน SQL Editor ตรวจว่ามีผู้ใช้ที่อนุญาตอยู่ใน `public.user_access` และ `enabled = true`

รัน SQL ตรวจระบบแบบอ่านอย่างเดียวได้ที่ `supabase/verification/boxcheck-readiness.sql` และทำรายการทดสอบจริงตาม `docs/BOXCHECK-POSTDEPLOY-CHECKS.md`

Migration นี้ไม่ลบข้อมูลเดิม และแก้การเรียก `gen_random_bytes()` โดยสร้างส่วนท้ายรหัสรอบจาก UUID มาตรฐานของ PostgreSQL แทน หาก SQL แจ้งเวอร์ชันต่ำกว่า PostgreSQL 13 ให้หยุดแล้วแจ้งผู้ดูแลก่อน Deploy

## โครงสร้างสำคัญ

```text
src/app/                 หน้าภาพรวม, login, สร้างรอบ, history, หน้าสแกน และ API
src/lib/ocr/             อ่าน TSV จาก OCR และจัดกลุ่มคำตามพิกัดแถว
src/lib/scan/            กติกาปลดล็อกบาร์โค้ดเมื่อรหัสพ้นจากภาพ
src/lib/supabase/        client/server Supabase helpers
supabase/migrations/     schema, indexes, RLS, RPC และ append-only policies
```

OCR เป็นตัวช่วยและต้องตรวจทานทีละแถว ไม่รับประกันความแม่นยำกับเอกสารทุกแบบ ต้องทดสอบเอกสารจริง กล้องจริง และสิทธิ์ Storage ของผู้ใช้อีกบัญชีก่อนใช้งานจริง รวมทั้งตรวจ Backup/Restore ของ Supabase
