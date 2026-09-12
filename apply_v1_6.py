from pathlib import Path
import re, shutil, sys

ROOT=Path(__file__).resolve().parent
INDEX=ROOT/"index.html"
APP=ROOT/"assets"/"app.js"
CSS=ROOT/"assets"/"styles.css"

for p in (INDEX,APP,CSS):
    if not p.exists():
        print(f"[LỖI] Không tìm thấy {p}")
        print("Đặt các file cập nhật vào root repo Toeicfulltest.github.io rồi chạy lại.")
        sys.exit(1)
    bak=p.with_name(p.name+".bak-v1.5")
    if not bak.exists():
        shutil.copy2(p,bak)

# index.html
s=INDEX.read_text(encoding="utf-8")
s=re.sub(r'assets/styles\.css\?v=[^"\']+','assets/styles.css?v=1.6',s)
s=re.sub(r'assets/app\.js\?v=[^"\']+','assets/app.js?v=1.6',s)
if 'id="staffHeaderNav"' not in s:
    s=s.replace(
        '<a class="brand" href="#/">TOEIC Full Test</a>',
        '<a class="brand" href="#/">TOEIC Full Test</a>\\n'
        '    <nav id="staffHeaderNav" class="staff-header-nav" hidden aria-label="Điều hướng quản trị"></nav>'
    )
INDEX.write_text(s,encoding="utf-8")

# app.js
a=APP.read_text(encoding="utf-8")

if 'const staffHeaderNav = document.querySelector("#staffHeaderNav");' not in a:
    a=a.replace(
        'const sessionActions = document.querySelector("#sessionActions");',
        'const sessionActions = document.querySelector("#sessionActions");\\n'
        'const staffHeaderNav = document.querySelector("#staffHeaderNav");'
    )

# Header Nav
pat=re.compile(r'function renderHeader\(\)\{\n.*?\n\}\nasync function render\(\)\{',re.S)
rep=r'''function staffHeaderActive(){
  const p=route();
  if(p==="/teacher") return "home";
  if(p==="/accounts") return "accounts";
  if(p==="/classes" || p.startsWith("/class/")) return "classes";
  if(p==="/tests" || p.startsWith("/test/") || p.startsWith("/result/")) return "tests";
  return "";
}
function renderHeader(){
  if(!session){
    if(staffHeaderNav){ staffHeaderNav.hidden=true; staffHeaderNav.innerHTML=""; }
    sessionActions.innerHTML = `<a class="btn ghost header-btn" href="#/login">Đăng nhập</a>`;
    return;
  }
  const isStaff=["teacher","system_admin"].includes(profile?.role);
  if(staffHeaderNav){
    staffHeaderNav.hidden=!isStaff;
    if(isStaff){
      const active=staffHeaderActive();
      staffHeaderNav.innerHTML=`
        <a class="header-nav-link ${active==="home"?"active":""}" href="#/teacher">Tổng quan</a>
        <a class="header-nav-link ${active==="accounts"?"active":""}" href="#/accounts">Tài khoản</a>
        <a class="header-nav-link ${active==="classes"?"active":""}" href="#/classes">Lớp</a>
        <a class="header-nav-link ${active==="tests"?"active":""}" href="#/tests">Bài kiểm tra</a>`;
    }
  }
  sessionActions.innerHTML = `
    <a class="user-name small profile-link" href="#/profile" title="Hồ sơ">${esc(profile?.full_name || session.user.email)} · ${esc(roleLabel(profile?.role||""))}</a>
    <button class="ghost sm header-btn" id="logoutBtn">Đăng xuất</button>`;
  document.querySelector("#logoutBtn")?.addEventListener("click", async()=>{
    clearLiveChannel();
    clearStaffPages();
    testWorkspace=null;
    await sb.auth.signOut();
    go("/");
  });
}
async function render(){'''
a,n=pat.subn(rep,a,count=1)
print("[OK] Nav" if n else "[WARN] renderHeader không khớp")

# Class detail route
old='''  if(p==="/classes") return requireStaff(()=>showStaffPage("classes",renderClasses));
  if(p==="/tests")'''
new='''  if(p==="/classes") return requireStaff(()=>showStaffPage("classes",renderClasses));
  if(p.startsWith("/class/")){
    const id=p.split("/")[2];
    return requireStaff(()=>showStaffPage(`class:${id}`,()=>renderClassDetail(id)));
  }
  if(p==="/tests")'''
if old in a: a=a.replace(old,new,1)

