create extension if not exists pgcrypto;
create table if not exists public.profiles(id uuid primary key references auth.users(id) on delete restrict,email text,created_at timestamptz not null default now(),last_login_at timestamptz);
create table if not exists public.user_access(user_id uuid primary key references auth.users(id) on delete restrict,enabled boolean not null default true,created_at timestamptz not null default now());
create table if not exists public.receiving_sessions(id uuid primary key default gen_random_uuid(),session_code text not null unique,started_at timestamptz not null default now(),completed_at timestamptz,status text not null default 'OPEN' check(status in ('OPEN','COMPLETED','INCOMPLETE','DISCREPANCY','INCOMPLETE_WITH_DISCREPANCY')),total_items int not null default 0,total_expected_boxes int not null default 0,total_actual_scanned_boxes int not null default 0,total_missing_boxes int not null default 0,total_over_boxes int not null default 0,created_by uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default now());
create table if not exists public.receiving_documents(id uuid primary key default gen_random_uuid(),session_id uuid not null references public.receiving_sessions(id) on delete restrict,original_file_path text,document_type text,original_filename text,ocr_status text not null default 'NOT_STARTED',uploaded_at timestamptz not null default now());
create table if not exists public.transfer_items(id uuid primary key default gen_random_uuid(),session_id uuid not null references public.receiving_sessions(id) on delete restrict,transfer_number text not null,source_branch text not null default '',destination_branch text not null default '',expected_quantity int not null check(expected_quantity>=1),actual_scanned_quantity int not null default 0,missing_quantity int not null default 0,over_quantity int not null default 0,status text not null default 'PENDING',created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(session_id,transfer_number));
create table if not exists public.box_scans(id uuid primary key default gen_random_uuid(),session_id uuid not null references public.receiving_sessions(id) on delete restrict,transfer_item_id uuid references public.transfer_items(id) on delete restrict,scanned_code text not null,scan_result text not null check(scan_result in ('MATCH','DUPLICATE_REQUEST','UNEXPECTED','OVER_RECEIVED')),request_id uuid not null unique,scanned_at timestamptz not null default now(),device_id text,created_at timestamptz not null default now());
create table if not exists public.audit_logs(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id) on delete restrict,action text not null,entity_type text not null,entity_id uuid,details jsonb not null default '{}',ip_address text,user_agent text,created_at timestamptz not null default now());
create index if not exists sessions_created_idx on public.receiving_sessions(created_by,created_at desc);create index if not exists scans_session_idx on public.box_scans(session_id,scanned_at desc);create index if not exists items_session_idx on public.transfer_items(session_id);
alter table public.profiles enable row level security;alter table public.user_access enable row level security;alter table public.receiving_sessions enable row level security;alter table public.receiving_documents enable row level security;alter table public.transfer_items enable row level security;alter table public.box_scans enable row level security;alter table public.audit_logs enable row level security;
create policy "read own profile" on public.profiles for select to authenticated using(id=auth.uid());
create policy "read own sessions" on public.receiving_sessions for select to authenticated using(created_by=auth.uid());
create policy "read own documents" on public.receiving_documents for select to authenticated using(exists(select 1 from public.receiving_sessions s where s.id=session_id and s.created_by=auth.uid()));
create policy "read own items" on public.transfer_items for select to authenticated using(exists(select 1 from public.receiving_sessions s where s.id=session_id and s.created_by=auth.uid()));
create policy "read own scans" on public.box_scans for select to authenticated using(exists(select 1 from public.receiving_sessions s where s.id=session_id and s.created_by=auth.uid()));
create policy "read own audits" on public.audit_logs for select to authenticated using(user_id=auth.uid());
revoke all on public.user_access,public.receiving_sessions,public.receiving_documents,public.transfer_items,public.box_scans,public.audit_logs from anon,authenticated;
grant select on public.receiving_sessions,public.receiving_documents,public.transfer_items,public.box_scans,public.audit_logs to authenticated;
grant select on public.profiles to authenticated;
create or replace function public.create_receiving_session(p_items jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid();v_id uuid;v_code text;v_expected int;
begin
 if v_uid is null or not exists(select 1 from user_access where user_id=v_uid and enabled) then raise exception 'Not authorized';end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>500 then raise exception 'Invalid items';end if;
 if exists(select 1 from jsonb_array_elements(p_items)x where upper(trim(coalesce(x->>'transfer_number',''))) !~ '^TFS[A-Z0-9-]{5,40}$' or coalesce((x->>'expected_quantity')::int,0)<1) then raise exception 'Invalid transfer item';end if;
 if (select count(*) from jsonb_array_elements(p_items))<>(select count(distinct upper(trim(x->>'transfer_number'))) from jsonb_array_elements(p_items)x) then raise exception 'Duplicate transfer number';end if;
 v_id:=gen_random_uuid();v_code:='RCV-'||to_char(now(),'YYMMDD')||'-'||upper(substr(encode(gen_random_bytes(4),'hex'),1,6));
 insert into receiving_sessions(id,session_code,created_by,total_items,total_expected_boxes) values(v_id,v_code,v_uid,jsonb_array_length(p_items),0);
 insert into transfer_items(session_id,transfer_number,source_branch,destination_branch,expected_quantity)
 select v_id,upper(trim(x->>'transfer_number')),coalesce(x->>'source_branch',''),coalesce(x->>'destination_branch',''),(x->>'expected_quantity')::int from jsonb_array_elements(p_items)x;
 select sum(expected_quantity) into v_expected from transfer_items where session_id=v_id;
 update receiving_sessions set total_expected_boxes=v_expected where id=v_id;
 insert into audit_logs(user_id,action,entity_type,entity_id,details) values(v_uid,'CREATE_SESSION','receiving_session',v_id,jsonb_build_object('session_code',v_code,'item_count',jsonb_array_length(p_items),'expected_boxes',v_expected));
 return jsonb_build_object('id',v_id,'session_code',v_code);
end $$;
create or replace function public.record_box_scan(p_session_id uuid,p_code text,p_request_id uuid,p_device_id text default null) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid();v_item transfer_items%rowtype;v_scan box_scans%rowtype;v_count int;v_missing int;v_over int;v_item_status text;v_total_actual int;v_total_missing int;v_total_over int;
begin
 if v_uid is null or not exists(select 1 from user_access where user_id=v_uid and enabled) then raise exception 'Not authorized';end if;
 select * into v_scan from box_scans where request_id=p_request_id;
 if found then return jsonb_build_object('result','DUPLICATE_REQUEST','scan_id',v_scan.id);end if;
 if not exists(select 1 from receiving_sessions where id=p_session_id and created_by=v_uid and status='OPEN' for update) then raise exception 'Session is not open or inaccessible';end if;
 select * into v_scan from box_scans where request_id=p_request_id;
 if found then return jsonb_build_object('result','DUPLICATE_REQUEST','scan_id',v_scan.id);end if;
 select * into v_item from transfer_items where session_id=p_session_id and upper(transfer_number)=upper(trim(p_code)) for update;
 if not found then
  insert into box_scans(session_id,scanned_code,scan_result,request_id,device_id) values(p_session_id,p_code,'UNEXPECTED',p_request_id,p_device_id);
  insert into audit_logs(user_id,action,entity_type,entity_id,details) values(v_uid,'UNEXPECTED_SCAN','receiving_session',p_session_id,jsonb_build_object('code',p_code));
  return jsonb_build_object('result','UNEXPECTED');
 end if;
 v_count:=v_item.actual_scanned_quantity+1;v_missing:=greatest(v_item.expected_quantity-v_count,0);v_over:=greatest(v_count-v_item.expected_quantity,0);
 v_item_status:=case when v_over>0 then 'OVER_RECEIVED' when v_missing=0 then 'RECEIVED' when v_count>0 then 'PARTIAL' else 'PENDING' end;
 update transfer_items set actual_scanned_quantity=v_count,missing_quantity=v_missing,over_quantity=v_over,status=v_item_status,updated_at=now() where id=v_item.id;
 insert into box_scans(session_id,transfer_item_id,scanned_code,scan_result,request_id,device_id) values(p_session_id,v_item.id,p_code,case when v_over>0 then 'OVER_RECEIVED' else 'MATCH' end,p_request_id,p_device_id);
 select sum(actual_scanned_quantity),sum(missing_quantity),sum(over_quantity) into v_total_actual,v_total_missing,v_total_over from transfer_items where session_id=p_session_id;
 update receiving_sessions set total_actual_scanned_boxes=v_total_actual,total_missing_boxes=v_total_missing,total_over_boxes=v_total_over where id=p_session_id;
 insert into audit_logs(user_id,action,entity_type,entity_id,details) values(v_uid,'SCAN_BARCODE','transfer_item',v_item.id,jsonb_build_object('code',p_code,'actual',v_count,'missing',v_missing,'over',v_over));
 return jsonb_build_object('result',case when v_over>0 then 'OVER_RECEIVED' else 'MATCH' end,'items',(select jsonb_agg(to_jsonb(t)-'session_id') from transfer_items t where t.session_id=p_session_id));
end $$;
create or replace function public.complete_receiving_session(p_session_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid();v_status text;v_missing int;v_over int;
begin
 if v_uid is null or not exists(select 1 from user_access where user_id=v_uid and enabled) then raise exception 'Not authorized';end if;
 select total_missing_boxes,total_over_boxes into v_missing,v_over from receiving_sessions where id=p_session_id and created_by=v_uid and status='OPEN' for update;
 if not found then raise exception 'Session is not open or inaccessible';end if;
 v_status:=case when v_missing>0 and v_over>0 then 'INCOMPLETE_WITH_DISCREPANCY' when v_missing>0 then 'INCOMPLETE' when v_over>0 then 'DISCREPANCY' else 'COMPLETED' end;
 update receiving_sessions set status=v_status,completed_at=now() where id=p_session_id;
 insert into audit_logs(user_id,action,entity_type,entity_id,details) values(v_uid,'COMPLETE_SESSION','receiving_session',p_session_id,jsonb_build_object('status',v_status));
 return jsonb_build_object('status',v_status,'items',(select jsonb_agg(to_jsonb(t)-'session_id') from transfer_items t where t.session_id=p_session_id));
end $$;
revoke all on function public.create_receiving_session(jsonb),public.record_box_scan(uuid,text,uuid,text),public.complete_receiving_session(uuid) from public,anon;
grant execute on function public.create_receiving_session(jsonb),public.record_box_scan(uuid,text,uuid,text),public.complete_receiving_session(uuid) to authenticated;
create or replace function public.protect_append_only() returns trigger language plpgsql as $$ begin raise exception 'Append-only record';end $$;
create trigger audit_append_only before update or delete on public.audit_logs for each row execute function public.protect_append_only();
create trigger scans_append_only before update or delete on public.box_scans for each row execute function public.protect_append_only();
insert into storage.buckets(id,name,public) values('receiving-documents','receiving-documents',false) on conflict(id) do nothing;
create policy "read own receiving files" on storage.objects for select to authenticated using(bucket_id='receiving-documents' and (storage.foldername(name))[1]=auth.uid()::text);
