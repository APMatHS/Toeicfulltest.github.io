function fileExt(name=""){ return name.includes(".") ? "."+name.split(".").pop().toLowerCase() : ""; }

function mediaTypeFromFile(file){
  if(!file) return null;
  if(file.type.startsWith("image/")) return "image";
  if(file.type.startsWith("audio/")) return "audio";
  return null;
}

export function createMediaService(sb){
  async function uploadMedia(file,prefix="media"){
    if(!file) return null;
    const kind=mediaTypeFromFile(file);
    if(!kind) throw new Error("Chỉ hỗ trợ ảnh hoặc âm thanh.");
    const path=`${prefix}/${crypto.randomUUID()}${fileExt(file.name)}`;
    const {error}=await sb.storage.from("test-media").upload(path,file,{
      cacheControl:"3600",upsert:false,contentType:file.type
    });
    if(error) throw error;
    return {media_type:kind,storage_path:path};
  }

  async function signedUrl(path){
    if(!path) return null;
    const {data,error}=await sb.storage.from("test-media").createSignedUrl(path,3600);
    return error ? null : data?.signedUrl||null;
  }

  async function signedUrlMap(paths){
    const unique=[...new Set(paths.filter(Boolean))];
    if(!unique.length) return {};
    const {data}=await sb.storage.from("test-media").createSignedUrls(unique,3600);
    return Object.fromEntries((data||[]).filter(x=>x.signedUrl).map(x=>[x.path,x.signedUrl]));
  }

  return {uploadMedia,signedUrl,signedUrlMap};
}
