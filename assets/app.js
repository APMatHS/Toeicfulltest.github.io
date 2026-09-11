
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

const sb=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
const view=document.querySelector("#view"),sessionActions=document.querySelector("#sessionActions"),toastEl=document.querySelector("#toast"),modalRoot=document.querySelector("#modalRoot");
let session=null,profile=null,examState=null,antiCheatBound=false,lastViolationAt=0,timerId=null;

const esc=(s="")=>String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
function toast(msg){toastEl.textContent=msg;toastEl.hidden=false;clearTimeout(toastEl._t);toastEl._t=setTimeout(()=>toastEl.hidden=true,3200)}
function fmt(dt){return dt?new Date(dt).toLocaleString("vi-VN"):"—"}
function route(){return location.hash.slice(1)||"/"}
function go(p){location.hash=p}
function roleLabel(r){return ({system_admin:"System Admin",teacher:"Giáo viên",student:"Sinh viên"})[r]||r}
function statusBadge(s){let c=s==="published"||s==="submitted"?"ok":s==="in_progress"?"warn":"off";return `<span class="status ${c}">${esc(s)}</span>`}

async function boot(){
  const {data}=await sb.auth.getSession();session=data.session;
  if(session) await loadProfile();
 sb.auth.onAuthStateChange((_e,s)=>{
  session=s;
  profile=null;

  setTimeout(async ()=>{
    if(s) await loadProfile();
    render();
  },0);
});
async function loadProfile(){
  const {data,error}=await sb.from("profiles").select("*").eq("id",session.user.id).single();
  if(error){console.error(error);return} profile=data;
}
function renderHeader(){
  if(!session){sessionActions.innerHTML=`<a class="btn ghost" style="color:white;border-color:#475569" href="#/login">Đăng nhập</a>`;return}
  sessionActions.innerHTML=`<span class="user-name small">${esc(profile?.full_name||session.user.email)} · ${esc(roleLabel(profile?.role))}</span><button class="ghost sm" id="logoutBtn" style="color:white;border-color:#475569">Đăng xuất</button>`;
  document.querySelector("#logoutBtn")?.addEventListener("click",async()=>{await sb.auth.signOut();go("/")});
}
async function render(){
  clearInterval(timerId);timerId=null;renderHeader();
  const p=route();
  if(p.startsWith("/exam/")) return renderExam(p.split("/")[2]);
  if(p.startsWith("/result/")) return renderResult(p.split("/")[2]);
  if(p==="/login") return renderLogin();
  if(p==="/teacher") return requireStaff(renderTeacher);
  if(p==="/student") return requireStudent(renderStudent);
  if(p==="/accounts") return requireStaff(renderAccounts);
  if(p==="/classes") return requireStaff(renderClasses);
  if(p==="/tests") return requireStaff(renderTests);
  if(p.startsWith("/test/")) return requireStaff(()=>renderTestDetail(p.split("/")[2]));
  return renderHome();
}
function requireStaff(fn){if(!session)return go("/login");if(!["teacher","system_admin"].includes(profile?.role))return go("/student");return fn()}
function requireStudent(fn){if(!session)return go("/login");if(profile?.role!=="student")return go("/teacher");return fn()}

function renderHome(){
  if(session) return go(profile?.role==="student"?"/student":"/teacher");
  view.innerHTML=`<section class="hero">
    <div class="card"><span class="eyebrow">TOEIC Reading Online</span><h1>TOEIC Full Test</h1><p class="muted">Hệ thống kiểm tra trực tuyến dành cho giảng viên và sinh viên: 100 câu Reading, 75 phút, chấm điểm ngay sau khi nộp.</p><div class="row"><a href="#/login" class="btn primary">Đăng nhập</a></div></div>
    <div class="card"><h2>Quy tắc V1</h2><div class="stack"><div><b>Part 5</b><div class="muted">Đảo 30 câu</div></div><div><b>Part 6</b><div class="muted">Đảo 4 passage, giữ thứ tự câu trong passage</div></div><div><b>Part 7</b><div class="muted">Giữ nguyên</div></div><div class="warning-box"><b>Chống gian lận:</b> rời màn hình lần 1 cảnh báo, lần 2 tự nộp.</div></div></div>
  </section>`;
}
function renderLogin(){
  if(session)return go(profile?.role==="student"?"/student":"/teacher");
  view.innerHTML=`<section class="card" style="max-width:520px;margin:40px auto"><h1>Đăng nhập</h1><p class="muted">Dùng tài khoản do giáo viên hoặc System Admin cấp.</p>
  <form id="loginForm" class="stack"><label>Email<input type="email" name="email" required autocomplete="username"></label><label>Mật khẩu<input type="password" name="password" required autocomplete="current-password"></label><button class="primary">Đăng nhập</button></form></section>`;
  document.querySelector("#loginForm").onsubmit=async e=>{e.preventDefault();let f=new FormData(e.target);let {error}=await sb.auth.signInWithPassword({email:f.get("email"),password:f.get("password")});if(error)toast(error.message)};
}

function staffNav(active){
  return `<div class="tabs"><a class="btn tab ${active==="home"?"active":""}" href="#/teacher">Tổng quan</a><a class="btn tab ${active==="accounts"?"active":""}" href="#/accounts">Tài khoản</a><a class="btn tab ${active==="classes"?"active":""}" href="#/classes">Lớp</a><a class="btn tab ${active==="tests"?"active":""}" href="#/tests">Bài kiểm tra</a></div>`;
}
async function renderTeacher(){
  const [{count:students},{count:teachers},{count:classes},{count:tests}]=await Promise.all([
    sb.from("profiles").select("*",{count:"exact",head:true}).eq("role","student"),
    sb.from("profiles").select("*",{count:"exact",head:true}).in("role",["teacher","system_admin"]),
    sb.from("classes").select("*",{count:"exact",head:true}),
    sb.from("tests").select("*",{count:"exact",head:true})
  ]);
  view.innerHTML=`${staffNav("home")}<section class="card"><div class="between row"><div><h1 style="margin:.2rem 0">Bảng điều khiển</h1><div class="muted">${esc(profile.full_name)} · ${esc(roleLabel(profile.role))}</div></div></div></section>
  <section class="grid grid-4" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-top:16px">
  ${[["Sinh viên",students||0],["Giảng viên",teachers||0],["Lớp",classes||0],["Bài kiểm tra",tests||0]].map(([a,b])=>`<div class="card"><div class="muted">${a}</div><div class="kpi">${b}</div></div>`).join("")}</section>
  <h2 class="section-title">Thao tác nhanh</h2><section class="grid grid-3"><a class="card" href="#/accounts" style="color:inherit;text-decoration:none"><h3>Quản lý tài khoản</h3><p class="muted">Tạo sinh viên, giáo viên và theo dõi trạng thái.</p></a><a class="card" href="#/classes" style="color:inherit;text-decoration:none"><h3>Quản lý lớp</h3><p class="muted">Tạo lớp và gán sinh viên.</p></a><a class="card" href="#/tests" style="color:inherit;text-decoration:none"><h3>Bài kiểm tra</h3><p class="muted">Tạo đề, cài đặt thời gian và xem kết quả.</p></a></section>`;
}
async function renderAccounts(){
  const {data=[]}=await sb.from("profiles").select("*").order("created_at",{ascending:false});
  view.innerHTML=`${staffNav("accounts")}<section class="card"><div class="row between"><div><h1>Tài khoản</h1><p class="muted">Teacher được tạo Student/Teacher; chỉ System Admin cấp System Admin.</p></div><button class="primary" id="newUser">+ Tạo tài khoản</button></div>
  <div class="table-wrap"><table><thead><tr><th>Họ tên</th><th>Vai trò</th><th>Mã SV</th><th>Trạng thái</th><th>Ngày tạo</th></tr></thead><tbody>${data.map(x=>`<tr><td>${esc(x.full_name)}</td><td>${esc(roleLabel(x.role))}</td><td>${esc(x.student_code||"—")}</td><td>${x.is_active?'<span class="status ok">Hoạt động</span>':'<span class="status off">Khóa</span>'}</td><td>${fmt(x.created_at)}</td></tr>`).join("")||`<tr><td colspan="5" class="empty">Chưa có tài khoản</td></tr>`}</tbody></table></div></section>`;
  document.querySelector("#newUser").onclick=openNewUser;
}
function openNewUser(){
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="row between"><h2>Tạo tài khoản</h2><button class="ghost sm" data-close>Đóng</button></div>
  <form id="newUserForm" class="stack"><label>Họ và tên<input name="full_name" required></label><label>Email<input type="email" name="email" required></label><label>Mật khẩu ban đầu<input type="password" name="password" minlength="6" required></label><label>Vai trò<select name="role"><option value="student">Sinh viên</option><option value="teacher">Giáo viên</option></select></label><label>Mã sinh viên (nếu có)<input name="student_code"></label><button class="primary">Tạo tài khoản</button></form></div></div>`;
  modalRoot.querySelector("[data-close]").onclick=()=>modalRoot.innerHTML="";
  modalRoot.querySelector("#newUserForm").onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));const {data,error}=await sb.functions.invoke("manage-user",{body:{action:"create_user",...f,student_code:f.student_code||null}});if(error||data?.error){toast(data?.error||error.message);return}modalRoot.innerHTML="";toast("Đã tạo tài khoản");renderAccounts()};
}
async function renderClasses(){
  const {data=[]}=await sb.from("classes").select("*").order("created_at",{ascending:false});
  view.innerHTML=`${staffNav("classes")}<section class="card"><div class="row between"><div><h1>Lớp</h1><p class="muted">Tạo và quản lý lớp học.</p></div><button id="newClass" class="primary">+ Tạo lớp</button></div>
  <div class="table-wrap"><table><thead><tr><th>Tên lớp</th><th>Học kỳ</th><th>Năm học</th><th>Ngày tạo</th></tr></thead><tbody>${data.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.semester||"—")}</td><td>${esc(x.academic_year||"—")}</td><td>${fmt(x.created_at)}</td></tr>`).join("")||`<tr><td colspan="4" class="empty">Chưa có lớp</td></tr>`}</tbody></table></div></section>`;
  document.querySelector("#newClass").onclick=()=>openClass();
}
function openClass(){
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="row between"><h2>Tạo lớp</h2><button class="ghost sm" data-close>Đóng</button></div><form id="classForm" class="stack"><label>Tên lớp<input name="name" required></label><label>Học kỳ<input name="semester" placeholder="HK1"></label><label>Năm học<input name="academic_year" placeholder="2026-2027"></label><button class="primary">Tạo lớp</button></form></div></div>`;
  modalRoot.querySelector("[data-close]").onclick=()=>modalRoot.innerHTML="";
  modalRoot.querySelector("#classForm").onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));const {error}=await sb.from("classes").insert({...f,created_by:session.user.id});if(error)return toast(error.message);modalRoot.innerHTML="";toast("Đã tạo lớp");renderClasses()};
}
async function renderTests(){
  const {data=[]}=await sb.from("tests").select("*,classes(name)").order("created_at",{ascending:false});
  view.innerHTML=`${staffNav("tests")}<section class="card"><div class="row between"><div><h1>Bài kiểm tra</h1><p class="muted">Reading 100 câu, mặc định 75 phút và một lượt làm.</p></div><button id="newTest" class="primary">+ Tạo bài kiểm tra</button></div>
  <div class="table-wrap"><table><thead><tr><th>Tên bài</th><th>Lớp</th><th>Thời gian</th><th>Trạng thái</th><th></th></tr></thead><tbody>${data.map(x=>`<tr><td>${esc(x.title)}</td><td>${esc(x.classes?.name||"—")}</td><td>${x.duration_minutes} phút</td><td>${statusBadge(x.status)}</td><td><a class="btn secondary sm" href="#/test/${x.id}">Chi tiết</a></td></tr>`).join("")||`<tr><td colspan="5" class="empty">Chưa có bài kiểm tra</td></tr>`}</tbody></table></div></section>`;
  document.querySelector("#newTest").onclick=openNewTest;
}
async function openNewTest(){
  const {data:classes=[]}=await sb.from("classes").select("id,name").order("name");
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="row between"><h2>Tạo bài kiểm tra</h2><button class="ghost sm" data-close>Đóng</button></div>
  <form id="testForm" class="form-grid"><label class="span-2">Tên bài<input name="title" required></label><label>Lớp<select name="class_id"><option value="">Chưa gán lớp</option>${classes.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label><label>Thời gian (phút)<input type="number" name="duration_minutes" value="75" min="1"></label><label>Mở lúc<input type="datetime-local" name="opens_at"></label><label>Đóng lúc<input type="datetime-local" name="closes_at"></label><label class="span-2">Mô tả<textarea name="description"></textarea></label><button class="primary span-2">Tạo bài</button></form></div></div>`;
  modalRoot.querySelector("[data-close]").onclick=()=>modalRoot.innerHTML="";
  modalRoot.querySelector("#testForm").onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));["opens_at","closes_at"].forEach(k=>f[k]=f[k]?new Date(f[k]).toISOString():"");f.status="draft";f.max_attempts=1;f.show_answers_after_submit=true;f.anti_cheat_mode="warn_then_submit";f.allowed_violations=1;const {data,error}=await sb.rpc("staff_upsert_test",{p_data:f});if(error)return toast(error.message);for(const p of [{part_no:5,title:"Part 5",shuffle_mode:"shuffle_questions",sort_order:1},{part_no:6,title:"Part 6",shuffle_mode:"shuffle_stimulus_groups",sort_order:2},{part_no:7,title:"Part 7",shuffle_mode:"fixed",sort_order:3}])await sb.rpc("staff_upsert_part",{p_data:{...p,test_id:data}});modalRoot.innerHTML="";toast("Đã tạo bài kiểm tra");go(`/test/${data}`)};
}
async function renderTestDetail(id){
  const {data,error}=await sb.rpc("get_test_authoring",{p_test_id:id});if(error){view.innerHTML=`${staffNav("tests")}<div class="card">${esc(error.message)}</div>`;return}
  const t=data.test,parts=data.parts||[],qs=data.questions||[],groups=data.stimulus_groups||[];
  view.innerHTML=`${staffNav("tests")}<section class="card"><div class="row between"><div><a href="#/tests" class="muted">← Danh sách</a><h1>${esc(t.title)}</h1><div class="row">${statusBadge(t.status)}<span class="badge">${t.duration_minutes} phút</span><span class="badge">${qs.length}/100 câu</span></div></div><div class="row"><button id="publishBtn" class="${t.status==="published"?"secondary":"primary"}">${t.status==="published"?"Đóng bài":"Xuất bản"}</button></div></div></section>
  <section class="grid grid-3" style="margin-top:16px">${parts.map(p=>`<div class="card"><h3>${esc(p.title)}</h3><div class="muted">${esc(p.shuffle_mode)}</div><div class="kpi">${qs.filter(q=>q.part_no===p.part_no).length}</div><div class="muted">câu hỏi</div></div>`).join("")}</section>
  <section class="card" style="margin-top:16px"><h2>Soạn đề</h2><p class="muted">Khung dữ liệu đã sẵn sàng cho Part 5/6/7. Hai đề PDF mẫu sẽ được nhập vào bước tiếp theo.</p><div class="row"><span class="badge">Part 5: đảo câu</span><span class="badge">Part 6: đảo passage</span><span class="badge">Part 7: cố định</span></div></section>`;
  document.querySelector("#publishBtn").onclick=async()=>{const next=t.status==="published"?"closed":"published";const {error}=await sb.rpc("staff_upsert_test",{p_data:{id:t.id,status:next}});if(error)return toast(error.message);toast(next==="published"?"Đã xuất bản":"Đã đóng bài");renderTestDetail(id)};
}

