const ENHANCED_ATTR="data-v113-review";
let enhanceQueued=false;

function resultAttemptId(){
  const m=location.hash.match(/^#\/result\/([^/?#]+)/);
  return m?.[1]||"unknown";
}
function stateKey(){return `toeic.review.v1.13.${resultAttemptId()}`;}
function readState(){
  try{return JSON.parse(localStorage.getItem(stateKey())||"{}")||{};}catch{return {};}
}
function writeState(patch){
  const old=readState();
  try{localStorage.setItem(stateKey(),JSON.stringify({...old,...patch,updated_at:Date.now()}));}catch{}
}
function parseMeta(article){
  const head=article.querySelector(".review-question-head");
  const text=head?.textContent||"";
  const m=text.match(/Part\s*(\d+).*?Câu\s*(\d+)/i);
  const stateEl=article.querySelector(".review-state");
  const state=stateEl?.classList.contains("wrong")?"wrong"
    :stateEl?.classList.contains("correct")?"correct"
    :stateEl?.classList.contains("unanswered")?"unanswered"
    :"selected-only";
  return {
    part:Number(m?.[1]||0),
    number:Number(m?.[2]||0),
    state,
    stateText:(stateEl?.textContent||"").trim()||"—"
  };
}
function partStats(items){
  return {
    total:items.length,
    correct:items.filter(x=>x.state==="correct").length,
    wrong:items.filter(x=>x.state==="wrong").length,
    unanswered:items.filter(x=>x.state==="unanswered").length
  };
}
function stateLabel(state){
  return ({wrong:"Sai",correct:"Đúng",unanswered:"Chưa trả lời","selected-only":"Đã trả lời"})[state]||state;
}
function createQuestionDetails(article,meta){
  const oldHead=article.querySelector(".review-question-head");
  if(oldHead) oldHead.remove();
  const details=document.createElement("details");
  details.className=`review-question-details review-${meta.state}`;
  details.dataset.part=String(meta.part);
  details.dataset.number=String(meta.number);
  details.dataset.state=meta.state;
  details.id=`review-q-${resultAttemptId()}-${meta.number}`;

  const summary=document.createElement("summary");
  summary.innerHTML=`<span class="review-q-summary-title"><b>Câu ${meta.number}</b><span class="muted"> · ${stateLabel(meta.state)}</span></span><span class="review-state ${meta.state}">${meta.stateText}</span>`;
  const body=document.createElement("div");
  body.className="review-question-body";
  while(article.firstChild) body.appendChild(article.firstChild);
  details.append(summary,body);
  article.replaceWith(details);
  return details;
}
function makePart(part,items,questionEls){
  const st=partStats(items);
  const d=document.createElement("details");
  d.className="review-part";
  d.dataset.part=String(part);
  const s=document.createElement("summary");
  const answerBits=items.some(x=>x.state==="wrong"||x.state==="correct")
    ? `<span class="review-part-stats">${st.correct} đúng · ${st.wrong} sai${st.unanswered?` · ${st.unanswered} chưa trả lời`:""}</span>`
    : `<span class="review-part-stats">${st.unanswered} chưa trả lời · ${st.total-st.unanswered} đã trả lời</span>`;
  s.innerHTML=`<span><b>Part ${part}</b> <span class="muted">· ${st.total} câu</span></span>${answerBits}`;
  const body=document.createElement("div");
  body.className="review-part-body";
  questionEls.forEach(x=>body.appendChild(x));
  d.append(s,body);
  return d;
}
function ensureContext(target){
  const body=target.querySelector(":scope > .review-question-body");
  if(!body || body.querySelector(".review-stimulus") || body.querySelector(".review-context-copy")) return;
  const part=Number(target.dataset.part||0);
  if(part!==6 && part!==7) return;
  const siblings=[...target.parentElement.querySelectorAll(":scope > .review-question-details")];
  const idx=siblings.indexOf(target);
  for(let i=idx-1;i>=0;i--){
    const stimuli=[...siblings[i].querySelectorAll(".review-stimulus")];
    if(!stimuli.length) continue;
    const wrap=document.createElement("div");
    wrap.className="review-context-copy";
    wrap.innerHTML='<div class="review-context-label">Ngữ cảnh / passage dùng chung</div>';
    stimuli.forEach(x=>wrap.appendChild(x.cloneNode(true)));
    body.prepend(wrap);
    return;
  }
}
function enhanceSection(section){
  if(section.hasAttribute(ENHANCED_ATTR)) return;
  const articles=[...section.querySelectorAll(".review-question")];
  if(!articles.length) return;
  section.setAttribute(ENHANCED_ATTR,"1");

  const items=articles.map(article=>({article,...parseMeta(article)})).filter(x=>x.part&&x.number);
  if(!items.length) return;
  const showAnswers=items.some(x=>x.state==="wrong"||x.state==="correct");
  const saved=readState();
  const validFilters=showAnswers?["all","wrong","unanswered","correct"]:["all","unanswered","answered"];
  let filter=validFilters.includes(saved.filter)?saved.filter:(showAnswers&&items.some(x=>x.state==="wrong")?"wrong":"all");

  const qEls=new Map();
  items.forEach(x=>qEls.set(x.number,createQuestionDetails(x.article,x)));
  const parts=[...new Set(items.map(x=>x.part))].sort((a,b)=>a-b);
  const partContainer=document.createElement("div");
  partContainer.className="review-parts";
  const partEls=new Map();
  for(const p of parts){
    const inPart=items.filter(x=>x.part===p);
    const els=inPart.map(x=>qEls.get(x.number));
    const partEl=makePart(p,inPart,els);
    partEls.set(p,partEl);
    partContainer.appendChild(partEl);
  }

  const total=items.length;
  const correct=items.filter(x=>x.state==="correct").length;
  const wrong=items.filter(x=>x.state==="wrong").length;
  const unanswered=items.filter(x=>x.state==="unanswered").length;
  const overview=document.createElement("div");
  overview.className="review-overview";
  overview.innerHTML=`
    <div><span>Tổng</span><b>${total}</b></div>
    ${showAnswers?`<div><span>Đúng</span><b>${correct}</b></div><div><span>Sai</span><b>${wrong}</b></div>`:""}
    <div><span>Chưa trả lời</span><b>${unanswered}</b></div>`;

  const tools=document.createElement("div");
  tools.className="review-sticky-tools";
  const filters=showAnswers
    ? [["all","Tất cả"],["wrong",`Sai (${wrong})`],["unanswered",`Chưa trả lời (${unanswered})`],["correct",`Đúng (${correct})`]]
    : [["all","Tất cả"],["unanswered",`Chưa trả lời (${unanswered})`],["answered",`Đã trả lời (${total-unanswered})`]];
  const jumpItems=showAnswers?items.filter(x=>x.state==="wrong"):items.filter(x=>x.state==="unanswered");
  tools.innerHTML=`
    <div class="review-tool-row">
      <div class="review-filters">${filters.map(([k,l])=>`<button type="button" class="secondary sm review-filter" data-filter="${k}">${l}</button>`).join("")}</div>
      <div class="review-open-actions"><button type="button" class="ghost sm" data-review-open-all>Mở tất cả</button><button type="button" class="ghost sm" data-review-close-all>Thu gọn</button></div>
    </div>
    <div class="review-jump-row">
      <b>${showAnswers?"Câu sai":"Chưa trả lời"}</b>
      <div class="review-jump-list">${jumpItems.length?jumpItems.map(x=>`<button type="button" class="review-jump-btn" data-jump="${x.number}">${x.number}</button>`).join(""):'<span class="muted small">Không có</span>'}</div>
    </div>`;

  const header=section.querySelector(":scope > .row") || section.firstElementChild;
  if(header?.nextSibling){
    section.insertBefore(overview,header.nextSibling);
    section.insertBefore(tools,overview.nextSibling);
    section.insertBefore(partContainer,tools.nextSibling);
  }else{
    section.append(overview,tools,partContainer);
  }

  const matches=(item,f)=>f==="all" || item.state===f || (f==="answered"&&item.state!=="unanswered");
  function persist(){
    writeState({
      filter,
      openParts:[...partEls].filter(([,el])=>el.open).map(([p])=>p),
      openQuestions:[...qEls].filter(([,el])=>el.open).map(([n])=>n)
    });
  }
  function applyFilter({openParts=true}={}){
    items.forEach(item=>{
      const el=qEls.get(item.number);
      el.hidden=!matches(item,filter);
    });
    for(const [p,partEl] of partEls){
      const visible=items.some(x=>x.part===p && matches(x,filter));
      partEl.hidden=!visible;
      if(visible && openParts && filter!=="all") partEl.open=true;
    }
    tools.querySelectorAll(".review-filter").forEach(b=>b.classList.toggle("active",b.dataset.filter===filter));
    writeState({filter});
  }
  function jumpTo(number,{smooth=true}={}){
    const target=qEls.get(Number(number));
    if(!target) return;
    const meta=items.find(x=>x.number===Number(number));
    if(meta && !matches(meta,filter)){
      filter="all";
      applyFilter({openParts:false});
    }
    const partEl=partEls.get(Number(target.dataset.part));
    if(partEl){partEl.hidden=false;partEl.open=true;}
    target.hidden=false;
    target.open=true;
    ensureContext(target);
    writeState({lastQuestion:Number(number)});
    requestAnimationFrame(()=>target.scrollIntoView({behavior:smooth?"smooth":"auto",block:"start"}));
  }

  tools.querySelectorAll(".review-filter").forEach(b=>b.addEventListener("click",()=>{
    filter=b.dataset.filter;
    applyFilter();
    persist();
  }));
  tools.querySelectorAll("[data-jump]").forEach(b=>b.addEventListener("click",()=>jumpTo(b.dataset.jump)));
  tools.querySelector("[data-review-open-all]")?.addEventListener("click",()=>{
    for(const el of partEls.values()) if(!el.hidden) el.open=true;
    for(const el of qEls.values()) if(!el.hidden){el.open=true;ensureContext(el);}
    persist();
  });
  tools.querySelector("[data-review-close-all]")?.addEventListener("click",()=>{
    for(const el of qEls.values()) el.open=false;
    for(const el of partEls.values()) el.open=false;
    persist();
  });

  const wrongNumbers=items.filter(x=>x.state==="wrong").map(x=>x.number);
  for(const [number,el] of qEls){
    const body=el.querySelector(":scope > .review-question-body");
    if(showAnswers && wrongNumbers.length){
      const prev=wrongNumbers.filter(n=>n<number).at(-1) ?? wrongNumbers.at(-1);
      const next=wrongNumbers.find(n=>n>number) ?? wrongNumbers[0];
      const nav=document.createElement("div");
      nav.className="review-wrong-nav";
      nav.innerHTML=`<button type="button" class="secondary sm" data-prev-wrong="${prev}">← Câu sai trước</button><button type="button" class="secondary sm" data-next-wrong="${next}">Câu sai sau →</button>`;
      body.appendChild(nav);
      nav.querySelector("[data-prev-wrong]").onclick=e=>jumpTo(e.currentTarget.dataset.prevWrong);
      nav.querySelector("[data-next-wrong]").onclick=e=>jumpTo(e.currentTarget.dataset.nextWrong);
    }
    el.addEventListener("toggle",()=>{
      if(el.open){ensureContext(el);writeState({lastQuestion:Number(number)});}
      persist();
    });
  }
  for(const el of partEls.values()) el.addEventListener("toggle",persist);

  // Khôi phục trạng thái đóng/mở nếu sinh viên quay lại trang kết quả.
  const savedOpenParts=new Set((saved.openParts||[]).map(Number));
  const savedOpenQuestions=new Set((saved.openQuestions||[]).map(Number));
  if(saved.openParts){
    for(const [p,el] of partEls) el.open=savedOpenParts.has(p);
  }else{
    for(const [p,el] of partEls){
      el.open=filter==="all" || items.some(x=>x.part===p&&matches(x,filter));
    }
  }
  if(saved.openQuestions){for(const [n,el] of qEls) el.open=savedOpenQuestions.has(n);}
  applyFilter({openParts:!saved.openParts});

  if(saved.lastQuestion && qEls.has(Number(saved.lastQuestion))){
    setTimeout(()=>jumpTo(Number(saved.lastQuestion),{smooth:false}),80);
  }
}
function enhance(){
  if(!location.hash.startsWith("#/result/")) return;
  document.querySelectorAll(`.result-list:not([${ENHANCED_ATTR}])`).forEach(enhanceSection);
}
function scheduleEnhance(){
  if(enhanceQueued) return;
  enhanceQueued=true;
  queueMicrotask(()=>{enhanceQueued=false;enhance();});
}

const view=document.querySelector("#view");
if(view){
  new MutationObserver(scheduleEnhance).observe(view,{childList:true,subtree:true});
}
window.addEventListener("hashchange",scheduleEnhance);
addEventListener("DOMContentLoaded",scheduleEnhance,{once:true});
scheduleEnhance();
