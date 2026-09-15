import { esc } from "../modules/utils.js";

function formatDuration(seconds){
  const value=Math.max(0,Math.round(Number(seconds)||0));
  if(!value)return "Chưa xác định";
  const h=Math.floor(value/3600),m=Math.floor((value%3600)/60),s=value%60;
  return h?`${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`:`${m}:${String(s).padStart(2,"0")}`;
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
      <div class="row between wrap"><div><h2>Audio Listening Part 1–4</h2><p class="muted">Một file audio chung. Sinh viên bấm Bắt đầu nghe một lần; audio chạy liên tục, không pause, không tua và không nghe lại.</p></div><span class="status ${has?"ok":"warn"}">${has?"Đã có audio":"Chưa có audio"}</span></div>
      ${has?`<div class="listening-audio-meta"><div><span class="muted">Tên file</span><b>${esc(test.listening_audio_filename||"Audio Listening")}</b></div><div><span class="muted">Thời lượng</span><b>${formatDuration(test.listening_audio_duration_seconds)}</b></div></div>${tooLong?`<div class="warning-box"><b>Audio dài hơn thời lượng bài kiểm tra (${test.duration_minutes} phút).</b><br>Hãy tăng thời lượng bài trước khi Publish.</div>`:""}<div id="listeningAudioTeacherPreview" class="listening-audio-preview muted">Đang tạo liên kết nghe thử…</div>`:'<div class="warning-box"><b>Cần tải 1 file audio trước khi xuất bản Listening/Full Test.</b><br>Không cần gắn audio riêng cho từng câu hoặc từng nhóm.</div>'}
      <div class="row wrap"><label class="btn ${has?"secondary":"primary"} ${locked?"disabled":""}">${has?"Thay file audio":"Tải audio"}<input id="listeningAudioUpload" type="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/aac,audio/ogg,.mp3,.m4a,.wav,.aac,.ogg" ${locked?"disabled":""} hidden></label>${has?`<button type="button" class="danger" id="removeListeningAudio" ${locked?"disabled":""}>Xóa audio</button>`:""}</div>
      ${locked?'<p class="muted small">🔒 Audio đã khóa vì đã có sinh viên bắt đầu bài.</p>':'<p class="muted small">Nên dùng MP3/M4A. File cũ được giữ trong Storage để không làm hỏng bài đã nhân bản; có thể dọn media không còn dùng sau.</p>'}
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
      const label=input.closest("label"),oldText=label?.childNodes?.[0]?.textContent||"Tải audio";
      if(label){label.classList.add("disabled");input.disabled=true;label.childNodes[0].textContent="Đang tải audio…";}
      let uploaded=null;
      try{
        const duration=await audioDuration(file);
        uploaded=await uploadMedia(file,`tests/${test.id}/listening-master`);
        const {error}=await sb.rpc("staff_set_listening_audio_v118b",{p_test_id:test.id,p_storage_path:uploaded.storage_path,p_filename:file.name,p_duration_seconds:duration||null});
        if(error)throw error;
        toast("Đã lưu audio chung cho Listening Part 1–4");await onUpdated?.();
      }catch(err){if(uploaded?.storage_path)removeMedia?.(uploaded.storage_path).catch(()=>{});toast(`Không tải được audio: ${err.message||err}`,7000);if(label){label.classList.remove("disabled");input.disabled=false;label.childNodes[0].textContent=oldText;}input.value="";}
    };
    const remove=document.querySelector("#removeListeningAudio");
    if(remove)remove.onclick=async()=>{
      if(!confirm("Xóa file audio chung của Listening Part 1–4? Bài sẽ không thể Publish cho đến khi tải audio mới."))return;
      remove.disabled=true;remove.textContent="Đang xóa…";
      const {error}=await sb.rpc("staff_set_listening_audio_v118b",{p_test_id:test.id,p_storage_path:null,p_filename:null,p_duration_seconds:null});
      if(error){remove.disabled=false;remove.textContent="Xóa audio";return toast(error.message,6000);}
      toast("Đã gỡ audio Listening khỏi bài kiểm tra");await onUpdated?.();
    };
  }

  return {card,bind,formatDuration};
}