async function renderStudent(){
  const {data:tests=[],error}=await sb.from("tests").select("*,classes(name)").eq("status","published").order("created_at",{ascending:false});
  if(error)console.error(error);
  const {data:attempts=[]}=await sb.from("attempts").select("*").eq("student_id",session.user.id);
  const amap=Object.fromEntries(attempts.map(a=>[a.test_id,a]));
  view.innerHTML=`<section class="card"><h1>Bài kiểm tra của tôi</h1><p class="muted">${esc(profile.full_name)} · ${esc(profile.student_code||"")}</p></section><section class="grid grid-2" style="margin-top:16px">${tests.map(t=>{let a=amap[t.id];return `<div class="card"><div class="row between"><span class="badge">${esc(t.classes?.name||"TOEIC")}</span>${a?statusBadge(a.status):'<span class="status off">Chưa làm</span>'}</div><h2>${esc(t.title)}</h2><p class="muted">${esc(t.description||"100 câu Reading")}</p><div class="row"><span>⏱ ${t.duration_minutes} phút</span><span>•</span><span>1 lượt</span></div><div style="margin-top:15px">${a?(a.status==="in_progress"?`<a class="btn primary" href="#/exam/${a.id}">Tiếp tục</a>`:`<a class="btn secondary" href="#/result/${a.id}">Xem kết quả</a>`):`<button class="primary start-test" data-id="${t.id}">Bắt đầu</button>`}</div></div>`}).join("")||`<div class="card empty">Hiện chưa có bài kiểm tra được mở.</div>`}</section>`;
  document.querySelectorAll(".start-test").forEach(b=>b.onclick=()=>confirmStart(b.dataset.id));
}
function confirmStart(testId){
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><h2>Trước khi bắt đầu</h2><div class="warning-box"><b>Quy định chống gian lận</b><br>Rời tab/màn hình hoặc thoát toàn màn hình lần 1 sẽ bị cảnh báo. Lần 2 hệ thống tự nộp bài.</div><p>Bài thi chỉ được làm <b>một lần</b>. Đồng hồ bắt đầu ngay khi nhấn nút dưới đây.</p><div class="row between"><button class="secondary" data-close>Hủy</button><button class="primary" id="confirmStart">Bắt đầu bài thi</button></div></div></div>`;
  modalRoot.querySelector("[data-close]").onclick=()=>modalRoot.innerHTML="";
  modalRoot.querySelector("#confirmStart").onclick=async()=>{const {data,error}=await sb.rpc("start_attempt",{p_test_id:testId});if(error)return toast(error.message);modalRoot.innerHTML="";try{await document.documentElement.requestFullscreen?.()}catch{}go(`/exam/${data.attempt_id}`)};
}
async function renderExam(attemptId){
  if(!session||profile?.role!=="student")return go("/login");
  const {data,error}=await sb.rpc("get_attempt_payload",{p_attempt_id:attemptId});if(error)return view.innerHTML=`<div class="card">${esc(error.message)}</div>`;
  if(data.attempt.status!=="in_progress")return go(`/result/${attemptId}`);
  examState={attemptId,payload:data,current:0};
  await hydrateMedia(data.questions);
  drawExam();bindAntiCheat();
}
async function hydrateMedia(questions){
  const paths=[...new Set(questions.flatMap(q=>(q.stimuli||[]).filter(s=>s.storage_path).map(s=>s.storage_path)))];
  if(!paths.length)return;
  const {data}=await sb.storage.from("test-media").createSignedUrls(paths,3600);
  const m={};(data||[]).forEach(x=>m[x.path]=x.signedUrl);
  questions.forEach(q=>(q.stimuli||[]).forEach(s=>{if(s.storage_path)s.url=m[s.storage_path]}));
}
function drawExam(){
  const {payload,current}=examState,q=payload.questions[current],a=payload.attempt;
  view.innerHTML=`<section class="exam-layout"><div class="exam-main">
  <div class="card"><div class="row between"><div><b>Part ${q.part}</b><div class="muted">Câu ${q.number} · ${current+1}/${payload.questions.length}</div></div><div id="timer" class="timer"></div></div></div>
  ${(q.stimuli||[]).map(s=>`<div class="stimulus">${s.media_type==="image"&&s.url?`<img src="${s.url}" alt="Tài liệu câu hỏi">`:s.media_type==="audio"&&s.url?`<audio controls src="${s.url}"></audio>`:`<div>${esc(s.content||"").replace(/\n/g,"<br>")}</div>`}</div>`).join("")}
  <div class="card question"><h3>${q.number}. ${esc(q.content)}</h3>${(q.choices||[]).map(c=>`<label class="choice"><input type="radio" name="choice" value="${c.key}" ${q.selected===c.key?"checked":""}><b>${c.key}.</b><span>${esc(c.content)}</span></label>`).join("")}<div class="divider"></div><label style="display:flex;grid-template-columns:auto 1fr;align-items:center"><input id="markReview" type="checkbox" style="width:auto" ${q.marked?"checked":""}> Đánh dấu xem lại</label></div>
  <div class="exam-toolbar"><button class="secondary" id="prevBtn" ${current===0?"disabled":""}>← Câu trước</button><button class="secondary" id="nextBtn" ${current===payload.questions.length-1?"disabled":""}>Câu sau →</button></div></div>
  <aside class="exam-side"><div class="card sticky"><div class="row between"><b>Câu hỏi</b><span class="muted">${payload.questions.filter(x=>x.selected).length}/${payload.questions.length}</span></div><div class="palette" style="margin-top:12px">${payload.questions.map((x,i)=>`<button class="qbtn ${x.selected?"done":""} ${x.marked?"review":""} ${i===current?"current":""}" data-i="${i}">${x.number}</button>`).join("")}</div><button class="danger" id="submitBtn" style="width:100%;margin-top:14px">Nộp bài</button><p class="muted small">Vi phạm: ${a.violation_count||0}/1 cảnh báo</p></div></aside></section>`;
  document.querySelectorAll(".qbtn").forEach(b=>b.onclick=()=>{examState.current=+b.dataset.i;drawExam()});
  document.querySelector("#prevBtn").onclick=()=>{examState.current--;drawExam()};
  document.querySelector("#nextBtn").onclick=()=>{examState.current++;drawExam()};
  document.querySelectorAll('input[name="choice"]').forEach(r=>r.onchange=()=>saveCurrent(r.value));
  document.querySelector("#markReview").onchange=e=>saveCurrent(q.selected,e.target.checked);
  document.querySelector("#submitBtn").onclick=confirmSubmit;
  updateTimer();timerId=setInterval(updateTimer,1000);
}
async function saveCurrent(choice,marked=document.querySelector("#markReview")?.checked||false){
  const q=examState.payload.questions[examState.current];if(!choice){q.marked=marked;return}
  const {data,error}=await sb.rpc("save_answer",{p_attempt_id:examState.attemptId,p_question_id:q.id,p_choice:choice,p_marked:marked});
  if(error)return toast("Không lưu được đáp án: "+error.message);
  q.selected=choice;q.marked=marked;if(data?.submitted)go(`/result/${examState.attemptId}`);
}
function updateTimer(){
  if(!examState)return;const left=Math.max(0,new Date(examState.payload.attempt.expires_at)-Date.now()),el=document.querySelector("#timer");if(!el)return;
  const s=Math.floor(left/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),ss=s%60;el.textContent=`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;el.classList.toggle("danger",s<300);
  if(left<=0){clearInterval(timerId);go(`/result/${examState.attemptId}`)}
}
function confirmSubmit(){
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><h2>Nộp bài?</h2><p>Bạn đã trả lời <b>${examState.payload.questions.filter(x=>x.selected).length}/${examState.payload.questions.length}</b> câu. Sau khi nộp không thể sửa đáp án.</p><div class="row between"><button class="secondary" data-close>Tiếp tục làm</button><button class="danger" id="doSubmit">Nộp bài</button></div></div></div>`;
  modalRoot.querySelector("[data-close]").onclick=()=>modalRoot.innerHTML="";
  modalRoot.querySelector("#doSubmit").onclick=async()=>{const {error}=await sb.rpc("submit_attempt",{p_attempt_id:examState.attemptId});if(error)return toast(error.message);modalRoot.innerHTML="";go(`/result/${examState.attemptId}`)};
}
function bindAntiCheat(){
  if(antiCheatBound)return;antiCheatBound=true;
  const fire=async type=>{
    if(!examState||route()!==`/exam/${examState.attemptId}`)return;
    const now=Date.now();if(now-lastViolationAt<1800)return;lastViolationAt=now;
    const {data,error}=await sb.rpc("register_violation",{p_attempt_id:examState.attemptId,p_event_type:type,p_details:{ua:navigator.userAgent}});
    if(error)return console.error(error);
    examState.payload.attempt.violation_count=data.violation_count;
    if(data.submitted){alert("Bạn đã rời màn hình lần thứ 2. Hệ thống đã tự động nộp bài.");go(`/result/${examState.attemptId}`)}
    else alert("Cảnh báo lần 1: Bạn đã rời màn hình bài thi. Nếu vi phạm lần nữa, hệ thống sẽ tự động nộp bài.");
  };
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")fire("tab_hidden")});
  document.addEventListener("fullscreenchange",()=>{if(!document.fullscreenElement&&examState&&route().startsWith("/exam/"))fire("fullscreen_exit")});
}
async function renderResult(attemptId){
  const {data,error}=await sb.rpc("get_attempt_result",{p_attempt_id:attemptId});
  if(error){if(error.message.includes("not submitted")){setTimeout(()=>renderResult(attemptId),1200);return view.innerHTML=`<div class="card">Đang chốt bài...</div>`}return view.innerHTML=`<div class="card">${esc(error.message)}</div>`}
  examState=null;try{if(document.fullscreenElement)await document.exitFullscreen()}catch{}
  const ans=data.answers||[];
  view.innerHTML=`<section class="card"><span class="eyebrow">Kết quả</span><h1>Hoàn thành bài thi</h1><div class="row" style="align-items:flex-end"><div><div class="big-score">${data.correct_count}/100</div><div class="muted">${data.correct_count}%</div></div><div>${statusBadge(data.status)}</div></div><p class="muted">Nộp lúc ${fmt(data.submitted_at)}</p><a class="btn primary" href="#/student">Về danh sách bài</a></section>
  <section class="card" style="margin-top:16px"><h2>Đáp án</h2>${ans.map(x=>`<div class="result-row"><b>Câu ${x.number}</b> · Bạn chọn: <b>${esc(x.selected||"—")}</b> · Đáp án: <b>${esc(x.correct)}</b> · <span class="${x.is_correct?"correct":"wrong"}">${x.is_correct?"Đúng":"Sai"}</span></div>`).join("")}</section>`;
}

boot();
