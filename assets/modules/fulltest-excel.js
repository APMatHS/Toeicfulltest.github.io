import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY } from "../config.js";
import { loadXlsx } from "../services/xlsx-service.js";
import { scoreOutOfTen } from "./score-utils.js";

function toast(message,ms=3600){
  const el=document.querySelector("#toast");
  if(!el)return;
  el.textContent=message;el.hidden=false;clearTimeout(el._t);el._t=setTimeout(()=>el.hidden=true,ms);
}

function currentTestId(){
  return location.hash.match(/^#\/test\/([^/]+)/)?.[1]||null;
}

const exportClient=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);

async function fetchExport(testId){
  const {data,error}=await exportClient.rpc("staff_get_test_export",{p_test_id:testId});
  if(error)throw error;
  return data;
}

function sectionStats(answers=[]){
  const calc=(minPart,maxPart)=>{
    const rows=answers.filter(a=>Number(a.part)>=minPart&&Number(a.part)<=maxPart);
    return {total:rows.length,correct:rows.filter(a=>a.is_correct===true).length};
  };
  return {listening:calc(1,4),reading:calc(5,7)};
}

async function exportEnhanced(testId){
  toast("Đang tạo Excel…");
  let XLSX;
  try{XLSX=await loadXlsx();}catch(err){console.error(err);toast("Không tải được thư viện Excel. Hãy kiểm tra mạng và thử lại.",6000);return;}
  let data;
  try{data=await fetchExport(testId);}catch(err){console.error(err);toast(err.message||"Không tạo được Excel.",6000);return;}
  const students=data.students||[],testKind=data.test?.test_kind||"reading";
  const summary=students.map((s,i)=>{
    const answers=s.answers||[],total=answers.length,stats=sectionStats(answers);
    const base={STT:i+1,"Họ tên":s.full_name,MSSV:s.student_code||"","Lần làm":s.attempt_no||"","Trạng thái":s.status||"Chưa làm","Bắt đầu":s.started_at?new Date(s.started_at).toLocaleString("vi-VN"):"","Nộp bài":s.submitted_at?new Date(s.submitted_at).toLocaleString("vi-VN"):""};
    if(testKind==="full")return {...base,"Listening đúng":stats.listening.correct,"Listening tổng":stats.listening.total,"Listening /10":stats.listening.total?scoreOutOfTen(stats.listening.correct,stats.listening.total):"","Reading đúng":stats.reading.correct,"Reading tổng":stats.reading.total,"Reading /10":stats.reading.total?scoreOutOfTen(stats.reading.correct,stats.reading.total):"","Tổng đúng":s.correct_count??"","Tổng câu":total,"Tổng /10":s.correct_count==null?"":scoreOutOfTen(s.correct_count,total||100),"Vi phạm":s.violation_count||0,"Lý do nộp":s.submission_reason||""};
    return {...base,"Số câu đúng":s.correct_count??"","Điểm /10":s.correct_count==null?"":scoreOutOfTen(s.correct_count,total||100),"Vi phạm":s.violation_count||0,"Lý do nộp":s.submission_reason||""};
  });
  const detail=[];
  for(const s of students)for(const a of s.answers||[]){
    const part=Number(a.part)||"",section=part>=1&&part<=4?"Listening":part>=5&&part<=7?"Reading":"";
    detail.push({"Họ tên":s.full_name,MSSV:s.student_code||"","Lần làm":s.attempt_no||"",Part:part,Section:section,"Câu":a.number,"Đã chọn":a.selected||"","Đáp án":a.correct||"","Đúng/Sai":a.selected?(a.is_correct?"Đúng":"Sai"):"Chưa trả lời"});
  }
  const violations=[];
  for(const s of students)for(const v of s.violations||[])violations.push({"Họ tên":s.full_name,MSSV:s.student_code||"","Lần làm":s.attempt_no||"","Sự kiện":v.event_type,"Lần":v.violation_number,"Thời điểm":new Date(v.occurred_at).toLocaleString("vi-VN")});
  const roster=(data.roster||[]).map((r,i)=>({STT:i+1,"Họ tên":r.full_name,MSSV:r.student_code||"",Email:r.email||"","Trạng thái":r.is_active?"Hoạt động":"Khóa"}));
  const resetHistory=(data.reset_history||[]).map(r=>({"Họ tên":r.full_name,MSSV:r.student_code||"","Lần làm":r.attempt_no||"","Trạng thái":r.status,"Bắt đầu":r.started_at?new Date(r.started_at).toLocaleString("vi-VN"):"","Kết thúc":r.submitted_at?new Date(r.submitted_at).toLocaleString("vi-VN"):"","Lý do":r.submission_reason||""}));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(summary),"Tong_hop");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(detail),"Chi_tiet");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(violations),"Vi_pham");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(roster),"Danh_sach_lop");
  if(resetHistory.length)XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(resetHistory),"Lich_su_reset");
  const safe=(data.test?.title||"ket-qua").replace(/[\\/:*?"<>|]+/g,"-");
  XLSX.writeFile(wb,`${safe}.xlsx`);
  toast("Đã tạo file Excel");
}

document.addEventListener("click",event=>{
  const button=event.target.closest?.("#liveExcel,#subExcel");
  if(!button)return;
  const testId=currentTestId();
  if(!testId)return;
  event.preventDefault();event.stopImmediatePropagation();
  exportEnhanced(testId);
},true);
