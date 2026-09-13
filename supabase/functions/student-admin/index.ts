import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const H={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
const out=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...H,"Content-Type":"application/json"}});
function secret(){const a=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(a)return a;const r=Deno.env.get("SUPABASE_SECRET_KEYS")||"";try{const j=JSON.parse(r);return j.default||Object.values(j)[0]||""}catch{return ""}}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:H});
 const url=Deno.env.get("SUPABASE_URL")||"",key=secret(); if(!url||!key)return out({error:"Server configuration missing"},500);
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const token=(req.headers.get("Authorization")||"").replace("Bearer ","");
 const {data:{user}}=await db.auth.getUser(token); if(!user)return out({error:"Unauthorized"},401);
 const {data:me}=await db.from("profiles").select("role,is_active").eq("id",user.id).single();
 if(!me?.is_active||!["teacher","system_admin"].includes(me.role))return out({error:"Forbidden"},403);
 let b:any;try{b=await req.json()}catch{return out({error:"Invalid JSON"},400)}
 const assign=async(uid:string,cid:string|null)=>{await db.from("class_members").delete().eq("user_id",uid);if(cid){const {error}=await db.from("class_members").insert({user_id:uid,class_id:cid});if(error)return error.message}return ""};
 if(b.action==="set_active"){
   const {data:t}=await db.from("profiles").select("role").eq("id",b.user_id).single();
   if(t?.role!=="student")return out({error:"Chỉ áp dụng cho sinh viên"},403);
   const {error}=await db.from("profiles").update({is_active:!!b.is_active}).eq("id",b.user_id);if(error)return out({error:error.message},400);
   await db.from("audit_logs").insert({actor_id:user.id,action:b.is_active?"activate_user":"deactivate_user",target_type:"profile",target_id:b.user_id});return out({ok:true});
 }
 if(b.action==="delete_student"){
   const {data:t}=await db.from("profiles").select("id,role,full_name,email,student_code").eq("id",b.user_id).maybeSingle();
   if(!t||t.role!=="student")return out({error:"Không tìm thấy sinh viên"},404);
   const [{count:a},{count:l}]=await Promise.all([db.from("attempts").select("id",{count:"exact",head:true}).eq("student_id",t.id),db.from("audit_logs").select("id",{count:"exact",head:true}).eq("actor_id",t.id)]);
   if((a||0)>0||(l||0)>0)return out({error:"Sinh viên đã có lịch sử. Hãy khóa tài khoản thay vì xóa.",can_deactivate:true},409);
   const {error}=await db.auth.admin.deleteUser(t.id);if(error)return out({error:error.message},400);
   await db.from("audit_logs").insert({actor_id:user.id,action:"student_deleted",target_type:"profile",target_id:t.id,metadata:{email:t.email,student_code:t.student_code,full_name:t.full_name}});return out({ok:true});
 }
 if(b.action==="bulk_students"){
   const rows=Array.isArray(b.users)?b.users:[];if(!rows.length||rows.length>500)return out({error:"Danh sách phải có 1-500 sinh viên"},400);
   const cid=b.class_id||null;if(cid){const {data:c}=await db.from("classes").select("id").eq("id",cid).maybeSingle();if(!c)return out({error:"Không tìm thấy lớp"},400)}
   const results=[];
   for(const r of rows){
     const email=String(r.email||"").trim().toLowerCase(),name=String(r.full_name||r.name||"").trim(),code=r.student_code?String(r.student_code).trim():null,pw=String(r.password||"");
     if(!email||!name){results.push({ok:false,email,error:"Thiếu họ tên/email"});continue}
     const {data:old}=await db.from("profiles").select("id,role").ilike("email",email).maybeSingle();
     if(old){if(old.role!=="student"){results.push({ok:false,email,error:"Email thuộc tài khoản khác"});continue}const er=cid?await assign(old.id,cid):"";if(er){results.push({ok:false,email,error:er});continue}const {error:u}=await db.from("profiles").update({full_name:name,student_code:code}).eq("id",old.id);results.push(u?{ok:false,email,error:u.message}:{ok:true,email,existing:true,reassigned:!!cid});continue}
     if(pw.length<6){results.push({ok:false,email,error:"Password < 6 ký tự"});continue}
     const {data:au,error:ae}=await db.auth.admin.createUser({email,password:pw,email_confirm:true});if(ae||!au.user){results.push({ok:false,email,error:ae?.message||"Không tạo được user"});continue}
     const uid=au.user.id;const {error:pe}=await db.from("profiles").upsert({id:uid,full_name:name,student_code:code,role:"student",email,is_active:true,must_change_password:false,created_by:user.id},{onConflict:"id"});
     if(pe){await db.auth.admin.deleteUser(uid);results.push({ok:false,email,error:pe.message});continue}
     const er=cid?await assign(uid,cid):"";if(er){await db.auth.admin.deleteUser(uid);results.push({ok:false,email,error:er});continue}
     await db.from("audit_logs").insert({actor_id:user.id,action:"create_user",target_type:"profile",target_id:uid,metadata:{role:"student",email,bulk:true,class_id:cid}});results.push({ok:true,email,created:true});
   }
   const success=results.filter((x:any)=>x.ok).length;return out({ok:true,total:results.length,success,failed:results.length-success,results});
 }
 return out({error:"Unknown action"},400);
});
