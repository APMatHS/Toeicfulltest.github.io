import { esc,go,readJSON,writeJSON,removeStorage } from "../../modules/utils.js";
import { createAnswerQueue } from "../answer-queue.js";
import { createExamMedia } from "../exam-media.js";
import { createListeningAudio,questionAudioUnit } from "./audio-session.js";
import { renderListeningView } from "./listening-view.js";

export function createListeningExamApp(ctx){
  const {sb,modalRoot,signedUrlMap,toast,getSession,getProfile,getView}=ctx;
  let state=null,timerId=null,antiCheat=null;
  const uiKey=id=>`toeic.listening.ui.${id}`;
  const getExamState=()=>state;
  const media=createExamMedia({signedUrlMap,getExamState});

  function setSaveStatus(text,kind="saved"){if(state)state.saveStatus=text;const el=document.querySelector("#listeningSaveStatus");if(el){el.textContent=text;el.dataset.kind=kind;}}
  function stopTimer(){clearInterval(timerId);timerId=null;}
  function resetExamState(){stopTimer();audio.reset();state=null;queue.reset();media.clear();}
  const queue=createAnswerQueue({sb,getExamState,setSaveStatus,onSubmitted:attemptId=>{antiCheat?.reset();resetExamState();go(`/result/${attemptId}`);}});
  const audio=createListeningAudio({sb,modalRoot,signedUrlMap,toast,getState:getExamState,onChanged:()=>draw()});

  function setAntiCheat(value){antiCheat=value;}
  function setViolationCount(count){if(state?.payload?.attempt)state.payload.attempt.violation_count=count;}
  function saveAttemptUi(){if(!state)return;writeJSON(uiKey(state.attemptId),{current:state.current,updated_at:Date.now()});audio.persist();}
  async function flushAnswerQueue(){await queue.flush();await audio.syncPending();}

  async function renderAttempt(attemptId,{mode="listening",onComplete=null}={}){
    const session=getSession(),profile=getProfile(),view=getView();if(!session||profile?.role!=="student")return go("/login");
    view.innerHTML='<section class="card">Đang tải Listening...</section>';
    const {data,error}=await sb.rpc("get_attempt_payload",{p_attempt_id:attemptId});
    if(error)return view.innerHTML=`<section class="card">${esc(error.message)}</section>`;
    if(data?.attempt?.status!=="in_progress")return go(`/result/${attemptId}`);
    const questions=(data.questions||[]).filter(q=>Number(q.part)>=1&&Number(q.part)<=4);
    if(!questions.length)return view.innerHTML='<section class="card">Bài chưa có câu Listening.</section>';
    data.questions=questions;const ui=readJSON(uiKey(attemptId),{current:0});
    state={attemptId,payload:data,current:Math.min(ui.current||0,questions.length-1),saveStatus:"Đã lưu",audioStates:new Map(),activeAudio:null,mode,onComplete};
    queue.merge(attemptId,questions);await audio.loadStates();await media.ensureQuestionMedia(questions[state.current]);draw();media.prefetchQuestion(state.current+1);startTimer();antiCheat?.bind();queue.flush();
  }

  async function moveTo(index){
    if(!state||index<0||index>=state.payload.questions.length)return;
    const target=state.payload.questions[index];if(state.activeAudio&&!audio.sameActiveUnit(target))return toast("Audio đang phát. Chỉ có thể chuyển giữa các câu dùng chung audio hiện tại.",5000);
    saveAttemptUi();state.current=index;await media.ensureQuestionMedia(target);if(!state||state.current!==index)return;draw();media.prefetchQuestion(index+1);
  }

  function saveCurrent(choice,marked){
    if(!state)return;const q=state.payload.questions[state.current];if(choice)q.selected=choice;q.marked=marked??q.marked;
    queue.enqueue(state.attemptId,{client_event_id:crypto.randomUUID(),question_id:q.id,choice:q.selected||null,marked:!!q.marked,created_at:Date.now()});
    setSaveStatus(navigator.onLine?"Đang lưu…":"Mất mạng – đáp án đã lưu tạm",navigator.onLine?"pending":"offline");queue.flush();draw();
  }

  function draw(){
    if(!state)return;const view=getView();view.innerHTML=renderListeningView(state,{audio,media});
    const q=state.payload.questions[state.current],unit=questionAudioUnit(q);
    document.querySelector("#playListeningAudio")?.addEventListener("click",()=>audio.begin(unit,q));
    document.querySelectorAll('input[name="answer"]').forEach(input=>input.onchange=()=>saveCurrent(input.value,!!q.marked));
    const mark=document.querySelector("#markListening");if(mark)mark.onchange=e=>saveCurrent(q.selected,!!e.target.checked);
    document.querySelector("#prevListening")?.addEventListener("click",()=>moveTo(state.current-1));
    document.querySelector("#nextListening")?.addEventListener("click",()=>state.current===state.payload.questions.length-1?completeListening():moveTo(state.current+1));
    document.querySelectorAll(".listening-palette button[data-idx]").forEach(btn=>btn.onclick=()=>moveTo(Number(btn.dataset.idx)));
    document.querySelector("#submitListening")?.addEventListener("click",()=>state.mode==="full"?completeListening():confirmSubmit());updateTimer();
  }

  function updateTimer(){
    if(!state)return;const left=Math.max(0,new Date(state.payload.attempt.expires_at).getTime()-Date.now()),sec=Math.ceil(left/1000),m=Math.floor(sec/60),s=sec%60,el=document.querySelector("#listeningTimer");if(el)el.textContent=`${m}:${String(s).padStart(2,"0")}`;
    if(left<=0){const id=state.attemptId;antiCheat?.reset();resetExamState();go(`/result/${id}`);}
  }
  function startTimer(){stopTimer();timerId=setInterval(updateTimer,1000);updateTimer();}

  async function completeListening(){
    if(!state)return;if(state.activeAudio)return toast("Hãy chờ audio hiện tại phát xong trước khi hoàn thành Listening.",5000);
    if(state.mode!=="full")return confirmSubmit();
    await flushAnswerQueue();if(queue.read(state.attemptId).length||audio.hasPending())return toast("Còn đáp án hoặc trạng thái audio chưa đồng bộ. Hãy kiểm tra mạng rồi thử lại.",6000);
    const {data,error}=await sb.rpc("complete_listening_phase_v118",{p_attempt_id:state.attemptId});if(error)return toast(error.message,6000);if(data?.blocked)return toast(`Chưa thể chuyển Reading: còn ${data.missing_audio_units||0} audio chưa phát xong.`,6000);
    const id=state.attemptId,onComplete=state.onComplete;removeStorage(uiKey(id));resetExamState();return onComplete?.(id);
  }

  function confirmSubmit(){
    if(!state)return;const unanswered=state.payload.questions.filter(q=>!q.selected).length;
    modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><h2>Nộp bài?</h2><p>${unanswered?`Còn <b>${unanswered}</b> câu chưa chọn đáp án.`:"Bạn đã chọn đáp án cho tất cả câu."}</p><div class="row between"><button class="secondary" data-close>Tiếp tục làm</button><button class="danger" id="doSubmitListening">Nộp bài</button></div></div></div>`;
    modalRoot.querySelector("[data-close]").onclick=()=>modalRoot.innerHTML="";
    modalRoot.querySelector("#doSubmitListening").onclick=async()=>{const id=state.attemptId;await flushAnswerQueue();if(queue.read(id).length||audio.hasPending())return toast("Còn đáp án hoặc trạng thái audio chưa đồng bộ. Hãy kiểm tra mạng trước khi nộp bài.",6000);const {error}=await sb.rpc("submit_attempt",{p_attempt_id:id});if(error)return toast(error.message,6000);removeStorage(queue.queueKey(id));removeStorage(uiKey(id));antiCheat?.reset();resetExamState();modalRoot.innerHTML="";go(`/result/${id}`);};
  }

  document.addEventListener("visibilitychange",()=>audio.resumeIfVisible());
  return {renderAttempt,getExamState,setAntiCheat,setViolationCount,saveAttemptUi,flushAnswerQueue,setSaveStatus,stopTimer,resetExamState};
}
