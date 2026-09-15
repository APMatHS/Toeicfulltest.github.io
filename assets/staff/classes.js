import { esc,fmt } from "../modules/utils.js";

export function createClassesController(ctx){
  const {
    sb,modalRoot,toast,closeModal,showLoading,staffNav,
    prefetchStaffData,getStaffDataCache,invalidateStaffData,invalidateStaffPage,showStaffPage,
    getView,getSession,getAccountsController
  }=ctx;

  async function renderClasses(){
    const cache=getStaffDataCache();
    if(!cache.classes||!cache.users) showLoading();
    await prefetchStaffData();
    const view=getView(),data=cache.classes||[],users=cache.users||[];
    const countStudents=id=>users.filter(x=>x.role==="student"&&x.class_id===id).length;
    view.innerHTML=`${staffNav("classes")}<section class="card">
      <div class="row between wrap"><div><h1>Lớp</h1><p class="muted">Nhấn tên lớp để quản lý thành viên.</p></div><button id="newClass" class="primary">+ Tạo lớp</button></div>
      <div class="table-wrap"><table><thead><tr><th>Tên lớp</th><th>Sinh viên</th><th>Học kỳ</th><th>Năm học</th><th>Ngày tạo</th><th></th></tr></thead>
      <tbody>${data.map(x=>`<tr><td><a class="class-name-link" href="#/class/${x.id}"><b>${esc(x.name)}</b></a></td><td>${countStudents(x.id)}</td><td>${esc(x.semester||"—")}</td><td>${esc(x.academic_year||"—")}</td><td>${fmt(x.created_at)}</td><td><a class="btn secondary sm" href="#/class/${x.id}">Chi tiết</a></td></tr>`).join("")||'<tr><td colspan="6" class="empty">Chưa có lớp</td></tr>'}</tbody></table></div>
    </section>`;
    document.querySelector("#newClass").onclick=()=>openClass();
  }

  function openClass(existing=null){
    const editing=!!existing;
    modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="row between"><h2>${editing?"Chỉnh sửa lớp":"Tạo lớp"}</h2><button type="button" class="ghost sm" data-close>Đóng</button></div><form id="classForm" class="stack"><label>Tên lớp<input name="name" value="${esc(existing?.name||"")}" required></label><label>Học kỳ<input name="semester" value="${esc(existing?.semester||"")}" placeholder="HK1"></label><label>Năm học<input name="academic_year" value="${esc(existing?.academic_year||"")}" placeholder="2026-2027"></label><button type="submit" class="primary">${editing?"Lưu thay đổi":"Tạo lớp"}</button></form></div></div>`;
    modalRoot.querySelector("[data-close]").onclick=closeModal;
    modalRoot.querySelector("#classForm").onsubmit=async e=>{
      e.preventDefault();
      const f=Object.fromEntries(new FormData(e.target)),btn=e.submitter||e.target.querySelector('button[type="submit"]');btn.disabled=true;
      let error;if(editing)({error}=await sb.from("classes").update(f).eq("id",existing.id));else({error}=await sb.from("classes").insert({...f,created_by:getSession().user.id}));btn.disabled=false;
      if(error)return toast(error.message,6000);
      closeModal();invalidateStaffData("classes");invalidateStaffPage("classes");invalidateStaffPage("teacher");invalidateStaffPage("tests");
      if(editing){invalidateStaffPage(`class:${existing.id}`);toast("Đã cập nhật lớp");return showStaffPage(`class:${existing.id}`,()=>renderClassDetail(existing.id));}
      toast("Đã tạo lớp");showStaffPage("classes",renderClasses);
    };
  }

  async function setStudentClass(studentId,classId){
    const {error}=await sb.rpc("staff_set_student_class",{p_student_id:studentId,p_class_id:classId||null});
    if(error)throw error;
    invalidateStaffData("users");invalidateStaffPage("accounts");invalidateStaffPage("teacher");invalidateStaffPage("classes");
  }

  async function renderClassDetail(classId){
    showLoading("Đang tải lớp...");await prefetchStaffData();
    const cache=getStaffDataCache(),view=getView(),cls=(cache.classes||[]).find(x=>x.id===classId);
    if(!cls){view.innerHTML='<section class="card"><a href="#/classes">← Lớp</a><h2>Không tìm thấy lớp</h2></section>';return;}
    const users=cache.users||[],students=users.filter(x=>x.role==="student"&&x.class_id===classId).sort((a,b)=>String(a.full_name||"").localeCompare(String(b.full_name||""),"vi")),tests=(cache.tests||[]).filter(x=>x.class_id===classId);
    view.innerHTML=`${staffNav("classes")}<section class="card class-detail-head"><div class="row between wrap"><div><a class="muted" href="#/classes">← Danh sách lớp</a><h1>${esc(cls.name)}</h1><div class="row wrap"><span class="badge">${students.length} sinh viên</span><span class="badge">${tests.length} bài kiểm tra</span></div></div><button id="editClass" class="secondary">✎ Chỉnh sửa lớp</button></div><div class="class-meta-grid"><div><span>Học kỳ</span><b>${esc(cls.semester||"—")}</b></div><div><span>Năm học</span><b>${esc(cls.academic_year||"—")}</b></div><div><span>Ngày tạo</span><b>${fmt(cls.created_at)}</b></div></div></section>
    <section class="card class-members-card"><div class="row between wrap"><div><h2>Thành viên lớp</h2><p class="muted">Bỏ khỏi lớp không xóa tài khoản.</p></div><button id="addStudentsToClass" class="primary">+ Thêm sinh viên</button></div><div class="table-wrap"><table><thead><tr><th>Họ tên</th><th>MSSV</th><th>Email</th><th>Trạng thái</th><th></th></tr></thead><tbody>${students.map(s=>`<tr><td><b>${esc(s.full_name)}</b></td><td>${esc(s.student_code||"—")}</td><td>${esc(s.email||"—")}</td><td>${s.is_active?'<span class="status ok">Hoạt động</span>':'<span class="status off">Khóa</span>'}${s.must_change_password?'<br><span class="status warn">Chờ đổi MK</span>':''}</td><td><div class="row wrap"><button class="ghost sm reset-student-password" data-id="${s.id}" data-name="${esc(s.full_name)}">Sinh lại mật khẩu</button><button class="ghost sm student-active-action" data-id="${s.id}" data-name="${esc(s.full_name)}" data-active="${s.is_active?"1":"0"}">${s.is_active?"Khóa":"Mở khóa"}</button><button class="ghost sm remove-class-member" data-id="${s.id}" data-name="${esc(s.full_name)}">Bỏ khỏi lớp</button><button class="danger sm delete-student-account" data-id="${s.id}" data-name="${esc(s.full_name)}">Xóa TK</button></div></td></tr>`).join("")||'<tr><td colspan="5" class="empty">Lớp chưa có sinh viên.</td></tr>'}</tbody></table></div></section>`;
    const accounts=getAccountsController();
    document.querySelector("#editClass").onclick=()=>openClass(cls);document.querySelector("#addStudentsToClass").onclick=()=>openAddStudentsToClass(cls,users);
    document.querySelectorAll(".reset-student-password").forEach(b=>b.onclick=()=>accounts.openResetStudentPassword(b.dataset.id,b.dataset.name));
    document.querySelectorAll(".student-active-action").forEach(b=>b.onclick=()=>accounts.confirmStudentAccountAction("active",b.dataset.id,b.dataset.name,b.dataset.active==="1"));
    document.querySelectorAll(".remove-class-member").forEach(b=>b.onclick=()=>confirmRemoveStudentFromClass(cls,b.dataset.id,b.dataset.name));
    document.querySelectorAll(".delete-student-account").forEach(b=>b.onclick=()=>accounts.confirmStudentAccountAction("delete",b.dataset.id,b.dataset.name,true));
  }

  function confirmRemoveStudentFromClass(cls,studentId,name){
    modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><h2>Bỏ sinh viên khỏi lớp?</h2><p><b>${esc(name||"Sinh viên")}</b> sẽ được bỏ khỏi <b>${esc(cls.name)}</b>.</p><div class="warning-box">Tài khoản sinh viên vẫn được giữ nguyên.</div><div class="row between"><button type="button" class="secondary" data-close>Hủy</button><button type="button" class="danger" id="doRemoveStudent">Bỏ khỏi lớp</button></div></div></div>`;
    modalRoot.querySelector("[data-close]").onclick=closeModal;
    modalRoot.querySelector("#doRemoveStudent").onclick=async()=>{try{await setStudentClass(studentId,null);closeModal();toast("Đã bỏ sinh viên khỏi lớp");invalidateStaffPage(`class:${cls.id}`);await showStaffPage(`class:${cls.id}`,()=>renderClassDetail(cls.id));}catch(err){toast(err.message,6000);}};
  }

  function openAddStudentsToClass(cls,users){
    const classes=getStaffDataCache().classes||[],classById=Object.fromEntries(classes.map(c=>[c.id,c]));
    const candidates=users.filter(x=>x.role==="student"&&x.class_id!==cls.id).sort((a,b)=>String(a.full_name||"").localeCompare(String(b.full_name||""),"vi"));
    modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal wide"><div class="row between wrap"><div><h2>Thêm sinh viên vào ${esc(cls.name)}</h2><p class="muted">Sinh viên đang ở lớp khác sẽ được chuyển sang lớp này.</p></div><button type="button" class="ghost sm" data-close>Đóng</button></div><label class="member-search">Tìm sinh viên<input id="memberSearch" placeholder="Họ tên, MSSV hoặc email"></label><div class="member-picker">${candidates.map(s=>`<label class="member-pick-row" data-search="${esc(`${s.full_name||""} ${s.student_code||""} ${s.email||""}`.toLowerCase())}"><input type="checkbox" value="${s.id}"><span><b>${esc(s.full_name)}</b><small>${esc(s.student_code||"—")} · ${esc(s.email||"—")}${s.class_id?` · đang ở ${esc(classById[s.class_id]?.name||"lớp khác")}`:" · chưa có lớp"}</small></span></label>`).join("")||'<div class="empty">Không còn sinh viên để thêm.</div>'}</div><div class="row between"><span id="selectedMemberCount" class="muted">0 sinh viên được chọn</span><button type="button" class="primary" id="doAddStudents" ${candidates.length?"":"disabled"}>Thêm vào lớp</button></div></div></div>`;
    modalRoot.querySelector("[data-close]").onclick=closeModal;
    const search=modalRoot.querySelector("#memberSearch"),rows=[...modalRoot.querySelectorAll(".member-pick-row")],checks=[...modalRoot.querySelectorAll('.member-pick-row input[type="checkbox"]')],count=modalRoot.querySelector("#selectedMemberCount");
    const sync=()=>count.textContent=`${checks.filter(x=>x.checked).length} sinh viên được chọn`;checks.forEach(x=>x.onchange=sync);search.oninput=()=>{const q=search.value.trim().toLowerCase();rows.forEach(r=>r.hidden=q&&!r.dataset.search.includes(q));};
    modalRoot.querySelector("#doAddStudents").onclick=async()=>{const ids=checks.filter(x=>x.checked).map(x=>x.value);if(!ids.length)return toast("Chưa chọn sinh viên.");const btn=modalRoot.querySelector("#doAddStudents");btn.disabled=true;try{for(let i=0;i<ids.length;i++){btn.textContent=`Đang thêm ${i+1}/${ids.length}…`;await setStudentClass(ids[i],cls.id);}closeModal();toast(`Đã thêm ${ids.length} sinh viên`);invalidateStaffPage(`class:${cls.id}`);await showStaffPage(`class:${cls.id}`,()=>renderClassDetail(cls.id));}catch(err){btn.disabled=false;btn.textContent="Thêm vào lớp";toast(err.message,7000);}};
  }

  return {renderClasses,renderClassDetail,setStudentClass};
}
