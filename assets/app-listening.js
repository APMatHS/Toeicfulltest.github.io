import { esc,go,readJSON,writeJSON,removeStorage } from "./modules/utils.js?build=20260915-v117";
import { embeddedImagePaths,hydrateEmbeddedImages,renderRichText } from "./modules/rich-editor.js?build=20260915-v117";

const AUDIO_SAVE_MS=4000;

function stableHash(text){
  let h=2166136261;
  for(let i=0;i<text.length;i++){
    h^=text.charCodeAt(i);
    h=Math.imul(h,16777619);
  }
  return h>>>0;
}
function orderedChoices(question,attemptId){
  const choices=(question.choices||[]).map(c=>({...c,originalKey:c.key}));
  if(!question.shuffle_choices) return choices.map(c=>({...c,displayKey:c.key}));
  const shuffled=choices.slice().sort((a,b)=>stableHash(`${attemptId}:${question.id}:${a.key}`)-stableHash(`${attemptId}:${question.id}:${b.key}`));
  // V1.18 chỉ trộn thứ tự hiển thị; giữ nhãn/key gốc để chấm và review nhất quán.
  return shuffled.map(c=>({...c,displayKey:c.key}));
}
function audioUnit(question){
  const st=(question.stimuli||[]).find(x=>x.type==="audio"&&x.storage_path);
  if(st) return {key:`stimulus:${st.id}`,path:st.storage_path};
  if(question.media_type==="audio"&&question.storage_path) return {key:`question:${question.id}`,path:question.storage_path};
  return null;
}
function partGroups(questions){
  const out=[];
  for(const p of [1,2,3,4]){
    const qs=questions.filter(q=>Number(q.part)===p);
    if(qs.length) out.push([p,qs]);
  }
  return out;
}

