const GRACE_MS = 30_000;
const CHECK_MS = 30_250;

export function createAntiCheatController({
  getExamState,
  getRoute,
  registerViolation,
  onCountChange,
  onWarning,
  onSubmitted
}){
  let bound=false;
  let away=null;

  function activeExam(){
    const state=getExamState?.();
    if(!state || state.preview) return null;
    if(getRoute?.()!==`/exam/${state.attemptId}`) return null;
    return state;
  }

  async function registerAway(state,returnedAt=null){
    if(!state || state.registered || state.sending) return;
    const exam=activeExam();
    if(!exam || exam.attemptId!==state.attemptId) return;

    const end=returnedAt ?? Date.now();
    const durationMs=end-state.startedAt;
    if(durationMs<=GRACE_MS) return;

    state.sending=true;
    const durationSeconds=Math.round(durationMs/100)/10;
    const eventType=state.sources.has("tab_hidden") ? "tab_hidden" : "window_blur";
    const details={
      policy:"v1.9_30s_grace",
      duration_seconds:durationSeconds,
      left_at:new Date(state.startedAt).toISOString(),
      returned_at:returnedAt ? new Date(returnedAt).toISOString() : null,
      sources:[...state.sources],
      ua:navigator.userAgent
    };

    try{
      const {data,error}=await registerViolation({
        attemptId:state.attemptId,
        eventType,
        details,
        clientEventId:crypto.randomUUID()
      });
      if(error){ console.error("Anti-cheat V1.9:",error); return; }
      if(data?.ignored || data?.duplicate) return;

      state.registered=true;
      onCountChange?.(Number(data?.violation_count)||0);
      if(data?.submitted) onSubmitted?.(data);
      else if(data?.warning) onWarning?.(data);
    }finally{
      state.sending=false;
    }
  }

  function beginAway(source){
    const exam=activeExam();
    if(!exam) return;
    if(!away || away.attemptId!==exam.attemptId){
      away={
        attemptId:exam.attemptId,
        startedAt:Date.now(),
        sources:new Set(),
        registered:false,
        sending:false,
        timer:null
      };
    }
    away.sources.add(source);
    if(!away.timer){
      const state=away;
      state.timer=setTimeout(()=>registerAway(state),CHECK_MS);
    }
  }

  function endAway(){
    if(document.visibilityState==="hidden") return;
    const state=away;
    if(!state) return;
    away=null;
    clearTimeout(state.timer);
    if(!state.registered) registerAway(state,Date.now());
  }

  function reset(){
    if(away?.timer) clearTimeout(away.timer);
    away=null;
  }

  function bind(){
    if(bound) return;
    bound=true;
    document.addEventListener("visibilitychange",()=>{
      if(document.visibilityState==="hidden") beginAway("tab_hidden");
      else endAway();
    });
    window.addEventListener("blur",()=>{
      if(document.visibilityState==="visible") beginAway("window_blur");
    });
    window.addEventListener("focus",endAway);
    window.addEventListener("hashchange",reset);
  }

  return {bind,reset};
}
