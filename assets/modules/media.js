function fileExt(name=""){ return name.includes(".") ? "."+name.split(".").pop().toLowerCase() : ""; }

function mediaTypeFromFile(file){
  if(!file) return null;
  if(file.type.startsWith("image/")) return "image";
  if(file.type.startsWith("audio/")) return "audio";
  return null;
}

// TOEIC Reading thường kéo dài 75 phút. V1.10 tiếp tục dùng URL tạm 6 giờ để media
// không hết hạn giữa bài thi hoặc khi giảng viên soạn/chấm trong thời gian dài.
const SIGNED_URL_TTL_SECONDS=6*60*60;

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
    const {data,error}=await sb.storage.from("test-media").createSignedUrl(path,SIGNED_URL_TTL_SECONDS);
    return error ? null : data?.signedUrl||null;
  }

  async function signedUrlMap(paths){
    const unique=[...new Set(paths.filter(Boolean))];
    if(!unique.length) return {};
    const {data}=await sb.storage.from("test-media").createSignedUrls(unique,SIGNED_URL_TTL_SECONDS);
    return Object.fromEntries((data||[]).filter(x=>x.signedUrl).map(x=>[x.path,x.signedUrl]));
  }

  return {uploadMedia,signedUrl,signedUrlMap};
}