# Remove duplicated staffNav row
a=re.sub(
    r'function staffNav\(active\)\{\n.*?\n\}\nasync function renderTeacher\(\)\{',
    'function staffNav(_active){ return ""; }\\nasync function renderTeacher(){',
    a,count=1,flags=re.S
)

# Accounts class column
pat=re.compile(r'async function renderAccounts\(\)\{\n.*?\n\}\nfunction openNewUser\(classes=\[\]\)\{',re.S)
rep=r'''async function renderAccounts(){
  if(!staffDataCache.users||!staffDataCache.classes) showLoading();
  await prefetchStaffData();
  const users=staffDataCache.users||[];
  const classes=[...(staffDataCache.classes||[])].sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),"vi"));
  const classById=Object.fromEntries(classes.map(c=>[c.id,c]));
  view.innerHTML=`${staffNav("accounts")}
  <section class="card">
    <div class="row between wrap">
      <div><h1>Tài khoản</h1><p class="muted">Tài khoản tồn tại độc lập với lớp.</p></div>
      <div class="row wrap">
        <button class="secondary" id="bulkUser">↑ Nhập danh sách SV</button>
        <button class="primary" id="newUser">+ Tạo tài khoản</button>
      </div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Họ tên</th><th>Vai trò</th><th>Mã SV</th><th>Lớp</th><th>Trạng thái</th><th>Ngày tạo</th></tr></thead>
      <tbody>${users.map(x=>`<tr>
        <td>${esc(x.full_name)}</td><td>${esc(roleLabel(x.role))}</td><td>${esc(x.student_code||"—")}</td>
        <td>${x.role==="student"?(x.class_id?`<a href="#/class/${x.class_id}">${esc(classById[x.class_id]?.name||"Lớp")}</a>`:"Chưa gán"):"—"}</td>
        <td>${x.is_active?'<span class="status ok">Hoạt động</span>':'<span class="status off">Khóa</span>'}</td>
        <td>${fmt(x.created_at)}</td></tr>`).join("")||`<tr><td colspan="6" class="empty">Chưa có tài khoản</td></tr>`}</tbody>
    </table></div>
  </section>`;
  document.querySelector("#newUser").onclick=()=>openNewUser(classes);
  document.querySelector("#bulkUser").onclick=()=>openBulkStudents(classes);
}
function openNewUser(classes=[]){'''
a,n2=pat.subn(rep,a,count=1)
print("[OK] Accounts" if n2 else "[WARN] renderAccounts không khớp")

