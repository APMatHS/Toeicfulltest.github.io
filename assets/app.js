
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const view = document.querySelector("#view");
const sessionActions = document.querySelector("#sessionActions");
const toastEl = document.querySelector("#toast");
const modalRoot = document.querySelector("#modalRoot");

let session = null;
let profile = null;
let examState = null;
let timerId = null;
let antiCheatBound = false;
let lastViolationAt = 0;
let fullscreenWasEntered = false;
let suppressFullscreenViolation = false;

const esc = (s="") => String(s).replace(/[&<>"']/g, m => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[m]));
const fmt = dt => dt ? new Date(dt).toLocaleString("vi-VN") : "—";
const route = () => location.hash.slice(1) || "/";
const go = p => location.hash = p;
const roleLabel = r => ({system_admin:"System Admin",teacher:"Giáo viên",student:"Sinh viên"})[r] || r;
const statusBadge = s => `<span class="status ${["published","submitted"].includes(s)?"ok":s==="in_progress"?"warn":"off"}">${esc(s)}</span>`;

function toast(msg, ms=3600){
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(()=>toastEl.hidden=true, ms);
}
function closeModal(){ modalRoot.innerHTML = ""; }
function fileExt(name=""){ return name.includes(".") ? "."+name.split(".").pop().toLowerCase() : ""; }
function mediaTypeFromFile(file){
  if(!file) return null;
  if(file.type.startsWith("image/")) return "image";
  if(file.type.startsWith("audio/")) return "audio";
  return null;
}
async function uploadMedia(file, prefix="media"){
  if(!file) return null;
  const kind = mediaTypeFromFile(file);
  if(!kind) throw new Error("Chỉ hỗ trợ ảnh hoặc âm thanh.");
  const path = `${prefix}/${crypto.randomUUID()}${fileExt(file.name)}`;
  const { error } = await sb.storage.from("test-media").upload(path, file, {
    cacheControl:"3600", upsert:false, contentType:file.type
  });
  if(error) throw error;
  return { media_type:kind, storage_path:path };
}
async function signedUrl(path){
  if(!path) return null;
  const {data,error}=await sb.storage.from("test-media").createSignedUrl(path,3600);
  if(error) return null;
  return data?.signedUrl || null;
}

async function boot(){
  const {data} = await sb.auth.getSession();
  session = data.session;
  if(session) await loadProfile();

  sb.auth.onAuthStateChange((_event, s)=>{
    session = s;
    profile = null;
    setTimeout(async ()=>{
      if(s) await loadProfile();
      render();
    }, 0);
  });

  addEventListener("hashchange", render);
  render();
}
async function loadProfile(){
  if(!session) return;
  const {data,error}=await sb.from("profiles").select("*").eq("id",session.user.id).single();
  if(error){ console.error(error); profile=null; return; }
  profile=data;
}
function renderHeader(){
  if(!session){
    sessionActions.innerHTML = `<a class="btn ghost header-btn" href="#/login">Đăng nhập</a>`;
    return;
  }
  sessionActions.innerHTML = `
    <span class="user-name small">${esc(profile?.full_name || session.user.email)} · ${esc(roleLabel(profile?.role||""))}</span>
    <button class="ghost sm header-btn" id="logoutBtn">Đăng xuất</button>`;
  document.querySelector("#logoutBtn")?.addEventListener("click", async()=>{
    await sb.auth.signOut();
    go("/");
  });
}
async function render(){
  clearInterval(timerId); timerId=null;
  renderHeader();
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
function requireStaff(fn){
  if(!session) return go("/login");
  if(!profile) return showLoading("Đang tải hồ sơ...");
  if(!["teacher","system_admin"].includes(profile.role)) return go("/student");
  return fn();
}
function requireStudent(fn){
  if(!session) return go("/login");
  if(!profile) return showLoading("Đang tải hồ sơ...");
  if(profile.role!=="student") return go("/teacher");
  return fn();
}
function showLoading(text="Đang tải..."){ view.innerHTML=`<section class="card">${esc(text)}</section>`; }

function renderHome(){
  if(session){
    if(!profile) return showLoading("Đang tải hồ sơ...");
    return go(profile.role==="student"?"/student":"/teacher");
  }
  view.innerHTML = `
  <section class="hero">
    <div class="card">
      <span class="eyebrow">TOEIC Online</span>
      <h1>TOEIC Full Test</h1>
      <p class="muted">Nền tảng kiểm tra TOEIC, sẵn sàng cho Reading và mở rộng Listening.</p>
      <div class="row"><a href="#/login" class="btn primary">Đăng nhập</a></div>
    </div>
    <div class="card">
      <h2>Thiết kế đề linh hoạt</h2>
      <p class="muted">Một nhóm nội dung có thể dùng chung văn bản, ảnh hoặc audio cho nhiều câu hỏi; câu hỏi và đáp án cũng có thể chứa ảnh/audio.</p>
    </div>
  </section>`;
}
function renderLogin(){
  if(session){
    if(!profile) return showLoading("Đang tải hồ sơ...");
    return go(profile.role==="student"?"/student":"/teacher");
  }
  view.innerHTML=`
  <section class="card login-card">
    <h1>Đăng nhập</h1>
    <p class="muted">Dùng tài khoản do giáo viên hoặc System Admin cấp.</p>
    <form id="loginForm" class="stack">
      <label>Email<input type="email" name="email" required autocomplete="username"></label>
      <label>Mật khẩu<input type="password" name="password" required autocomplete="current-password"></label>
      <button class="primary">Đăng nhập</button>
    </form>
  </section>`;
  document.querySelector("#loginForm").onsubmit=async e=>{
    e.preventDefault();
    const f=new FormData(e.target);
    const btn=e.target.querySelector("button");
    btn.disabled=true; btn.textContent="Đang đăng nhập...";
    const {error}=await sb.auth.signInWithPassword({email:f.get("email"),password:f.get("password")});
    btn.disabled=false; btn.textContent="Đăng nhập";
    if(error) toast(error.message);
  };
}

function staffNav(active){
  return `<div class="tabs">
    <a class="btn tab ${active==="home"?"active":""}" href="#/teacher">Tổng quan</a>
    <a class="btn tab ${active==="accounts"?"active":""}" href="#/accounts">Tài khoản</a>
    <a class="btn tab ${active==="classes"?"active":""}" href="#/classes">Lớp</a>
    <a class="btn tab ${active==="tests"?"active":""}" href="#/tests">Bài kiểm tra</a>
  </div>`;
}
async function renderTeacher(){
  showLoading();
  const [s,t,c,x]=await Promise.all([
    sb.from("profiles").select("*",{count:"exact",head:true}).eq("role","student"),
    sb.from("profiles").select("*",{count:"exact",head:true}).in("role",["teacher","system_admin"]),
    sb.from("classes").select("*",{count:"exact",head:true}),
    sb.from("tests").select("*",{count:"exact",head:true})
  ]);
  view.innerHTML=`${staffNav("home")}
  <section class="card">
    <h1>Bảng điều khiển</h1>
    <div class="muted">${esc(profile.full_name)} · ${esc(roleLabel(profile.role))}</div>
  </section>
  <section class="grid grid-4 kpi-grid">
    ${[["Sinh viên",s.count||0],["Giảng viên",t.count||0],["Lớp",c.count||0],["Bài kiểm tra",x.count||0]]
      .map(([a,b])=>`<div class="card"><div class="muted">${a}</div><div class="kpi">${b}</div></div>`).join("")}
  </section>
  <h2 class="section-title">Thao tác nhanh</h2>
  <section class="grid grid-3">
    <a class="card card-link" href="#/accounts"><h3>Tài khoản</h3><p class="muted">Tạo từng người hoặc nhập danh sách sinh viên từ Excel/CSV.</p></a>
    <a class="card card-link" href="#/classes"><h3>Lớp</h3><p class="muted">Tạo lớp và gán sinh viên.</p></a>
    <a class="card card-link" href="#/tests"><h3>Bài kiểm tra</h3><p class="muted">Soạn câu chữ, ảnh, audio và nội dung dùng chung.</p></a>
  </section>`;
}

async function renderAccounts(){
  showLoading();
  const [{data:users=[]},{data:classes=[]}] = await Promise.all([
    sb.from("profiles").select("*").order("created_at",{ascending:false}),
    sb.from("classes").select("id,name").order("name")
  ]);
  view.innerHTML=`${staffNav("accounts")}
  <section class="card">
    <div class="row between wrap">
      <div><h1>Tài khoản</h1><p class="muted">Có thể tạo từng tài khoản hoặc nhập Excel/CSV kèm mật khẩu ban đầu.</p></div>
      <div class="row wrap">
        <button class="secondary" id="bulkUser">↑ Nhập danh sách SV</button>
        <button class="primary" id="newUser">+ Tạo tài khoản</button>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Họ tên</th><th>Vai trò</th><th>Mã SV</th><th>Trạng thái</th><th>Ngày tạo</th></tr></thead>
        <tbody>${users.map(x=>`<tr>
          <td>${esc(x.full_name)}</td><td>${esc(roleLabel(x.role))}</td><td>${esc(x.student_code||"—")}</td>
          <td>${x.is_active?'<span class="status ok">Hoạt động</span>':'<span class="status off">Khóa</span>'}</td>
          <td>${fmt(x.created_at)}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">Chưa có tài khoản</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
  document.querySelector("#newUser").onclick=()=>openNewUser(classes);
  document.querySelector("#bulkUser").onclick=()=>openBulkStudents(classes);
}
function openNewUser(classes=[]){
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal">
    <div class="row between"><h2>Tạo tài khoản</h2><button class="ghost sm" data-close>Đóng</button></div>
    <form id="newUserForm" class="stack">
      <label>Họ và tên<input name="full_name" required></label>
      <label>Email<input type="email" name="email" required></label>
      <label>Mật khẩu ban đầu<input type="password" name="password" minlength="6" required></label>
      <label>Vai trò<select name="role"><option value="student">Sinh viên</option><option value="teacher">Giáo viên</option></select></label>
      <label>Mã sinh viên<input name="student_code"></label>
      <label>Lớp (nếu là sinh viên)<select name="class_id"><option value="">Chưa gán</option>${classes.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label>
      <button class="primary">Tạo tài khoản</button>
    </form>
  </div></div>`;
  modalRoot.querySelector("[data-close]").onclick=closeModal;
  modalRoot.querySelector("#newUserForm").onsubmit=async e=>{
    e.preventDefault();
    const f=Object.fromEntries(new FormData(e.target));
    const btn=e.target.querySelector("button[type='submit']");
    btn.disabled=true; btn.textContent="Đang tạo...";
    const {data,error}=await sb.functions.invoke("manage-user",{body:{
      action:"create_user",...f,student_code:f.student_code||null,class_id:f.class_id||null
    }});
    btn.disabled=false; btn.textContent="Tạo tài khoản";
    if(error||data?.error) return toast(data?.error||error.message);
    closeModal(); toast("Đã tạo tài khoản"); renderAccounts();
  };
}
function normalizeHeader(s=""){
  return String(s).trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");
}
function mapStudentRows(rows){
  return rows.map((row,i)=>{
    const entries=Object.entries(row);
    const get=(aliases)=>{
      for(const [k,v] of entries){
        if(aliases.includes(normalizeHeader(k))) return v;
      }
      return "";
    };
    return {
      _row:i+2,
      full_name:String(get(["ho_ten","hoten","name","full_name","ten"])||"").trim(),
      student_code:String(get(["mssv","ma_sv","masv","student_code","student_id"])||"").trim(),
      email:String(get(["email","mail"])||"").trim(),
      password:String(get(["password","mat_khau","matkhau","pass"])||"").trim()
    };
  });
}
function openBulkStudents(classes=[]){
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal wide">
    <div class="row between"><div><h2>Nhập danh sách sinh viên</h2><p class="muted">Excel/CSV: Họ tên · MSSV · Email · Password. Password tối thiểu 6 ký tự.</p></div><button class="ghost sm" data-close>Đóng</button></div>
    <div class="form-grid">
      <label class="span-2">File Excel/CSV<input id="studentFile" type="file" accept=".xlsx,.xls,.csv" required></label>
      <label class="span-2">Gán vào lớp<select id="bulkClass"><option value="">Chưa gán lớp</option>${classes.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label>
    </div>
    <div id="bulkPreview" class="preview-box muted">Chọn file để xem trước.</div>
    <div class="row between"><span id="bulkSummary" class="muted"></span><button class="primary" id="doBulk" disabled>Tạo sinh viên</button></div>
  </div></div>`;
  modalRoot.querySelector("[data-close]").onclick=closeModal;
  let parsed=[];
  const input=modalRoot.querySelector("#studentFile");
  const preview=modalRoot.querySelector("#bulkPreview");
  const summary=modalRoot.querySelector("#bulkSummary");
  const goBtn=modalRoot.querySelector("#doBulk");
  input.onchange=async()=>{
    try{
      const file=input.files?.[0]; if(!file) return;
      const buf=await file.arrayBuffer();
      const wb=XLSX.read(buf);
      const ws=wb.Sheets[wb.SheetNames[0]];
      parsed=mapStudentRows(XLSX.utils.sheet_to_json(ws,{defval:""}));
      const invalid=parsed.filter(r=>!r.full_name||!r.email||r.password.length<6);
      preview.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Dòng</th><th>Họ tên</th><th>MSSV</th><th>Email</th><th>Password</th><th></th></tr></thead>
      <tbody>${parsed.slice(0,100).map(r=>`<tr><td>${r._row}</td><td>${esc(r.full_name)}</td><td>${esc(r.student_code)}</td><td>${esc(r.email)}</td><td>${r.password?"••••••":"—"}</td><td>${(!r.full_name||!r.email||r.password.length<6)?'<span class="status off">Lỗi</span>':'<span class="status ok">OK</span>'}</td></tr>`).join("")}</tbody></table></div>
      ${parsed.length>100?`<p class="muted">Đang hiển thị 100/${parsed.length} dòng.</p>`:""}`;
      summary.textContent=`${parsed.length} sinh viên · ${invalid.length} dòng chưa hợp lệ`;
      goBtn.disabled=!parsed.length || invalid.length>0;
    }catch(err){
      parsed=[]; goBtn.disabled=true; preview.textContent="Không đọc được file."; toast(err.message);
    }
  };
  goBtn.onclick=async()=>{
    const users=parsed.map(({_row,...r})=>r);
    goBtn.disabled=true; goBtn.textContent="Đang tạo...";
    const {data,error}=await sb.functions.invoke("manage-user",{body:{
      action:"bulk_create_students",
      class_id:modalRoot.querySelector("#bulkClass").value||null,
      users
    }});
    goBtn.disabled=false; goBtn.textContent="Tạo sinh viên";
    if(error||data?.error) return toast(data?.error||error.message,6000);
    const failed=(data.results||[]).filter(x=>!x.ok);
    if(failed.length){
      preview.innerHTML=`<div class="warning-box"><b>${data.success}/${data.total} thành công.</b><br>${failed.map(x=>`${esc(x.email)}: ${esc(x.error)}`).join("<br>")}</div>`;
      summary.textContent=`${data.success} thành công · ${data.failed} lỗi`;
      return;
    }
    closeModal(); toast(`Đã tạo ${data.success} sinh viên`); renderAccounts();
  };
}

async function renderClasses(){
  showLoading();
  const {data=[]}=await sb.from("classes").select("*").order("created_at",{ascending:false});
  view.innerHTML=`${staffNav("classes")}
  <section class="card">
    <div class="row between wrap"><div><h1>Lớp</h1><p class="muted">Tạo và quản lý lớp học.</p></div><button id="newClass" class="primary">+ Tạo lớp</button></div>
    <div class="table-wrap"><table><thead><tr><th>Tên lớp</th><th>Học kỳ</th><th>Năm học</th><th>Ngày tạo</th></tr></thead>
    <tbody>${data.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.semester||"—")}</td><td>${esc(x.academic_year||"—")}</td><td>${fmt(x.created_at)}</td></tr>`).join("")||`<tr><td colspan="4" class="empty">Chưa có lớp</td></tr>`}</tbody></table></div>
  </section>`;
  document.querySelector("#newClass").onclick=openClass;
}
function openClass(){
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal">
    <div class="row between"><h2>Tạo lớp</h2><button class="ghost sm" data-close>Đóng</button></div>
    <form id="classForm" class="stack">
      <label>Tên lớp<input name="name" required></label>
      <label>Học kỳ<input name="semester" placeholder="HK1"></label>
      <label>Năm học<input name="academic_year" placeholder="2026-2027"></label>
      <button class="primary">Tạo lớp</button>
    </form></div></div>`;
  modalRoot.querySelector("[data-close]").onclick=closeModal;
  modalRoot.querySelector("#classForm").onsubmit=async e=>{
    e.preventDefault();
    const f=Object.fromEntries(new FormData(e.target));
    const {error}=await sb.from("classes").insert({...f,created_by:session.user.id});
    if(error) return toast(error.message);
    closeModal(); toast("Đã tạo lớp"); renderClasses();
  };
}

async function renderTests(){
  showLoading();
  const {data=[]}=await sb.from("tests").select("*,classes(name)").order("created_at",{ascending:false});
  view.innerHTML=`${staffNav("tests")}
  <section class="card">
    <div class="row between wrap"><div><h1>Bài kiểm tra</h1><p class="muted">Reading hiện tại; kiến trúc media/group sẵn sàng cho Listening.</p></div><button id="newTest" class="primary">+ Tạo bài kiểm tra</button></div>
    <div class="table-wrap"><table><thead><tr><th>Tên bài</th><th>Lớp</th><th>Thời gian</th><th>Trạng thái</th><th></th></tr></thead>
    <tbody>${data.map(x=>`<tr><td>${esc(x.title)}</td><td>${esc(x.classes?.name||"—")}</td><td>${x.duration_minutes} phút</td><td>${statusBadge(x.status)}</td><td><a class="btn secondary sm" href="#/test/${x.id}">Chi tiết</a></td></tr>`).join("")||`<tr><td colspan="5" class="empty">Chưa có bài kiểm tra</td></tr>`}</tbody></table></div>
  </section>`;
  document.querySelector("#newTest").onclick=openNewTest;
}
async function openNewTest(){
  const {data:classes=[]}=await sb.from("classes").select("id,name").order("name");
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal">
    <div class="row between"><h2>Tạo bài kiểm tra Reading</h2><button class="ghost sm" data-close>Đóng</button></div>
    <form id="testForm" class="form-grid">
      <label class="span-2">Tên bài<input name="title" required></label>
      <label>Lớp<select name="class_id"><option value="">Chưa gán lớp</option>${classes.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label>
      <label>Thời gian (phút)<input type="number" name="duration_minutes" value="75" min="1"></label>
      <label>Mở lúc<input type="datetime-local" name="opens_at"></label>
      <label>Đóng lúc<input type="datetime-local" name="closes_at"></label>
      <label class="span-2">Mô tả<textarea name="description"></textarea></label>
      <button class="primary span-2">Tạo bài</button>
    </form></div></div>`;
  modalRoot.querySelector("[data-close]").onclick=closeModal;
  modalRoot.querySelector("#testForm").onsubmit=async e=>{
    e.preventDefault();
    const f=Object.fromEntries(new FormData(e.target));
    ["opens_at","closes_at"].forEach(k=>f[k]=f[k]?new Date(f[k]).toISOString():"");
    Object.assign(f,{status:"draft",max_attempts:1,show_answers_after_submit:true,anti_cheat_mode:"warn_then_submit",allowed_violations:1});
    const {data,error}=await sb.rpc("staff_upsert_test",{p_data:f});
    if(error) return toast(error.message);
    for(const p of [
      {part_no:5,title:"Part 5",shuffle_mode:"shuffle_questions",sort_order:1},
      {part_no:6,title:"Part 6",shuffle_mode:"shuffle_stimulus_groups",sort_order:2},
      {part_no:7,title:"Part 7",shuffle_mode:"fixed",sort_order:3}
    ]){
      const r=await sb.rpc("staff_upsert_part",{p_data:{...p,test_id:data}});
      if(r.error) return toast(r.error.message);
    }
    closeModal(); toast("Đã tạo bài kiểm tra"); go(`/test/${data}`);
  };
}

async function renderTestDetail(id){
  showLoading();
  const {data,error}=await sb.rpc("get_test_authoring",{p_test_id:id});
  if(error){ view.innerHTML=`${staffNav("tests")}<div class="card">${esc(error.message)}</div>`; return; }
  const t=data.test, parts=data.parts||[], qs=data.questions||[], groups=data.stimulus_groups||[];
  const groupMap=Object.fromEntries(groups.map(g=>[g.id,g]));

  view.innerHTML=`${staffNav("tests")}
  <section class="card">
    <div class="row between wrap">
      <div><a href="#/tests" class="muted">← Danh sách</a><h1>${esc(t.title)}</h1>
        <div class="row wrap">${statusBadge(t.status)}<span class="badge">${t.duration_minutes} phút</span><span class="badge">${qs.length}/100 câu</span></div>
      </div>
      <button id="publishBtn" class="${t.status==="published"?"secondary":"primary"}">${t.status==="published"?"Đóng bài":"Xuất bản"}</button>
    </div>
  </section>

  <section class="grid grid-3 part-summary">
    ${parts.map(p=>`<div class="card"><h3>${esc(p.title)}</h3><div class="muted">${esc(p.shuffle_mode)}</div><div class="kpi">${qs.filter(q=>q.part_no===p.part_no).length}</div><div class="muted">câu hỏi</div></div>`).join("")}
  </section>

  <section class="card authoring">
    <div class="row between wrap">
      <div><h2>Soạn đề</h2><p class="muted">Nội dung chung (text/ảnh/audio) có thể dùng cho nhiều câu. Câu hỏi và từng đáp án cũng có thể gắn media.</p></div>
    </div>
    ${parts.map(p=>{
      const pGroups=groups.filter(g=>g.part_no===p.part_no);
      const pQs=qs.filter(q=>q.part_no===p.part_no);
      return `<div class="part-editor">
        <div class="row between wrap"><div><h3>${esc(p.title)}</h3><span class="muted">${pQs.length} câu · ${pGroups.length} nhóm nội dung</span></div>
          <div class="row wrap"><button class="secondary sm add-group" data-part="${p.id}" data-partno="${p.part_no}">+ Nhóm nội dung</button><button class="primary sm add-question" data-part="${p.id}" data-partno="${p.part_no}">+ Câu hỏi</button></div>
        </div>
        ${pGroups.map(g=>`<div class="group-box">
          <div class="row between wrap"><div><b>${esc(g.title||`Nhóm ${g.source_order}`)}</b><div class="muted">Thứ tự ${g.source_order} · ${esc(g.play_mode||"normal")}</div></div>
          <button class="ghost sm add-stimulus" data-group="${g.id}">+ Nội dung chung</button></div>
          <div class="media-list">${(g.stimuli||[]).map(s=>`<span class="badge">${s.media_type==="image"?"🖼 Ảnh":s.media_type==="audio"?"🔊 Audio":"📝 Text"}</span>`).join("") || '<span class="muted">Chưa có stimulus</span>'}</div>
          ${pQs.filter(q=>q.stimulus_group_id===g.id).map(q=>questionAuthorRow(q)).join("") || '<div class="muted mini-empty">Chưa có câu trong nhóm</div>'}
        </div>`).join("")}
        <div class="ungrouped">${pQs.filter(q=>!q.stimulus_group_id).map(q=>questionAuthorRow(q)).join("")}</div>
      </div>`;
    }).join("")}
  </section>`;

  document.querySelector("#publishBtn").onclick=async()=>{
    const next=t.status==="published"?"closed":"published";
    const {error}=await sb.rpc("staff_upsert_test",{p_data:{id:t.id,status:next}});
    if(error) return toast(error.message);
    toast(next==="published"?"Đã xuất bản":"Đã đóng bài"); renderTestDetail(id);
  };
  document.querySelectorAll(".add-group").forEach(b=>b.onclick=()=>openGroupEditor(id,b.dataset.part,+b.dataset.partno));
  document.querySelectorAll(".add-stimulus").forEach(b=>b.onclick=()=>openStimulusEditor(id,b.dataset.group));
  document.querySelectorAll(".add-question").forEach(b=>b.onclick=()=>openQuestionEditor(id,b.dataset.part,+b.dataset.partno,groups));
  document.querySelectorAll(".edit-question").forEach(b=>{
    const q=qs.find(x=>x.id===b.dataset.id);
    b.onclick=()=>openQuestionEditor(id,q.test_part_id,q.part_no,groups,q);
  });
}
function questionAuthorRow(q){
  const media = q.storage_path ? (q.media_type==="audio"?" 🔊":" 🖼") : "";
  return `<div class="question-author-row">
    <div><b>Câu ${q.source_number}</b>${media} · ${esc(q.content||"(không có chữ)")}<div class="muted small">Đáp án đúng: ${esc(q.correct_choice_key||"—")}</div></div>
    <button class="secondary sm edit-question" data-id="${q.id}">Sửa</button>
  </div>`;
}
function openGroupEditor(testId, partId, partNo){
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal">
    <div class="row between"><div><h2>Nhóm nội dung · Part ${partNo}</h2><p class="muted">Dùng cho passage, ảnh hoặc audio chung nhiều câu.</p></div><button class="ghost sm" data-close>Đóng</button></div>
    <form id="groupForm" class="form-grid">
      <label class="span-2">Tên nhóm<input name="title" placeholder="Ví dụ: Conversation 1 / Passage 1"></label>
      <label>Thứ tự nguồn<input type="number" name="source_order" min="1" required></label>
      <label>Chế độ phát<select name="play_mode"><option value="normal">Bình thường</option><option value="once">Nghe một lần</option><option value="auto">Tự phát</option></select></label>
      <label><span>Cho nghe lại</span><select name="allow_replay"><option value="true">Có</option><option value="false">Không</option></select></label>
      <label><span>Cho tua</span><select name="allow_seek"><option value="true">Có</option><option value="false">Không</option></select></label>
      <label>Số lượt nghe tối đa<input type="number" name="max_plays" min="1" placeholder="Để trống = không giới hạn"></label>
      <button class="primary span-2">Tạo nhóm</button>
    </form>
  </div></div>`;
  modalRoot.querySelector("[data-close]").onclick=closeModal;
  modalRoot.querySelector("#groupForm").onsubmit=async e=>{
    e.preventDefault();
    const f=Object.fromEntries(new FormData(e.target));
    const {error}=await sb.rpc("staff_upsert_stimulus_group",{p_data:{
      test_part_id:partId,
      source_order:+f.source_order,
      title:f.title||null,
      play_mode:f.play_mode,
      allow_replay:f.allow_replay==="true",
      allow_seek:f.allow_seek==="true",
      max_plays:f.max_plays?+f.max_plays:null
    }});
    if(error) return toast(error.message);
    closeModal(); toast("Đã tạo nhóm nội dung"); renderTestDetail(testId);
  };
}
function openStimulusEditor(testId, groupId){
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal">
    <div class="row between"><div><h2>Thêm nội dung chung</h2><p class="muted">Text, ảnh hoặc audio này được dùng chung cho các câu thuộc nhóm.</p></div><button class="ghost sm" data-close>Đóng</button></div>
    <form id="stimForm" class="stack">
      <label>Loại<select name="kind" id="stimKind"><option value="text">Văn bản</option><option value="file">Ảnh / Audio</option></select></label>
      <label id="stimTextWrap">Nội dung<textarea name="content" rows="6"></textarea></label>
      <label id="stimFileWrap" hidden>Chọn file<input type="file" name="file" accept="image/png,image/jpeg,image/webp,audio/mpeg,audio/mp4,audio/wav"></label>
      <label>Thứ tự<input type="number" name="sort_order" value="1" min="1"></label>
      <button class="primary">Lưu nội dung</button>
    </form>
  </div></div>`;
  modalRoot.querySelector("[data-close]").onclick=closeModal;
  const kind=modalRoot.querySelector("#stimKind");
  kind.onchange=()=>{
    modalRoot.querySelector("#stimTextWrap").hidden=kind.value!=="text";
    modalRoot.querySelector("#stimFileWrap").hidden=kind.value!=="file";
  };
  modalRoot.querySelector("#stimForm").onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    let payload={stimulus_group_id:groupId,sort_order:+fd.get("sort_order")||1};
    try{
      if(fd.get("kind")==="text"){
        payload.media_type="text"; payload.content=fd.get("content")||"";
      }else{
        const file=fd.get("file");
        if(!(file instanceof File)||!file.size) return toast("Chưa chọn file.");
        const up=await uploadMedia(file,`groups/${groupId}`);
        Object.assign(payload,up);
      }
      const {error}=await sb.rpc("staff_upsert_stimulus",{p_data:payload});
      if(error) throw error;
      closeModal(); toast("Đã thêm nội dung chung"); renderTestDetail(testId);
    }catch(err){ toast(err.message); }
  };
}
function choiceFields(choice){
  return `<div class="choice-edit">
    <div class="choice-key">${choice}</div>
    <input name="choice_${choice}" placeholder="Nội dung đáp án ${choice}">
    <input name="choice_file_${choice}" type="file" accept="image/png,image/jpeg,image/webp,audio/mpeg,audio/mp4,audio/wav">
  </div>`;
}
function openQuestionEditor(testId, partId, partNo, allGroups, existing=null){
  const groups=allGroups.filter(g=>g.part_no===partNo);
  const choices=Object.fromEntries((existing?.choices||[]).map(c=>[c.key,c]));
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal wide">
    <div class="row between"><div><h2>${existing?"Sửa":"Thêm"} câu hỏi · Part ${partNo}</h2><p class="muted">Câu hỏi và từng đáp án có thể có ảnh/audio riêng.</p></div><button class="ghost sm" data-close>Đóng</button></div>
    <form id="questionForm" class="stack">
      <div class="form-grid">
        <label>Số câu nguồn<input type="number" name="source_number" value="${existing?.source_number??""}" required></label>
        <label>Thứ tự<input type="number" name="source_order" value="${existing?.source_order??existing?.source_number??""}" required></label>
        <label class="span-2">Nhóm nội dung<select name="stimulus_group_id"><option value="">Không dùng nhóm</option>${groups.map(g=>`<option value="${g.id}" ${existing?.stimulus_group_id===g.id?"selected":""}>${esc(g.title||`Nhóm ${g.source_order}`)}</option>`).join("")}</select></label>
        <label class="span-2">Nội dung câu hỏi<textarea name="content" rows="3">${esc(existing?.content||"")}</textarea></label>
        <label class="span-2">Ảnh/Audio riêng của câu<input type="file" name="question_file" accept="image/png,image/jpeg,image/webp,audio/mpeg,audio/mp4,audio/wav"><span class="hint">${existing?.storage_path?"Đang có media; chỉ chọn file nếu muốn thay.":""}</span></label>
      </div>
      <h3>Đáp án</h3>
      <div class="choices-editor">
        ${["A","B","C","D"].map(k=>`<div class="choice-edit"><div class="choice-key">${k}</div><input name="choice_${k}" value="${esc(choices[k]?.content||"")}" placeholder="Nội dung đáp án ${k}"><input name="choice_file_${k}" type="file" accept="image/png,image/jpeg,image/webp,audio/mpeg,audio/mp4,audio/wav"><span class="hint">${choices[k]?.storage_path?"Có media":""}</span></div>`).join("")}
      </div>
      <label>Đáp án đúng<select name="correct_choice_key">${["A","B","C","D"].map(k=>`<option ${existing?.correct_choice_key===k?"selected":""}>${k}</option>`).join("")}</select></label>
      <button class="primary">${existing?"Lưu thay đổi":"Thêm câu hỏi"}</button>
    </form>
  </div></div>`;
  modalRoot.querySelector("[data-close]").onclick=closeModal;
  modalRoot.querySelector("#questionForm").onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const btn=e.target.querySelector("button[type='submit']");
    btn.disabled=true; btn.textContent="Đang lưu...";
    try{
      let qMedia={media_type:existing?.media_type||null,storage_path:existing?.storage_path||null};
      const qf=fd.get("question_file");
      if(qf instanceof File && qf.size) qMedia=await uploadMedia(qf,`questions/${testId}`);
      const choiceRows=[];
      for(const k of ["A","B","C","D"]){
        let cMedia={media_type:choices[k]?.media_type||null,storage_path:choices[k]?.storage_path||null};
        const cf=fd.get(`choice_file_${k}`);
        if(cf instanceof File && cf.size) cMedia=await uploadMedia(cf,`choices/${testId}`);
        choiceRows.push({key:k,content:String(fd.get(`choice_${k}`)||""),...cMedia});
      }
      const payload={
        id:existing?.id||undefined,
        test_part_id:partId,
        source_number:+fd.get("source_number"),
        source_order:+fd.get("source_order"),
        stimulus_group_id:fd.get("stimulus_group_id")||null,
        content:String(fd.get("content")||""),
        correct_choice_key:fd.get("correct_choice_key"),
        score_weight:1,
        ...qMedia,
        choices:choiceRows
      };
      const {error}=await sb.rpc("staff_upsert_question",{p_data:payload});
      if(error) throw error;
      closeModal(); toast(existing?"Đã lưu câu hỏi":"Đã thêm câu hỏi"); renderTestDetail(testId);
    }catch(err){ toast(err.message,6000); }
    finally{ btn.disabled=false; btn.textContent=existing?"Lưu thay đổi":"Thêm câu hỏi"; }
  };
}

async function renderStudent(){
  showLoading();
  const [{data:tests=[],error},{data:attempts=[]}] = await Promise.all([
    sb.from("tests").select("*,classes(name)").eq("status","published").order("created_at",{ascending:false}),
    sb.from("attempts").select("*").eq("student_id",session.user.id)
  ]);
  if(error) console.error(error);
  const amap=Object.fromEntries(attempts.map(a=>[a.test_id,a]));
  view.innerHTML=`<section class="card"><h1>Bài kiểm tra của tôi</h1><p class="muted">${esc(profile.full_name)} · ${esc(profile.student_code||"")}</p></section>
  <section class="grid grid-2 student-tests">
    ${tests.map(t=>{
      const a=amap[t.id];
      return `<div class="card"><div class="row between"><span class="badge">${esc(t.classes?.name||"TOEIC")}</span>${a?statusBadge(a.status):'<span class="status off">Chưa làm</span>'}</div>
      <h2>${esc(t.title)}</h2><p class="muted">${esc(t.description||"100 câu Reading")}</p><div class="row"><span>⏱ ${t.duration_minutes} phút</span><span>•</span><span>1 lượt</span></div>
      <div class="test-action">${a?(a.status==="in_progress"?`<a class="btn primary" href="#/exam/${a.id}">Tiếp tục</a>`:`<a class="btn secondary" href="#/result/${a.id}">Xem kết quả</a>`):`<button class="primary start-test" data-id="${t.id}">Bắt đầu</button>`}</div></div>`;
    }).join("")||`<div class="card empty">Hiện chưa có bài kiểm tra được mở.</div>`}
  </section>`;
  document.querySelectorAll(".start-test").forEach(b=>b.onclick=()=>confirmStart(b.dataset.id));
}
function confirmStart(testId){
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal">
    <h2>Trước khi bắt đầu</h2>
    <div class="warning-box"><b>Quy định chống gian lận</b><br>Rời tab/màn hình hoặc thoát toàn màn hình lần 1 sẽ bị cảnh báo. Lần 2 hệ thống tự động nộp bài.</div>
    <p>Bài thi chỉ được làm <b>một lần</b>. Đồng hồ bắt đầu ngay khi nhấn Bắt đầu.</p>
    <div class="row between"><button class="secondary" data-close>Hủy</button><button class="primary" id="confirmStart">Bắt đầu bài thi</button></div>
  </div></div>`;
  modalRoot.querySelector("[data-close]").onclick=closeModal;
  modalRoot.querySelector("#confirmStart").onclick=async()=>{
    const {data,error}=await sb.rpc("start_attempt",{p_test_id:testId});
    if(error) return toast(error.message);
    closeModal();
    try{
      await document.documentElement.requestFullscreen?.();
      fullscreenWasEntered=!!document.fullscreenElement;
    }catch{ fullscreenWasEntered=false; }
    const attemptId=data?.attempt_id || data?.id || data?.attempt?.id;
    if(!attemptId) return toast("Không nhận được mã lượt làm.");
    go(`/exam/${attemptId}`);
  };
}
async function renderExam(attemptId){
  if(!session||profile?.role!=="student") return go("/login");
  showLoading("Đang tải bài thi...");
  const {data,error}=await sb.rpc("get_attempt_payload",{p_attempt_id:attemptId});
  if(error) return view.innerHTML=`<div class="card">${esc(error.message)}</div>`;
  if(data?.attempt?.status!=="in_progress") return go(`/result/${attemptId}`);
  examState={attemptId,payload:data,current:0};
  await hydrateMedia(data.questions||[]);
  drawExam(); bindAntiCheat();
}
async function hydrateMedia(questions){
  const paths=new Set();
  for(const q of questions){
    if(q.storage_path) paths.add(q.storage_path);
    for(const s of q.stimuli||[]) if(s.storage_path) paths.add(s.storage_path);
    for(const c of q.choices||[]) if(c.storage_path) paths.add(c.storage_path);
  }
  if(!paths.size) return;
  const {data}=await sb.storage.from("test-media").createSignedUrls([...paths],3600);
  const m={}; (data||[]).forEach(x=>m[x.path]=x.signedUrl);
  for(const q of questions){
    if(q.storage_path) q.url=m[q.storage_path];
    for(const s of q.stimuli||[]) if(s.storage_path) s.url=m[s.storage_path];
    for(const c of q.choices||[]) if(c.storage_path) c.url=m[c.storage_path];
  }
}
function renderMedia(type,url,content,cls=""){
  if(type==="image" && url) return `<img class="question-media ${cls}" src="${url}" alt="Nội dung câu hỏi">`;
  if(type==="audio" && url) return `<audio class="${cls}" controls src="${url}"></audio>`;
  if(type==="text" || content) return content?`<div class="${cls}">${esc(content).replace(/\n/g,"<br>")}</div>`:"";
  return "";
}
function drawExam(){
  const {payload,current}=examState;
  const q=payload.questions[current], a=payload.attempt;
  if(!q) return view.innerHTML=`<div class="card">Không có câu hỏi.</div>`;
  view.innerHTML=`<section class="exam-layout"><div class="exam-main">
    <div class="card"><div class="row between"><div><b>Part ${q.part}</b><div class="muted">Câu ${q.number} · ${current+1}/${payload.questions.length}</div></div><div id="timer" class="timer"></div></div></div>
    ${(q.stimuli||[]).map(s=>`<div class="stimulus">${renderMedia(s.type,s.url,s.content)}</div>`).join("")}
    <div class="card question">
      ${renderMedia(q.media_type,q.url,null)}
      <h3>${q.number}. ${esc(q.content||"")}</h3>
      ${(q.choices||[]).map(c=>`<label class="choice">
        <input type="radio" name="choice" value="${c.key}" ${q.selected===c.key?"checked":""}>
        <b>${c.key}.</b>
        <span class="choice-body">${renderMedia(c.media_type,c.url,null,"choice-media")}${esc(c.content||"")}</span>
      </label>`).join("")}
      <div class="divider"></div>
      <label class="review-label"><input id="markReview" type="checkbox" ${q.marked?"checked":""}> Đánh dấu xem lại</label>
    </div>
    <div class="exam-toolbar"><button class="secondary" id="prevBtn" ${current===0?"disabled":""}>← Câu trước</button><button class="secondary" id="nextBtn" ${current===payload.questions.length-1?"disabled":""}>Câu sau →</button></div>
  </div>
  <aside class="exam-side"><div class="card sticky"><div class="row between"><b>Câu hỏi</b><span class="muted">${payload.questions.filter(x=>x.selected).length}/${payload.questions.length}</span></div>
  <div class="palette">${payload.questions.map((x,i)=>`<button class="qbtn ${x.selected?"done":""} ${x.marked?"review":""} ${i===current?"current":""}" data-i="${i}">${x.number}</button>`).join("")}</div>
  <button class="danger full" id="submitBtn">Nộp bài</button><p class="muted small">Vi phạm: ${a.violation_count||0}/1 cảnh báo</p></div></aside></section>`;

  document.querySelectorAll(".qbtn").forEach(b=>b.onclick=()=>{examState.current=+b.dataset.i;drawExam()});
  document.querySelector("#prevBtn").onclick=()=>{examState.current--;drawExam()};
  document.querySelector("#nextBtn").onclick=()=>{examState.current++;drawExam()};
  document.querySelectorAll('input[name="choice"]').forEach(r=>r.onchange=()=>saveCurrent(r.value));
  document.querySelector("#markReview").onchange=e=>saveCurrent(q.selected,e.target.checked);
  document.querySelector("#submitBtn").onclick=confirmSubmit;
  updateTimer(); timerId=setInterval(updateTimer,1000);
}
async function saveCurrent(choice,marked=document.querySelector("#markReview")?.checked||false){
  const q=examState.payload.questions[examState.current];
  q.marked=marked;
  if(!choice) return;
  const {data,error}=await sb.rpc("save_answer",{p_attempt_id:examState.attemptId,p_question_id:q.id,p_choice:choice,p_marked:marked});
  if(error) return toast("Không lưu được đáp án: "+error.message);
  q.selected=choice;
  if(data?.submitted) go(`/result/${examState.attemptId}`);
}
function updateTimer(){
  if(!examState) return;
  const left=Math.max(0,new Date(examState.payload.attempt.expires_at)-Date.now());
  const el=document.querySelector("#timer"); if(!el) return;
  const s=Math.floor(left/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),ss=s%60;
  el.textContent=`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
  el.classList.toggle("danger-text",s<300);
  if(left<=0){ clearInterval(timerId); go(`/result/${examState.attemptId}`); }
}
function confirmSubmit(){
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal">
    <h2>Nộp bài?</h2><p>Bạn đã trả lời <b>${examState.payload.questions.filter(x=>x.selected).length}/${examState.payload.questions.length}</b> câu.</p>
    <div class="row between"><button class="secondary" data-close>Tiếp tục làm</button><button class="danger" id="doSubmit">Nộp bài</button></div>
  </div></div>`;
  modalRoot.querySelector("[data-close]").onclick=closeModal;
  modalRoot.querySelector("#doSubmit").onclick=async()=>{
    suppressFullscreenViolation=true;
    const {error}=await sb.rpc("submit_attempt",{p_attempt_id:examState.attemptId});
    if(error){suppressFullscreenViolation=false;return toast(error.message);}
    closeModal(); go(`/result/${examState.attemptId}`);
  };
}
function bindAntiCheat(){
  if(antiCheatBound) return;
  antiCheatBound=true;
  const fire=async type=>{
    if(!examState||route()!==`/exam/${examState.attemptId}`) return;
    const now=Date.now(); if(now-lastViolationAt<1800) return;
    lastViolationAt=now;
    const {data,error}=await sb.rpc("register_violation",{p_attempt_id:examState.attemptId,p_event_type:type,p_details:{ua:navigator.userAgent}});
    if(error) return console.error(error);
    examState.payload.attempt.violation_count=data.violation_count;
    if(data.submitted){ alert("Bạn đã vi phạm lần thứ 2. Hệ thống đã tự động nộp bài."); go(`/result/${examState.attemptId}`); }
    else alert("Cảnh báo lần 1: nếu vi phạm lần nữa, hệ thống sẽ tự động nộp bài.");
  };
  document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="hidden") fire("tab_hidden"); });
  window.addEventListener("blur",()=>{ if(document.visibilityState==="visible") fire("window_blur"); });
  document.addEventListener("fullscreenchange",()=>{
    if(suppressFullscreenViolation){suppressFullscreenViolation=false;return;}
    if(fullscreenWasEntered&&!document.fullscreenElement&&examState&&route().startsWith("/exam/")) fire("fullscreen_exit");
    if(document.fullscreenElement) fullscreenWasEntered=true;
  });
}
async function renderResult(attemptId){
  showLoading("Đang tải kết quả...");
  const {data,error}=await sb.rpc("get_attempt_result",{p_attempt_id:attemptId});
  if(error){
    if(error.message.includes("not submitted")){
      setTimeout(()=>renderResult(attemptId),1200);
      return view.innerHTML=`<div class="card">Đang chốt bài...</div>`;
    }
    return view.innerHTML=`<div class="card">${esc(error.message)}</div>`;
  }
  examState=null;
  suppressFullscreenViolation=true;
  try{ if(document.fullscreenElement) await document.exitFullscreen(); }catch{}
  const ans=data.answers||[];
  view.innerHTML=`<section class="card">
    <span class="eyebrow">Kết quả</span><h1>Hoàn thành bài thi</h1>
    <div class="row score-row"><div><div class="big-score">${data.correct_count}/100</div><div class="muted">${data.correct_count}%</div></div><div>${statusBadge(data.status)}</div></div>
    <p class="muted">Nộp lúc ${fmt(data.submitted_at)}</p><a class="btn primary" href="#/student">Về danh sách bài</a>
  </section>
  <section class="card result-list"><h2>Đáp án</h2>${ans.map(x=>`<div class="result-row"><b>Câu ${x.number}</b> · Bạn chọn: <b>${esc(x.selected||"—")}</b> · Đáp án: <b>${esc(x.correct)}</b> · <span class="${x.is_correct?"correct":"wrong"}">${x.is_correct?"Đúng":"Sai"}</span></div>`).join("")}</section>`;
}

boot();
