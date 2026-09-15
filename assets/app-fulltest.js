import { createListeningExamApp } from "./app-listening.js?build=20260915-v118";

export function createExamCoordinator(ctx){
  const {sb,readingApp}=ctx;
  const listeningApp=createListeningExamApp(ctx);
  let currentMode="reading";

  async function attemptMode(attemptId){
    const {data,error}=await sb.rpc("get_attempt_mode_v118",{p_attempt_id:attemptId});
    if(error) return {test_kind:"reading",listening_completed_at:null,legacy:true};
    return data||{test_kind:"reading"};
  }
  async function renderExam(attemptId){
    const meta=await attemptMode(attemptId);
    const kind=meta.test_kind||"reading";
    if(kind==="reading"){
      currentMode="reading";
      return readingApp.renderExam(attemptId);
    }
    if(kind==="listening"){
      currentMode="listening";
      return listeningApp.renderAttempt(attemptId,{mode:"listening"});
    }
    if(kind==="full" && !meta.listening_completed_at){
      currentMode="listening";
      return listeningApp.renderAttempt(attemptId,{mode:"full",onComplete:async id=>{
        currentMode="reading";
        await readingApp.renderExam(id,{parts:[5,6,7]});
      }});
    }
    currentMode="reading";
    return readingApp.renderExam(attemptId,{parts:[5,6,7]});
  }
  function active(){return currentMode==="listening"?listeningApp:readingApp;}
  function getExamState(){return listeningApp.getExamState()||readingApp.getExamState();}
  function setAntiCheat(v){readingApp.setAntiCheat(v);listeningApp.setAntiCheat(v);}
  function setViolationCount(v){active().setViolationCount(v);}
  function saveAttemptUi(){return active().saveAttemptUi();}
  function flushAnswerQueue(){return active().flushAnswerQueue();}
  function setSaveStatus(t,k){return active().setSaveStatus(t,k);}
  function stopTimer(){readingApp.stopTimer();listeningApp.stopTimer();}
  function resetExamState(){readingApp.resetExamState();listeningApp.resetExamState();currentMode="reading";}

  return {renderExam,getExamState,setAntiCheat,setViolationCount,saveAttemptUi,flushAnswerQueue,setSaveStatus,stopTimer,resetExamState};
}
