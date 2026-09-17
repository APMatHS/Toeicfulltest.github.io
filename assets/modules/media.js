import { SUPABASE_URL } from "../config.js";

function fileExt(name=""){ return name.includes(".") ? "."+name.split(".").pop().toLowerCase() : ""; }

function mediaTypeFromFile(file){
  if(!file) return null;
  if(file.type.startsWith("image/")) return "image";
  if(file.type.startsWith("audio/")) return "audio";
  return null;
}

const SIGNED_URL_TTL_SECONDS=6*60*60;
const MAX_SOURCE_IMAGE_BYTES=20*1024*1024;
const MAX_IMAGE_EDGE=2000;
const TARGET_IMAGE_BYTES=2.5*1024*1024;
const STANDARD_AUDIO_UPLOAD_BYTES=6*1024*1024;
export const MAX_AUDIO_UPLOAD_BYTES=50*1024*1024;
const TUS_CHUNK_BYTES=6*1024*1024;
let tusPromise=null;

function canvasToBlob(canvas,type,quality){
  return new Promise(resolve=>canvas.toBlob(resolve,type,quality));
}

async function decodeImage(file){
  if("createImageBitmap" in window){
    const bitmap=await createImageBitmap(file);
    return {source:bitmap,width:bitmap.width,height:bitmap.height,close:()=>bitmap.close?.()};
  }
  const url=URL.createObjectURL(file);
  try{
    const img=new Image();
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;});
    return {source:img,width:img.naturalWidth,height:img.naturalHeight,close:()=>{}};
  }finally{URL.revokeObjectURL(url);}
}

async function optimizeImage(file){
  if(!file?.type?.startsWith("image/")) return file;
  if(file.size>MAX_SOURCE_IMAGE_BYTES) throw new Error("Ảnh quá lớn. Vui lòng chọn ảnh dưới 20 MB.");
  if(file.type==="image/gif") return file;

  let decoded;
  try{ decoded=await decodeImage(file); }
  catch{ return file; }
  try{
    const scale=Math.min(1,MAX_IMAGE_EDGE/Math.max(decoded.width,decoded.height));
    if(scale===1 && file.size<=TARGET_IMAGE_BYTES) return file;
    const width=Math.max(1,Math.round(decoded.width*scale));
    const height=Math.max(1,Math.round(decoded.height*scale));
    const canvas=document.createElement("canvas");
    canvas.width=width; canvas.height=height;
    const ctx=canvas.getContext("2d",{alpha:true});
    if(!ctx) return file;
    ctx.drawImage(decoded.source,0,0,width,height);

    let blob=await canvasToBlob(canvas,"image/webp",0.86);
    if(blob && blob.size>TARGET_IMAGE_BYTES) blob=await canvasToBlob(canvas,"image/webp",0.76);
    if(!blob) return file;
    if(scale===1 && blob.size>=file.size) return file;
    const stem=(file.name||"image").replace(/\.[^.]+$/,'');
    return new File([blob],`${stem}.webp`,{type:"image/webp",lastModified:Date.now()});
  }finally{ decoded.close(); }
}

async function loadTus(){
  if(!tusPromise) tusPromise=import("https://cdn.jsdelivr.net/npm/tus-js-client@4/+esm");
  return tusPromise;
}

export function createMediaService(sb){
  async function standardUpload(path,file,onProgress){
    onProgress?.({percent:0,uploaded:0,total:file.size,method:"standard"});
    const {error}=await sb.storage.from("test-media").upload(path,file,{
      cacheControl:"3600",upsert:false,contentType:file.type
    });
    if(error) throw error;
    onProgress?.({percent:100,uploaded:file.size,total:file.size,method:"standard"});
  }

  async function resumableUpload(path,file,onProgress){
    const {data,error}=await sb.auth.getSession();
    if(error) throw error;
    const token=data?.session?.access_token;
    if(!token) throw new Error("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại trước khi tải audio.");
    const tus=await loadTus();
    await new Promise((resolve,reject)=>{
      const upload=new tus.Upload(file,{
        endpoint:`${SUPABASE_URL}/storage/v1/upload/resumable`,
        retryDelays:[0,1000,3000,5000,10000,20000],
        headers:{authorization:`Bearer ${token}`},
        uploadSize:file.size,
        chunkSize:TUS_CHUNK_BYTES,
        removeFingerprintOnSuccess:true,
        metadata:{
          bucketName:"test-media",
          objectName:path,
          contentType:file.type||"audio/mpeg",
          cacheControl:"3600"
        },
        onError:reject,
        onProgress(uploaded,total){
          const percent=total?Math.min(100,Math.round((uploaded/total)*100)):0;
          onProgress?.({percent,uploaded,total,method:"resumable"});
        },
        onSuccess:resolve
      });
      upload.start();
    });
  }

  async function uploadMedia(file,prefix="media",options={}){
    if(!file) return null;
    const kind=mediaTypeFromFile(file);
    if(!kind) throw new Error("Chỉ hỗ trợ ảnh hoặc âm thanh.");
    if(kind==="audio" && file.size>MAX_AUDIO_UPLOAD_BYTES){
      throw new Error("Audio quá lớn. Vui lòng dùng file không quá 50 MB.");
    }
    const prepared=kind==="image" ? await optimizeImage(file) : file;
    const path=`${prefix}/${crypto.randomUUID()}${fileExt(prepared.name)}`;
    if(kind==="audio" && prepared.size>STANDARD_AUDIO_UPLOAD_BYTES){
      await resumableUpload(path,prepared,options.onProgress);
    }else{
      await standardUpload(path,prepared,options.onProgress);
    }
    return {media_type:kind,storage_path:path};
  }

  async function signedUrl(path){
    if(!path) return null;
    const {data,error}=await sb.storage.from("test-media").createSignedUrl(path,SIGNED_URL_TTL_SECONDS);
    return error ? null : data?.signedUrl||null;
  }

  async function signedUrlMap(paths){
    const unique=[...new Set(paths.filter(Boolean))];
    if(!unique.length) return {};
    const {data}=await sb.storage.from("test-media").createSignedUrls(unique,SIGNED_URL_TTL_SECONDS);
    return Object.fromEntries((data||[]).filter(x=>x.signedUrl).map(x=>[x.path,x.signedUrl]));
  }

  async function removeMedia(path){
    if(!path) return;
    const {error}=await sb.storage.from("test-media").remove([path]);
    if(error) throw error;
  }

  return {uploadMedia,signedUrl,signedUrlMap,removeMedia};
}
