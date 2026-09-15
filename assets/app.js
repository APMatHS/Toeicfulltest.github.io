import { createExamApp } from "./app-exam.js?build=20260915-v118";
import { createExamCoordinator } from "./app-fulltest.js?build=20260915-v118";
import { openNewTestV118,testKindLabel } from "./modules/test-create-v118.js?build=20260915-v118";
const examApp=createExamApp({});
const {
  renderStudent,renderExam,renderStaffPreview,renderStaffPracticeResult,renderResult,
  saveAttemptUi,flushAnswerQueue,setSaveStatus
}=examApp;

const examCoordinator=createExamCoordinator({
  sb,modalRoot,signedUrlMap,toast,closeModal,showLoading,staffNav,readingApp:examApp,
  getSession:()=>session,getProfile:()=>profile,getView:()=>view
});

const antiCheat=createAntiCheatController({
  getExamState:()=>examCoordinator.getExamState(),
  onCountChange:count=>{
    examCoordinator.setViolationCount(count);
    const el=document.querySelector("#antiCheatStatus");
    if(el) el.textContent=`Vi phạm: ${count}/3 · rời khỏi phần làm bài tính ngay · quá 15 giây hoặc lần 3 sẽ tự nộp`;
  },
  onWarning:data=>toast(`Đã ghi nhận vi phạm ${data.violation_count}/3 vì rời khỏi phần làm bài. Quá 15 giây hoặc vi phạm lần thứ 3 sẽ tự động nộp bài.`,6000),
  onSubmitted:data=>{
    const id=examCoordinator.getExamState()?.attemptId;
    if(id){
      examCoordinator.resetExamState();
      antiCheat.reset();
    }
  }
});
examCoordinator.setAntiCheat(antiCheat);

function listeners(){
window.addEventListener("online",()=>{examCoordinator.setSaveStatus("Có mạng – đang đồng bộ…","pending");examCoordinator.flushAnswerQueue()});
window.addEventListener("offline",()=>examCoordinator.setSaveStatus("Mất mạng – đáp án sẽ lưu tạm","offline"));
if(!examCoordinator.getExamState() || examCoordinator.getExamState().preview) return;
examCoordinator.saveAttemptUi(); examCoordinator.flushAnswerQueue();
if(!examCoordinator.getExamState() || examCoordinator.getExamState().preview) return;
examCoordinator.saveAttemptUi(); examCoordinator.flushAnswerQueue();
if(!examCoordinator.getExamState() || examCoordinator.getExamState().preview) return;
examCoordinator.saveAttemptUi();
}
function handleRouteChange(){
  const state=examCoordinator.getExamState();
  examCoordinator.saveAttemptUi();
  examCoordinator.flushAnswerQueue();
}
function renderHeader(){
 const activeExam=examCoordinator.getExamState();
 examCoordinator.saveAttemptUi();
 examCoordinator.flushAnswerQueue();
}
async function render(){
 examCoordinator.stopTimer();
 const p=route();
 if(p.startsWith("/exam/")){
   return examCoordinator.renderExam(p.split("/")[2]);
 }
}
function renderTeacher(){ const x=`Tạo Listening, Reading hoặc Full Test; cấu trúc Listening tách riêng khỏi Reading.`; }
function renderSettings(t){ return `<div><div class="muted">Loại bài</div><b>${esc(testKindLabel(t.test_kind||"reading"))}</b></div><div><div class="muted">Lớp liên kết</div><b>${esc(t.class_id?"Đã gán lớp":"Chưa gán")}</b></div>`; }
function openEditTest(t){ return `<label class="span-2">Tên bài<input name="title" value="${esc(t.title||"")}" required></label><label>Loại bài<input value="${esc(testKindLabel(t.test_kind||"reading"))}" disabled></label>`; }
function showPreflight(check={}){ return `<div>${check.structure_complete?"✅":"❌"} ${esc(check.structure_label||"Cấu trúc đề")}${check.structure_standard?" · chuẩn TOEIC":" · chưa đúng số câu chuẩn"}</div>`; }
async function openNewTest(){
  return openNewTestV118({
    sb,modalRoot,esc,closeModal,toast,go,
    onCreated:async()=>{
      invalidateStaffData("tests");invalidateStaffPage("tests");invalidateStaffPage("teacher");
    }
  });
}



function testTabs(testId,active){ return ''; }
function openQuestionEditor(testId, partId, partNo, allGroups, existing=null, draft=null, allQuestions=[],duplicate=false){
  const groups=[];
  const choices={};
  const defaultStart=({1:1,2:7,3:32,4:71,5:101,6:131,7:147})[partNo]||1;
  const nextNumber=1;
  const sourceNumber=1;
  const sourceOrder=1;
  const draftFields=draft?.fields||{};
  const choiceKeys=partNo===2?["A","B","C"]:["A","B","C","D"];
  const a=`${choiceKeys.map(k=>`<div>${k}</div>`).join("")}`;
  const b=`${choiceKeys.map(k=>`<option>${k}</option>`).join("")}`;
  const choiceRows=choiceKeys.map(k=>({key:k}));
  return [a,b,choiceRows];
}


boot();
