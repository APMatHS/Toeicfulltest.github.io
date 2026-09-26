const BUCKET="bank-media";
const SIGNED_URL_TTL=6*60*60;
const MAX_IMAGE_BYTES=20*1024*1024;

function ext(name=""){
  const m=String(name).toLowerCase().match(/\.(png|jpe?g|webp)$/);
  return m?m[0].replace(".jpeg",".jpg"):"";
}

export function createQuestionBankMediaService(sb){
  const cache=new Map();

  async function signedUrl(path){
    if(!path)return null;
    const hit=cache.get(path);
    if(hit&&hit.expiresAt>Date.now())return hit.url;
    const {data,error}=await sb.storage.from(BUCKET).createSignedUrl(path,SIGNED_URL_TTL);
    if(error)return null;
    const url=data?.signedUrl||null;
    if(url)cache.set(path,{url,expiresAt:Date.now()+(SIGNED_URL_TTL-300)*1000});
    return url;
  }

  async function signedUrlMap(paths=[]){
    const unique=[...new Set(paths.filter(Boolean))],out={},missing=[];
    for(const path of unique){
      const hit=cache.get(path);
      if(hit&&hit.expiresAt>Date.now())out[path]=hit.url;else missing.push(path);
    }
    if(missing.length){
      const {data,error}=await sb.storage.from(BUCKET).createSignedUrls(missing,SIGNED_URL_TTL);
      if(!error)for(const item of data||[]){
        if(!item.signedUrl)continue;
        out[item.path]=item.signedUrl;
        cache.set(item.path,{url:item.signedUrl,expiresAt:Date.now()+(SIGNED_URL_TTL-300)*1000});
      }
    }
    return out;
  }

  async function uploadImage(file){
    if(!(file instanceof File)||!file.size)throw new Error("Không có ảnh để tải lên.");
    if(!["image/png","image/jpeg","image/webp"].includes(file.type))throw new Error("Ngân hàng hỗ trợ ảnh PNG, JPG hoặc WebP.");
    if(file.size>MAX_IMAGE_BYTES)throw new Error("Ảnh quá lớn. Vui lòng dùng ảnh không quá 20 MB.");
    const suffix=ext(file.name)||({"image/png":".png","image/jpeg":".jpg","image/webp":".webp"}[file.type]||"");
    const path=`rich/${crypto.randomUUID()}${suffix}`;
    const {error}=await sb.storage.from(BUCKET).upload(path,file,{cacheControl:"3600",upsert:false,contentType:file.type});
    if(error)throw error;
    return {storage_path:path,url:await signedUrl(path)};
  }

  return {uploadImage,signedUrl,signedUrlMap};
}
