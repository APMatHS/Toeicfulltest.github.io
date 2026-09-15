import { readJSON,writeJSON,removeStorage } from "../../modules/utils.js";

const SAVE_INTERVAL_MS=4000;

export function questionAudioUnit(question){
  if(!question)return null;
  const stimulus=(question.stimuli||[]).find(x=>x.type==="audio"&&x.storage_path);
  if(stimulus)return {key:`stimulus:${stimulus.id}`,path:stimulus.storage_path};
  if(question.media_type==="audio"&&question.storage_path)return {key:`question:${question.id}`,path:question.storage_path};
  return null;
}

export function createListeningAudio(ctx){
  const {sb,modalRoot,signedUrlMap,toast,getState,onChanged,rpc={},localPrefix="toeic.listening.audio"}=ctx;
  const rpcNames={getStates:rpc.getStates||"get_audio_states_v118",start:rpc.start||"start_audio_unit_v118",update:rpc.update||"update_audio_unit_v118"};
  let audio=null,lastPersist=0,resumeGuard=false;
  const localKey=id=>`${localPrefix}.${id}`;
  const pendingKey=id=>`${localPrefix}.pending.${id}`;

  function stateFor(key){return getState()?.audioStates?.get(key)||null;}
  function isPlaying(){return !!getState()?.activeAudio;}
  function sameActiveUnit(question){const active=getState()?.activeAudio;if(!active)return true;return questionAudioUnit(question)?.key===active.unitKey;}
  function pendingCompletions(){const state=getState();return state?readJSON(pendingKey(state.attemptId),{}):{};}
  function hasPending(){return Object.keys(pendingCompletions()).length>0;}
  function queuePendingCompletion(unitKey,position){
    const state=getState();if(!state)return;const pending=pendingCompletions();pending[unitKey]=Math.max(Number(pending[unitKey]||0),Number(position||0));writeJSON(pendingKey(state.attemptId),pending);
    const old=state.audioStates.get(unitKey)||{};state.audioStates.set(unitKey,{...old,last_position_seconds:pending[unitKey],completed_at:"pending_sync"});
  }
  async function syncPending(){
    const state=getState();if(!state||!navigator.onLine)return false;const pending=pendingCompletions(),entries=Object.entries(pending);if(!entries.length)return true;
    for(const [unitKey,position] of entries){
      const {data,error}=await sb.rpc(rpcNames.update,{p_attempt_id:state.attemptId,p_unit_key:unitKey,p_position_seconds:Number(position),p_completed:true});
      if(error)return false;state.audioStates.set(unitKey,data||{...(state.audioStates.get(unitKey)||{}),last_position_seconds:Number(position),completed_at:new Date().toISOString()});delete pending[unitKey];writeJSON(pendingKey(state.attemptId),pending);
    }
    if(!Object.keys(pending).length)removeStorage(pendingKey(state.attemptId));onChanged?.();return true;
  }

  async function loadStates(){
    const state=getState();if(!state)return;
    const {data,error}=await sb.rpc(rpcNames.getStates,{p_attempt_id:state.attemptId});
    if(error)console.warn(error);
    state.audioStates=new Map((data||[]).map(x=>[x.unit_key,x]));
    const pending=pendingCompletions();for(const [unitKey,position] of Object.entries(pending)){const old=state.audioStates.get(unitKey)||{};if(!old.completed_at)state.audioStates.set(unitKey,{...old,last_position_seconds:Number(position),completed_at:"pending_sync"});}
    if(!error&&navigator.onLine)await syncPending();
    const local=readJSON(localKey(state.attemptId),null);
    if(!local?.unit_key||Number(local.position)<=0)return;
    const server=state.audioStates.get(local.unit_key);
    if(!server||server.completed_at||Number(local.position)<=Number(server.last_position_seconds||0))return;
    state.audioStates.set(local.unit_key,{...server,last_position_seconds:Number(local.position)});
    if(navigator.onLine)sb.rpc(rpcNames.update,{p_attempt_id:state.attemptId,p_unit_key:local.unit_key,p_position_seconds:Number(local.position),p_completed:false}).catch(()=>{});
  }

  async function begin(unit,question){
    const state=getState();if(!state||!unit)return;
    const existing=stateFor(unit.key);
    if(existing?.completed_at)return toast("Audio này đã phát xong và không thể nghe lại.",5000);
    modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><h2>Chuẩn bị nghe</h2><div class="warning-box"><b>Audio chỉ phát một lần.</b><br>Không pause, không tua và không nghe lại. Nếu trình duyệt bị gián đoạn, hệ thống tiếp tục gần vị trí đã lưu.</div><p>Part ${question.part} · Câu ${question.number}</p><div class="row between"><button class="secondary" data-close>Chưa phát</button><button class="primary" id="startListeningAudio">${existing?.started_at?"Tiếp tục audio":"Bắt đầu audio"}</button></div></div></div>`;
    modalRoot.querySelector("[data-close]").onclick=()=>modalRoot.innerHTML="";
    modalRoot.querySelector("#startListeningAudio").onclick=async()=>{
      const btn=modalRoot.querySelector("#startListeningAudio");btn.disabled=true;btn.textContent="Đang chuẩn bị…";
      const {data,error}=await sb.rpc(rpcNames.start,{p_attempt_id:state.attemptId,p_unit_key:unit.key});
      if(error){btn.disabled=false;btn.textContent="Thử lại";return toast(error.message,6000);}
      state.audioStates.set(unit.key,data);modalRoot.innerHTML="";await play(unit,data);
    };
  }

  async function play(unit,audioState){
    const state=getState();if(!state)return;
    stopElement();
    const urls=await signedUrlMap([unit.path]),url=urls?.[unit.path];if(!url)return toast("Không mở được audio.",6000);
    audio=new Audio(url);audio.preload="auto";audio.controls=false;audio.setAttribute("playsinline","");
    const resume=Math.max(0,Number(audioState?.last_position_seconds||0));
    audio.addEventListener("loadedmetadata",()=>{if(resume>0&&resume<audio.duration){resumeGuard=true;audio.currentTime=resume;setTimeout(()=>resumeGuard=false,120);}},{once:true});
    audio.addEventListener("seeking",()=>{const current=getState();if(resumeGuard||!current?.activeAudio)return;const allowed=Number(current.activeAudio.lastPosition||0);if(Math.abs(audio.currentTime-allowed)>1){resumeGuard=true;audio.currentTime=allowed;setTimeout(()=>resumeGuard=false,80);}});
    audio.addEventListener("pause",()=>{const current=getState();if(!current?.activeAudio||audio.ended||document.visibilityState==="hidden")return;audio.play().catch(()=>{});});
    audio.addEventListener("timeupdate",()=>{const current=getState();if(!current?.activeAudio)return;current.activeAudio.lastPosition=Math.max(current.activeAudio.lastPosition||0,audio.currentTime||0);const now=Date.now();if(now-lastPersist>SAVE_INTERVAL_MS){lastPersist=now;persist();}const el=document.querySelector("#listeningAudioProgress");if(el&&Number.isFinite(audio.duration)&&audio.duration>0)el.value=Math.min(1,audio.currentTime/audio.duration);});
    audio.addEventListener("ended",finish);
    state.activeAudio={unitKey:unit.key,lastPosition:resume};
    try{await audio.play();onChanged?.();}catch{state.activeAudio=null;stopElement();toast("Trình duyệt chưa cho phép phát audio. Hãy bấm Bắt đầu audio lại.",6000);}
  }

  async function finish(){
    const state=getState();if(!state?.activeAudio||!audio)return;
    const unitKey=state.activeAudio.unitKey,pos=audio.duration||state.activeAudio.lastPosition||0;
    const {data,error}=await sb.rpc(rpcNames.update,{p_attempt_id:state.attemptId,p_unit_key:unitKey,p_position_seconds:pos,p_completed:true});
    const old=state.audioStates.get(unitKey)||{};
    if(error)queuePendingCompletion(unitKey,pos);else state.audioStates.set(unitKey,data||{...old,completed_at:new Date().toISOString(),last_position_seconds:pos});
    removeStorage(localKey(state.attemptId));state.activeAudio=null;audio=null;onChanged?.();
  }

  async function persist(){
    const state=getState();if(!state?.activeAudio||!audio)return;
    const pos=Math.max(state.activeAudio.lastPosition||0,audio.currentTime||0);writeJSON(localKey(state.attemptId),{unit_key:state.activeAudio.unitKey,position:pos,updated_at:Date.now()});
    try{await sb.rpc(rpcNames.update,{p_attempt_id:state.attemptId,p_unit_key:state.activeAudio.unitKey,p_position_seconds:pos,p_completed:false});}catch{}
  }

  function resumeIfVisible(){if(document.visibilityState==="visible"&&getState()?.activeAudio&&audio?.paused&&!audio.ended)audio.play().catch(()=>{});}
  function stopElement(){if(audio){try{audio.pause();}catch{}audio.remove();audio=null;}}
  function reset(){const state=getState();if(state)state.activeAudio=null;stopElement();lastPersist=0;resumeGuard=false;}

  return {loadStates,begin,persist,syncPending,hasPending,stateFor,isPlaying,sameActiveUnit,resumeIfVisible,reset};
}
