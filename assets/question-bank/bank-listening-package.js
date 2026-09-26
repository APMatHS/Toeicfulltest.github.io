import { MAX_AUDIO_UPLOAD_BYTES } from "../modules/media.js";

const textDecoder=new TextDecoder();
const isMp3Frame=(bytes,offset=0)=>bytes.length>=offset+4&&bytes[offset]===0xff&&(bytes[offset+1]&0xe0)===0xe0;

function synchsafe(bytes,offset){return ((bytes[offset]&0x7f)<<21)|((bytes[offset+1]&0x7f)<<14)|((bytes[offset+2]&0x7f)<<7)|(bytes[offset+3]&0x7f);}

export function stripMp3Tags(input){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  let start=0,end=bytes.length;
  if(bytes.length>=10&&textDecoder.decode(bytes.subarray(0,3))==="ID3"){
    const footer=(bytes[5]&0x10)!==0;
    start=Math.min(bytes.length,10+synchsafe(bytes,6)+(footer?10:0));
  }
  if(end-start>=128&&textDecoder.decode(bytes.subarray(end-128,end-125))==="TAG")end-=128;
  const body=bytes.subarray(start,end);
  if(!isMp3Frame(body,0))throw new Error("Clip Listening không phải luồng MP3 hợp lệ sau khi bỏ metadata ID3.");
  return body;
}

export function mp3Signature(bytes){
  if(!isMp3Frame(bytes,0))throw new Error("Không đọc được header MP3.");
  const versionBits=(bytes[1]>>3)&3,layerBits=(bytes[1]>>1)&3,sampleIndex=(bytes[2]>>2)&3;
  if(versionBits===1||layerBits===0||sampleIndex===3)throw new Error("Header MP3 dùng cấu hình không được hỗ trợ.");
  const version=versionBits===3?"mpeg1":versionBits===2?"mpeg2":"mpeg2.5";
  const layer={1:"layer3",2:"layer2",3:"layer1"}[layerBits];
  const rates={mpeg1:[44100,48000,32000],mpeg2:[22050,24000,16000],"mpeg2.5":[11025,12000,8000]};
  return {version,layer,sampleRate:rates[version][sampleIndex],key:`${version}:${layer}:${rates[version][sampleIndex]}`};
}

function audioDuration(blob){
  return new Promise(resolve=>{
    const url=URL.createObjectURL(blob),audio=document.createElement("audio");
    const done=value=>{URL.revokeObjectURL(url);audio.remove();resolve(Number.isFinite(value)?value:0);};
    const timer=setTimeout(()=>done(0),7000);
    audio.preload="metadata";
    audio.onloadedmetadata=()=>{clearTimeout(timer);done(audio.duration);};
    audio.onerror=()=>{clearTimeout(timer);done(0);};
    audio.src=url;
  });
}

function listeningDetails(details){return (details||[]).filter(d=>Number(d.item?.part_no)>=1&&Number(d.item?.part_no)<=4);}

function clipPath(detail){
  const rows=(detail.stimuli||[]).filter(s=>s.media_type==="audio"&&s.storage_path);
  if(rows.length!==1)throw new Error(`${detail.item?.public_code||"Item Listening"} phải có đúng một clip MP3.`);
  if(!/\.mp3$/i.test(rows[0].storage_path))throw new Error(`${detail.item?.public_code||"Item Listening"} phải dùng clip MP3.`);
  return rows[0].storage_path;
}

export async function packageListeningAudio({details,bankMedia,uploadMedia,testId,onProgress}){
  const rows=listeningDetails(details);if(!rows.length)return null;
  const parts=[];let totalBytes=0,totalDuration=0,masterSignature=null;
  for(let i=0;i<rows.length;i++){
    const detail=rows[i],path=clipPath(detail);
    onProgress?.({stage:"download",done:i,total:rows.length,code:detail.item?.public_code||""});
    const url=await bankMedia.signedUrl(path);if(!url)throw new Error(`Không tạo được liên kết clip ${detail.item?.public_code||path}.`);
    const response=await fetch(url,{cache:"no-store"});if(!response.ok)throw new Error(`Không tải được clip ${detail.item?.public_code||path} (HTTP ${response.status}).`);
    const blob=await response.blob();
    if(blob.type&&blob.type!=="audio/mpeg"&&!/mpeg|mp3/i.test(blob.type))throw new Error(`${detail.item?.public_code||"Clip"} không phải MP3.`);
    const duration=await audioDuration(blob);if(duration>0)totalDuration+=duration;
    const body=stripMp3Tags(new Uint8Array(await blob.arrayBuffer())),signature=mp3Signature(body);
    if(!masterSignature)masterSignature=signature;
    else if(signature.key!==masterSignature.key)throw new Error(`Clip ${detail.item?.public_code||i+1} không cùng chuẩn MP3 với các clip trước (${signature.sampleRate} Hz thay vì ${masterSignature.sampleRate} Hz). Hãy chuẩn hóa toàn bộ clip cùng sample-rate/MPEG Layer.`);
    totalBytes+=body.byteLength;
    if(totalBytes>MAX_AUDIO_UPLOAD_BYTES)throw new Error("Audio Listening sau khi ghép vượt 50 MB. Hãy nén các clip MP3 trước khi tạo đề.");
    parts.push(body);onProgress?.({stage:"download",done:i+1,total:rows.length,code:detail.item?.public_code||""});
  }
  const file=new File(parts,`listening-bank-${Date.now()}.mp3`,{type:"audio/mpeg",lastModified:Date.now()});
  onProgress?.({stage:"upload",done:0,total:1,percent:0});
  const uploaded=await uploadMedia(file,`tests/${testId}/listening-master`,{onProgress:p=>onProgress?.({stage:"upload",done:p.percent===100?1:0,total:1,percent:p.percent,status:p.status})});
  return {storage_path:uploaded.storage_path,filename:file.name,duration_seconds:totalDuration||null,size:file.size,audio_signature:masterSignature};
}
