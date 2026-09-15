import { esc,go,readJSON,writeJSON,removeStorage } from "../../modules/utils.js";
import { createExamMedia } from "../exam-media.js";
import { buildPracticeQuestions } from "../practice-data.js";
import { createListeningAudio } from "./audio-session.js";
import { renderListeningView } from "./listening-view.js";

export function createListeningPracticeApp(ctx){
  const {sb,modalRoot,signedUrlMap,toast,getSession,getProfile,getView}=ctx;
  let state=null,timerId=null;
  const uiKey=id=>`toeic.listening.practice.ui.${id}`;
  const getExamState=()=>state;
  const media=createExamMedia({signedUrlMap,getExamState});
  const audio=createListeningAudio({sb,modalRoot,signedUrlMap,toast,getState:getExamState,onChanged:()=>draw(),localPrefix:"toeic.listening.practice.audio",rpc:{getStates:"staff_get_practice_audio_states_v118",start:"staff_start_practice_audio_unit_v118",update:"staff_update_practice_audio_unit_v118"}});

  function setSaveStatus(text,kind="saved"){if(state)state.saveStatus=text;const el=document.querySelector("#listeningSaveStatus");if(el){el.textContent=text;el.dataset.kind=kind;}}
  function stopTimer(){clearInterval(timerId);timerId=null;}
  function resetExamState(){stopTimer();audio.reset();state=null;media.clear();}
  function saveAttemptUi(){if(!state)return;writeJSON(uiKey(state.attemptId),{current:state.current,updated_at:Date.now()});audio.persist();}
  async function flushAnswerQueue(){if(state?.pendingSave)await state.pendingSave;await audio.syncPending();}
  function setViolationCount(){}
  function setAntiCheat(){}

  async function renderAttempt(testId,{mode="listening",onComplete=null}={}){
    const session=getSession(),profile=getProfile(),view=getView();if(!session||!["teacher","system_admin"].includes(profile?.role))return go("/login");
    view.innerHTML='<section class="card">Đang mở chế độ làm thử Listening...</section>';
    const {data:start,error:startError}=await sb.rpc("staff_start_practice_attempt",{p_test_id:testId});if(startError)return view.innerHTML=`<div class="card">${esc(startError.message)}</div>`;
    const attemptId=start?.attempt_id;
    const [{data:authoring,error},{data:practice,error:practiceError}]=await Promise.all([sb.rpc("get_test_authoring",{p_test_id:testId}),sb.rpc("staff_get_practice_attempt",{p_attempt_id:attemptId})]);
    if(error||practiceError)return view.innerHTML=`<div class="card">${esc((error||practiceError).message)}</div>`;
    if(mode==="full"&&practice?.attempt?.listening_completed_at)return onComplete?.(testId);
    const questions=buildPracticeQuestions(authoring,practice?.answers||[],[1,2,3,4]);if(!questions.length)return view.innerHTML='<section class="card">Bài chưa có câu Listening để làm thử.</section>';
    const ui=readJSON(uiKey(attemptId),{current:0}),attempt={...practice.attempt,test_title:authoring?.test?.title||"TOEIC Listening",violation_count:0},test=authoring?.test||{};
    state={attemptId,preview:true,testId,payload:{test,attempt,questions},current:Math.min(ui.current||0,questions.length-1),saveStatus:start?.resumed?"Đã phục hồi lượt làm thử":"Lượt làm thử đã được lưu",audioStates:new Map(),activeAudio:null,mode,onComplete,pendingSave:null,listeningAudio:{path:test.listening_audio_storage_path||null,filename:test.listening_audio_filename||"Audio Listening Part 1–4",durationSeconds:Number(test.listening_audio_duration_seconds||0)}};
    await audio.loadStates();await media.ensureQuestionMedia(questions[state.current]);draw();media.prefetchQuestion(state.current+1);startTimer();
  }

  function saveCurrent(choice,marked){
    if(!state)return;const q=state.payload.questions[state.current];if(choice)q.selected=choice;q.marked=marked??q.marked;setSaveStatus("Đang lưu…","pending");
    const current=state,previous=current.pendingSave||Promise.resolve();
    const task=previous.then(()=>sb.rpc("staff_save_practice_answer",{p_attempt_id:current.attemptId,p_question_id:q.id,p_choice:q.selected||null,p_marked:!!q.marked})).then(r=>{if(r.error)throw r.error;return r;});
    const settled=task.then(result=>({result}),error=>({error}));current.pendingSave=settled;settled.then(outcome=>{if(state!==current)return;if(outcome.error)setSaveStatus(`Chưa lưu: ${outcome.error.message}`,"offline");else setSaveStatus("Đã lưu","saved");if(current.pendingSave===settled)current.pendingSave=null;});draw();
  }

  async function moveTo(index){if(!state||index<0||index>=state.payload.questions.length)return;saveAttemptUi();state.current=index;const target=state.payload.questions[index];await media.ensureQuestionMedia(target);if(!state||state.current!==index)return;draw();media.prefetchQuestion(index+1);}

  function draw(){
    if(!state)return;getView().innerHTML=renderListeningView(state,{audio,media});const q=state.payload.questions[state.current];
    document.querySelector("#playListeningAudio")?.addEventListener("click",()=>audio.begin());document.querySelectorAll('input[name="answer"]').forEach(input=>input.onchange=()=>saveCurrent(input.value,!!q.marked));const mark=document.querySelector("#markListening");if(mark)mark.onchange=e=>saveCurrent(q.selected,!!e.target.checked);document.querySelector("#prevListening")?.addEventListener("click",()=>moveTo(state.current-1));document.querySelector("#nextListening")?.addEventListener("click",()=>state.current===state.payload.questions.length-1?completeListening():moveTo(state.current+1));document.querySelectorAll(".listening-palette button[data-idx]").forEach(btn=>btn.onclick=()=>moveTo(Number(btn.dataset.idx)));document.querySelector("#submitListening")?.addEventListener("click",()=>state.mode==="full"?completeListening():confirmFinish());updateTimer();
  }

  function updateTimer(){if(!state)return;const left=Math.max(0,new Date(state.payload.attempt.expires_at).getTime()-Date.now()),sec=Math.ceil(left/1000),m=Math.floor(sec/60),s=sec%60,el=document.querySelector("#listeningTimer");if(el)el.textContent=`${m}:${String(s).padStart(2,"0")}`;if(left<=0)finish("expired");}
  function startTimer(){stopTimer();timerId=setInterval(updateTimer,1000);updateTimer();}

  async function completeListening(){
    if(!state)return;if(state.activeAudio)return toast("Audio đang phát liên tục. Hãy chờ audio Part 1–4 phát hết.",5000);if(!audio.isCompleted())return toast("Cần nghe hết file audio chung Part 1–4 trước khi hoàn thành Listening.",6000);await flushAnswerQueue();
    if(state.mode!=="full")return confirmFinish();if(audio.hasPending())return toast("Trạng thái audio chưa đồng bộ. Hãy kiểm tra mạng rồi thử lại.",6000);const {data,error}=await sb.rpc("staff_complete_practice_listening_v118",{p_attempt_id:state.attemptId});if(error)return toast(error.message,6000);if(data?.blocked)return toast("Audio chung Part 1–4 chưa được ghi nhận là đã phát hết.",6000);const testId=state.testId,onComplete=state.onComplete;resetExamState();return onComplete?.(testId);
  }
  function confirmFinish(){if(!state)return;if(state.activeAudio||!audio.isCompleted())return toast("Hãy nghe hết file audio chung Part 1–4 trước khi kết thúc làm thử.",6000);modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><h2>Kết thúc làm thử?</h2><p>Đã trả lời <b>${state.payload.questions.filter(q=>q.selected).length}/${state.payload.questions.length}</b> câu Listening.</p><div class="row between"><button class="secondary" data-close>Tiếp tục làm</button><button class="primary" id="finishListeningPractice">Xem kết quả thử</button></div></div></div>`;modalRoot.querySelector("[data-close]").onclick=()=>modalRoot.innerHTML="";modalRoot.querySelector("#finishListeningPractice").onclick=()=>finish("submitted");}
  async function finish(status){if(!state)return;stopTimer();await flushAnswerQueue();if(status!=="expired"&&audio.hasPending()){startTimer();return toast("Trạng thái audio chưa đồng bộ. Hãy kiểm tra mạng trước khi kết thúc làm thử.",6000);}const {error}=await sb.rpc("staff_finish_practice_attempt",{p_attempt_id:state.attemptId,p_status:status});if(error)return toast(error.message,6000);const {attemptId,testId}=state;removeStorage(uiKey(attemptId));resetExamState();modalRoot.innerHTML="";go(`/practice-result/${testId}/${attemptId}`);}

  document.addEventListener("visibilitychange",()=>audio.resumeIfVisible());
  return {renderAttempt,getExamState,setAntiCheat,setViolationCount,saveAttemptUi,flushAnswerQueue,setSaveStatus,stopTimer,resetExamState};
}
