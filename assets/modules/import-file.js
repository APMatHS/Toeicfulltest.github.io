import { esc } from "./utils.js";

let mammothPromise=null,xlsxPromise=null;

function loadScriptOnce(src,globalName){
  const existing=window[globalName];
  if(existing)return Promise.resolve(existing);
  return new Promise((resolve,reject)=>{
    const old=[...document.scripts].find(x=>x.src===src);
    const finish=()=>{
      const api=window[globalName];
      if(api)resolve(api);else reject(new Error(`Đã tải ${globalName} nhưng không khởi tạo được thư viện.`));
    };
    if(old){
      if(window[globalName])return resolve(window[globalName]);
      old.addEventListener("load",finish,{once:true});
      old.addEventListener("error",()=>reject(new Error(`Không tải được ${globalName}.`)),{once:true});
      return;
    }
    const script=document.createElement("script");
    script.src=src;script.async=true;
    script.onload=finish;
    script.onerror=()=>reject(new Error(`Không tải được ${globalName}. Kiểm tra kết nối mạng/CDN.`));
    document.head.appendChild(script);
  });
}
const loadMammoth=()=>mammothPromise||(mammothPromise=loadScriptOnce("https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js","mammoth"));
const loadXlsx=()=>xlsxPromise||(xlsxPromise=loadScriptOnce("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js","XLSX"));
const clean=s=>String(s??"").replace(/\u00a0/g," ").replace(/\s+/g," ").trim();
const safe=s=>esc(clean(s));

function inferPart(number,currentPart){
  if(currentPart>=1&&currentPart<=7)return currentPart;
  if(number<=6)return 1;if(number<=31)return 2;if(number<=70)return 3;if(number<=100)return 4;
  if(number<=130)return 5;if(number<=146)return 6;return 7;
}

function parseQuestionText(text){
  const lines=String(text||"").split(/\r?\n/).map(clean).filter(Boolean);
  const out=[],directions={};let part=0,q=null,lastChoice=null,preamble=[];
  const flushPreamble=()=>{
    if(part&&preamble.length&&!directions[part])directions[part]=clean(preamble.join(" "));
    preamble=[];
  };
  const push=()=>{
    if(q){
      q.content=clean(q.content);
      q.choices=Object.fromEntries(Object.entries(q.choices).map(([k,v])=>[k,clean(v)]));
      out.push(q);
    }
    q=null;lastChoice=null;
  };
  for(const line of lines){
    const pm=line.match(/^PART\s*([1-7])\b/i);
    if(pm){push();flushPreamble();part=+pm[1];continue;}
    const qm=line.match(/^(\d{1,3})\s*[.)]\s*(.*)$/);
    if(qm){
      push();flushPreamble();
      const number=+qm[1];
      q={number,part:inferPart(number,part),content:qm[2]||"",choices:{}};
      continue;
    }
    if(!q){
      if(part&&!/^This is the end\b/i.test(line))preamble.push(line);
      continue;
    }
    if(/^This is the end\b/i.test(line))continue;
    const cm=line.match(/^\(?([A-D])\)?\s*[.)]?\s+(.+)$/i);
    if(cm){lastChoice=cm[1].toUpperCase();q.choices[lastChoice]=cm[2];continue;}
    if(lastChoice)q.choices[lastChoice]+=` ${line}`;else q.content+=`${q.content?" ":""}${line}`;
  }
  push();flushPreamble();
  return {questions:out.filter(x=>Number.isInteger(x.number)&&x.number>0),directions};
}

async function readDocx(file){
  if(!file||!/\.docx$/i.test(file.name))throw new Error("File đề phải là .docx.");
  const mammoth=await loadMammoth();
  if(typeof mammoth?.extractRawText!=="function")throw new Error("Không tải được thư viện đọc Word.");
  const buf=await file.arrayBuffer(),result=await mammoth.extractRawText({arrayBuffer:buf});
  return parseQuestionText(result?.value||"");
}

async function readAnswers(file){
  if(!file||!/\.(xlsx|xls)$/i.test(file.name))throw new Error("File đáp án phải là .xlsx hoặc .xls.");
  const XLSX=await loadXlsx(),buf=await file.arrayBuffer(),wb=XLSX.read(buf,{type:"array"}),map={};
  for(const name of wb.SheetNames){
    const rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:""});
    for(const row of rows){
      for(let i=0;i<row.length;i++){
        const n=Number(String(row[i]).trim());if(!Number.isInteger(n)||n<1||n>999)continue;
        for(let j=i+1;j<Math.min(row.length,i+4);j++){const a=clean(row[j]).toUpperCase();if(/^[A-D]$/.test(a)){map[n]=a;break;}}
      }
    }
  }
  return map;
}