# Classes + details
pat=re.compile(r'async function renderClasses\(\)\{\n.*?\n\}\nfunction openClass\(\)\{\n.*?\n\}\n\nasync function renderTests\(\)\{',re.S)
rep=r'''async function renderClasses(){
  if(!staffDataCache.classes||!staffDataCache.users) showLoading();
  await prefetchStaffData();
  const data=staffDataCache.classes||[],users=staffDataCache.users||[];
  const countStudents=id=>users.filter(x=>x.role==="student"&&x.class_id===id).length;
  view.innerHTML=`${staffNav("classes")}
  <section class="card">
    <div class="row between wrap"><div><h1>Lớp</h1><p class="muted">Nhấn tên lớp để quản lý thành viên.</p></div><button id="newClass" class="primary">+ Tạo lớp</button></div>
    <div class="table-wrap"><table><thead><tr><th>Tên lớp</th><th>Sinh viên</th><th>Học kỳ</th><th>Năm học</th><th>Ngày tạo</th><th></th></tr></thead>
    <tbody>${data.map(x=>`<tr><td><a class="class-name-link" href="#/class/${x.id}"><b>${esc(x.name)}</b></a></td>
      <td>${countStudents(x.id)}</td><td>${esc(x.semester||"—")}</td><td>${esc(x.academic_year||"—")}</td><td>${fmt(x.created_at)}</td>
      <td><a class="btn secondary sm" href="#/class/${x.id}">Chi tiết</a></td></tr>`).join("")||`<tr><td colspan="6" class="empty">Chưa có lớp</td></tr>`}</tbody></table></div>
  </section>`;
  document.querySelector("#newClass").onclick=()=>openClass();
}
function openClass(existing=null){
  const editing=!!existing;
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal">
    <div class="row between"><h2>${editing?"Chỉnh sửa lớp":"Tạo lớp"}</h2><button type="button" class="ghost sm" data-close>Đóng</button></div>
    <form id="classForm" class="stack">
      <label>Tên lớp<input name="name" value="${esc(existing?.name||"")}" required></label>
      <label>Học kỳ<input name="semester" value="${esc(existing?.semester||"")}" placeholder="HK1"></label>
      <label>Năm học<input name="academic_year" value="${esc(existing?.academic_year||"")}" placeholder="2026-2027"></label>
      <button type="submit" class="primary">${editing?"Lưu thay đổi":"Tạo lớp"}</button>
    </form></div></div>`;
  modalRoot.querySelector("[data-close]").onclick=closeModal;
  modalRoot.querySelector("#classForm").onsubmit=async e=>{
    e.preventDefault();
    const f=Object.fromEntries(new FormData(e.target));
    const btn=e.submitter||e.target.querySelector('button[type="submit"]');
    btn.disabled=true;
    let error;
    if(editing) ({error}=await sb.from("classes").update(f).eq("id",existing.id));
    else ({error}=await sb.from("classes").insert({...f,created_by:session.user.id}));
    btn.disabled=false;
    if(error) return toast(error.message,6000);
    closeModal();
    invalidateStaffData("classes");
    invalidateStaffPage("classes");invalidateStaffPage("teacher");invalidateStaffPage("tests");
    if(editing){
      invalidateStaffPage(`class:${existing.id}`);
      toast("Đã cập nhật lớp");
      return showStaffPage(`class:${existing.id}`,()=>renderClassDetail(existing.id));
    }
    toast("Đã tạo lớp");
    showStaffPage("classes",renderClasses);
  };
}
async function setStudentClass(studentId,classId){
  const {error}=await sb.rpc("staff_set_student_class",{p_student_id:studentId,p_class_id:classId||null});
  if(error) throw error;
  invalidateStaffData("users");
  invalidateStaffPage("accounts");invalidateStaffPage("teacher");invalidateStaffPage("classes");
}
async function renderClassDetail(classId){
  showLoading("Đang tải lớp...");
  await prefetchStaffData();
  const cls=(staffDataCache.classes||[]).find(x=>x.id===classId);
  if(!cls){view.innerHTML=`<section class="card"><a href="#/classes">← Lớp</a><h2>Không tìm thấy lớp</h2></section>`;return;}
  const users=staffDataCache.users||[];
  const students=users.filter(x=>x.role==="student"&&x.class_id===classId).sort((a,b)=>String(a.full_name||"").localeCompare(String(b.full_name||""),"vi"));
  const tests=(staffDataCache.tests||[]).filter(x=>x.class_id===classId);
  view.innerHTML=`${staffNav("classes")}
  <section class="card class-detail-head">
    <div class="row between wrap">
      <div><a class="muted" href="#/classes">← Danh sách lớp</a><h1>${esc(cls.name)}</h1>
        <div class="row wrap"><span class="badge">${students.length} sinh viên</span><span class="badge">${tests.length} bài kiểm tra</span></div>
      </div>
      <button id="editClass" class="secondary">✎ Chỉnh sửa lớp</button>
    </div>
    <div class="class-meta-grid">
      <div><span>Học kỳ</span><b>${esc(cls.semester||"—")}</b></div>
      <div><span>Năm học</span><b>${esc(cls.academic_year||"—")}</b></div>
      <div><span>Ngày tạo</span><b>${fmt(cls.created_at)}</b></div>
    </div>
  </section>
  <section class="card class-members-card">
    <div class="row between wrap"><div><h2>Thành viên lớp</h2><p class="muted">Bỏ khỏi lớp không xóa tài khoản.</p></div><button id="addStudentsToClass" class="primary">+ Thêm sinh viên</button></div>
    <div class="table-wrap"><table><thead><tr><th>Họ tên</th><th>MSSV</th><th>Email</th><th>Trạng thái</th><th></th></tr></thead>
    <tbody>${students.map(s=>`<tr><td><b>${esc(s.full_name)}</b></td><td>${esc(s.student_code||"—")}</td><td>${esc(s.email||"—")}</td>
      <td>${s.is_active?'<span class="status ok">Hoạt động</span>':'<span class="status off">Khóa</span>'}</td>
      <td><button class="ghost sm remove-class-member" data-id="${s.id}" data-name="${esc(s.full_name)}">Bỏ khỏi lớp</button></td></tr>`).join("")||`<tr><td colspan="5" class="empty">Lớp chưa có sinh viên.</td></tr>`}</tbody></table></div>
  </section>`;
  document.querySelector("#editClass").onclick=()=>openClass(cls);
  document.querySelector("#addStudentsToClass").onclick=()=>openAddStudentsToClass(cls,users);
  document.querySelectorAll(".remove-class-member").forEach(b=>b.onclick=()=>confirmRemoveStudentFromClass(cls,b.dataset.id,b.dataset.name));
}
function confirmRemoveStudentFromClass(cls,studentId,name){
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal">
    <h2>Bỏ sinh viên khỏi lớp?</h2>
    <p><b>${esc(name||"Sinh viên")}</b> sẽ được bỏ khỏi <b>${esc(cls.name)}</b>.</p>
    <div class="warning-box">Tài khoản sinh viên vẫn được giữ nguyên.</div>
    <div class="row between"><button type="button" class="secondary" data-close>Hủy</button><button type="button" class="danger" id="doRemoveStudent">Bỏ khỏi lớp</button></div>
  </div></div>`;
  modalRoot.querySelector("[data-close]").onclick=closeModal;
  modalRoot.querySelector("#doRemoveStudent").onclick=async()=>{
    try{
      await setStudentClass(studentId,null);
      closeModal();toast("Đã bỏ sinh viên khỏi lớp");
      invalidateStaffPage(`class:${cls.id}`);
      await showStaffPage(`class:${cls.id}`,()=>renderClassDetail(cls.id));
    }catch(err){toast(err.message,6000);}
  };
}
function openAddStudentsToClass(cls,users){
  const classes=staffDataCache.classes||[],classById=Object.fromEntries(classes.map(c=>[c.id,c]));
  const candidates=users.filter(x=>x.role==="student"&&x.class_id!==cls.id).sort((a,b)=>String(a.full_name||"").localeCompare(String(b.full_name||""),"vi"));
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal wide">
    <div class="row between wrap"><div><h2>Thêm sinh viên vào ${esc(cls.name)}</h2><p class="muted">Sinh viên đang ở lớp khác sẽ được chuyển sang lớp này.</p></div><button type="button" class="ghost sm" data-close>Đóng</button></div>
    <label class="member-search">Tìm sinh viên<input id="memberSearch" placeholder="Họ tên, MSSV hoặc email"></label>
    <div class="member-picker">${candidates.map(s=>`<label class="member-pick-row" data-search="${esc(`${s.full_name||""} ${s.student_code||""} ${s.email||""}`.toLowerCase())}">
      <input type="checkbox" value="${s.id}">
      <span><b>${esc(s.full_name)}</b><small>${esc(s.student_code||"—")} · ${esc(s.email||"—")}${s.class_id?` · đang ở ${esc(classById[s.class_id]?.name||"lớp khác")}`:" · chưa có lớp"}</small></span>
    </label>`).join("")||`<div class="empty">Không còn sinh viên để thêm.</div>`}</div>
    <div class="row between"><span id="selectedMemberCount" class="muted">0 sinh viên được chọn</span><button type="button" class="primary" id="doAddStudents" ${candidates.length?"":"disabled"}>Thêm vào lớp</button></div>
  </div></div>`;
  modalRoot.querySelector("[data-close]").onclick=closeModal;
  const search=modalRoot.querySelector("#memberSearch");
  const rows=[...modalRoot.querySelectorAll(".member-pick-row")];
  const checks=[...modalRoot.querySelectorAll('.member-pick-row input[type="checkbox"]')];
  const count=modalRoot.querySelector("#selectedMemberCount");
  const sync=()=>count.textContent=`${checks.filter(x=>x.checked).length} sinh viên được chọn`;
  checks.forEach(x=>x.onchange=sync);
  search.oninput=()=>{
    const q=search.value.trim().toLowerCase();
    rows.forEach(r=>r.hidden=q&&!r.dataset.search.includes(q));
  };
  modalRoot.querySelector("#doAddStudents").onclick=async()=>{
    const ids=checks.filter(x=>x.checked).map(x=>x.value);
    if(!ids.length)return toast("Chưa chọn sinh viên.");
    const btn=modalRoot.querySelector("#doAddStudents");btn.disabled=true;
    try{
      for(let i=0;i<ids.length;i++){
        btn.textContent=`Đang thêm ${i+1}/${ids.length}…`;
        await setStudentClass(ids[i],cls.id);
      }
      closeModal();toast(`Đã thêm ${ids.length} sinh viên`);
      invalidateStaffPage(`class:${cls.id}`);
      await showStaffPage(`class:${cls.id}`,()=>renderClassDetail(cls.id));
    }catch(err){btn.disabled=false;btn.textContent="Thêm vào lớp";toast(err.message,7000);}
  };
}

async function renderTests(){'''
a,n3=pat.subn(rep,a,count=1)
print("[OK] Classes" if n3 else "[WARN] khối Lớp không khớp")

