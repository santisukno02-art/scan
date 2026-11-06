import { authorizedUser } from '@/lib/auth';
export async function POST(request: Request) {
 const {supabase,user,response}=await authorizedUser(); if(response||!user)return response!;
 const body=await request.json().catch(()=>null);const items=body?.items;
 if(!Array.isArray(items)||items.length===0||items.length>500)return Response.json({error:'กรุณาระบุรายการ TFS (1–500 รายการ)'},{status:400});
 const cleaned=[];const seen=new Set<string>();
 for(const row of items){const transfer_number=String(row.transfer_number??'').trim().toUpperCase(),expected_quantity=Number(row.expected_quantity);if(!/^TFS[A-Z0-9-]{5,40}$/.test(transfer_number)||!Number.isInteger(expected_quantity)||expected_quantity<1||expected_quantity>100000)return Response.json({error:'เลข TFS หรือจำนวนกล่องไม่ถูกต้อง'},{status:400});if(seen.has(transfer_number))return Response.json({error:`พบเลข TFS ซ้ำ: ${transfer_number}`},{status:400});seen.add(transfer_number);cleaned.push({transfer_number,source_branch:String(row.source_branch??'').trim().slice(0,80),destination_branch:String(row.destination_branch??'').trim().slice(0,80),expected_quantity});}
 const {data,error}=await supabase.rpc('create_receiving_session',{p_items:cleaned});if(error)return Response.json({error:error.message},{status:400});return Response.json({session:data});
}