function assess(q,answer){
  const issues=[],keys=Object.keys(q.choices||{}),expected=q.part===2?3:4;
  // TOEIC Part 1–2: statements/responses nằm trong audio, nên không bắt buộc text choices.
  if(q.part>=3&&!q.content)issues.push("Thiếu nội dung câu");
  if(q.part>=3&&keys.length!==expected)issues.push(`Nhận ${keys.length}/${expected} lựa chọn`);
  if(q.part===1)issues.push("Cần bổ sung hình");
  if(!answer)issues.push("Thiếu đáp án");
  if(q.part>=3&&/\blook at the (graphic|picture|image|map|chart|schedule|form|table)\b/i.test(q.content))issues.push("Cần bổ sung hình");
  return [...new Set(issues)];
}

export async function readToeicImportFiles(questionFile,answerFile){
  let parsedDocx,answers;
  try{parsedDocx=await readDocx(questionFile);}catch(err){throw new Error(`Lỗi đọc Word: ${err?.message||err}`);}
  try{answers=await readAnswers(answerFile);}catch(err){throw new Error(`Lỗi đọc Excel: ${err?.message||err}`);}
  const questions=parsedDocx?.questions||[];
  if(!questions.length)throw new Error("Không nhận diện được câu hỏi nào trong file Word.");
  const seen=new Set(),rows=questions.filter(q=>{if(seen.has(q.number))return false;seen.add(q.number);return true;}).sort((a,b)=>a.number-b.number).map(q=>({...q,answer:answers[q.number]||null,issues:assess(q,answers[q.number])}));
  return {rows,answers,directions:parsedDocx?.directions||{}};
}

export function inferTestKind(rows){
  const parts=new Set(rows.map(r=>r.part).filter(Boolean)),hasListening=[1,2,3,4].some(p=>parts.has(p)),hasReading=[5,6,7].some(p=>parts.has(p));
  if(hasListening&&hasReading)return "full";
  if(hasListening)return "listening";
  if(hasReading)return "reading";
  throw new Error("Không xác định được loại đề từ các Part.");
}

export function renderImportPreview(rows){
  const counts={};for(const r of rows)counts[r.part]=(counts[r.part]||0)+1;
  const review=rows.filter(r=>r.issues.length).length,ok=rows.length-review,answers=rows.filter(r=>r.answer).length;
  return `<div class="stack"><div class="row wrap"><span class="status ok">${ok} câu OK</span><span class="status warn">${review} cần kiểm tra</span><span class="badge">${answers}/${rows.length} đáp án</span></div><div class="muted small">${Object.entries(counts).sort((a,b)=>a[0]-b[0]).map(([p,n])=>`Part ${p}: ${n}`).join(" · ")}</div><div style="max-height:320px;overflow:auto">${rows.map(r=>`<div style="padding:8px 0;border-top:1px solid var(--line)"><b>Câu ${r.number} · Part ${r.part}</b> <span class="badge">${safe(r.answer||"—")}</span><div class="small">${safe(r.content||"(không nhận được nội dung)")}</div>${r.issues.length?`<div class="small">${r.issues.map(x=>`<span class="status warn">${safe(x)}</span>`).join(" ")}</div>`:""}</div>`).join("")}</div></div>`;
}

export async function importQuestionsIntoTest(sb,testId,rows,kind,onProgress,directions={}){
  const {data:parts,error}=await sb.from("test_parts").select("id,part_no").eq("test_id",testId);
  if(error)throw error;
  const partMap=Object.fromEntries((parts||[]).map(p=>[Number(p.part_no),p.id])),allowed=new Set(kind==="listening"?[1,2,3,4]:kind==="reading"?[5,6,7]:[1,2,3,4,5,6,7]);
  for(const [partNo,text] of Object.entries(directions||{})){
    const partId=partMap[Number(partNo)];
    if(partId&&clean(text)){
      const {error:directionError}=await sb.from("test_parts").update({directions:clean(text)}).eq("id",partId);
      if(directionError)throw new Error(`Không lưu được Directions Part ${partNo}: ${directionError.message}`);
    }
  }
  const todo=rows.filter(r=>allowed.has(r.part)),failed=[];let done=0;
  for(const r of todo){
    const partId=partMap[r.part];if(!partId){failed.push(`Câu ${r.number}: thiếu Part ${r.part}`);onProgress?.({done,total:todo.length,failed});continue;}
    const keys=r.part===2?["A","B","C"]:["A","B","C","D"];
    const choices=keys.filter(k=>r.choices[k]!=null).map(k=>({key:k,content:safe(r.choices[k]),media_type:null,storage_path:null}));
    const payload={test_part_id:partId,source_number:r.number,source_order:r.number,stimulus_group_id:null,content:safe(r.content),media_type:null,storage_path:null,correct_choice_key:r.answer||null,score_weight:1,choices};
    const {error:saveError}=await sb.rpc("staff_upsert_question",{p_data:payload});
    if(saveError)failed.push(`Câu ${r.number}: ${saveError.message}`);else done++;
    onProgress?.({done,total:todo.length,failed});
  }
  return {done,total:todo.length,failed};
}
