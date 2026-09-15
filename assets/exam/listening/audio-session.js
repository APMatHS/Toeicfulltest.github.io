import { esc,readJSON,writeJSON,removeStorage } from "../../modules/utils.js";

const SAVE_INTERVAL_MS=4000;
export const LISTENING_AUDIO_UNIT_KEY="listening:main";

export function createListeningAudio(ctx){
  const {sb,modalRoot,signedUrlMap,toast,getState,onChanged,rpc={},localPrefix="toeic.listening.audio"}=ctx;
  const rpcNames={getStates:rpc.getStates||"get_audio_states_v118",start:rpc.start||"start_audio_unit_v118",update:rpc.update||"update_audio_unit_v118"};
  let audio=null,lastPersist=0,resumeGuard=false,preparedUrl=null;
  const localKey=id=>`${localPrefix}.${id}`;
  const pendingKey=id=>`${localPrefix}.pending.${id}`;
  const unit=()=>{const item=getState()?.listeningAudio;return item?.path?{...item,key:LISTENING_AUDIO_UNIT_KEY}:null;};

  function stateFor(){return getState()?.audioStates?.get(LISTENING_AUDIO_UNIT_KEY)||null;}
  function isPlaying(){return !!getState()?.activeAudio;}
  function isCompleted(){return !!stateFor()?.completed_at;}
  function pendingCompletions(){const state=getState();return state?readJSON(pendingKey(state.attemptId),{}):{};}
  function hasPending(){return Object.keys(pendingCompletions()).length>0;}
  function queuePendingCompletion(position){
    const state=getState();if(!state)return;const pending=pendingCompletions();pending[LISTENING_AUDIO_UNIT_KEY]=Math.max(Number(pending[LISTENING_AUDIO_UNIT_KEY]||0),Number(position||0));writeJSON(pendingKey(state.attemptId),pending);
    const old=state.audioStates.get(LISTENING_AUDIO_UNIT_KEY)||{};state.audioStates.set(LISTENING_AUDIO_UNIT_KEY,{...old,last_position_seconds:pending[LISTENING_AUDIO_UNIT_KEY],completed_at:"pending_sync"});
  }
  async function syncPending(){
    const state=getState();if(!state||!navigator.onLine)return false;const pending=pendingCompletions(),position=pending[LISTENING_AUDIO_UNIT_KEY];if(position==null)return true;
    const {data,error}=await sb.rpc(rpcNames.update,{p_attempt_id:state.attemptId,p_unit_key:LISTENING_AUDIO_UNIT_KEY,p_position_seconds:Number(position),p_completed:true});
    if(error)return false;state.audioStates.set(LISTENING_AUDIO_UNIT_KEY,data||{...(state.audioStates.get(LISTENING_AUDIO_UNIT_KEY)||{}),last_position_seconds:Number(position),completed_at:new Date().toISOString()});delete pending[LISTENING_AUDIO_UNIT_KEY];
    if(Object.keys(pending).length)writeJSON(pendingKey(state.attemptId),pending);else removeStorage(pendingKey(state.attemptId));onChanged?.();return true;
  }

  async function prepareUrl(){
    const audioUnit=unit();if(!audioUnit)return null;if(preparedUrl)return preparedUrl;
    const urls=await signedUrlMap([audioUnit.path]);preparedUrl=urls?.[audioUnit.path]||null;return preparedUrl;
  }
  async function loadStates(){
    const state=getState();if(!state)return;
    const {data,error}=await sb.rpc(rpcNames.getStates,{p_attempt_id:state.attemptId});if(error)console.warn(error);
    state.audioStates=new Map((data||[]).map(x=>[x.unit_key,x]));
    const pending=pendingCompletions(),pendingPos=pending[LISTENING_AUDIO_UNIT_KEY];if(pendingPos!=null){const old=state.audioStates.get(LISTENING_AUDIO_UNIT_KEY)||{};if(!old.completed_at)state.audioStates.set(LISTENING_AUDIO_UNIT_KEY,{...old,last_position_seconds:Number(pendingPos),completed_at:"pending_sync"});}
    if(!error&&navigator.onLine)await syncPending();
    const local=readJSON(localKey(state.attemptId),null);
    if(local?.unit_key===LISTENING_AUDIO_UNIT_KEY&&Number(local.position)>0){
      const server=state.audioStates.get(LISTENING_AUDIO_UNIT_KEY);
      if(server&&!server.completed_at&&Number(local.position)>Number(server.last_position_seconds||0)){
        state.audioStates.set(LISTENING_AUDIO_UNIT_KEY,{...server,last_position_seconds:Number(local.position)});
        if(navigator.onLine)sb.rpc(rpcNames.update,{p_attempt_id:state.attemptId,p_unit_key:LISTENING_AUDIO_UNIT_KEY,p_position_seconds:Number(local.position),p_completed:false}).catch(()=>{});
      }
    }
    try{await prepareUrl();}catch{}
  }

  async function begin(){
    const state=getState(),audioUnit=unit();if(!state)return;if(!audioUnit)return toast("Bài chưa có file audio chung cho Listening Part 1–4.",6000);
    const existing=stateFor();if(existing?.completed_at)return toast("Audio Listening đã phát xong và không thể nghe lại.",5000);
    const url=await prepareUrl();if(!url)return toast("Không mở được file audio Listening.",6000);
    modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><h2>Chuẩn bị nghe Listening</h2><div class="warning-box"><b>Audio Part 1–4 chỉ phát một lần và chạy liên tục từ đầu đến cuối.</b><br>Không pause, không tua và không nghe lại. Trong lúc nghe, bạn có thể chuyển câu để chọn đáp án.</div><p>${state.listeningAudio?.filename?`File: <b>${esc(state.listeningAudio.filename)}</b>`:""}</p><div class="row between"><button class="secondary" data-close>Chưa phát</button><button class="primary" id="startListeningAudio">${existing?.started_at?"Tiếp tục sau gián đoạn":"Bắt đầu nghe"}</button></div></div></div>`;
    modalRoot.querySelector("[data-close]").onclick=()=>modalRoot.innerHTML="";
    modalRoot.querySelector("#startListeningAudio").onclick=async()=>{
      if(!navigator.onLine)return toast("Cần có mạng khi bắt đầu audio để khóa lượt nghe trên hệ thống.",6000);
      const btn=modalRoot.querySelector("#startListeningAudio");btn.disabled=true;btn.textContent="Đang bắt đầu…";
      const playback=startPlayback(audioUnit,existing||{},url);
      const {data,error}=await sb.rpc(rpcNames.start,{p_attempt_id:state.attemptId,p_unit_key:LISTENING_AUDIO_UNIT_KEY});
      if(error){cancelPlayback();btn.disabled=false;btn.textContent="Thử lại";return toast(error.message,6000);}
      state.audioStates.set(LISTENING_AUDIO_UNIT_KEY,data||existing||{});modalRoot.innerHTML="";
      const ok=await playback;if(!ok)return;onChanged?.();
    };
  }

  function startPlayback(audioUnit,audioState,url){
    const state=getState();if(!state)return Promise.resolve(false);stopElement();
    audio=new Audio(url);audio.preload="auto";audio.controls=false;audio.setAttribute("playsinline","");const resume=Math.max(0,Number(audioState?.last_position_seconds||0));
    audio.addEventListener("loadedmetadata",()=>{if(resume>0&&resume<audio.duration){resumeGuard=true;audio.currentTime=resume;setTimeout(()=>resumeGuard=false,120);}},{once:true});
    audio.addEventListener("seeking",()=>{const current=getState();if(resumeGuard||!current?.activeAudio)return;const allowed=Number(current.activeAudio.lastPosition||0);if(Math.abs(audio.currentTime-allowed)>1){resumeGuard=true;audio.currentTime=allowed;setTimeout(()=>resumeGuard=false,80);}});
    audio.addEventListener("pause",()=>{const current=getState();if(!current?.activeAudio||audio.ended||document.visibilityState==="hidden")return;audio.play().catch(()=>{});});
    audio.addEventListener("timeupdate",()=>{const current=getState();if(!current?.activeAudio)return;current.activeAudio.lastPosition=Math.max(current.activeAudio.lastPosition||0,audio.currentTime||0);const now=Date.now();if(now-lastPersist>SAVE_INTERVAL_MS){lastPersist=now;persist();}const el=document.querySelector("#listeningAudioProgress");if(el&&Number.isFinite(audio.duration)&&audio.duration>0)el.value=Math.min(1,audio.currentTime/audio.duration);});
    audio.addEventListener("ended",finish);state.activeAudio={unitKey:audioUnit.key,lastPosition:resume};
    const promise=audio.play();
    return promise.then(()=>true).catch(()=>{if(getState()===state)state.activeAudio=null;stopElement();toast("Trình duyệt chưa cho phép phát audio. Hãy bấm Bắt đầu nghe lại.",6000);return false;});
  }

  function cancelPlayback(){const state=getState();if(state)state.activeAudio=null;stopElement();}
  async function finish(){
    const state=getState();if(!state?.activeAudio||!audio)return;const pos=audio.duration||state.activeAudio.lastPosition||0;
    const {data,error}=await sb.rpc(rpcNames.update,{p_attempt_id:state.attemptId,p_unit_key:LISTENING_AUDIO_UNIT_KEY,p_position_seconds:pos,p_completed:true});const old=state.audioStates.get(LISTENING_AUDIO_UNIT_KEY)||{};
    if(error)queuePendingCompletion(pos);else state.audioStates.set(LISTENING_AUDIO_UNIT_KEY,data||{...old,completed_at:new Date().toISOString(),last_position_seconds:pos});removeStorage(localKey(state.attemptId));state.activeAudio=null;audio=null;onChanged?.();
  }
  async function persist(){
    const state=getState();if(!state?.activeAudio||!audio)return;const pos=Math.max(state.activeAudio.lastPosition||0,audio.currentTime||0);writeJSON(localKey(state.attemptId),{unit_key:LISTENING_AUDIO_UNIT_KEY,position:pos,updated_at:Date.now()});
    try{await sb.rpc(rpcNames.update,{p_attempt_id:state.attemptId,p_unit_key:LISTENING_AUDIO_UNIT_KEY,p_position_seconds:pos,p_completed:false});}catch{}
  }
  function resumeIfVisible(){if(document.visibilityState==="visible"&&getState()?.activeAudio&&audio?.paused&&!audio.ended)audio.play().catch(()=>{});}
  function stopElement(){if(audio){try{audio.pause();}catch{}audio.remove();audio=null;}}
  function reset(){const state=getState();if(state)state.activeAudio=null;stopElement();preparedUrl=null;lastPersist=0;resumeGuard=false;}

  return {loadStates,begin,persist,syncPending,hasPending,stateFor,isPlaying,isCompleted,resumeIfVisible,reset};
}