export function createListeningExamApp(ctx){
  const {sb,modalRoot,signedUrlMap,toast,getSession,getProfile,getView}=ctx;
  let antiCheat=null;
  let state=null;
  let timerId=null;
  let flushBusy=false;
  let activeFlushEventId=null;
  let audioEl=null;
  let audioPersistAt=0;
  let audioResumeGuard=false;
  const mediaCache=new Map();

  const queueKey=id=>`toeic.listening.answerQueue.${id}`;
  const uiKey=id=>`toeic.listening.ui.${id}`;
  const audioLocalKey=id=>`toeic.listening.audio.${id}`;
  const getViewNow=()=>getView();

  function getExamState(){ return state; }
  function setAntiCheat(v){antiCheat=v;}
  function setViolationCount(count){
    if(!state?.payload?.attempt) return;
    state.payload.attempt.violation_count=count;
  }
  function setSaveStatus(text,kind="saved"){
    if(state) state.saveStatus=text;
    const el=document.querySelector("#listeningSaveStatus");
    if(el){el.textContent=text;el.dataset.kind=kind;}
  }
  function saveAttemptUi(){
    if(!state) return;
    writeJSON(uiKey(state.attemptId),{current:state.current,updated_at:Date.now()});
    persistAudioPosition();
  }
  function mergeQueuedAnswers(){
    if(!state) return;
    const queue=readJSON(queueKey(state.attemptId),[]);
    const latest=new Map();
    for(const e of queue) latest.set(e.question_id,e);
    for(const q of state.questions){
      const e=latest.get(q.id);
      if(e){q.selected=e.choice;q.marked=!!e.marked;}
    }
  }
  function enqueueAnswer(q){
    const id=state.attemptId;
    let queue=readJSON(queueKey(id),[]);
    const protectedId=activeFlushEventId;
    queue=queue.filter(x=>x.question_id!==q.id || x.client_event_id===protectedId);
    queue.push({client_event_id:crypto.randomUUID(),question_id:q.id,choice:q.selected||null,marked:!!q.marked,created_at:Date.now()});
    writeJSON(queueKey(id),queue);
    setSaveStatus(navigator.onLine?"Đang lưu…":"Mất mạng – đáp án đã lưu tạm",navigator.onLine?"pending":"offline");
    flushAnswerQueue();
  }
  async function flushAnswerQueue(){
    if(!state||state.preview||flushBusy||!navigator.onLine) return;
    flushBusy=true;
    try{
      while(state&&navigator.onLine){
        let queue=readJSON(queueKey(state.attemptId),[]);
        if(!queue.length){setSaveStatus("Đã lưu","saved");break;}
        const item=queue[0];
        activeFlushEventId=item.client_event_id;
        const {data,error}=await sb.rpc("save_answer_v2",{
          p_attempt_id:state.attemptId,p_question_id:item.question_id,p_choice:item.choice||null,
          p_marked:!!item.marked,p_client_event_id:item.client_event_id
        });
        if(error){setSaveStatus("Lưu tạm – chờ mạng","offline");break;}
        queue=readJSON(queueKey(state.attemptId),[]);
        const idx=queue.findIndex(x=>x.client_event_id===item.client_event_id);
        if(idx>=0){queue.splice(idx,1);writeJSON(queueKey(state.attemptId),queue);}
        if(data?.submitted){
          const id=state.attemptId;
          resetExamState();antiCheat?.reset();go(`/result/${id}`);return;
        }
      }
    }finally{activeFlushEventId=null;flushBusy=false;}
  }
  function hasPendingAnswers(){
    return !!state && readJSON(queueKey(state.attemptId),[]).length>0;
  }

  async function mediaForQuestion(q){
    if(!q) return {};
    const textValues=[q.content,...(q.choices||[]).map(c=>c.content),...(q.stimuli||[]).map(s=>s.content)];
    const direct=[q.storage_path,...(q.choices||[]).map(c=>c.storage_path),...(q.stimuli||[]).map(s=>s.storage_path)].filter(Boolean);
    const paths=[...new Set([...direct,...textValues.flatMap(x=>embeddedImagePaths(x||""))])];
    const missing=paths.filter(p=>!mediaCache.has(p));
    if(missing.length){
      const urls=await signedUrlMap(missing);
      Object.entries(urls||{}).forEach(([p,u])=>mediaCache.set(p,u));
    }
    return Object.fromEntries(paths.map(p=>[p,mediaCache.get(p)]).filter(([,u])=>u));
  }
  async function prepareQuestion(index){
    const q=state?.questions?.[index];
    if(!q) return;
    const urls=await mediaForQuestion(q);
    q._content=hydrateEmbeddedImages(q.content||"",urls);
    q._choices=(q.choices||[]).map(c=>({...c,_content:hydrateEmbeddedImages(c.content||"",urls),url:c.storage_path?urls[c.storage_path]:null}));
    q._stimuli=(q.stimuli||[]).map(s=>({...s,_content:hydrateEmbeddedImages(s.content||"",urls),url:s.storage_path?urls[s.storage_path]:null}));
    q._url=q.storage_path?urls[q.storage_path]:null;
  }

  function currentAudioState(unitKey){return state?.audioStates?.get(unitKey)||null;}
  async function loadAudioStates(){
    const {data,error}=await sb.rpc("get_audio_states_v118",{p_attempt_id:state.attemptId});
    if(error){console.warn(error);return;}
    state.audioStates=new Map((data||[]).map(x=>[x.unit_key,x]));
    // Nếu lần ghi server cuối bị gián đoạn, ưu tiên vị trí local mới hơn rồi đồng bộ lại.
    const local=readJSON(audioLocalKey(state.attemptId),null);
    if(local?.unit_key && Number(local.position)>0){
      const server=state.audioStates.get(local.unit_key);
      if(server && !server.completed_at && Number(local.position)>Number(server.last_position_seconds||0)){
        const merged={...server,last_position_seconds:Number(local.position)};
        state.audioStates.set(local.unit_key,merged);
        if(navigator.onLine){
          sb.rpc("update_audio_unit_v118",{
            p_attempt_id:state.attemptId,p_unit_key:local.unit_key,
            p_position_seconds:Number(local.position),p_completed:false
          }).catch(()=>{});
        }
      }
    }
  }
  async function beginAudio(unit,q){
    if(!unit||!state) return;
    const existing=currentAudioState(unit.key);
    if(existing?.completed_at) return toast("Audio này đã phát xong và không thể nghe lại.",5000);
    modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal">
      <h2>Chuẩn bị nghe</h2>
      <div class="warning-box"><b>Audio chỉ phát một lần.</b><br>Không có pause, tua hoặc nghe lại. Nếu trình duyệt bị gián đoạn, hệ thống chỉ cho tiếp tục từ vị trí đã lưu.</div>
      <p>Part ${q.part} · Câu ${q.number}</p>
      <div class="row between"><button class="secondary" data-close>Chưa phát</button><button class="primary" id="startListeningAudio">${existing?.started_at?"Tiếp tục audio":"Bắt đầu audio"}</button></div>
    </div></div>`;
    modalRoot.querySelector("[data-close]").onclick=()=>modalRoot.innerHTML="";
    modalRoot.querySelector("#startListeningAudio").onclick=async()=>{
      const btn=modalRoot.querySelector("#startListeningAudio");btn.disabled=true;btn.textContent="Đang chuẩn bị…";
      const {data,error}=await sb.rpc("start_audio_unit_v118",{p_attempt_id:state.attemptId,p_unit_key:unit.key});
      if(error){btn.disabled=false;btn.textContent="Thử lại";return toast(error.message,6000);}
      state.audioStates.set(unit.key,data);
      modalRoot.innerHTML="";
      await playAudio(unit,data);
    };
  }
  async function playAudio(unit,audioState){
    if(audioEl){try{audioEl.pause();}catch{} audioEl.remove();audioEl=null;}
    const urls=await signedUrlMap([unit.path]);
    const url=urls?.[unit.path];
    if(!url) return toast("Không mở được audio.",6000);
    audioEl=new Audio(url);
    audioEl.preload="auto";
    audioEl.controls=false;
    audioEl.setAttribute("playsinline","");
    const resume=Math.max(0,Number(audioState?.last_position_seconds||0));
    audioEl.addEventListener("loadedmetadata",()=>{
      if(resume>0 && resume<audioEl.duration){audioResumeGuard=true;audioEl.currentTime=resume;setTimeout(()=>audioResumeGuard=false,100);}
    },{once:true});
    audioEl.addEventListener("seeking",()=>{
      if(audioResumeGuard||!state?.activeAudio) return;
      const allowed=Number(state.activeAudio.lastPosition||0);
      if(Math.abs(audioEl.currentTime-allowed)>1){audioResumeGuard=true;audioEl.currentTime=allowed;setTimeout(()=>audioResumeGuard=false,80);}
    });
    audioEl.addEventListener("pause",()=>{
      if(!state?.activeAudio||audioEl.ended||document.visibilityState==="hidden") return;
      audioEl.play().catch(()=>{});
    });
    audioEl.addEventListener("timeupdate",()=>{
      if(!state?.activeAudio) return;
      state.activeAudio.lastPosition=Math.max(state.activeAudio.lastPosition||0,audioEl.currentTime||0);
      const now=Date.now();
      if(now-audioPersistAt>AUDIO_SAVE_MS){audioPersistAt=now;persistAudioPosition();}
      const p=document.querySelector("#listeningAudioProgress");
      if(p&&Number.isFinite(audioEl.duration)&&audioEl.duration>0) p.value=Math.min(1,audioEl.currentTime/audioEl.duration);
    });
    audioEl.addEventListener("ended",async()=>{
      if(!state?.activeAudio) return;
      const unitKey=state.activeAudio.unitKey;
      await sb.rpc("update_audio_unit_v118",{p_attempt_id:state.attemptId,p_unit_key:unitKey,p_position_seconds:audioEl.duration||state.activeAudio.lastPosition||0,p_completed:true});
      const prev=state.audioStates.get(unitKey)||{};
      state.audioStates.set(unitKey,{...prev,completed_at:new Date().toISOString(),last_position_seconds:audioEl.duration||state.activeAudio.lastPosition||0});
      removeStorage(audioLocalKey(state.attemptId));
      state.activeAudio=null;audioEl=null;
      draw();
    });
    state.activeAudio={unitKey:unit.key,lastPosition:resume};
    try{await audioEl.play();draw();}
    catch(err){state.activeAudio=null;audioEl=null;toast("Trình duyệt chưa cho phép phát audio. Hãy bấm Bắt đầu audio lại.",6000);}
  }
  async function persistAudioPosition(){
    if(!state?.activeAudio||!audioEl) return;
    const pos=Math.max(state.activeAudio.lastPosition||0,audioEl.currentTime||0);
    writeJSON(audioLocalKey(state.attemptId),{unit_key:state.activeAudio.unitKey,position:pos,updated_at:Date.now()});
    try{
      await sb.rpc("update_audio_unit_v118",{p_attempt_id:state.attemptId,p_unit_key:state.activeAudio.unitKey,p_position_seconds:pos,p_completed:false});
    }catch{}
  }

  function renderMedia(q){
    const blocks=[];
    for(const s of q._stimuli||[]){
      if(s.type==="image"&&s.url) blocks.push(`<img class="listening-image" loading="lazy" decoding="async" src="${esc(s.url)}" alt="Hình Listening">`);
      else if(s.type!=="audio"&&s._content) blocks.push(`<div class="rich-content">${renderRichText(s._content)}</div>`);
    }
    if(q.media_type==="image"&&q._url) blocks.push(`<img class="listening-image" loading="lazy" decoding="async" src="${esc(q._url)}" alt="Hình câu hỏi">`);
    if(q._content) blocks.push(`<div class="rich-content listening-question-text">${renderRichText(q._content)}</div>`);
    return blocks.join("");
  }
  function draw(){
    if(!state) return;
    const view=getViewNow(),q=state.questions[state.current];
    if(!q) return;
    const unit=audioUnit(q),aState=unit?currentAudioState(unit.key):null;
    const choices=orderedChoices({...q,choices:q._choices||q.choices},state.attemptId);
    const parts=partGroups(state.questions);
    const playing=!!state.activeAudio;
    view.innerHTML=`<section class="listening-shell">
      <div class="card listening-head">
        <div><div class="eyebrow">LISTENING</div><h2>${esc(state.testTitle||"TOEIC Listening")}</h2></div>
        <div class="listening-head-meta"><b id="listeningTimer">--:--</b><span id="listeningSaveStatus" data-kind="saved">${esc(state.saveStatus||"Đã lưu")}</span><span id="antiCheatStatus">Vi phạm: ${Number(state.payload.attempt.violation_count||0)}/3</span></div>
      </div>
      <div class="listening-layout">
        <main class="card listening-main">
          <div class="row between wrap"><span class="badge">Part ${q.part}</span><b>Câu ${q.number}</b></div>
          ${renderMedia(q)}
          ${unit?`<div class="listening-audio-box">
            <div><b>Audio</b><div class="muted small">${aState?.completed_at?"Đã phát xong · không nghe lại":state.activeAudio?.unitKey===unit.key?"Đang phát · không pause/tua":aState?.started_at?"Có trạng thái nghe dở đã lưu":"Chưa phát"}</div></div>
            <progress id="listeningAudioProgress" max="1" value="${aState?.completed_at?1:0}"></progress>
            <button class="primary" id="playListeningAudio" ${playing||aState?.completed_at?"disabled":""}>${aState?.completed_at?"Đã phát":aState?.started_at?"Tiếp tục audio":"Bắt đầu audio"}</button>
          </div>`:""}
          <div class="listening-choices">${choices.map(c=>`<label class="listening-choice ${q.selected===c.originalKey?"selected":""}">
            <input type="radio" name="answer" value="${esc(c.originalKey)}" ${q.selected===c.originalKey?"checked":""}>
            <span class="choice-key">${esc(c.displayKey)}</span><span>${c._content?renderRichText(c._content):""}${c.url?`<img src="${esc(c.url)}" alt="Đáp án ${esc(c.displayKey)}">`:""}</span>
          </label>`).join("")}</div>
          <div class="row between wrap listening-nav"><button class="secondary" id="prevListening" ${state.current===0?"disabled":""}>← Câu trước</button><label class="check-row"><input id="markListening" type="checkbox" ${q.marked?"checked":""}> Đánh dấu xem lại</label><button class="primary" id="nextListening">${state.current===state.questions.length-1?"Hoàn thành Listening":"Câu tiếp →"}</button></div>
        </main>
        <aside class="card listening-palette"><h3>Câu hỏi</h3>${parts.map(([p,qs])=>`<div class="listening-palette-part"><b>Part ${p}</b><div>${qs.map(x=>{const idx=state.questions.indexOf(x);return `<button class="${idx===state.current?"active":""} ${x.selected?"answered":""} ${x.marked?"marked":""}" data-idx="${idx}">${x.number}</button>`}).join("")}</div></div>`).join("")}</aside>
      </div>
      <div class="row end"><button class="danger" id="submitListening">Nộp bài</button></div>
    </section>`;
    document.querySelector("#playListeningAudio")?.addEventListener("click",()=>beginAudio(unit,q));
    document.querySelectorAll('input[name="answer"]').forEach(inp=>inp.onchange=()=>{q.selected=inp.value;enqueueAnswer(q);draw();});
    document.querySelector("#markListening").onchange=e=>{q.marked=e.target.checked;enqueueAnswer(q);};
    document.querySelector("#prevListening").onclick=()=>moveTo(state.current-1);
    document.querySelector("#nextListening").onclick=()=>state.current===state.questions.length-1?completeListening():moveTo(state.current+1);
    document.querySelectorAll(".listening-palette button[data-idx]").forEach(btn=>btn.onclick=()=>moveTo(Number(btn.dataset.idx)));
    document.querySelector("#submitListening").onclick=confirmSubmit;
    updateTimer();
  }
  async function moveTo(index){
    if(!state||index<0||index>=state.questions.length) return;
    const current=state.questions[state.current],target=state.questions[index];
    if(state.activeAudio && Number(current?.part)!==Number(target?.part)){
      return toast("Audio đang phát. Bạn có thể đổi câu trong Part hiện tại, nhưng chưa thể chuyển sang Part khác.",5000);
    }
    saveAttemptUi();state.current=index;await prepareQuestion(index);draw();prepareQuestion(index+1);
  }
  function updateTimer(){
    if(!state) return;
    const left=Math.max(0,new Date(state.payload.attempt.expires_at).getTime()-Date.now());
    const sec=Math.ceil(left/1000),m=Math.floor(sec/60),s=sec%60;
    const el=document.querySelector("#listeningTimer");if(el)el.textContent=`${m}:${String(s).padStart(2,"0")}`;
    if(left<=0){const id=state.attemptId;resetExamState();antiCheat?.reset();go(`/result/${id}`);}
  }
  function startTimer(){clearInterval(timerId);timerId=setInterval(updateTimer,1000);updateTimer();}
  function stopTimer(){clearInterval(timerId);timerId=null;}

  async function completeListening(){
    if(!state) return;
    if(state.activeAudio) return toast("Hãy chờ audio hiện tại phát xong trước khi hoàn thành Listening.",5000);
    if(state.mode==="full"){
      await flushAnswerQueue();
      if(hasPendingAnswers()) return toast("Còn đáp án Listening chưa đồng bộ. Hãy kiểm tra mạng rồi thử chuyển sang Reading lại.",6000);
      const {data,error}=await sb.rpc("complete_listening_phase_v118",{p_attempt_id:state.attemptId});
      if(error) return toast(error.message,6000);
      if(data?.blocked) return toast("Chưa thể chuyển Reading: vẫn còn audio Listening chưa phát xong.",6000);
      const id=state.attemptId,onComplete=state.onComplete;
      resetExamState();
      return onComplete?.(id);
    }
    confirmSubmit();
  }
  function confirmSubmit(){
    if(!state) return;
    const unanswered=state.questions.filter(q=>!q.selected).length;
    modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><h2>Nộp bài?</h2><p>${unanswered?`Còn <b>${unanswered}</b> câu chưa chọn đáp án.`:"Bạn đã chọn đáp án cho tất cả câu."}</p><div class="row between"><button class="secondary" data-close>Tiếp tục làm</button><button class="danger" id="doSubmitListening">Nộp bài</button></div></div></div>`;
    modalRoot.querySelector("[data-close]").onclick=()=>modalRoot.innerHTML="";
    modalRoot.querySelector("#doSubmitListening").onclick=async()=>{
      const id=state.attemptId;
      await flushAnswerQueue();
      if(hasPendingAnswers()) return toast("Còn đáp án chưa đồng bộ. Hãy kiểm tra mạng trước khi nộp bài.",6000);
      const {error}=await sb.rpc("submit_attempt",{p_attempt_id:id});
      if(error) return toast(error.message,6000);
      removeStorage(queueKey(id));removeStorage(uiKey(id));
      resetExamState();antiCheat?.reset();modalRoot.innerHTML="";go(`/result/${id}`);
    };
  }

  async function renderAttempt(attemptId,{mode="listening",onComplete=null}={}){
    const session=getSession(),profile=getProfile(),view=getViewNow();
    if(!session||profile?.role!=="student") return go("/login");
    view.innerHTML='<section class="card">Đang tải Listening...</section>';
    const {data,error}=await sb.rpc("get_attempt_payload",{p_attempt_id:attemptId});
    if(error) return view.innerHTML=`<section class="card">${esc(error.message)}</section>`;
    if(data?.attempt?.status!=="in_progress") return go(`/result/${attemptId}`);
    const questions=(data.questions||[]).filter(q=>Number(q.part)>=1&&Number(q.part)<=4);
    if(!questions.length) return view.innerHTML='<section class="card">Bài chưa có câu Listening.</section>';
    const ui=readJSON(uiKey(attemptId),{current:0});
    state={attemptId,payload:data,questions,current:Math.min(ui.current||0,questions.length-1),saveStatus:"Đã lưu",audioStates:new Map(),activeAudio:null,mode,onComplete,testTitle:data?.attempt?.test_title||"TOEIC Listening"};
    mergeQueuedAnswers();
    await loadAudioStates();
    await prepareQuestion(state.current);
    draw();prepareQuestion(state.current+1);startTimer();antiCheat?.bind();flushAnswerQueue();
  }
  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState!=="visible" || !state?.activeAudio || !audioEl || audioEl.ended || !audioEl.paused) return;
    audioEl.play().catch(()=>{});
  });

  function resetExamState(){
    stopTimer();
    if(state) state.activeAudio=null;
    if(audioEl){try{audioEl.pause();}catch{}audioEl.remove();audioEl=null;}
    state=null;flushBusy=false;activeFlushEventId=null;mediaCache.clear();
  }

  return {renderAttempt,getExamState,setAntiCheat,setViolationCount,saveAttemptUi,flushAnswerQueue,setSaveStatus,stopTimer,resetExamState};
}