# Submit bug
a=a.replace('<button class="primary span-2">Tạo bài nháp</button>','<button type="submit" class="primary span-2">Tạo bài nháp</button>')
a=a.replace('<button class="primary span-2">Tạo bản sao</button>','<button type="submit" class="primary span-2">Tạo bản sao</button>')
a=a.replace(
    'e.target.querySelector("button[type=\'submit\']")',
    'e.submitter || e.target.querySelector("button[type=\'submit\'],button:not([type])")'
)

pat=re.compile(r'  modalRoot\.querySelector\("#manualTestForm"\)\.onsubmit=async e=>\{\n.*?\n  \};',re.S)
rep=r'''  modalRoot.querySelector("#manualTestForm").onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(e.target),f=Object.fromEntries(fd);
    f.class_id=f.class_id||null;
    f.duration_minutes=Number(f.duration_minutes);
    f.max_attempts=Number(f.max_attempts);
    ["opens_at","closes_at"].forEach(k=>f[k]=f[k]?new Date(f[k]).toISOString():null);
    Object.assign(f,{status:"draft",show_answers_after_submit:fd.has("show_answers_after_submit"),allowed_violations:1});
    const btn=e.submitter || e.target.querySelector("button[type='submit'],button:not([type])");
    btn.disabled=true;btn.textContent="Đang tạo…";
    try{
      const {data,error}=await sb.rpc("staff_upsert_test",{p_data:f});
      if(error) throw error;
      const testId=typeof data==="string"?data:(data?.id||data?.test_id);
      if(!testId) throw new Error("Backend không trả về mã bài kiểm tra.");
      await createReadingParts(testId);
      invalidateStaffData("tests");invalidateStaffPage("tests");invalidateStaffPage("teacher");
      closeModal();toast("Đã tạo bài kiểm tra nháp");go(`/test/${testId}/authoring`);
    }catch(err){
      console.error(err);
      toast(`Không tạo được bài: ${err.message||err}`,7000);
    }finally{
      btn.disabled=false;btn.textContent="Tạo bài nháp";
    }
  };'''
