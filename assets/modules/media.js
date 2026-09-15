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
  // GIF có thể là ảnh động; giữ nguyên để không phá nội dung.
  if(file.type==="image/gif") return file;

  let decoded;
  try{ decoded=await decodeImage(file); }
  catch{ return file; }
  try{
    const scale=Math.min(1,MAX_IMAGE_EDGE/Math.max(decoded.width,decoded.height));
    // Nếu ảnh đã nhỏ và nhẹ, không encode lại để tránh giảm chất lượng không cần thiết.
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
    // Chỉ dùng bản tối ưu khi thực sự nhỏ hơn hoặc khi đã resize kích thước ảnh.
    if(scale===1 && blob.size>=file.size) return file;
    const stem=(file.name||"image").replace(/\.[^.]+$/,'');
    return new File([blob],`${stem}.webp`,{type:"image/webp",lastModified:Date.now()});
  }finally{ decoded.close(); }
}

export function createMediaService(sb){
  async function uploadMedia(file,prefix="media"){
    if(!file) return null;
    const kind=mediaTypeFromFile(file);
    if(!kind) throw new Error("Chỉ hỗ trợ ảnh hoặc âm thanh.");
    const prepared=kind==="image" ? await optimizeImage(file) : file;
    const path=`${prefix}/${crypto.randomUUID()}${fileExt(prepared.name)}`;
    const {error}=await sb.storage.from("test-media").upload(path,prepared,{
      cacheControl:"3600",upsert:false,contentType:prepared.type
    });
    if(error) throw error;
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
