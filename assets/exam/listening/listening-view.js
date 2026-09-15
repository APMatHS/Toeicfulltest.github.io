import { esc } from "../../modules/utils.js";
import { questionAudioUnit } from "./audio-session.js";

function stableHash(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}

export function orderedListeningChoices(question,attemptId){
  const choices=(question.choices||[]).map(c=>({...c,originalKey:c.key}));
  if(!question.shuffle_choices)return choices.map(c=>({...c,displayKey:c.key}));
  const labels=["A","B","C","D"];return choices.slice().sort((a,b)=>stableHash(`${attemptId}:${question.id}:${a.key}`)-stableHash(`${attemptId}:${question.id}:${b.key}`)).map((c,i)=>({...c,displayKey:labels[i]||c.key}));
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
  return orderedListeningChoices(q,state.attemptId).map(c=>`<label class="listening-choice ${q.selected===c.originalKey?"selected":""}"><input type="radio" name="answer" value="${esc(c.originalKey)}" ${q.selected===c.originalKey?"checked":""}><span class="choice-key">${esc(c.displayKey)}</span><span>${hideContent?'<span class="muted">Chọn đáp án</span>':`${c.content?media.renderRichText(c.content):""}${c.url?`<img loading="lazy" decoding="async" src="${esc(c.url)}" alt="Đáp án ${esc(c.displayKey)}">`:""}`}</span></label>`).join("");
}

export function renderListeningView(state,{audio,media}){
  const q=state.payload.questions[state.current];if(!q)return '<section class="card">Không có câu Listening.</section>';
  const unit=questionAudioUnit(q),audioState=unit?audio.stateFor(unit.key):null,playing=audio.isPlaying(),parts=partGroups(state.payload.questions),answered=state.payload.questions.filter(x=>x.selected).length;
  return `<section class="listening-shell">
    <div class="card listening-head"><div><div class="eyebrow">${state.preview?"LISTENING · LÀM THỬ":"LISTENING"}</div><h2>${esc(state.payload.attempt.test_title||"TOEIC Listening")}</h2></div><div class="listening-head-meta"><b id="listeningTimer">--:--</b><span id="listeningSaveStatus" data-kind="saved">${esc(state.saveStatus||"Đã lưu")}</span><span id="antiCheatStatus">${esc(antiCheatText(state))}</span></div></div>
    <div class="listening-layout"><main class="card listening-main"><div class="row between wrap"><span class="badge">Part ${q.part}</span><b>Câu ${q.number}</b></div>${renderQuestionMedia(q,media)}
    ${unit?`<div class="listening-audio-box"><div><b>Audio</b><div class="muted small">${audioState?.completed_at==="pending_sync"?"Đã phát xong · chờ đồng bộ":audioState?.completed_at?"Đã phát xong · không nghe lại":state.activeAudio?.unitKey===unit.key?"Đang phát · không pause/tua":audioState?.started_at?"Có trạng thái nghe dở đã lưu":"Chưa phát"}</div></div><progress id="listeningAudioProgress" max="1" value="${audioState?.completed_at?1:0}"></progress><button class="primary" id="playListeningAudio" ${playing||audioState?.completed_at?"disabled":""}>${audioState?.completed_at?"Đã phát":audioState?.started_at?"Tiếp tục audio":"Bắt đầu audio"}</button></div>`:'<div class="warning-box">Câu/nhóm này chưa có audio. Giảng viên cần bổ sung trước khi Publish.</div>'}
    <div class="listening-choices">${renderChoices(q,state,media)}</div><div class="row between wrap listening-nav"><button class="secondary" id="prevListening" ${state.current===0?"disabled":""}>← Câu trước</button><label class="check-row"><input id="markListening" type="checkbox" ${q.marked?"checked":""}> Đánh dấu xem lại</label><button class="primary" id="nextListening">${state.current===state.payload.questions.length-1?"Hoàn thành Listening":"Câu tiếp →"}</button></div></main>
    <aside class="card listening-palette"><div class="row between"><h3>Câu hỏi</h3><span class="muted">${answered}/${state.payload.questions.length}</span></div>${parts.map(([p,qs])=>`<div class="listening-palette-part"><b>Part ${p}</b><div>${qs.map(x=>{const idx=state.payload.questions.indexOf(x);return `<button class="${idx===state.current?"active":""} ${x.selected?"answered":""} ${x.marked?"marked":""}" data-idx="${idx}">${x.number}</button>`;}).join("")}</div></div>`).join("")}</aside></div>
    <div class="row end"><button class="${state.preview||state.mode==="full"?"primary":"danger"}" id="submitListening">${state.mode==="full"?"Hoàn thành Listening → Reading":state.preview?"Kết thúc làm thử":"Nộp bài"}</button></div></section>`;
}
