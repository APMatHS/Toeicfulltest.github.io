import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"
};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{...cors,"Content-Type":"application/json"}
});

function readKey(legacyName:string,newName:string){
  const legacy=Deno.env.get(legacyName);
  if(legacy) return legacy;
  const raw=Deno.env.get(newName);
  if(!raw) return "";
  try{
    const parsed=JSON.parse(raw);
    return parsed.default || Object.values(parsed)[0] || "";
  }catch{return "";}
}

function randomIndex(max:number){
  const a=new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0]%max;
}
function randomChar(chars:string){return chars[randomIndex(chars.length)];}
function shuffle(chars:string[]){
  for(let i=chars.length-1;i>0;i--){
    const j=randomIndex(i+1);
    [chars[i],chars[j]]=[chars[j],chars[i]];
  }
  return chars;
}
function generateTemporaryPassword(){
  const upper="ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower="abcdefghijkmnopqrstuvwxyz";
  const digits="23456789";
  const symbols="!@#$%";
  const pool=upper+lower+digits+symbols;
  const out=[randomChar(upper),randomChar(lower),randomChar(digits),randomChar(symbols)];
  while(out.length<12) out.push(randomChar(pool));
  return shuffle(out).join("");
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});

  const url=Deno.env.get("SUPABASE_URL")!;
  const secretKey=readKey("SUPABASE_SERVICE_ROLE_KEY","SUPABASE_SECRET_KEYS");
  if(!url||!secretKey) return json({error:"Server configuration missing"},500);

  const admin=createClient(url,secretKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const token=(req.headers.get("Authorization")??"").replace("Bearer ","");
  const {data:{user:actor}}=await admin.auth.getUser(token);
  if(!actor) return json({error:"Unauthorized"},401);

  const {data:p}=await admin.from("profiles").select("role,is_active").eq("id",actor.id).single();
  if(!p?.is_active||!["teacher","system_admin"].includes(p.role)) return json({error:"Forbidden"},403);

  let body:any;
  try{body=await req.json()}catch{return json({error:"Invalid JSON body"},400)}

  async function createOne(row:any, forcedRole?:"student"|"teacher", forcedClassId?:string|null){
    const role=forcedRole??row.role??"student";
    if(!["student","teacher"].includes(role)) return {ok:false,email:row.email,error:"Invalid role"};
    const email=String(row.email??"").trim().toLowerCase();
    const password=String(row.password??"");
    const full_name=String(row.full_name??row.name??"").trim();
    const student_code=row.student_code?String(row.student_code).trim():null;
    const class_id=forcedClassId??row.class_id??null;
    if(!email||!full_name||password.length<6) return {ok:false,email,error:"Thiếu họ tên/email hoặc password < 6 ký tự"};

    const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true});
    if(error) return {ok:false,email,error:error.message};

    const {error:pe}=await admin.from("profiles").upsert({
      id:data.user.id,full_name,student_code,role,email,is_active:true,must_change_password:false,created_by:actor.id
    },{onConflict:"id"});
    if(pe){await admin.auth.admin.deleteUser(data.user.id);return {ok:false,email,error:pe.message}}

    if(class_id&&role==="student"){
      const {error:ce}=await admin.from("class_members").upsert({class_id,user_id:data.user.id},{onConflict:"class_id,user_id"});
      if(ce){return {ok:false,email,error:ce.message,user_id:data.user.id}}
    }
    await admin.from("audit_logs").insert({
      actor_id:actor.id,action:"create_user",target_type:"profile",target_id:data.user.id,
      metadata:{role,email,bulk:!!body.users}
    });
    return {ok:true,email,user_id:data.user.id};
  }

  if(body.action==="create_user"){
    const r=await createOne(body);
    return r.ok?json(r):json({error:r.error},400);
  }

  if(body.action==="bulk_create_students"){
    const users=Array.isArray(body.users)?body.users:[];
    if(!users.length) return json({error:"Danh sách trống"},400);
    if(users.length>500) return json({error:"Tối đa 500 sinh viên mỗi lần"},400);
    const results=[];
    for(const row of users) results.push(await createOne(row,"student",body.class_id??null));
    const success=results.filter((x:any)=>x.ok).length;
    return json({ok:true,total:results.length,success,failed:results.length-success,results});
  }

  if(body.action==="reset_student_password"){
    const targetId=String(body.user_id??"");
    if(!targetId) return json({error:"Thiếu user_id"},400);

    const {data:target,error:targetError}=await admin.from("profiles")
      .select("id,full_name,student_code,email,role,is_active")
      .eq("id",targetId).single();
    if(targetError||!target) return json({error:"Không tìm thấy sinh viên"},404);
    if(target.role!=="student") return json({error:"Chỉ được sinh lại mật khẩu cho sinh viên"},403);

    const temporaryPassword=generateTemporaryPassword();
    const {error:authError}=await admin.auth.admin.updateUserById(target.id,{password:temporaryPassword});
    if(authError) return json({error:authError.message},400);

    // The auth.users password-change trigger clears this flag first; set it back
    // after the admin reset so the student is forced to choose a private password.
    const {error:profileError}=await admin.from("profiles")
      .update({must_change_password:true})
      .eq("id",target.id);
    if(profileError) return json({error:"Đã đổi mật khẩu nhưng không đặt được cờ bắt buộc đổi lại"},500);

    await admin.from("audit_logs").insert({
      actor_id:actor.id,action:"student_password_reset",target_type:"profile",target_id:target.id,
      metadata:{student_code:target.student_code,email:target.email}
    });

    return json({
      ok:true,
      user_id:target.id,
      student_name:target.full_name,
      temporary_password:temporaryPassword,
      must_change_password:true
    });
  }

  if(body.action==="set_system_admin"){
    if(p.role!=="system_admin") return json({error:"Only system_admin can grant system_admin"},403);
    const {error}=await admin.from("profiles").update({role:"system_admin"}).eq("id",body.user_id);
    if(error) return json({error:error.message},400);
    await admin.from("audit_logs").insert({actor_id:actor.id,action:"grant_system_admin",target_type:"profile",target_id:body.user_id});
    return json({ok:true});
  }

  if(body.action==="set_active"){
    const {data:target}=await admin.from("profiles").select("role").eq("id",body.user_id).single();
    if(target?.role==="system_admin"&&p.role!=="system_admin") return json({error:"Teacher cannot disable system_admin"},403);
    const {error}=await admin.from("profiles").update({is_active:!!body.is_active}).eq("id",body.user_id);
    if(error) return json({error:error.message},400);
    await admin.from("audit_logs").insert({actor_id:actor.id,action:body.is_active?"activate_user":"deactivate_user",target_type:"profile",target_id:body.user_id});
    return json({ok:true});
  }

  return json({error:"Unknown action"},400);
});
