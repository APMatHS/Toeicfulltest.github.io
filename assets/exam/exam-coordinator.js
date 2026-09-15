import { createListeningExamApp } from "./listening/listening-exam.js";
import { createListeningPracticeApp } from "./listening/listening-practice.js";

export function createExamCoordinator(ctx){
  const {sb,readingApp}=ctx;
  const listeningApp=createListeningExamApp(ctx);
  const practiceListeningApp=createListeningPracticeApp(ctx);
  let activeMode="reading";

  async function attemptMode(attemptId){
    const {data,error}=await sb.rpc("get_attempt_mode_v118",{p_attempt_id:attemptId});
    if(error){console.warn("V1.18 mode RPC unavailable; falling back to Reading.",error);return {test_kind:"reading",listening_completed_at:null,legacy:true};}
    return data||{test_kind:"reading",listening_completed_at:null};
  }
  async function testKind(testId){
    const {data,error}=await sb.from("tests").select("test_kind").eq("id",testId).single();
    if(error)return "reading";return data?.test_kind||"reading";
  }
  async function renderExam(attemptId){
    const meta=await attemptMode(attemptId),kind=meta.test_kind||"reading";
    if(kind==="listening"){activeMode="listening";return listeningApp.renderAttempt(attemptId,{mode:"listening"});}
    if(kind==="full"&&!meta.listening_completed_at){activeMode="listening";return listeningApp.renderAttempt(attemptId,{mode:"full",onComplete:async id=>{activeMode="reading";await readingApp.renderExam(id,{parts:[5,6,7]});}});}
    activeMode="reading";return readingApp.renderExam(attemptId,kind==="full"?{parts:[5,6,7]}:{});
  }
  async function renderStaffPreview(testId){
    const kind=await testKind(testId);
    if(kind==="reading"){activeMode="reading";return readingApp.renderStaffPreview(testId);}
    activeMode="practice-listening";
    return practiceListeningApp.renderAttempt(testId,{mode:kind,onComplete:kind==="full"?async id=>{activeMode="reading";await readingApp.renderStaffPreview(id,{parts:[5,6,7]});}:null});
  }

  const active=()=>activeMode==="listening"?listeningApp:activeMode==="practice-listening"?practiceListeningApp:readingApp;
  const getExamState=()=>practiceListeningApp.getExamState()||listeningApp.getExamState()||readingApp.getExamState();
  const setAntiCheat=value=>{readingApp.setAntiCheat(value);listeningApp.setAntiCheat(value);practiceListeningApp.setAntiCheat(value);};
  const setViolationCount=count=>active().setViolationCount(count);
  const saveAttemptUi=()=>active().saveAttemptUi();
  const flushAnswerQueue=()=>active().flushAnswerQueue();
  const setSaveStatus=(text,kind)=>active().setSaveStatus(text,kind);
  const stopTimer=()=>{readingApp.stopTimer();listeningApp.stopTimer();practiceListeningApp.stopTimer();};
  const resetExamState=()=>{readingApp.resetExamState();listeningApp.resetExamState();practiceListeningApp.resetExamState();activeMode="reading";};

  return {renderExam,renderStaffPreview,getExamState,setAntiCheat,setViolationCount,saveAttemptUi,flushAnswerQueue,setSaveStatus,stopTimer,resetExamState,getActiveMode:()=>activeMode};
}
