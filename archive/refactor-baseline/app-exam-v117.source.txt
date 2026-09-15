import { esc,fmt,go,statusBadge,readJSON,writeJSON,removeStorage } from "./modules/utils.js?build=20260915-v117";
import { formatScore10 } from "./modules/score-utils.js";
import { embeddedImagePaths,hydrateEmbeddedImages,renderRichText } from "./modules/rich-editor.js?build=20260915-v117";

export function createExamApp(ctx){
  const {
    sb,modalRoot,signedUrlMap,toast,closeModal,showLoading,staffNav,
    getSession,getProfile,getView
  }=ctx;

  let session=null;
  let profile=null;
  let view=null;
  let examState=null;
  let timerId=null;
  let answerFlushBusy=false;
  let activeFlushEventId=null;
  let antiCheat=null;
  const mediaUrlCache=new Map();

  function syncRuntime(){
    session=getSession();
    profile=getProfile();
    view=getView();
  }

  function attemptQueueKey(attemptId){ return `toeic.answerQueue.${attemptId}`; }
  function attemptUiKey(attemptId){ return `toeic.attemptUi.${attemptId}`; }

  async function renderStudent(){
    syncRuntime();
    showLoading();
    const [{data:tests=[],error},{data:attempts=[]}] = await Promise.all([
      sb.from("tests").select("*,classes(name)").eq("status","published").is("archived_at",null).order("created_at",{ascending:false}),
      sb.from("attempts").select("*").eq("student_id",session.user.id).order("attempt_no",{ascending:false})
    ]);
    if(error) console.error(error);
    const byTest={};
    for(const a of attempts){(byTest[a.test_id]??=[]).push(a);}
    view.innerHTML=`<section class="card"><h1>Bài kiểm tra của tôi</h1><p class="muted">${esc(profile.full_name)} · ${esc(profile.student_code||"")}</p></section>
    <section class="grid grid-2 student-tests">
      ${tests.map(t=>{
        const all=byTest[t.id]||[];
        const valid=all.filter(a=>a.status!=="reset");
        const inProgress=valid.find(a=>a.status==="in_progress");
        const latest=inProgress||valid.sort((a,b)=>(b.attempt_no||0)-(a.attempt_no||0))[0];
        const used=valid.length,remaining=Math.max(0,(t.max_attempts||1)-used);
        let action="";
        if(inProgress) action=`<a class="btn primary" href="#/exam/${inProgress.id}">Tiếp tục lượt ${inProgress.attempt_no||1}</a>`;
        else if(remaining>0) action=`<button class="primary start-test" data-id="${t.id}" data-max="${t.max_attempts||1}" data-used="${used}">${used?`Làm lượt ${used+1}`:"Bắt đầu"}</button>${latest?`<a class="btn secondary" href="#/result/${latest.id}">Xem lượt trước</a>`:""}`;
        else if(latest) action=`<a class="btn secondary" href="#/result/${latest.id}">Xem kết quả</a>`;
        return `<div class="card"><div class="row between"><span class="badge">${esc(t.classes?.name||"TOEIC")}</span>${latest?statusBadge(latest.status):'<span class="status off">Chưa làm</span>'}</div>
        <h2>${esc(t.title)}</h2><p class="muted">${esc(t.description||"Bài kiểm tra TOEIC")}</p><div class="row wrap"><span>⏱ ${t.duration_minutes} phút</span><span>•</span><span>${used}/${t.max_attempts||1} lượt đã dùng</span>${remaining?`<span>• còn ${remaining}</span>`:""}</div>
        <div class="test-action row wrap">${action}</div></div>`;
      }).join("")||`<div class="card empty">Hiện chưa có bài kiểm tra được mở.</div>`}
    </section>`;
    document.querySelectorAll(".start-test").forEach(b=>b.onclick=()=>confirmStart(b.dataset.id,+b.dataset.max||1,+b.dataset.used||0));
  }

  function confirmStart(testId,maxAttempts=1,used=0){
    const nextNo=used+1;
    modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal">
      <h2>Trước khi bắt đầu lượt ${nextNo}</h2>
      <div class="warning-box"><b>Quy định chống gian lận</b><br>Mỗi lần rời màn hình được tính ngay 1 vi phạm. Quay lại trong 15 giây để tiếp tục; quá 15 giây hoặc rời màn hình lần thứ 3, hệ thống tự động nộp bài.</div>
      <p>Bài cho phép tối đa <b>${maxAttempts} lượt</b>. Bạn đã dùng <b>${used}</b> lượt. Đồng hồ bắt đầu ngay khi nhấn Bắt đầu.</p>
      <div class="row between"><button class="secondary" data-close>Hủy</button><button class="primary" id="confirmStart">Bắt đầu lượt ${nextNo}</button></div>
    </div></div>`;
    modalRoot.querySelector("[data-close]").onclick=closeModal;
    modalRoot.querySelector("#confirmStart").onclick=async()=>{
      antiCheat.armAudio();
      const btn=modalRoot.querySelector("#confirmStart");btn.disabled=true;btn.textContent="Đang bắt đầu…";
      const {data,error}=await sb.rpc("start_attempt",{p_test_id:testId});
      if(error){btn.disabled=false;btn.textContent=`Bắt đầu lượt ${nextNo}`;return toast(error.message,6000);}
      closeModal();
      try{ await document.documentElement.requestFullscreen?.(); }catch{}
      const attemptId=data?.attempt_id || data?.id || data?.attempt?.id;
      if(!attemptId) return toast("Không nhận được mã lượt làm.");
      go(`/exam/${attemptId}`);
    };
  }

  async function renderExam(attemptId){
    syncRuntime();
    if(!session||profile?.role!=="student") return go("/login");
    showLoading("Đang tải bài thi...");
    const {data,error}=await sb.rpc("get_attempt_payload",{p_attempt_id:attemptId});
    if(error) return view.innerHTML=`<div class="card">${esc(error.message)}</div>`;
    if(data?.attempt?.status!=="in_progress") return go(`/result/${attemptId}`);
    mediaUrlCache.clear();
    const ui=readJSON(attemptUiKey(attemptId),{current:0});
    examState={attemptId,payload:data,current:Math.min(ui.current||0,(data.questions?.length||1)-1),saveStatus:"Đã lưu"};
    mergeQueuedAnswers(attemptId,data.questions||[]);
    await ensureQuestionMedia(data.questions?.[examState.current]);
    drawExam();
    antiCheat.bind();
    flushAnswerQueue();
    prefetchQuestion(examState.current+1);
  }

  function buildPracticeQuestions(authoring,answers=[]){
    const groupMap=new Map((authoring?.stimulus_groups||[]).map(g=>[g.id,g]));
    const savedAnswers=new Map(answers.map(a=>[a.question_id,a]));
    return (authoring?.questions||[]).slice()
      .sort((a,b)=>(a.part_no-b.part_no)||(a.source_order-b.source_order)||(a.source_number-b.source_number))
      .map(q=>{
        const a=savedAnswers.get(q.id);
        return {...q,part:q.part_no,number:q.source_number,selected:a?.selected,marked:!!a?.marked,
          choices:(q.choices||[]).map(c=>({...c,key:c.key||c.choice_key})),
          stimuli:(groupMap.get(q.stimulus_group_id)?.stimuli||[]).map(s=>({...s,type:s.media_type}))};
      });
  }

  async function renderStaffPreview(testId){
    syncRuntime();
    showLoading("Đang mở chế độ làm thử...");
    const {data:start,error:startError}=await sb.rpc("staff_start_practice_attempt",{p_test_id:testId});
    if(startError) return view.innerHTML=`<div class="card"><a href="#/test/${testId}">← Quay lại</a><p>${esc(startError.message)}</p></div>`;
    const practiceId=start?.attempt_id;
    const [{data,error},{data:practice,error:practiceError}]=await Promise.all([
      sb.rpc("get_test_authoring",{p_test_id:testId}),
      sb.rpc("staff_get_practice_attempt",{p_attempt_id:practiceId})
    ]);
    if(error||practiceError) return view.innerHTML=`<div class="card"><a href="#/test/${testId}">← Quay lại</a><p>${esc((error||practiceError).message)}</p></div>`;
    const t=data?.test||{};
    const questions=buildPracticeQuestions(data,practice?.answers||[]);
    if(!questions.length) return view.innerHTML=`<div class="card"><a href="#/test/${testId}">← Quay lại</a><h2>${esc(t.title||"Bài kiểm tra")}</h2><p>Chưa có câu hỏi để làm thử.</p></div>`;
    if(practice?.attempt?.status!=="in_progress") return renderStoredPracticeResult(testId,practiceId,questions,practice.attempt);
    mediaUrlCache.clear();
    const ui=readJSON(attemptUiKey(practiceId),{current:0});
    examState={
      attemptId:practiceId,
      preview:true,
      persistedPractice:true,
      testId,
      payload:{
        test:t,
        questions,
        attempt:{...practice.attempt,anti_cheat_mode:"off",violation_count:0,allowed_violations:0}
      },
      current:Math.min(ui.current||0,questions.length-1),
      saveStatus:start?.resumed?"Đã phục hồi lượt làm thử":"Lượt làm thử đã được lưu"
    };
    await ensureQuestionMedia(questions[examState.current]);
    drawExam();
    prefetchQuestion(examState.current+1);
  }

  async function renderStaffPracticeResult(testId,attemptId){
    syncRuntime();
    showLoading("Đang tải kết quả làm thử...");
    const [{data,error},{data:practice,error:practiceError}]=await Promise.all([
      sb.rpc("get_test_authoring",{p_test_id:testId}),
      sb.rpc("staff_get_practice_attempt",{p_attempt_id:attemptId})
    ]);
    if(error||practiceError) return view.innerHTML=`<div class="card"><a href="#/test/${testId}/practice">← Quay lại</a><p>${esc((error||practiceError).message)}</p></div>`;
    const questions=buildPracticeQuestions(data,practice?.answers||[]);
    renderStoredPracticeResult(testId,attemptId,questions,practice?.attempt||{});
  }

  function mergeQueuedAnswers(attemptId,questions){
    const queue=readJSON(attemptQueueKey(attemptId),[]);
    const byId=new Map(questions.map(q=>[q.id,q]));
    for(const ev of Array.isArray(queue)?queue:[]){
      const q=byId.get(ev.question_id);
      if(q){q.selected=ev.choice;q.marked=ev.marked;}
    }
  }

  const staticUrl=p=>p?.startsWith("static:") ? p.slice(7) : null;

  function collectMediaPaths(q){
    const paths=new Set();
    if(!q) return paths;
    if(q.storage_path && !staticUrl(q.storage_path)) paths.add(q.storage_path);
    embeddedImagePaths(q.content).forEach(p=>paths.add(p));
    for(const s of q.stimuli||[]){
      if(s.storage_path && !staticUrl(s.storage_path)) paths.add(s.storage_path);
      embeddedImagePaths(s.content).forEach(p=>paths.add(p));
    }
    for(const c of q.choices||[]){
      if(c.storage_path && !staticUrl(c.storage_path)) paths.add(c.storage_path);
      embeddedImagePaths(c.content).forEach(p=>paths.add(p));
    }
    return paths;
  }

  async function ensureQuestionMedia(q){
    if(!q || q._mediaHydrated) return;
    if(q._mediaPromise) return q._mediaPromise;
    q._mediaPromise=(async()=>{
      const paths=[...collectMediaPaths(q)];
      const missing=paths.filter(p=>!mediaUrlCache.has(p));
      if(missing.length){
        const m=await signedUrlMap(missing);
        for(const [p,url] of Object.entries(m||{})) if(url) mediaUrlCache.set(p,url);
      }
      const map=Object.fromEntries(paths.map(p=>[p,mediaUrlCache.get(p)]).filter(([,u])=>u));
      const resolve=p=>staticUrl(p)||mediaUrlCache.get(p)||null;
      if(q.storage_path) q.url=resolve(q.storage_path);
      q.content=hydrateEmbeddedImages(q.content,map);
      for(const s of q.stimuli||[]){
        if(s.storage_path) s.url=resolve(s.storage_path);
        s.content=hydrateEmbeddedImages(s.content,map);
      }
      for(const c of q.choices||[]){
        if(c.storage_path) c.url=resolve(c.storage_path);
        c.content=hydrateEmbeddedImages(c.content,map);
      }
      q._mediaHydrated=true;
    })().finally(()=>{q._mediaPromise=null;});
    return q._mediaPromise;
  }

  async function hydrateMedia(questions,{batchSize=10}={}){
    for(let i=0;i<questions.length;i+=batchSize){
      await Promise.all(questions.slice(i,i+batchSize).map(ensureQuestionMedia));
      if(i+batchSize<questions.length) await new Promise(r=>setTimeout(r,0));
    }
  }

  function prefetchQuestion(index){
    if(!examState || index<0 || index>=examState.payload.questions.length) return;
    const run=()=>ensureQuestionMedia(examState?.payload?.questions?.[index]).catch(()=>{});
    if("requestIdleCallback" in window) requestIdleCallback(run,{timeout:1500});
    else setTimeout(run,120);
  }

  async function showQuestion(index){
    if(!examState) return;
    const total=examState.payload.questions.length;
    if(index<0||index>=total) return;
    examState.current=index;
    saveAttemptUi();
    const q=examState.payload.questions[index];
    if(!q._mediaHydrated){
      await ensureQuestionMedia(q);
    }
    if(!examState || examState.current!==index) return;
    drawExam();
    prefetchQuestion(index+1);
  }

  function renderMedia(type,url,content,cls=""){
    if(type==="image" && url) return `<img class="question-media ${cls}" src="${url}" alt="Nội dung câu hỏi" loading="lazy" decoding="async">`;
    if(type==="audio" && url) return `<audio class="${cls}" controls preload="metadata" src="${url}"></audio>`;
    if(type==="text" || content) return content?`<div class="rich-content ${cls}">${renderRichText(content)}</div>`:"";
    return "";
  }

  function saveAttemptUi(){
    if(!examState) return;
    writeJSON(attemptUiKey(examState.attemptId),{current:examState.current,updated_at:Date.now()});
  }

  function setSaveStatus(text,cls=""){
    if(examState) examState.saveStatus=text;
    const el=document.querySelector("#saveStatus");
    if(el){el.textContent=text;el.className=`save-status ${cls}`;}
  }

  function drawExam(){
    if(!examState) return;
    const {payload,current}=examState;
    const q=payload.questions[current], a=payload.attempt;
    if(!q) return view.innerHTML=`<div class="card">Không có câu hỏi.</div>`;
    const antiText=examState.preview?"Giảng viên làm thử · lưu lịch sử riêng, không tính vào kết quả sinh viên":a.anti_cheat_mode==="off"?"Chống gian lận: Tắt":a.anti_cheat_mode==="strict"?`Vi phạm: ${a.violation_count||0}/1 · rời màn hình tính ngay`:`Vi phạm: ${a.violation_count||0}/3 · rời màn hình tính ngay · quá 15 giây hoặc lần 3 sẽ tự nộp`;
    saveAttemptUi();
    view.innerHTML=`${examState.preview?`<section class="card preview-banner"><div class="row between wrap"><div><b>Chế độ làm thử</b><div class="muted">Giao diện như sinh viên · tự lưu trong lịch sử riêng của giảng viên</div></div><a class="btn secondary" href="#/test/${examState.testId}/practice">← Thoát làm thử</a></div></section>`:""}<section class="exam-layout"><div class="exam-main">
      <div class="card"><div class="row between wrap"><div><b>Part ${q.part}</b><div class="muted">Câu ${q.number} · ${current+1}/${payload.questions.length}</div></div><div class="exam-status"><span id="saveStatus" class="save-status">${esc(examState.saveStatus||"Đã lưu")}</span><div id="timer" class="timer"></div></div></div></div>
      ${(q.stimuli||[]).map(s=>`<div class="stimulus">${renderMedia(s.type,s.url,s.content)}</div>`).join("")}
      <div class="card question">
        ${renderMedia(q.media_type,q.url,null)}
        <div class="question-title"><b>${q.number}.</b><div class="rich-content">${renderRichText(q.content||"")}</div></div>
        ${(q.choices||[]).map(c=>`<label class="choice">
          <input type="radio" name="choice" value="${c.key}" ${q.selected===c.key?"checked":""}>
          <b>${c.key}.</b>
          <div class="choice-body">${renderMedia(c.media_type,c.url,null,"choice-media")}<div class="rich-content">${renderRichText(c.content||"")}</div></div>
        </label>`).join("")}
        <div class="divider"></div>
        <label class="review-label"><input id="markReview" type="checkbox" ${q.marked?"checked":""}> Đánh dấu xem lại</label>
      </div>
      <div class="exam-toolbar"><button class="secondary" id="prevBtn" ${current===0?"disabled":""}>← Câu trước</button><button class="secondary" id="nextBtn" ${current===payload.questions.length-1?"disabled":""}>Câu sau →</button></div>
    </div>
    <aside class="exam-side"><div class="card sticky"><div class="row between"><b>Câu hỏi</b><span class="muted">${payload.questions.filter(x=>x.selected).length}/${payload.questions.length}</span></div>
    <div class="palette">${payload.questions.map((x,i)=>`<button class="qbtn ${x.selected?"done":""} ${x.marked?"review":""} ${i===current?"current":""}" data-i="${i}">${x.number}</button>`).join("")}</div>
    <button class="${examState.preview?"primary":"danger"} full" id="submitBtn">${examState.preview?"Kết thúc làm thử":"Nộp bài"}</button>${examState.preview?"":'<button class="secondary full" id="fullscreenBtn" type="button">⛶ Toàn màn hình</button>'}<p id="antiCheatStatus" class="muted small">${esc(antiText)}</p></div></aside></section>`;

    document.querySelectorAll(".qbtn").forEach(b=>b.onclick=()=>showQuestion(+b.dataset.i));
    document.querySelector("#prevBtn").onclick=()=>showQuestion(examState.current-1);
    document.querySelector("#nextBtn").onclick=()=>showQuestion(examState.current+1);
    document.querySelectorAll('input[name="choice"]').forEach(r=>r.onchange=()=>saveCurrent(r.value));
    document.querySelector("#markReview").onchange=e=>saveCurrent(q.selected,e.target.checked);
    document.querySelector("#submitBtn").onclick=confirmSubmit;
    const fullscreenBtn=document.querySelector("#fullscreenBtn");
    if(fullscreenBtn) fullscreenBtn.onclick=async()=>{
      saveAttemptUi();
      flushAnswerQueue();
      try{ await document.documentElement.requestFullscreen?.(); }catch{}
    };
    clearInterval(timerId);
    updateTimer(); timerId=setInterval(updateTimer,1000);
  }

  function readAnswerQueue(attemptId){
    const q=readJSON(attemptQueueKey(attemptId),[]);
    return Array.isArray(q)?q:[];
  }

  function enqueueAnswer(attemptId,event){
    const queue=readAnswerQueue(attemptId);
    const next=[];
    let retainedActive=false;
    for(const old of queue){
      if(old.client_event_id===activeFlushEventId){
        next.push(old); retainedActive=true; continue;
      }
      if(old.question_id!==event.question_id) next.push(old);
    }
    // Nếu event đang gửi chính là câu này, giữ event đang bay và chỉ thêm trạng thái cuối mới nhất.
    // Nếu không, mọi event cũ của cùng câu đã được thay bằng event mới.
    next.push(event);
    writeJSON(attemptQueueKey(attemptId),next);
    return {length:next.length,retainedActive};
  }

  async function saveCurrent(choice,marked=document.querySelector("#markReview")?.checked||false){
    if(!examState) return;
    const q=examState.payload.questions[examState.current];
    q.marked=marked;
    if(examState.preview){
      if(choice) q.selected=choice;
      drawPaletteOnly();
      setSaveStatus("Đang lưu…","pending");
      const state=examState;
      const previous=state.pendingSave||Promise.resolve();
      const saveTask=previous.then(()=>sb.rpc("staff_save_practice_answer",{
        p_attempt_id:state.attemptId,p_question_id:q.id,p_choice:choice||null,p_marked:marked
      })).then(result=>{if(result.error) throw result.error;return result;});
      const settled=saveTask.then(result=>({result}),error=>({error}));
      state.pendingSave=settled;
      const outcome=await settled;
      if(outcome.error){
        if(examState===state) setSaveStatus(`Chưa lưu: ${outcome.error.message}`,"offline");
      }else if(examState===state){
        setSaveStatus("Đã lưu","saved");
      }
      if(state.pendingSave===settled) state.pendingSave=null;
      return;
    }
    if(choice) q.selected=choice;
    const ev={client_event_id:crypto.randomUUID(),question_id:q.id,choice:choice||null,marked,created_at:Date.now()};
    enqueueAnswer(examState.attemptId,ev);
    setSaveStatus(navigator.onLine?"Đang lưu…":"Mất mạng – đã lưu tạm",navigator.onLine?"pending":"offline");
    drawPaletteOnly();
    flushAnswerQueue();
  }

  function drawPaletteOnly(){
    const side=document.querySelector(".exam-side");
    if(!side||!examState) return;
    side.querySelectorAll(".qbtn").forEach((b,i)=>{
      const x=examState.payload.questions[i];
      b.classList.toggle("done",!!x.selected);
      b.classList.toggle("review",!!x.marked);
    });
  }

  async function flushAnswerQueue(){
    if(answerFlushBusy||!examState||!navigator.onLine) return;
    const attemptId=examState.attemptId;
    answerFlushBusy=true;
    try{
      while(navigator.onLine && examState?.attemptId===attemptId){
        const queue=readAnswerQueue(attemptId);
        if(!queue.length) break;
        const ev=queue[0];
        activeFlushEventId=ev.client_event_id;
        setSaveStatus("Đang lưu…","pending");
        const {data,error}=await sb.rpc("save_answer_v2",{
          p_attempt_id:attemptId,p_question_id:ev.question_id,p_choice:ev.choice,
          p_marked:ev.marked,p_client_event_id:ev.client_event_id
        });
        if(error){ setSaveStatus("Lưu tạm – chờ mạng","offline"); break; }
        // Luôn đọc lại queue sau request để không ghi đè event mới phát sinh trong lúc mạng đang chờ.
        const current=readAnswerQueue(attemptId);
        writeJSON(attemptQueueKey(attemptId),current.filter(x=>x.client_event_id!==ev.client_event_id));
        activeFlushEventId=null;
        if(data?.submitted){
          const id=attemptId;
          antiCheat.reset();
          resetExamState();
          go(`/result/${id}`);
          return;
        }
      }
      if(examState?.attemptId===attemptId && !readAnswerQueue(attemptId).length) setSaveStatus("Đã lưu","saved");
    }finally{
      activeFlushEventId=null;
      answerFlushBusy=false;
    }
  }

  function updateTimer(){
    if(!examState) return;
    const left=Math.max(0,new Date(examState.payload.attempt.expires_at)-Date.now());
    const el=document.querySelector("#timer"); if(!el) return;
    const s=Math.floor(left/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),ss=s%60;
    el.textContent=`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
    el.classList.toggle("danger-text",s<300);
    if(left<=0){
      clearInterval(timerId);
      if(examState.preview) renderPreviewResult("expired");
      else {
        const id=examState.attemptId;
        antiCheat.reset();
        resetExamState();
        go(`/result/${id}`);
      }
    }
  }

  function confirmSubmit(){
    if(examState?.preview){
      modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal">
        <h2>Kết thúc làm thử?</h2><p>Thầy đã trả lời <b>${examState.payload.questions.filter(x=>x.selected).length}/${examState.payload.questions.length}</b> câu. Kết quả sẽ được lưu vào lịch sử làm thử riêng.</p>
        <div class="row between"><button class="secondary" data-close>Tiếp tục làm</button><button class="primary" id="finishPreview">Xem kết quả thử</button></div>
      </div></div>`;
      modalRoot.querySelector("[data-close]").onclick=closeModal;
      modalRoot.querySelector("#finishPreview").onclick=()=>{closeModal();renderPreviewResult("submitted")};
      return;
    }
    modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal">
      <h2>Nộp bài?</h2><p>Bạn đã trả lời <b>${examState.payload.questions.filter(x=>x.selected).length}/${examState.payload.questions.length}</b> câu.</p>
      <div class="row between"><button class="secondary" data-close>Tiếp tục làm</button><button class="danger" id="doSubmit">Nộp bài</button></div>
    </div></div>`;
    modalRoot.querySelector("[data-close]").onclick=closeModal;
    modalRoot.querySelector("#doSubmit").onclick=async()=>{
      if(readAnswerQueue(examState.attemptId).length){
        await flushAnswerQueue();
        if(readAnswerQueue(examState.attemptId).length) return toast("Còn đáp án chưa đồng bộ. Hãy chờ mạng ổn định trước khi nộp.",6000);
      }
      const {error}=await sb.rpc("submit_attempt",{p_attempt_id:examState.attemptId});
      if(error) return toast(error.message);
      const id=examState.attemptId;
      removeStorage(attemptQueueKey(id));
      removeStorage(attemptUiKey(id));
      antiCheat.reset();
      resetExamState();
      closeModal(); go(`/result/${id}`);
    };
  }

  async function renderPreviewResult(status="submitted"){
    if(!examState?.preview) return;
    clearInterval(timerId); timerId=null;
    if(examState.pendingSave) await examState.pendingSave;
    const {questions}=examState.payload, testId=examState.testId;
    const attemptId=examState.attemptId;
    const {data,error}=await sb.rpc("staff_finish_practice_attempt",{p_attempt_id:attemptId,p_status:status});
    if(error) return toast(error.message,6000);
    removeStorage(attemptUiKey(attemptId));
    history.replaceState({practiceResult:true},"",`#/practice-result/${testId}/${attemptId}`);
    renderStoredPracticeResult(testId,attemptId,questions,{...data,status});
  }

  function renderStoredPracticeResult(testId,attemptId,questions,attempt={}){
    clearInterval(timerId); timerId=null;
    const correct=attempt.correct_count??questions.filter(q=>q.selected && q.selected===q.correct_choice_key).length;
    const answered=questions.filter(q=>q.selected).length;
    view.innerHTML=`<section class="card">
      <span class="eyebrow">Kết quả làm thử</span><h1>${correct}/${questions.length} câu đúng</h1>
      <p class="muted">Đã trả lời ${answered}/${questions.length} câu. Lượt này đã lưu trong lịch sử làm thử riêng của giảng viên.</p>
      <div class="row wrap"><button class="primary" id="retryPreview">Làm lượt mới</button><a class="btn secondary" href="#/test/${testId}/practice">← Về lịch sử làm thử</a></div>
    </section>
    <section class="card result-list"><h2>Đối chiếu đáp án</h2>${questions.map(q=>`<div class="result-row"><b>Câu ${q.number}</b> · Đã chọn: <b>${esc(q.selected||"—")}</b> · Đáp án: <b>${esc(q.correct_choice_key||"—")}</b> · <span class="${q.selected===q.correct_choice_key?"correct":"wrong"}">${q.selected===q.correct_choice_key?"Đúng":"Sai"}</span></div>`).join("")}</section>`;
    examState=null;
    document.querySelector("#retryPreview")?.addEventListener("click",()=>go(`/preview/${testId}`));
  }

  function renderAttemptReview(questions,showAnswers){
    let previousGroup=null;
    return questions.map(q=>{
      const showStimuli=!!q.stimulus_group_id && q.stimulus_group_id!==previousGroup;
      if(q.stimulus_group_id) previousGroup=q.stimulus_group_id;
      else previousGroup=null;
      const selected=q.selected||null;
      const correct=showAnswers?q.correct:null;
      const stateText=!selected?"Chưa trả lời":showAnswers?(q.is_correct?"Đúng":"Sai"):`Đã chọn ${selected}`;
      const stateClass=!selected?"unanswered":showAnswers?(q.is_correct?"correct":"wrong"):"selected-only";
      const choices=(q.choices||[]).map(c=>{
        const isSelected=selected===c.key;
        const isCorrect=showAnswers && correct===c.key;
        const cls=["review-choice",isSelected?"selected":"",isCorrect?"correct-choice":"",showAnswers&&isSelected&&!isCorrect?"wrong-choice":""].filter(Boolean).join(" ");
        const tag=isCorrect?'<span class="review-choice-tag correct">Đáp án đúng</span>':isSelected?'<span class="review-choice-tag">Bạn chọn</span>':"";
        return `<div class="${cls}"><div class="review-choice-key"><b>${esc(c.key)}.</b></div><div class="choice-body">${renderMedia(c.media_type,c.url,null,"choice-media")}<div class="rich-content">${renderRichText(c.content||"")}</div></div>${tag}</div>`;
      }).join("");
      return `<article class="review-question">
        ${showStimuli?(q.stimuli||[]).map(st=>`<div class="stimulus review-stimulus">${renderMedia(st.type,st.url,st.content)}</div>`).join(""):""}
        <div class="review-question-head"><div><b>Part ${q.part}</b> · Câu ${q.number}</div><span class="review-state ${stateClass}">${esc(stateText)}</span></div>
        ${renderMedia(q.media_type,q.url,null)}
        <div class="question-title"><b>${q.number}.</b><div class="rich-content">${renderRichText(q.content||"")}</div></div>
        <div class="review-choices">${choices}</div>
        <div class="review-summary">Bạn chọn: <b>${esc(selected||"—")}</b>${showAnswers?` · Đáp án đúng: <b>${esc(correct||"—")}</b>`:' · <span class="muted">Đáp án đúng chưa được công bố</span>'}</div>
      </article>`;
    }).join("");
  }

  async function renderResult(attemptId,staffView=false){
    syncRuntime();
    showLoading("Đang tải kết quả...");
    const {data,error}=await sb.rpc("get_attempt_result",{p_attempt_id:attemptId});
    if(error){
      if(error.message.includes("not submitted")){
        setTimeout(()=>renderResult(attemptId,staffView),1200);
        return view.innerHTML=`<div class="card">Đang chốt bài...</div>`;
      }
      return view.innerHTML=`<div class="card">${esc(error.message)}</div>`;
    }
    examState=null;
    antiCheat.reset();
    try{ if(document.fullscreenElement) await document.exitFullscreen(); }catch{}
    mediaUrlCache.clear();
    const ans=data.answers||[],questions=data.questions||[];
    if(questions.length) await hydrateMedia(questions,{batchSize:8});
    const total=data.total_questions||questions.length||ans.length||100;
    const pct=total?Math.round((Number(data.correct_count||0)/total)*1000)/10:0;
    const showAnswers=staffView || !!data.show_answers;
    const autoReason=data.submission_reason==="anti_cheat"
      ? '<div class="warning-box result-warning"><b>Bài được hệ thống tự động nộp do chống gian lận.</b></div>'
      : data.submission_reason==="timeout"
        ? '<div class="warning-box result-warning"><b>Bài được hệ thống tự động nộp vì hết thời gian.</b></div>'
        : "";
    const review=questions.length
      ? renderAttemptReview(questions,showAnswers)
      : ans.length
        ? ans.map(x=>`<div class="result-row"><b>Câu ${x.number}</b> · Bạn chọn: <b>${esc(x.selected||"—")}</b>${showAnswers?` · Đáp án: <b>${esc(x.correct||"—")}</b> · <span class="${x.is_correct?"correct":"wrong"}">${x.is_correct?"Đúng":"Sai"}</span>`:""}</div>`).join("")
        : '<div class="empty">Chưa có dữ liệu xem lại bài làm. Hãy áp dụng migration Supabase V1.10.</div>';
    view.innerHTML=`${staffView?staffNav("tests"):""}<section class="card">
      <span class="eyebrow">Kết quả${data.attempt_no?` · Lượt ${data.attempt_no}`:""}</span><h1>Hoàn thành bài thi</h1>
      <div class="row score-row"><div><div class="big-score">${formatScore10(data.correct_count,total)}</div><div class="muted">${data.correct_count}/${total} câu đúng · ${pct}%</div></div><div>${statusBadge(data.status)}</div></div>
      <p class="muted">Nộp lúc ${fmt(data.submitted_at)}${data.violation_count!=null?` · Vi phạm: ${data.violation_count}/3`:""}</p>${autoReason}${staffView?'<button class="btn primary" id="backFromResult">← Quay lại bài kiểm tra</button>':'<a class="btn primary" href="#/student">Về danh sách bài</a>'}
    </section>
    <section class="card result-list"><div class="row between wrap"><div><h2>Xem lại bài làm</h2><p class="muted">${showAnswers?"Đáp án đúng được hiển thị theo cài đặt của bài kiểm tra.":"Bạn được xem lại câu hỏi và phương án đã chọn; đáp án đúng chưa được công bố."}</p></div></div>${review}</section>`;
    document.querySelector("#backFromResult")?.addEventListener("click",()=>history.back());
  }

  function setAntiCheat(controller){ antiCheat=controller; }
  function getExamState(){ return examState; }
  function setViolationCount(count){
    if(examState?.payload?.attempt) examState.payload.attempt.violation_count=count;
  }
  function stopTimer(){ clearInterval(timerId); timerId=null; }
  function resetExamState(){
    stopTimer();
    examState=null;
    activeFlushEventId=null;
    mediaUrlCache.clear();
  }

  return {
    renderStudent,renderExam,renderStaffPreview,renderStaffPracticeResult,renderResult,
    saveAttemptUi,flushAnswerQueue,setSaveStatus,
    setAntiCheat,getExamState,setViolationCount,stopTimer,resetExamState
  };
}
