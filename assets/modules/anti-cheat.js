const RETURN_LIMIT_MS = 15_000;
const TICK_MS = 250;

function detectMobile(){
  const ua=navigator.userAgent||"";
  const isiPadDesktop=navigator.platform==="MacIntel" && navigator.maxTouchPoints>1;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || isiPadDesktop;
}

export function createAntiCheatController({
  getExamState,
  getRoute,
  registerViolation,
  enforceAbsenceTimeout,
  onCountChange,
  onWarning,
  onSubmitted
}){
  let bound=false;
  let away=null;
  let audioCtx=null;
  const mobile=detectMobile();

  function activeExam(){
    const state=getExamState?.();
    if(!state || state.preview) return null;
    if(state.payload?.attempt?.anti_cheat_mode==="off") return null;
    if(getRoute?.()!==`/exam/${state.attemptId}`) return null;
    return state;
  }

  function armAudio(){
    if(audioCtx) return;
    try{
      const Ctx=window.AudioContext||window.webkitAudioContext;
      if(!Ctx) return;
      audioCtx=new Ctx();
      if(audioCtx.state==="suspended") audioCtx.resume().catch(()=>{});
    }catch{}
  }

  function beep(freq=880,duration=0.12){
    try{
      if(!audioCtx) return;
      if(audioCtx.state==="suspended") audioCtx.resume().catch(()=>{});
      const osc=audioCtx.createOscillator();
      const gain=audioCtx.createGain();
      osc.frequency.value=freq;
      gain.gain.setValueAtTime(0.0001,audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12,audioCtx.currentTime+0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001,audioCtx.currentTime+duration);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(); osc.stop(audioCtx.currentTime+duration+0.02);
    }catch{}
  }

  function ensureOverlay(){
    let el=document.querySelector("#antiCheatOverlay");
    if(el) return el;
    el=document.createElement("div");
    el.id="antiCheatOverlay";
    el.className="anti-cheat-overlay";
    el.hidden=true;
    el.innerHTML=`<div class="anti-cheat-panel" role="dialog" aria-modal="true" aria-live="assertive">
      <div class="anti-cheat-kicker">CẢNH BÁO RỜI MÀN HÌNH</div>
      <div class="anti-cheat-count-wrap" data-ac-count-wrap>
        <div class="anti-cheat-count" data-ac-count>15</div>
        <div class="anti-cheat-count-unit">giây để quay lại</div>
      </div>
      <h2 data-ac-title>Quay lại bài thi ngay</h2>
      <p data-ac-message>Mỗi lần rời màn hình được tính ngay là 1 vi phạm. Quá 15 giây hoặc vi phạm lần thứ 3, bài sẽ tự động nộp.</p>
      <div class="anti-cheat-meta" data-ac-meta></div>
      <button type="button" class="primary anti-cheat-return-btn" data-ac-return hidden>Quay lại bài thi</button>
    </div>`;
    el.querySelector("[data-ac-return]")?.addEventListener("click",acknowledgeReturn);
    document.body.appendChild(el);
    return el;
  }

  function updateOverlay(state){
    if(!state) return;
    const el=ensureOverlay();
    const countWrap=el.querySelector("[data-ac-count-wrap]");
    const returnBtn=el.querySelector("[data-ac-return]");
    const title=el.querySelector("[data-ac-title]");
    const message=el.querySelector("[data-ac-message]");
    const count=state.violationCount ?? Number(activeExam()?.payload?.attempt?.violation_count||0);

    if(state.returned){
      if(countWrap) countWrap.hidden=true;
      if(title) title.textContent="Đã ghi nhận vi phạm";
      if(message) message.textContent="Bạn đã quay lại bài thi. Hãy xác nhận để tiếp tục làm bài.";
      if(returnBtn) returnBtn.hidden=false;
      el.querySelector("[data-ac-meta]").textContent=`Vi phạm: ${count}/3 · Lần thứ 3 sẽ tự động nộp`;
      el.hidden=false;
      if(!state.returnFocusQueued){
        state.returnFocusQueued=true;
        requestAnimationFrame(()=>returnBtn?.focus());
      }
      return;
    }

    const elapsed=Math.max(0,Date.now()-state.startedAt);
    const left=Math.max(0,Math.ceil((RETURN_LIMIT_MS-elapsed)/1000));
    if(countWrap) countWrap.hidden=false;
    el.querySelector("[data-ac-count]").textContent=String(left);
    if(title) title.textContent="Quay lại bài thi ngay";
    if(message) message.textContent="Mỗi lần rời màn hình được tính ngay là 1 vi phạm. Quá 15 giây hoặc vi phạm lần thứ 3, bài sẽ tự động nộp.";
    if(returnBtn) returnBtn.hidden=true;
    el.querySelector("[data-ac-meta]").textContent=`Vi phạm: ${count}/3 · Rời quá 15 giây sẽ tự động nộp`;
    el.hidden=false;
  }

  function hideOverlay(){
    const el=document.querySelector("#antiCheatOverlay");
    if(el) el.hidden=true;
  }

  function acknowledgeReturn(){
    const state=away;
    if(!state || state.closed || !state.returned) return;
    if(state.ticker) clearInterval(state.ticker);
    away=null;
    hideOverlay();
  }

  async function sendImmediateViolation(state){
    if(!state || state.violationSent || state.sendingViolation) return;
    const exam=activeExam();
    if(!exam || exam.attemptId!==state.attemptId) return;
    state.sendingViolation=true;
    try{
      const details={
        policy:"v1.10_exit_immediate",
        phase:"leave",
        left_at:new Date(state.startedAt).toISOString(),
        sources:[...state.sources],
        mobile,
        ua:navigator.userAgent
      };
      const {data,error}=await registerViolation({
        attemptId:state.attemptId,
        eventType:state.sources.has("tab_hidden")?"tab_hidden":"window_blur",
        details,
        clientEventId:state.leaveEventId
      });
      if(error){ console.error("Anti-cheat:",error); return; }
      if(data?.duplicate){ state.violationSent=true; return; }
      if(data?.ignored) return;
      state.violationSent=true;
      state.violationCount=Number(data?.violation_count)||0;
      onCountChange?.(state.violationCount);
      updateOverlay(state);
      if(!data?.submitted) onWarning?.(data);
      if(data?.submitted){
        state.closed=true;
        hideOverlay();
        onSubmitted?.({...data,reason:data.reason||"third_violation"});
      }
    }finally{
      state.sendingViolation=false;
    }
  }

  async function enforceTimeout(state){
    if(!state || state.closed || state.timeoutSending || state.returned) return false;
    if(Date.now()-state.startedAt<RETURN_LIMIT_MS) return false;
    const exam=activeExam();
    if(!exam || exam.attemptId!==state.attemptId) return false;
    if(!state.violationSent) await sendImmediateViolation(state);
    if(state.closed || !state.violationSent) return state.closed;
    state.timeoutSending=true;
    try{
      const {data,error}=await enforceAbsenceTimeout({
        attemptId:state.attemptId,
        leaveEventId:state.leaveEventId
      });
      if(error){ console.error("Anti-cheat timeout:",error); return false; }
      if(data?.submitted){
        state.closed=true;
        hideOverlay();
        onSubmitted?.({...data,reason:data.reason||"away_over_15_seconds"});
        return true;
      }
      return false;
    }finally{
      state.timeoutSending=false;
    }
  }

  function startTicker(state){
    clearInterval(state.ticker);
    state.ticker=setInterval(()=>{
      if(state.returned){clearInterval(state.ticker);return;}
      updateOverlay(state);
      if(Date.now()-state.startedAt>=RETURN_LIMIT_MS) enforceTimeout(state);
    },TICK_MS);
  }

  function beginAway(source){
    const exam=activeExam();
    if(!exam) return;
    if(mobile && source!=="tab_hidden" && source!=="route_leave") return;

    if(away && away.attemptId===exam.attemptId){
      if(!away.returned){
        away.sources.add(source);
        return;
      }
      // Sinh viên đã quay lại nhưng chưa bấm xác nhận rồi lại rời màn hình:
      // đây là một lần rời mới và phải được ghi nhận độc lập.
      if(away.ticker) clearInterval(away.ticker);
      away=null;
    }

    away={
      attemptId:exam.attemptId,
      startedAt:Date.now(),
      leaveEventId:crypto.randomUUID(),
      sources:new Set([source]),
      violationSent:false,
      sendingViolation:false,
      timeoutSending:false,
      violationCount:Number(exam.payload?.attempt?.violation_count||0),
      ticker:null,
      closed:false,
      returned:false,
      returnFocusQueued:false
    };
    updateOverlay(away);
    beep(980,0.15);
    sendImmediateViolation(away);
    startTicker(away);
    return away;
  }

  function recordRouteLeave(){
    const state=beginAway("route_leave");
    if(!state) return false;
    // Điều hướng ra khỏi trang thi được giữ lại ngay trên trang thi.
    // Đây là 1 vi phạm, nhưng không bắt sinh viên chờ 15 giây vì họ đã được đưa trở lại tức thì.
    if(state.ticker) clearInterval(state.ticker);
    state.returned=true;
    state.returnedAt=Date.now();
    updateOverlay(state);
    return true;
  }

  async function endAway(){
    if(document.visibilityState==="hidden") return;
    const state=away;
    if(!state || state.returned) return;

    if(Date.now()-state.startedAt>=RETURN_LIMIT_MS){
      const submitted=await enforceTimeout(state);
      if(submitted) return;
    }
    if(state.closed) return;

    // Dừng bộ đếm ngay tại thời điểm trình duyệt thực sự quay lại visible/focus.
    // Không để độ trễ mạng làm sinh viên bị tính quá 15 giây oan.
    if(state.ticker) clearInterval(state.ticker);
    state.returned=true;
    state.returnedAt=Date.now();
    updateOverlay(state);

    if(!state.violationSent) await sendImmediateViolation(state);
    if(state.closed) return;
    updateOverlay(state);

    // V1.13: không tự đóng cảnh báo và không dùng toast thay thế.
    // Sinh viên phải chủ động bấm “Quay lại bài thi”.
  }

  function reset(){
    if(away?.ticker) clearInterval(away.ticker);
    away=null;
    hideOverlay();
  }

  function bind(){
    if(bound) return;
    bound=true;
    document.addEventListener("visibilitychange",()=>{
      if(document.visibilityState==="hidden") beginAway("tab_hidden");
      else endAway();
    });
    if(!mobile){
      window.addEventListener("blur",()=>{
        if(document.visibilityState==="visible") beginAway("window_blur");
      });
      window.addEventListener("focus",endAway);
    }
  }

  return {bind,reset,armAudio,recordRouteLeave,isMobile:()=>mobile};
}
