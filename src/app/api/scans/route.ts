import { authorizedUser } from '@/lib/auth';
export async function POST(request: Request) {
 const {supabase,user,response}=await authorizedUser(); if(response||!user)return response!;
 const body=await request.json().catch(()=>null);const session_id=String(body?.session_id??''),code=String(body?.code??'').trim().toUpperCase(),request_id=String(body?.request_id??'');
 if(!session_id||!code||code.length>100||!request_id)return Response.json({error:'ข้อมูลสแกนไม่ครบ'},{status:400});
 const {data,error}=await supabase.rpc('record_box_scan',{p_session_id:session_id,p_code:code,p_request_id:request_id,p_device_id:String(body?.device_id??'').slice(0,100)});
 if(error)return Response.json({error:error.message},{status:400});return Response.json(data);
}
