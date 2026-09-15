import { removeStorage } from "./modules/utils.js?build=20260915-v117";
export function createExamApp(){
 async function renderExam(attemptId,options={}){
    const data={attempt:{status:"in_progress"},questions:[]};
    if(data?.attempt?.status!=="in_progress") return go(`/result/${attemptId}`);
    if(Array.isArray(options.parts)&&options.parts.length){
      const allowed=new Set(options.parts.map(Number));
      data.questions=(data.questions||[]).filter(q=>allowed.has(Number(q.part)));
      if(!data.questions.length) return view.innerHTML=`<div class="card">Không có câu hỏi trong phần được chọn.</div>`;
    }
    mediaUrlCache.clear();
 }
 function stopTimer(){} function resetExamState(){} function getExamState(){return null} function setViolationCount(){} function setAntiCheat(){} function saveAttemptUi(){} function flushAnswerQueue(){} function setSaveStatus(){}
 return {renderExam,stopTimer,resetExamState,getExamState,setViolationCount,setAntiCheat,saveAttemptUi,flushAnswerQueue,setSaveStatus};
}
