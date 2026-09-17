import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY } from "../config.js";
import { esc } from "./utils.js";

const sb=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
let mammothPromise=null,xlsxPromise=null;
const loadMammoth=()=>mammothPromise||(mammothPromise=import("https://cdn.jsdelivr.net/npm/mammoth@1.8.0/+esm"));
const loadXlsx=()=>xlsxPromise||(xlsxPromise=import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm"));
const clean=s=>String(s??"").replace(/\u00a0/g," ").replace(/\s+/g," ").trim();
const rich=s=>esc(clean(s));

function inferPart(number,currentPart){
  if(currentPart>=1&&currentPart<=7)return currentPart;
  if(number<=6)return 1;if(number<=31)return 2;if(number<=70)return 3;if(number<=100)return 4;
  if(number<=130)return 5;if(number<=146)return 6;return 7;
}

function parseQuestionText(text){
  const lines=String(text||"").split(/\r?\n/).map(clean).filter(Boolean);
  const out=[];let part=0,q=null,lastChoice=null;
  const push=()=>{if(q){q.content=clean(q.content);q.choices=Object.fromEntries(Object.entries(q.choices).map(([k,v])=>[k,clean(v)]));out.push(q);}q=null;lastChoice=null;};
  for(const line of lines){
    const pm=line.match(/^PART\s*([1-7])\b/i);if(pm){push();part=+pm[1];continue;}
    const qm=line.match(/^(\d{1,3})\s*[.)]\s*(.*)$/);if(qm){push();const number=+qm[1];q={number,part:inferPart(number,part),content:qm[2]||"",choices:{}};continue;}
    if(!q)continue;
    if(/^This is the end\b/i.test(line))continue;
    const cm=line.match(/^\(?([A-D])\)?\s*[.)]?\s+(.+)$/i);
    if(cm){lastChoice=cm[1].toUpperCase();q.choices[lastChoice]=cm[2];continue;}
    if(lastChoice)q.choices[lastChoice]+=` ${line}`;else q.content+=`${q.content?" ":""}${line}`;
  }
  push();
  return out.filter(x=>Number.isInteger(x.number)&&x.number>0);
}

async function readDocx(file){
  const mammoth=await loadMammoth(),buf=await file.arrayBuffer();
  const result=await mammoth.extractRawText({arrayBuffer:buf});
  return parseQuestionText(result.value||"");
}

async function readAnswers(file){
  const XLSX=await loadXlsx(),buf=await file.arrayBuffer(),wb=XLSX.read(buf,{type:"array"}),map={};
  for(const name of wb.SheetNames){
    const rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:""});
    for(const row of rows){
      for(let i=0;i<row.length;i++){
        const n=Number(String(row[i]).trim());if(!Number.isInteger(n)||n<1||n>999)continue;
        for(let j=i+1;j<Math.min(row.length,i+4);j++){
          const a=clean(row[j]).toUpperCase();if(/^[A-D]$/.test(a)){map[n]=a;break;}
        }
      }
    }
  }
  return map;
}

function assess(q,answer){
  const issues=[],keys=Object.keys(q.choices||{}),expected=q.part===2?3:4;
  if(!q.content)issues.push("Thiếu nội dung câu");
  if(q.part>=3&&keys.length!==expected)issues.push(`Nhận ${keys.length}/${expected} lựa chọn`);
  if(q.part<=2&&keys.length===0)issues.push("Chưa có nội dung lựa chọn");
  if(!answer)issues.push("Thiếu đáp án");
  if(/\blook at the (graphic|picture|image|map|chart|schedule|form|table)\b/i.test(q.content))issues.push("Cần bổ sung hình");
  return issues;
}

function modalHtml(rows,existing){
  const ok=rows.filter(r=>!r.issues.length&&!existing.has(r.number)).length,review=rows.filter(r=>r.issues.length&&!existing.has(r.number)).length,skip=rows.filter(r=>existing.has(r.number)).length;
  return `<div class="modal-backdrop"><div class="modal wide import-file-modal"><div class="row between wrap"><div><h2>Nhập đề từ file</h2><p class="muted">Chỉ nhập phần chữ và đáp án. Câu chưa hoàn chỉnh vẫn được lưu và đánh dấu để giảng viên sửa sau.</p></div><button class="ghost sm" data-close>Đóng</button></div>
    <div class="import-summary"><span class="status ok">${ok} câu OK</span><span class="status warn">${review} cần kiểm tra</span>${skip?`<span class="badge">${skip} câu đã có — bỏ qua</span>`:""}</div>
    <div class="import-preview-list">${rows.map(r=>`<div class="import-preview-row ${r.issues.length?"issue":""}"><div><b>Câu ${r.number}</b> · Part ${r.part}${existing.has(r.number)?' <span class="badge">Đã có</span>':""}<div class="small">${esc(r.content||"(không nhận được nội dung)")}</div><div class="muted small">${Object.entries(r.choices).map(([k,v])=>`${k}. ${v}`).join(" · ")||"Chưa nhận được lựa chọn"}</div></div><div><b>${esc(r.answer||"—")}</b>${r.issues.length?`<div class="import-issues">${r.issues.map(x=>`<span class="status warn">${esc(x)}</span>`).join("")}</div>`:'<span class="status ok">OK</span>'}</div></div>`).join("")}</div>
    <div class="row between wrap"><span class="muted small">Câu đã tồn tại trong đề sẽ không bị ghi đè.</span><button class="primary" id="doFileImport">Lưu ${rows.length-skip} câu nhận diện được</button></div><div id="fileImportProgress" class="muted small"></div></div></div>`;
}

