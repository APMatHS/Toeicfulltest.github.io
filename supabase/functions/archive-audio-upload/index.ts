import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type, x-audio-filename",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{...cors,"Content-Type":"application/json"}
});

function readKey(legacyName:string,newName:string){
  const legacy=Deno.env.get(legacyName);
  if(legacy)return legacy;
  const raw=Deno.env.get(newName);
  if(!raw)return "";
  try{
    const parsed=JSON.parse(raw);
    return parsed.default||Object.values(parsed)[0]||"";
  }catch{return "";}
}
function safeOriginalName(req:Request){
  const raw=req.headers.get("X-Audio-Filename")||"listening.mp3";
  try{return decodeURIComponent(raw).slice(0,180)}catch{return "listening.mp3"}
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"Method not allowed"},405);

  const supabaseUrl=Deno.env.get("SUPABASE_URL")||"";
  const secretKey=readKey("SUPABASE_SERVICE_ROLE_KEY","SUPABASE_SECRET_KEYS");
  const archiveAccess=Deno.env.get("ARCHIVE_ACCESS_KEY")||"";
  const archiveSecret=Deno.env.get("ARCHIVE_SECRET_KEY")||"";
  if(!supabaseUrl||!secretKey)return json({error:"Supabase server configuration missing"},500);
  if(!archiveAccess||!archiveSecret)return json({error:"Archive.org keys are not configured"},503);

  const admin=createClient(supabaseUrl,secretKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  const {data:{user}}=await admin.auth.getUser(token);
  if(!user)return json({error:"Unauthorized"},401);
  const {data:profile}=await admin.from("profiles").select("role,is_active").eq("id",user.id).single();
  if(!profile?.is_active||!["teacher","system_admin"].includes(profile.role))return json({error:"Forbidden"},403);

  const type=(req.headers.get("Content-Type")||"").split(";")[0].trim().toLowerCase();
  if(type!=="audio/mpeg")return json({error:"Listening audio must be MP3"},415);
  const declared=Number(req.headers.get("Content-Length")||0);
  const max=50*1024*1024;
  if(declared>max)return json({error:"Audio exceeds 50 MB"},413);

  const bytes=new Uint8Array(await req.arrayBuffer());
  if(!bytes.length)return json({error:"Empty audio file"},400);
  if(bytes.byteLength>max)return json({error:"Audio exceeds 50 MB"},413);

  const originalName=safeOriginalName(req);
  const id=crypto.randomUUID().replaceAll("-","");
  const identifier=`toeic-audio-${id}`;
  const filename=`${crypto.randomUUID().replaceAll("-","")}.mp3`;
  const target=`https://s3.us.archive.org/${identifier}/${filename}`;

  const upload=await fetch(target,{
    method:"PUT",
    headers:{
      "Authorization":`LOW ${archiveAccess}:${archiveSecret}`,
      "Content-Type":"audio/mpeg",
      "Content-Length":String(bytes.byteLength),
      "x-archive-auto-make-bucket":"1",
      "x-archive-meta-title":`TOEIC Listening Audio ${id.slice(0,8)}`,
      "x-archive-meta-mediatype":"audio",
      "x-archive-meta-description":"Audio asset managed by TOEIC Full Test question bank."
    },
    body:bytes
  });
  if(!upload.ok){
    const detail=(await upload.text()).slice(0,500);
    console.error("Archive upload failed",upload.status,detail);
    return json({error:`Archive upload failed (HTTP ${upload.status})`},502);
  }

  const url=`https://archive.org/download/${identifier}/${filename}`;
  await admin.from("audit_logs").insert({
    actor_id:user.id,action:"archive_audio_upload",target_type:"archive_audio",target_id:identifier,
    metadata:{filename,original_name:originalName,size_bytes:bytes.byteLength}
  });
  return json({ok:true,provider:"archive",identifier,filename,url,size_bytes:bytes.byteLength});
});
