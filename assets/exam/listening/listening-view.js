import { esc } from "../../modules/utils.js";

function stableHash(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}

export function orderedListeningChoices(question,attemptId){
  const choices=(question.choices||[]).map(c=>({...c,originalKey:c.key}));
  if(!question.shuffle_choices)return choices.map(c=>({...c,displayKey:c.key}));
  const labels=["A","B","C","D"];
  return choices.slice().sort((a,b)=>stableHash(`${attemptId}:${question.id}:${a.key}`)-stableHash(`${attemptId}:${question.id}:${b.key}`)).map((c,i)=>({...c,displayKey:labels[i]||c.key}));
}

function partGroups(questions){
  const out=[];for(const part of [1,2,3,4]){const qs=questions.filter(q=>Number(q.part)===part);if(qs.length)out.push([part,qs]);}return out;
}

function renderQuestionMedia(q,media){
  const blocks=[];
  for(const s of q.stimuli||[]){
    if(s.type==="image"&&s.url)blocks.push(`<img class="listening-image" loading="lazy" decoding="async" src="${esc(s.url)}" alt="Hình Listening">`);
    else if(s.type!=="audio"&&s.content)blocks.push(`<div class="rich-content">${media.renderRichText(s.content)}</div>`);
  }
  if(q.media_type==="image"&&q.url)blocks.push(`<img class="listening-image" loading="lazy" decoding="async" src="${esc(q.url)}" alt="Hình câu hỏi">`);
  if(Number(q.part)>2&&q.content)blocks.push(`<div class="rich-content listening-question-text">${media.renderRichText(q.content)}</div>`);
  return blocks.join("");
}

function antiCheatText(state){
  if(state.preview)return "Giảng viên làm thử · lưu lịch sử riêng";
  const attempt=state.payload.attempt||{},mode=attempt.anti_cheat_mode;
  if(mode==="off")return "Chống gian lận: Tắt";
  if(mode==="strict")return `Vi phạm: ${Number(attempt.violation_count||0)}/1 · rời phần làm bài sẽ tự nộp`;
  return `Vi phạm: ${Number(attempt.violation_count||0)}/3`;
}

function renderChoices(q,state,media){
  const hideContent=Number(q.part)<=2;
  return orderedListeningChoices(q,state.attemptId).map(c=>`<label class="choice listening-reading-choice ${q.selected===c.originalKey?"selected":""}"><input type="radio" name="answer" value="${esc(c.originalKey)}" ${q.selected===c.originalKey?"checked":""}><b>${esc(c.displayKey)}.</b><div class="choice-body">${c.url?`<img class="choice-media" loading="lazy" decoding="async" src="${esc(c.url)}" alt="Đáp án ${esc(c.displayKey)}">`:""}<div class="rich-content">${hideContent?"":(c.content?media.renderRichText(c.content):"")}</div></div></label>`).join("");
}

function renderMasterAudio(state,audio){
  const audioState=audio.stateFor(),playing=audio.isPlaying(),completed=audio.isCompleted(),hasFile=!!state.listeningAudio?.path;
  const status=audioState?.completed_at==="pending_sync"?"Đã phát xong · chờ đồng bộ":completed?"Đã phát xong · không nghe lại":playing?"Đang phát liên tục Part 1–4":audioState?.started_at?"Bị gián đoạn · có thể tiếp tục từ vị trí đã lưu":"Chưa phát";
  const buttonText=completed?"Đã phát xong":audioState?.started_at?"Tiếp tục sau gián đoạn":"Bắt đầu nghe";
  const pos=Number(state.activeAudio?.lastPosition??audioState?.last_position_seconds??0),duration=Number(state.listeningAudio?.durationSeconds||0),progress=completed?1:(duration>0?Math.min(1,pos/duration):0);
  return `<section class="card listening-master-audio"><div class="row between wrap"><div><div class="eyebrow">AUDIO LISTENING PART 1–4</div><h3>${esc(state.listeningAudio?.filename||"Audio chung Part 1–4")}</h3><div class="muted small">${hasFile?status:"Bài chưa có file audio chung."}</div></div><button class="primary" id="playListeningAudio" ${!hasFile||playing||completed?"disabled":""}>${esc(buttonText)}</button></div><progress id="listeningAudioProgress" max="1" value="${progress}"></progress><p class="muted small">Bấm một lần để nghe liên tục. Không pause, không tua, không nghe lại. Trong lúc audio chạy vẫn chuyển câu và chọn đáp án bình thường.</p></section>`;
}

