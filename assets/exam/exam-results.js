import { esc,fmt,go,statusBadge } from "../modules/utils.js";
import { formatScore10 } from "../modules/score-utils.js";
import { orderedListeningChoices } from "./listening/listening-view.js";

export function createExamResults({sb,toast,showLoading,staffNav,getView,getAntiCheat,media,clearForResult}){
  function displayedKey(question,originalKey,attemptId){
    if(!originalKey)return "—";const item=orderedListeningChoices(question,attemptId).find(c=>c.originalKey===originalKey);return item?.displayKey||originalKey;
  }

  function localSectionScores(questions){
    const build=(minPart,maxPart)=>{
      const section=questions.filter(q=>{const p=Number(q.part);return p>=minPart&&p<=maxPart;});
      const correct=section.filter(q=>q.is_correct===true||(q.correct_choice_key&&q.selected===q.correct_choice_key)).length;
      return {correct_count:correct,total_questions:section.length};
    };
    const listening=build(1,4),reading=build(5,7);
    if(!listening.total_questions&&!reading.total_questions)return null;
    return {test_kind:listening.total_questions&&reading.total_questions?"full":listening.total_questions?"listening":"reading",listening,reading};
  }

  function renderSectionScores(stats,totalCorrect,totalQuestions){
    if(!stats)return "";
    const listening=stats.listening||{},reading=stats.reading||{};
    const isFull=stats.test_kind==="full"||(Number(listening.total_questions)>0&&Number(reading.total_questions)>0);
    if(!isFull)return "";
    const item=(label,correct,total)=>`<div><span>${label}</span><b>${Number(correct||0)}/${Number(total||0)}</b><span>${formatScore10(correct,total)}</span></div>`;
    return `<div class="review-overview section-score-overview">${item("Listening · Part 1–4",listening.correct_count,listening.total_questions)}${item("Reading · Part 5–7",reading.correct_count,reading.total_questions)}${item("Tổng",totalCorrect,totalQuestions)}</div>`;
  }

  async function loadSectionScores(attemptId,questions,showAnswers){
    const hasListening=questions.some(q=>{const p=Number(q.part);return p>=1&&p<=4;});
    const hasReading=questions.some(q=>{const p=Number(q.part);return p>=5&&p<=7;});
    if(!hasListening||!hasReading)return null;
    try{
      const {data,error}=await sb.rpc("get_attempt_section_scores_v119",{p_attempt_id:attemptId});
      if(!error&&data)return data;
    }catch{}
    return showAnswers?localSectionScores(questions):null;
  }

  function renderStoredPracticeResult(testId,attemptId,questions,attempt={}){
    clearForResult();
    const view=getView(),correct=attempt.correct_count??questions.filter(q=>q.selected&&q.selected===q.correct_choice_key).length,answered=questions.filter(q=>q.selected).length;
    const practiceSections=localSectionScores(questions),sectionScores=renderSectionScores(practiceSections,correct,questions.length);
    view.innerHTML=`<section class="card"><span class="eyebrow">Kết quả làm thử</span><h1>${correct}/${questions.length} câu đúng</h1><p class="muted">Đã trả lời ${answered}/${questions.length} câu. Lượt này đã lưu trong lịch sử làm thử riêng của giảng viên.</p>${sectionScores}<div class="row wrap"><button class="primary" id="retryPreview">Làm lượt mới</button><a class="btn secondary" href="#/test/${testId}/practice">← Về lịch sử làm thử</a></div></section><section class="card result-list"><h2>Đối chiếu đáp án</h2>${questions.map(q=>`<div class="result-row"><b>Câu ${q.number}</b> · Đã chọn: <b>${esc(displayedKey(q,q.selected,attemptId))}</b> · Đáp án: <b>${esc(displayedKey(q,q.correct_choice_key,attemptId))}</b> · <span class="${q.selected===q.correct_choice_key?"correct":"wrong"}">${q.selected===q.correct_choice_key?"Đúng":"Sai"}</span></div>`).join("")}</section>`;
    document.querySelector("#retryPreview")?.addEventListener("click",()=>go(`/preview/${testId}`));
  }

  function renderAttemptReview(questions,showAnswers,attemptId){
    let previousGroup=null;
    return questions.map(q=>{
      const showStimuli=!!q.stimulus_group_id&&q.stimulus_group_id!==previousGroup;if(q.stimulus_group_id)previousGroup=q.stimulus_group_id;else previousGroup=null;
      const selected=q.selected||null,correct=showAnswers?q.correct:null,ordered=orderedListeningChoices(q,attemptId),selectedDisplay=displayedKey(q,selected,attemptId),correctDisplay=displayedKey(q,correct,attemptId),stateText=!selected?"Chưa trả lời":showAnswers?(q.is_correct?"Đúng":"Sai"):`Đã chọn ${selectedDisplay}`,stateClass=!selected?"unanswered":showAnswers?(q.is_correct?"correct":"wrong"):"selected-only";
      const choices=ordered.map(c=>{const isSelected=selected===c.originalKey,isCorrect=showAnswers&&correct===c.originalKey,cls=["review-choice",isSelected?"selected":"",isCorrect?"correct-choice":"",showAnswers&&isSelected&&!isCorrect?"wrong-choice":""].filter(Boolean).join(" "),tag=isCorrect?'<span class="review-choice-tag correct">Đáp án đúng</span>':isSelected?'<span class="review-choice-tag">Bạn chọn</span>':"";return `<div class="${cls}"><div class="review-choice-key"><b>${esc(c.displayKey)}.</b></div><div class="choice-body">${media.renderMedia(c.media_type,c.url,null,"choice-media")}<div class="rich-content">${media.renderRichText(c.content||"")}</div></div>${tag}</div>`;}).join("");
      return `<article class="review-question">${showStimuli?(q.stimuli||[]).map(st=>`<div class="stimulus review-stimulus">${media.renderMedia(st.type,st.url,st.content)}</div>`).join(""):""}<div class="review-question-head"><div><b>Part ${q.part}</b> · Câu ${q.number}</div><span class="review-state ${stateClass}">${esc(stateText)}</span></div>${media.renderMedia(q.media_type,q.url,null)}<div class="question-title"><b>${q.number}.</b><div class="rich-content">${media.renderRichText(q.content||"")}</div></div><div class="review-choices">${choices}</div><div class="review-summary">Bạn chọn: <b>${esc(selectedDisplay)}</b>${showAnswers?` · Đáp án đúng: <b>${esc(correctDisplay)}</b>`:' · <span class="muted">Đáp án đúng chưa được công bố</span>'}</div></article>`;
    }).join("");
  }

  async function renderResult(attemptId,staffView=false){
    showLoading("Đang tải kết quả...");const view=getView(),{data,error}=await sb.rpc("get_attempt_result",{p_attempt_id:attemptId});
    if(error){if(error.message.includes("not submitted")){setTimeout(()=>renderResult(attemptId,staffView),1200);return view.innerHTML='<div class="card">Đang chốt bài...</div>';}return view.innerHTML=`<div class="card">${esc(error.message)}</div>`;}
    clearForResult();getAntiCheat()?.reset();try{if(document.fullscreenElement)await document.exitFullscreen();}catch{}media.clear();
    const ans=data.answers||[],questions=data.questions||[];if(questions.length)await media.hydrateMedia(questions,{batchSize:8});
    const total=data.total_questions||questions.length||ans.length||100,pct=total?Math.round((Number(data.correct_count||0)/total)*1000)/10:0,showAnswers=staffView||!!data.show_answers;
    const sectionStats=await loadSectionScores(attemptId,questions,showAnswers),sectionScores=renderSectionScores(sectionStats,data.correct_count,total);
    const autoReason=data.submission_reason==="anti_cheat"?'<div class="warning-box result-warning"><b>Bài được hệ thống tự động nộp do chống gian lận.</b></div>':data.submission_reason==="timeout"?'<div class="warning-box result-warning"><b>Bài được hệ thống tự động nộp vì hết thời gian.</b></div>':"";
    const review=questions.length?renderAttemptReview(questions,showAnswers,attemptId):ans.length?ans.map(x=>`<div class="result-row"><b>Câu ${x.number}</b> · Bạn chọn: <b>${esc(x.selected||"—")}</b>${showAnswers?` · Đáp án: <b>${esc(x.correct||"—")}</b> · <span class="${x.is_correct?"correct":"wrong"}">${x.is_correct?"Đúng":"Sai"}</span>`:""}</div>`).join(""):'<div class="empty">Chưa có dữ liệu xem lại bài làm. Hãy áp dụng migration Supabase V1.10.</div>';
    view.innerHTML=`${staffView?staffNav("tests"):""}<section class="card"><span class="eyebrow">Kết quả${data.attempt_no?` · Lượt ${data.attempt_no}`:""}</span><h1>Hoàn thành bài thi</h1><div class="row score-row"><div><div class="big-score">${formatScore10(data.correct_count,total)}</div><div class="muted">${data.correct_count}/${total} câu đúng · ${pct}%</div></div><div>${statusBadge(data.status)}</div></div>${sectionScores}<p class="muted">Nộp lúc ${fmt(data.submitted_at)}${data.violation_count!=null?` · Vi phạm: ${data.violation_count}/3`:""}</p>${autoReason}${staffView?'<button class="btn primary" id="backFromResult">← Quay lại bài kiểm tra</button>':'<a class="btn primary" href="#/student">Về danh sách bài</a>'}</section><section class="card result-list"><div class="row between wrap"><div><h2>Xem lại bài làm</h2><p class="muted">${showAnswers?"Đáp án đúng được hiển thị theo cài đặt của bài kiểm tra.":"Bạn được xem lại câu hỏi và phương án đã chọn; đáp án đúng chưa được công bố."}</p></div></div>${review}</section>`;
    document.querySelector("#backFromResult")?.addEventListener("click",()=>history.back());
  }
  return {renderStoredPracticeResult,renderResult};
}
