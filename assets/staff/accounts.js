import { esc,fmt,roleLabel,route } from "../modules/utils.js";
import { readWorkbook } from "../services/xlsx-service.js";

export function createAccountsController(ctx){
  const {
    sb,modalRoot,toast,closeModal,showLoading,staffNav,
    prefetchStaffData,getStaffDataCache,invalidateStaffData,invalidateStaffPage,showStaffPage,
    getView,getClassController
  }=ctx;

  async function renderAccounts(){
    const cache=getStaffDataCache();
    if(!cache.users||!cache.classes) showLoading();
    await prefetchStaffData();
    const view=getView(),users=cache.users||[];
    const classes=[...(cache.classes||[])].sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),"vi"));
    const classById=Object.fromEntries(classes.map(c=>[c.id,c]));
    view.innerHTML=`${staffNav("accounts")}<section class="card">
      <div class="row between wrap"><div><h1>Tài khoản</h1><p class="muted">Tài khoản tồn tại độc lập với lớp. Giảng viên có thể sinh lại mật khẩu tạm thời cho sinh viên.</p></div>
      <div class="row wrap"><button class="secondary" id="bulkUser">↑ Nhập danh sách SV</button><button class="primary" id="newUser">+ Tạo tài khoản</button></div></div>
      <div class="table-wrap"><table><thead><tr><th>Họ tên</th><th>Vai trò</th><th>Mã SV</th><th>Email</th><th>Lớp</th><th>Trạng thái</th><th>Ngày tạo</th><th>Thao tác</th></tr></thead>
      <tbody>${users.map(x=>`<tr><td>${esc(x.full_name)}</td><td>${esc(roleLabel(x.role))}</td><td>${esc(x.student_code||"—")}</td><td>${esc(x.email||"—")}</td>
      <td>${x.role==="student"?(x.class_id?`<a href="#/class/${x.class_id}">${esc(classById[x.class_id]?.name||"Lớp")}</a>`:"Chưa gán"):"—"}</td>
      <td>${x.is_active?'<span class="status ok">Hoạt động</span>':'<span class="status off">Khóa</span>'}${x.must_change_password?'<br><span class="status warn">Chờ đổi MK</span>':''}</td><td>${fmt(x.created_at)}</td>
      <td>${x.role==="student"?`<div class="row wrap"><button class="ghost sm reset-student-password" data-id="${x.id}" data-name="${esc(x.full_name)}">Sinh lại mật khẩu</button><button class="ghost sm student-active-action" data-id="${x.id}" data-name="${esc(x.full_name)}" data-active="${x.is_active?"1":"0"}">${x.is_active?"Khóa":"Mở khóa"}</button><button class="danger sm delete-student-account" data-id="${x.id}" data-name="${esc(x.full_name)}">Xóa TK</button></div>`:"—"}</td></tr>`).join("")||'<tr><td colspan="8" class="empty">Chưa có tài khoản</td></tr>'}</tbody></table></div>
    </section>`;
    document.querySelector("#newUser").onclick=()=>openNewUser(classes);
    document.querySelector("#bulkUser").onclick=()=>openBulkStudents(classes);
    document.querySelectorAll(".reset-student-password").forEach(b=>b.onclick=()=>openResetStudentPassword(b.dataset.id,b.dataset.name));
    document.querySelectorAll(".student-active-action").forEach(b=>b.onclick=()=>confirmStudentAccountAction("active",b.dataset.id,b.dataset.name,b.dataset.active==="1"));
    document.querySelectorAll(".delete-student-account").forEach(b=>b.onclick=()=>confirmStudentAccountAction("delete",b.dataset.id,b.dataset.name,true));
  }

  async function confirmStudentAccountAction(action,studentId,name,isActive=true){
    const deleting=action==="delete";
    const title=deleting?"Xóa tài khoản sinh viên?":(isActive?"Khóa tài khoản sinh viên?":"Mở khóa tài khoản sinh viên?");
    const detail=deleting?"Chỉ tài khoản chưa có lịch sử hệ thống mới được xóa. Nếu đã từng làm bài, hệ thống sẽ yêu cầu khóa tài khoản thay vì xóa.":(isActive?"Sinh viên sẽ không thể bắt đầu lượt thi mới cho tới khi được mở khóa.":"Sinh viên sẽ được phép truy cập các bài thi đúng lớp trở lại.");
    modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><h2>${title}</h2><p><b>${esc(name||"Sinh viên")}</b></p><div class="warning-box">${detail}</div><div class="row between"><button class="secondary" data-close>Hủy</button><button class="${deleting?"danger":"primary"}" id="doStudentAccountAction">${deleting?"Xóa tài khoản":(isActive?"Khóa":"Mở khóa")}</button></div></div></div>`;
    modalRoot.querySelector("[data-close]").onclick=closeModal;
    modalRoot.querySelector("#doStudentAccountAction").onclick=async()=>{
      const body=deleting?{action:"delete_student",user_id:studentId}:{action:"set_active",user_id:studentId,is_active:!isActive};
      const {data,error}=await sb.functions.invoke("student-admin",{body});
      if(error||data?.error){const msg=data?.error||error?.message||"Không thực hiện được";if(deleting){closeModal();toast(msg,7000);return confirmStudentAccountAction("active",studentId,name,true);}return toast(msg,7000);}
      closeModal();toast(deleting?"Đã xóa tài khoản":"Đã cập nhật trạng thái tài khoản");
      invalidateStaffData("users");invalidateStaffPage("accounts");invalidateStaffPage("teacher");invalidateStaffPage("classes");
      const r=route();
      if(r.startsWith("/class/")){const cid=r.split("/")[2],classes=getClassController();invalidateStaffPage(`class:${cid}`);await showStaffPage(`class:${cid}`,()=>classes.renderClassDetail(cid));}
      else await showStaffPage("accounts",renderAccounts);
    };
  }

  function openResetStudentPassword(studentId,name){
    modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="row between"><h2>Sinh lại mật khẩu?</h2><button class="ghost sm" data-close>Đóng</button></div><p>Sinh mật khẩu tạm thời mới cho <b>${esc(name||"sinh viên")}</b>.</p><div class="warning-box">Mật khẩu cũ sẽ ngừng hoạt động. Sinh viên phải đổi mật khẩu tạm thời ngay lần đăng nhập tiếp theo.</div><div class="row between"><button class="secondary" data-close2>Hủy</button><button class="primary" id="doResetStudentPassword">Sinh mật khẩu mới</button></div></div></div>`;
    modalRoot.querySelector("[data-close]").onclick=closeModal;modalRoot.querySelector("[data-close2]").onclick=closeModal;
    modalRoot.querySelector("#doResetStudentPassword").onclick=async()=>{
      const btn=modalRoot.querySelector("#doResetStudentPassword");btn.disabled=true;btn.textContent="Đang sinh…";
      const {data,error}=await sb.functions.invoke("manage-user",{body:{action:"reset_student_password",user_id:studentId}});
      if(error||data?.error){btn.disabled=false;btn.textContent="Sinh mật khẩu mới";return toast(data?.error||error.message,6000);}
      const temp=String(data.temporary_password||"");
      modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><h2>Mật khẩu tạm thời mới</h2><p><b>${esc(data.student_name||name||"Sinh viên")}</b></p><div class="temporary-password-box"><code>${esc(temp)}</code><button class="secondary sm" id="copyTemporaryPassword">Sao chép</button></div><div class="warning-box"><b>Chỉ hiển thị mật khẩu này một lần.</b><br>Gửi trực tiếp cho sinh viên. Khi đăng nhập, sinh viên bắt buộc đặt mật khẩu mới.</div><div class="row end"><button class="primary" id="closeTemporaryPassword">Đã lưu mật khẩu</button></div></div></div>`;
      modalRoot.querySelector("#copyTemporaryPassword").onclick=async()=>{try{await navigator.clipboard.writeText(temp);toast("Đã sao chép mật khẩu");}catch{toast("Không sao chép tự động được. Hãy chọn và sao chép thủ công.");}};
      modalRoot.querySelector("#closeTemporaryPassword").onclick=()=>{closeModal();invalidateStaffData("users");invalidateStaffPage("accounts");invalidateStaffPage("teacher");};
    };
  }

  function openNewUser(classes=[]){
    modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="row between"><h2>Tạo tài khoản</h2><button class="ghost sm" data-close>Đóng</button></div><form id="newUserForm" class="stack"><label>Họ và tên<input name="full_name" required></label><label>Email<input type="email" name="email" required></label><label>Mật khẩu ban đầu<input type="password" name="password" minlength="6" required></label><label>Vai trò<select name="role"><option value="student">Sinh viên</option><option value="teacher">Giáo viên</option></select></label><label>Mã sinh viên<input name="student_code"></label><label>Lớp (nếu là sinh viên)<select name="class_id"><option value="">Chưa gán</option>${classes.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label><button class="primary">Tạo tài khoản</button></form></div></div>`;
    modalRoot.querySelector("[data-close]").onclick=closeModal;
    modalRoot.querySelector("#newUserForm").onsubmit=async e=>{
      e.preventDefault();const f=Object.fromEntries(new FormData(e.target)),btn=e.submitter||e.target.querySelector("button[type='submit'],button:not([type])");btn.disabled=true;btn.textContent="Đang tạo...";
      const {data,error}=await sb.functions.invoke("manage-user",{body:{action:"create_user",...f,student_code:f.student_code||null,class_id:f.class_id||null}});
      btn.disabled=false;btn.textContent="Tạo tài khoản";if(error||data?.error)return toast(data?.error||error.message);
      closeModal();toast("Đã tạo tài khoản");invalidateStaffData("users");invalidateStaffPage("accounts");invalidateStaffPage("teacher");showStaffPage("accounts",renderAccounts);
    };
  }

  const normalizeHeader=(s="")=>String(s).trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");
  function mapStudentRows(rows){return rows.map((row,i)=>{const entries=Object.entries(row),get=aliases=>{for(const [k,v] of entries)if(aliases.includes(normalizeHeader(k)))return v;return "";};return {_row:i+2,full_name:String(get(["ho_ten","hoten","name","full_name","ten"])||"").trim(),student_code:String(get(["mssv","ma_sv","masv","student_code","student_id"])||"").trim(),email:String(get(["email","mail"])||"").trim(),password:String(get(["password","mat_khau","matkhau","pass"])||"").trim()};});}

  function openBulkStudents(classes=[]){
    modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal wide"><div class="row between"><div><h2>Nhập danh sách sinh viên</h2><p class="muted">Excel/CSV: Họ tên · MSSV · Email · Password. Password bắt buộc với sinh viên mới; sinh viên đã tồn tại có thể để trống và sẽ được gán/chuyển vào lớp đã chọn, không tạo trùng email.</p></div><button class="ghost sm" data-close>Đóng</button></div><div class="form-grid"><label class="span-2">File Excel/CSV<input id="studentFile" type="file" accept=".xlsx,.xls,.csv" required></label><label class="span-2">Gán vào lớp<select id="bulkClass"><option value="">Chưa gán lớp</option>${classes.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label></div><div id="bulkPreview" class="preview-box muted">Chọn file để xem trước.</div><div class="row between"><span id="bulkSummary" class="muted"></span><button class="primary" id="doBulk" disabled>Nhập sinh viên</button></div></div></div>`;
    modalRoot.querySelector("[data-close]").onclick=closeModal;
    let parsed=[];const input=modalRoot.querySelector("#studentFile"),preview=modalRoot.querySelector("#bulkPreview"),summary=modalRoot.querySelector("#bulkSummary"),goBtn=modalRoot.querySelector("#doBulk");
    input.onchange=async()=>{try{const file=input.files?.[0];if(!file)return;const {XLSX,workbook:wb}=await readWorkbook(file),ws=wb.Sheets[wb.SheetNames[0]];parsed=mapStudentRows(XLSX.utils.sheet_to_json(ws,{defval:""}));const invalid=parsed.filter(r=>!r.full_name||!r.email);preview.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Dòng</th><th>Họ tên</th><th>MSSV</th><th>Email</th><th>Password</th><th></th></tr></thead><tbody>${parsed.slice(0,100).map(r=>`<tr><td>${r._row}</td><td>${esc(r.full_name)}</td><td>${esc(r.student_code)}</td><td>${esc(r.email)}</td><td>${r.password?"••••••":"—"}</td><td>${(!r.full_name||!r.email)?'<span class="status off">Lỗi</span>':'<span class="status ok">OK</span>'}</td></tr>`).join("")}</tbody></table></div>${parsed.length>100?`<p class="muted">Đang hiển thị 100/${parsed.length} dòng.</p>`:""}`;summary.textContent=`${parsed.length} sinh viên · ${invalid.length} dòng chưa hợp lệ`;goBtn.disabled=!parsed.length||invalid.length>0;}catch(err){parsed=[];goBtn.disabled=true;preview.textContent="Không đọc được file.";toast(err.message);}};
    goBtn.onclick=async()=>{const users=parsed.map(({_row,...r})=>r);goBtn.disabled=true;goBtn.textContent="Đang tạo...";const {data,error}=await sb.functions.invoke("student-admin",{body:{action:"bulk_students",class_id:modalRoot.querySelector("#bulkClass").value||null,users}});goBtn.disabled=false;goBtn.textContent="Nhập sinh viên";if(error||data?.error)return toast(data?.error||error.message,6000);const failed=(data.results||[]).filter(x=>!x.ok);if(failed.length){preview.innerHTML=`<div class="warning-box"><b>${data.success}/${data.total} thành công.</b><br>${failed.map(x=>`${esc(x.email)}: ${esc(x.error)}`).join("<br>")}</div>`;summary.textContent=`${data.success} thành công · ${data.failed} lỗi`;return;}closeModal();toast(`Đã xử lý ${data.success} sinh viên`);invalidateStaffData("users");invalidateStaffPage("accounts");invalidateStaffPage("teacher");showStaffPage("accounts",renderAccounts);};
  }

  return {renderAccounts,confirmStudentAccountAction,openResetStudentPassword};
}
