import { readJSON,writeJSON } from "../modules/utils.js";

export function createAnswerQueue({sb,getExamState,setSaveStatus,onSubmitted}){
  let busy=false;
  let activeFlushEventId=null;
  const queueKey=id=>`toeic.answerQueue.${id}`;
  const read=id=>{const q=readJSON(queueKey(id),[]);return Array.isArray(q)?q:[];};

  function merge(attemptId,questions){
    const byId=new Map(questions.map(q=>[q.id,q]));
    for(const ev of read(attemptId)){const q=byId.get(ev.question_id);if(q){q.selected=ev.choice;q.marked=ev.marked;}}
  }
  function enqueue(attemptId,event){
    const next=[];let retainedActive=false;
    for(const old of read(attemptId)){
      if(old.client_event_id===activeFlushEventId){next.push(old);retainedActive=true;continue;}
      if(old.question_id!==event.question_id)next.push(old);
    }
    next.push(event);writeJSON(queueKey(attemptId),next);return {length:next.length,retainedActive};
  }
  async function flush(){
    const state=getExamState();if(busy||!state||!navigator.onLine)return;
    const attemptId=state.attemptId;busy=true;
    try{
      while(navigator.onLine&&getExamState()?.attemptId===attemptId){
        const queue=read(attemptId);if(!queue.length)break;
        const ev=queue[0];activeFlushEventId=ev.client_event_id;setSaveStatus("Đang lưu…","pending");
        const {data,error}=await sb.rpc("save_answer_v2",{p_attempt_id:attemptId,p_question_id:ev.question_id,p_choice:ev.choice,p_marked:ev.marked,p_client_event_id:ev.client_event_id});
        if(error){setSaveStatus("Lưu tạm – chờ mạng","offline");break;}
        const current=read(attemptId);writeJSON(queueKey(attemptId),current.filter(x=>x.client_event_id!==ev.client_event_id));activeFlushEventId=null;
        if(data?.submitted){onSubmitted?.(attemptId,data);return;}
      }
      if(getExamState()?.attemptId===attemptId&&!read(attemptId).length)setSaveStatus("Đã lưu","saved");
    }finally{activeFlushEventId=null;busy=false;}
  }
  return {queueKey,read,merge,enqueue,flush,reset:()=>{busy=false;activeFlushEventId=null;}};
}