export function bindFileImporter(root=document){
  const btn=root.querySelector("#importQuestionsFromFile");if(!btn||btn.dataset.bound)return;btn.dataset.bound="1";
  btn.addEventListener("click",()=>{
    const testId=root.querySelector(".authoring")?.dataset.testId;
    const partMap=Object.fromEntries([...root.querySelectorAll(".add-question[data-part][data-partno]")].map(x=>[Number(x.dataset.partno),x.dataset.part]));
    const existing=new Set([...root.querySelectorAll(".author-question[data-number]")].map(x=>Number(x.dataset.number)));
    const host=document.querySelector("#modalRoot");if(!testId||!host)return;
    host.innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="row between"><div><h2>Nhập từ file</h2><p class="muted">Tải file đề Word và file đáp án Excel. Không đọc ảnh/audio ở bước này.</p></div><button class="ghost sm" data-close>Đóng</button></div><form id="fileImportForm" class="stack"><label>File đề Word (.docx)<input type="file" name="docx" accept=".docx" required></label><label>File đáp án Excel (.xlsx, .xls)<input type="file" name="xlsx" accept=".xlsx,.xls" required></label><div class="warning-box">Câu nhận diện chưa đủ vẫn được nhập và sẽ mang nhãn <b>Cần kiểm tra</b>. Câu đã có trong đề không bị ghi đè.</div><button class="primary">Đọc file và xem trước</button></form><div id="fileImportReadStatus" class="muted small"></div></div></div>`;
    host.querySelector("[data-close]").onclick=()=>host.innerHTML="";
    host.querySelector("#fileImportForm").onsubmit=async e=>{
      e.preventDefault();const form=e.currentTarget,submit=e.submitter,status=host.querySelector("#fileImportReadStatus"),docx=form.elements.docx.files?.[0],xlsx=form.elements.xlsx.files?.[0];
      submit.disabled=true;submit.textContent="Đang đọc file…";
      try{
        const [questions,answers]=await Promise.all([readDocx(docx),readAnswers(xlsx)]);
        if(!questions.length)throw new Error("Không nhận diện được câu hỏi nào trong file Word.");
        const seen=new Set(),rows=questions.filter(q=>{if(seen.has(q.number))return false;seen.add(q.number);return true;}).sort((a,b)=>a.number-b.number).map(q=>({...q,answer:answers[q.number]||null,issues:assess(q,answers[q.number])}));
        host.innerHTML=modalHtml(rows,existing);host.querySelector("[data-close]").onclick=()=>host.innerHTML="";
        host.querySelector("#doFileImport").onclick=async ev=>{
          const saveBtn=ev.currentTarget,progress=host.querySelector("#fileImportProgress"),todo=rows.filter(r=>!existing.has(r.number));saveBtn.disabled=true;let done=0,failed=[];
          for(const r of todo){
            const partId=partMap[r.part];if(!partId){failed.push(`Câu ${r.number}: đề chưa có Part ${r.part}`);continue;}
            const keys=r.part===2?["A","B","C"]:["A","B","C","D"],choices=keys.filter(k=>r.choices[k]!=null).map(k=>({key:k,content:rich(r.choices[k]),media_type:null,storage_path:null}));
            const payload={test_part_id:partId,source_number:r.number,source_order:r.number,stimulus_group_id:null,content:rich(r.content),media_type:null,storage_path:null,correct_choice_key:r.answer||null,score_weight:1,choices};
            const {error}=await sb.rpc("staff_upsert_question",{p_data:payload});if(error)failed.push(`Câu ${r.number}: ${error.message}`);else done++;
            progress.textContent=`Đã lưu ${done}/${todo.length} câu${failed.length?` · ${failed.length} lỗi`:""}…`;
          }
          if(failed.length){progress.innerHTML=`Đã lưu <b>${done}</b> câu. <b>${failed.length}</b> câu chưa lưu:<br>${failed.slice(0,12).map(esc).join("<br>")}${failed.length>12?"<br>…":""}`;saveBtn.disabled=false;saveBtn.textContent="Thử lưu phần còn lỗi";}
          else{progress.innerHTML=`✓ Đã lưu ${done} câu. Đang tải lại màn hình soạn đề…`;setTimeout(()=>location.reload(),700);}
        };
      }catch(err){status.textContent=`Không đọc được file: ${err.message||err}`;submit.disabled=false;submit.textContent="Đọc file và xem trước";}
    };
  });
}


function ensureImportButton(){
  const authoring=document.querySelector(".authoring");if(!authoring||document.querySelector("#importQuestionsFromFile")||!authoring.querySelector(".add-question"))return;
  const actions=authoring.querySelector(".authoring-top-actions");if(!actions)return;
  const btn=document.createElement("button");btn.type="button";btn.id="importQuestionsFromFile";btn.className="secondary sm";btn.textContent="↑ Nhập từ file";
  const ai=actions.querySelector(".ai-later");actions.insertBefore(btn,ai||null);bindFileImporter(document);
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",ensureImportButton);else ensureImportButton();
new MutationObserver(ensureImportButton).observe(document.body,{childList:true,subtree:true});
