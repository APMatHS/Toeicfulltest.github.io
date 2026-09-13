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
function safeRedirect(input:unknown){
  const fallback="https://toeicfulltest.github.io/";
  try{
    const u=new URL(String(input||fallback));
    const local=u.hostname==="localhost"||u.hostname==="127.0.0.1";
    if(u.hostname!=="toeicfulltest.github.io"&&!local) return fallback;
    if(u.protocol!=="https:"&&!local) return fallback;
    u.hash="";
    u.search="";
    return u.toString();
  }catch{return fallback;}
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return json({ok:true});

  let body:any={};
  try{body=await req.json()}catch{}
  const email=String(body.email??"").trim().toLowerCase();
  const redirectTo=safeRedirect(body.redirect_to);

  // Always return the same public response to avoid revealing whether an account exists.
  const generic=()=>json({ok:true,message:"If this is an active staff account, a recovery email will be sent."});
  if(!email||email.length>320||!email.includes("@")) return generic();

  const url=Deno.env.get("SUPABASE_URL")!;
  const secretKey=readKey("SUPABASE_SERVICE_ROLE_KEY","SUPABASE_SECRET_KEYS");
  const publishableKey=readKey("SUPABASE_ANON_KEY","SUPABASE_PUBLISHABLE_KEYS");
  if(!url||!secretKey||!publishableKey) return generic();

  const admin=createClient(url,secretKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:target}=await admin.from("profiles")
    .select("id,role,is_active,email")
    .eq("email",email)
    .maybeSingle();

  if(!target?.is_active||!["teacher","system_admin"].includes(target.role)) return generic();

  // Extra cooldown beyond Supabase Auth's own email rate limits.
  const since=new Date(Date.now()-10*60*1000).toISOString();
  const {data:recent}=await admin.from("audit_logs")
    .select("id")
    .eq("action","staff_password_recovery_requested")
    .eq("target_id",target.id)
    .gte("created_at",since)
    .limit(1);
  if(recent?.length) return generic();

  const publicClient=createClient(url,publishableKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {error}=await publicClient.auth.resetPasswordForEmail(email,{redirectTo});
  if(!error){
    await admin.from("audit_logs").insert({
      actor_id:null,action:"staff_password_recovery_requested",target_type:"profile",target_id:target.id,
      metadata:{channel:"email"}
    });
  }else{
    console.error("password reset request failed",error.message);
  }

  return generic();
});
