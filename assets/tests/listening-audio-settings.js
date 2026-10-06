import { esc } from "../modules/utils.js";
import { MAX_AUDIO_UPLOAD_BYTES } from "../modules/media.js";

function formatDuration(seconds){
  const value=Math.max(0,Math.round(Number(seconds)||0));
  if(!value)return "Chưa xác định";
  const h=Math.floor(value/3600),m=Math.floor((value%3600)/60),s=value%60;
  return h?`${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`:`${m}:${String(s).padStart(2,"0")}`;
}

function formatBytes(bytes){
  const mb=Number(bytes||0)/(1024*1024);
  return `${mb.toFixed(mb>=10?1:2)} MB`;
}

function audioDuration(file){
  return new Promise(resolve=>{
    const url=URL.createObjectURL(file),audio=document.createElement("audio"),done=value=>{URL.revokeObjectURL(url);audio.remove();resolve(Number.isFinite(value)?value:0);};
    const timer=setTimeout(()=>done(0),8000);
    audio.preload="metadata";
    audio.onloadedmetadata=()=>{clearTimeout(timer);done(audio.duration);};
    audio.onerror=()=>{clearTimeout(timer);done(0);};
    audio.src=url;
  });
}

export function createListeningAudioSettings(ctx){
  const {sb,uploadMedia,signedUrl,removeMedia,toast}=ctx;

  function card(test,locked=false){
    if(!["listening","full"].includes(test?.test_kind))return "";
    const has=!!test.listening_audio_storage_path;
    const duration=Number(test.listening_audio_duration_seconds||0),limit=Number(test.duration_minutes||0)*60,tooLong=has&&duration>0&&limit>0&&duration>limit;
    return `<section class="card listening-master-settings">
      <div class="row between wrap"><div><h2>Audio Listening Part 1–4</h2><p class="muted">Một file audio chung. File mới được chuyển sang Archive.org; Supabase Storage chỉ làm vùng tạm trong lúc tải. Sinh viên bấm Bắt đầu nghe một lần; audio chạy liên tục, không pause, không tua và không nghe lại.</p></div><span class="status ${has?"ok":"warn"}">${has?"Đã có audio":"Chưa có audio"}</span></div>
      ${has?`<div class="listening-audio-meta"><div><span class="muted">Tên file</span><b>${esc(test.listening_audio_filename||"Audio Listening")}</b></div><div><span class="muted">Thời lượng</span><b>${formatDuration(test.listening_audio_duration_seconds)}</b></div></div>${tooLong?`<div class="warning-box"><b>Audio dài hơn thời lượng bài kiểm tra (${test.duration_minutes} phút).</b><br>Hãy tăng thời lượng bài trước khi Publish.</div>`:""}<div id="listeningAudioTeacherPreview" class="listening-audio-preview muted">Đang tạo liên kết nghe thử…</div>`:'<div class="warning-box"><b>Cần tải 1 file audio trước khi xuất bản Listening/Full Test.</b><br>Không cần gắn audio riêng cho từng câu hoặc từng nhóm.</div>'}
      <div class="row wrap"><label class="btn ${has?"secondary":"primary"} ${locked?"disabled":""}">${has?"Thay file audio":"Tải audio"}<input id="listeningAudioUpload" type="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/aac,audio/ogg,.mp3,.m4a,.wav,.aac,.ogg" ${locked?"disabled":""} hidden></label>${has?`<button type="button" class="danger" id="removeListeningAudio" ${locked?"disabled":""}>Xóa audio</button>`:""}</div>
      <div id="listeningAudioUploadProgress" class="listening-upload-progress" hidden><progress max="100" value="0" style="width:min(100%,480px)"></progress> <b data-progress-text>0%</b><div class="muted small" data-progress-note></div></div>
      ${locked?'<p class="muted small">🔒 Audio đã khóa vì đã có sinh viên bắt đầu bài.</p>':`<p class="muted small">Nên dùng MP3/M4A. Tối đa ${formatBytes(MAX_AUDIO_UPLOAD_BYTES)}. File trên 6 MB dùng resumable upload vào vùng tạm Supabase, sau đó backend chuyển sang Archive.org.</p>`}
    </section>`;
  }

  async function bind(test,{onUpdated}={}){
    if(!["listening","full"].includes(test?.test_kind))return;
    const preview=document.querySelector("#listeningAudioTeacherPreview");
    if(preview&&test.listening_audio_storage_path){
      const url=await signedUrl(test.listening_audio_storage_path);
      preview.innerHTML=url?`<audio controls preload="metadata" src="${esc(url)}"></audio>`:'<span class="danger-text">Không tạo được liên kết nghe thử.</span>';
    }
    const input=document.querySelector("#listeningAudioUpload");
    if(input)input.onchange=async()=>{
      const file=input.files?.[0];if(!file)return;
      if(!file.type.startsWith("audio/")&&!/\.(mp3|m4a|wav|aac|ogg)$/i.test(file.name||"")){input.value="";return toast("Vui lòng chọn file audio MP3/M4A/WAV/AAC/OGG.",6000);}
      if(file.size>MAX_AUDIO_UPLOAD_BYTES){input.value="";return toast(`Audio ${formatBytes(file.size)} vượt giới hạn ${formatBytes(MAX_AUDIO_UPLOAD_BYTES)}. Hãy nén MP3 hoặc chọn file nhỏ hơn.`,7000);}
      const label=input.closest("label"),oldText=label?.childNodes?.[0]?.textContent||"Tải audio";
      const progress=document.querySelector("#listeningAudioUploadProgress"),bar=progress?.querySelector("progress"),progressText=progress?.querySelector("[data-progress-text]"),progressNote=progress?.querySelector("[data-progress-note]");
      let startedAt=0,lastUploaded=0,lastAt=0,speedBps=0;
      const updateProgress=({percent=0,uploaded=0,total=file.size,method="standard",status="uploading",retryAttempt=0,httpStatus=null,idleMs=0}={})=>{
        const now=Date.now();
        if(!startedAt){startedAt=now;lastAt=now;}
        if(uploaded>lastUploaded&&now>lastAt){
          const instant=(uploaded-lastUploaded)/((now-lastAt)/1000);
          speedBps=speedBps?speedBps*.65+instant*.35:instant;
          lastUploaded=uploaded;lastAt=now;
        }
        if(progress)progress.hidden=false;
        if(bar)bar.value=percent;
        if(progressText)progressText.textContent=`${percent}%`;
        let detail=`${formatBytes(uploaded)} / ${formatBytes(total)}`;
        if(speedBps>0&&uploaded<total){
          const mbps=speedBps/(1024*1024),eta=Math.max(0,(total-uploaded)/speedBps);
          detail+=` · ${mbps.toFixed(mbps>=1?1:2)} MB/s · còn ~${eta>=60?`${Math.ceil(eta/60)} phút`:`${Math.ceil(eta)} giây`}`;
        }
        if(status==="resuming")detail+=" · đang nối lại lần tải trước";
        else if(status==="retrying")detail+=` · mạng gián đoạn, đang thử lại lần ${retryAttempt}${httpStatus?` (HTTP ${httpStatus})`:""}`;
        else if(status==="waiting")detail+=` · chưa nhận dữ liệu ${Math.round(idleMs/1000)} giây, đang chờ Supabase`;
        else detail+=` · ${method==="resumable"?"resumable upload":"upload thường"}`;
        if(progressNote)progressNote.textContent=detail;
        if(label?.childNodes?.[0])label.childNodes[0].textContent=`Đang tải audio… ${percent}%`;
      };
      if(label){label.classList.add("disabled");input.disabled=true;label.childNodes[0].textContent="Đang chuẩn bị audio…";}
      if(progress){progress.hidden=false;if(bar)bar.value=0;if(progressText)progressText.textContent="0%";if(progressNote)progressNote.textContent=`${formatBytes(file.size)} · đang đọc thông tin file`;}
      let uploaded=null;
      try{
        const duration=await audioDuration(file);
        uploaded=await uploadMedia(file,`tests/${test.id}/archive-staging`,{onProgress:updateProgress});
        if(progressNote)progressNote.textContent="Đã tải vùng tạm · đang chuyển audio sang Archive.org…";
        if(label?.childNodes?.[0])label.childNodes[0].textContent="Đang chuyển sang Archive.org…";
        const {data,error}=await sb.functions.invoke("archive-audio",{body:{
          action:"upload",
          test_id:test.id,
          storage_path:uploaded.storage_path,
          filename:file.name,
          duration_seconds:duration||null
        }});
        if(error)throw error;
        if(!data?.ok)throw new Error(data?.error||"Archive.org chưa nhận được audio.");
        uploaded=null;
        updateProgress({percent:100,uploaded:file.size,total:file.size,method:file.size>6*1024*1024?"resumable":"standard",status:"done"});
        if(progressNote)progressNote.textContent=data.archive_ready
          ?`Hoàn tất · ${formatBytes(file.size)} · audio đang phục vụ từ Archive.org`
          :`Archive.org đã nhận file · ${formatBytes(file.size)} · liên kết công khai đang được đồng bộ`;
        toast(data.archive_ready?"Đã chuyển audio Listening sang Archive.org":"Archive.org đã nhận audio; liên kết có thể cần thêm ít phút để sẵn sàng",6500);
        await onUpdated?.();
      }catch(err){
        if(uploaded?.storage_path)removeMedia?.(uploaded.storage_path).catch(()=>{});
        if(progress){progress.hidden=false;if(progressNote)progressNote.textContent=`Tải audio chưa hoàn tất: ${err.message||err}`;}
        toast(`Không tải được audio: ${err.message||err}`,8000);
        if(label){label.classList.remove("disabled");input.disabled=false;label.childNodes[0].textContent=oldText;}
        input.value="";
      }
    };
    const remove=document.querySelector("#removeListeningAudio");
    if(remove)remove.onclick=async()=>{
      if(!confirm("Xóa file audio chung của Listening Part 1–4? Bài sẽ không thể Publish cho đến khi tải audio mới."))return;
      remove.disabled=true;remove.textContent="Đang xóa…";
      const {data,error}=await sb.functions.invoke("archive-audio",{body:{action:"remove",test_id:test.id}});
      if(error||!data?.ok){
        remove.disabled=false;remove.textContent="Xóa audio";
        return toast(error?.message||data?.error||"Không gỡ được audio.",7000);
      }
      toast(data.cleanup_warning?"Đã gỡ audio khỏi bài; file cũ sẽ được dọn riêng":"Đã gỡ audio Listening khỏi bài kiểm tra");
      await onUpdated?.();
    };
  }

  return {card,bind,formatDuration};
}