a,n4=pat.subn(rep,a,count=1)
print("[OK] Manual create" if n4 else "[WARN] manualTestForm không khớp")

APP.write_text(a,encoding="utf-8")

# CSS
c=CSS.read_text(encoding="utf-8")
if "/* V1.6 — top navigation + class detail */" not in c:
    c += r'''

/* V1.6 — top navigation + class detail */
.topbar{gap:18px}
.staff-header-nav{display:flex;align-items:center;gap:4px;min-width:0;flex:1;margin-left:14px;overflow-x:auto;scrollbar-width:none}
.staff-header-nav::-webkit-scrollbar{display:none}
.staff-header-nav[hidden]{display:none!important}
.header-nav-link{color:#cbd5e1;text-decoration:none;padding:9px 11px;border-radius:9px;white-space:nowrap;font-weight:750;font-size:.9rem}
.header-nav-link:hover{color:#fff;background:#1e293b}
.header-nav-link.active{color:#fff;background:#334155}
.container{padding-top:16px}
.class-name-link{text-decoration:none}
.class-name-link:hover{text-decoration:underline}
.class-detail-head{margin-bottom:16px}
.class-meta-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:18px}
.class-meta-grid>div{border:1px solid var(--line);border-radius:12px;padding:12px;display:grid;gap:4px;background:#fafcff}
.class-meta-grid span{font-size:.82rem;color:var(--muted)}
.class-members-card{margin-top:16px}
.member-search{margin:16px 0 10px}
.member-picker{border:1px solid var(--line);border-radius:12px;max-height:48vh;overflow:auto;margin:10px 0 16px}
.member-pick-row{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:center;padding:11px 12px;border-bottom:1px solid var(--line);font-weight:500}
.member-pick-row:last-child{border-bottom:0}
.member-pick-row:hover{background:#f8fbff}
.member-pick-row input{width:auto}
.member-pick-row span{display:grid;gap:3px;min-width:0}
.member-pick-row small{font-size:.8rem;color:var(--muted);font-weight:500;overflow-wrap:anywhere}
@media(max-width:900px){
  .topbar{flex-wrap:wrap;height:auto;min-height:64px;padding-top:8px;padding-bottom:8px}
  .staff-header-nav{order:3;flex-basis:100%;margin-left:0}
  .class-meta-grid{grid-template-columns:1fr}
}
'''
CSS.write_text(c,encoding="utf-8")

print()
print("Đã áp dụng V1.6.")
print("Tiếp theo chạy supabase/v1.6_class_management.sql rồi kiểm tra web.")