export function renderListeningView(state,{audio,media}){
  const q=state.payload.questions[state.current];if(!q)return '<section class="card">Không có câu Listening.</section>';
  const parts=partGroups(state.payload.questions),answered=state.payload.questions.filter(x=>x.selected).length,completeReady=audio.isCompleted()&&!audio.hasPending();
  return `<section class="listening-shell">
    <div class="card listening-head"><div><div class="eyebrow">${state.preview?"LISTENING · LÀM THỬ":"LISTENING"}</div><h2>${esc(state.payload.attempt.test_title||"TOEIC Listening")}</h2></div><div class="listening-head-meta"><b id="listeningTimer">--:--</b><span id="listeningSaveStatus" data-kind="saved">${esc(state.saveStatus||"Đã lưu")}</span><span id="antiCheatStatus">${esc(antiCheatText(state))}</span></div></div>
    ${renderMasterAudio(state,audio)}
    <div class="listening-layout"><main class="card listening-main"><div class="row between wrap"><span class="badge">Part ${q.part}</span><span class="muted">Câu ${q.number} · ${state.current+1}/${state.payload.questions.length}</span></div>
    <div class="question listening-question"><div class="question-title"><b>${q.number}.</b><div class="listening-question-body">${renderQuestionMedia(q,media)}</div></div>
    <div class="listening-choices">${renderChoices(q,state,media)}</div></div><div class="row between wrap listening-nav"><button class="secondary" id="prevListening" ${state.current===0?"disabled":""}>← Câu trước</button><label class="check-row"><input id="markListening" type="checkbox" ${q.marked?"checked":""}> Đánh dấu xem lại</label><button class="primary" id="nextListening">${state.current===state.payload.questions.length-1?"Hoàn thành Listening":"Câu tiếp →"}</button></div></main>
    <aside class="card listening-palette"><div class="row between"><h3>Câu hỏi</h3><span class="muted">${answered}/${state.payload.questions.length}</span></div>${parts.map(([p,qs])=>`<div class="listening-palette-part"><b>Part ${p}</b><div>${qs.map(x=>{const idx=state.payload.questions.indexOf(x);return `<button class="${idx===state.current?"active":""} ${x.selected?"answered":""} ${x.marked?"marked":""}" data-idx="${idx}">${x.number}</button>`;}).join("")}</div></div>`).join("")}</aside></div>
    <div class="row end"><button class="${state.preview||state.mode==="full"?"primary":"danger"}" id="submitListening" ${completeReady?"":"disabled"}>${state.mode==="full"?"Hoàn thành Listening → Reading":state.preview?"Kết thúc làm thử":"Nộp bài"}</button></div>${completeReady?"":'<p class="muted small listening-complete-hint">Nút hoàn thành sẽ mở sau khi file audio chung phát hết và trạng thái đã đồng bộ.</p>'}</section>`;
}

export function bindListeningView(state,handlers){
  document.querySelectorAll(".listening-palette button[data-idx]").forEach(b=>b.onclick=()=>handlers.showQuestion(Number(b.dataset.idx)));
  document.querySelector("#prevListening").onclick=()=>handlers.showQuestion(state.current-1);
  document.querySelector("#nextListening").onclick=()=>handlers.showQuestion(state.current+1);
  document.querySelectorAll('input[name="answer"]').forEach(r=>r.onchange=()=>handlers.saveAnswer(r.value));
  document.querySelector("#markListening").onchange=e=>handlers.saveMark(e.target.checked);
  document.querySelector("#submitListening").onclick=handlers.submit;
  const play=document.querySelector("#playListeningAudio");if(play)play.onclick=handlers.playAudio;
}
