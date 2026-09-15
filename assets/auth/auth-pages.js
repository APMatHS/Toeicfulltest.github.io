import { esc,go } from "../modules/utils.js";

export function createAuthPages(ctx){
  const {
    sb,toast,showLoading,invalidateStaffData,invalidateStaffPage,renderHeader,
    getSession,getProfile,setProfile,loadProfile,getView,getRecoveryMode,setRecoveryMode,rerender
  }=ctx;

  function renderHome(){
    const session=getSession(),profile=getProfile(),view=getView();
    if(session){
      if(!profile) return showLoading("Đang tải hồ sơ...");
      return go(profile.role==="student"?"/student":"/teacher");
    }
    view.innerHTML=`
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
    const session=getSession(),profile=getProfile(),view=getView();
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
      <div class="login-help">
        <a href="#/forgot-password"><b>Quên mật khẩu — Giảng viên / Admin</b></a>
        <p class="muted">Sinh viên quên mật khẩu: vui lòng liên hệ giảng viên để được cấp mật khẩu tạm thời mới.</p>
      </div>
    </section>`;
    document.querySelector("#loginForm").onsubmit=async e=>{
      e.preventDefault();
      const f=new FormData(e.target),btn=e.target.querySelector("button");
      btn.disabled=true;btn.textContent="Đang đăng nhập...";
      const {error}=await sb.auth.signInWithPassword({email:f.get("email"),password:f.get("password")});
      btn.disabled=false;btn.textContent="Đăng nhập";
      if(error) toast(error.message);
    };
  }

  const recoveryRedirectUrl=()=>`${location.origin}${location.pathname}`;

  function renderForgotPassword(){
    const session=getSession(),profile=getProfile(),view=getView();
    if(session){
      if(!profile) return showLoading("Đang tải hồ sơ...");
      return go(profile.role==="student"?"/student":"/teacher");
    }
    view.innerHTML=`<section class="card login-card">
      <a class="muted" href="#/login">← Đăng nhập</a>
      <h1>Quên mật khẩu</h1>
      <p>Dành cho <b>Giảng viên và System Admin</b>. Hệ thống sẽ gửi liên kết đặt lại mật khẩu đến email tài khoản.</p>
      <form id="forgotPasswordForm" class="stack">
        <label>Email<input type="email" name="email" required autocomplete="email"></label>
        <button class="primary">Gửi liên kết đặt lại</button>
      </form>
      <div class="info-box student-password-help"><b>Sinh viên quên mật khẩu?</b><br>Liên hệ giảng viên. Giảng viên có thể sinh mật khẩu tạm thời mới trong mục <b>Tài khoản</b> hoặc <b>Thành viên lớp</b>.</div>
      <div id="forgotPasswordResult" class="muted" aria-live="polite"></div>
    </section>`;
    document.querySelector("#forgotPasswordForm").onsubmit=async e=>{
      e.preventDefault();
      const email=String(new FormData(e.target).get("email")||"").trim().toLowerCase();
      const btn=e.target.querySelector("button"),out=document.querySelector("#forgotPasswordResult");
      btn.disabled=true;btn.textContent="Đang gửi…";out.textContent="";
      const {error}=await sb.functions.invoke("request-password-reset",{body:{email,redirect_to:recoveryRedirectUrl()}});
      btn.disabled=false;btn.textContent="Gửi liên kết đặt lại";
      if(error) return toast("Chưa gửi được yêu cầu. Vui lòng thử lại.",6000);
      out.innerHTML=`<div class="success-box">Nếu email thuộc tài khoản <b>Giảng viên/System Admin đang hoạt động</b>, hệ thống đã gửi liên kết đặt lại mật khẩu. Vui lòng kiểm tra cả thư rác.</div>`;
    };
  }

  async function renderResetPassword(){
    let session=getSession(),profile=getProfile(),view=getView();
    if(!session){
      view.innerHTML=`<section class="card login-card"><h1>Liên kết không còn hiệu lực</h1><p class="muted">Vui lòng yêu cầu gửi lại liên kết đặt mật khẩu.</p><a class="btn primary" href="#/forgot-password">Gửi lại liên kết</a></section>`;
      return;
    }
    if(!profile){await loadProfile();profile=getProfile();}
    if(profile?.role==="student"){
      view.innerHTML=`<section class="card login-card"><h1>Khôi phục mật khẩu sinh viên</h1><div class="warning-box">Sinh viên không tự khôi phục mật khẩu qua email. Vui lòng liên hệ giảng viên để được cấp mật khẩu tạm thời mới.</div><button class="secondary" id="recoveryStudentSignout">Về đăng nhập</button></section>`;
      document.querySelector("#recoveryStudentSignout").onclick=async()=>{setRecoveryMode(false);await sb.auth.signOut();go("/login")};
      return;
    }
    view.innerHTML=`<section class="card login-card">
      <h1>Đặt mật khẩu mới</h1><p class="muted">Tài khoản: ${esc(session.user.email||"")}</p>
      <form id="recoveryPasswordForm" class="stack">
        <label>Mật khẩu mới<input type="password" name="p1" minlength="6" required autocomplete="new-password"></label>
        <label>Nhập lại mật khẩu<input type="password" name="p2" minlength="6" required autocomplete="new-password"></label>
        <button class="primary">Lưu mật khẩu mới</button>
      </form>
    </section>`;
    document.querySelector("#recoveryPasswordForm").onsubmit=async e=>{
      e.preventDefault();
      const f=new FormData(e.target),p1=String(f.get("p1")||""),p2=String(f.get("p2")||"");
      if(p1.length<6) return toast("Mật khẩu tối thiểu 6 ký tự.");
      if(p1!==p2) return toast("Hai mật khẩu chưa trùng nhau.");
      const btn=e.target.querySelector("button");btn.disabled=true;btn.textContent="Đang lưu…";
      const {error}=await sb.auth.updateUser({password:p1});
      btn.disabled=false;btn.textContent="Lưu mật khẩu mới";
      if(error) return toast(error.message,6000);
      setRecoveryMode(false);history.replaceState(null,"",`${location.pathname}#/teacher`);toast("Đã đặt mật khẩu mới");rerender();
    };
  }

  async function renderProfile(){
    let profile=getProfile();
    const session=getSession(),view=getView();
    if(!profile) return showLoading("Đang tải hồ sơ...");
    const canRename=["teacher","system_admin"].includes(profile.role);
    const mustChange=profile.role==="student" && !!profile.must_change_password;
    view.innerHTML=`<section class="card profile-card">
      ${mustChange?"":`<a class="muted" href="${profile.role==="student"?"#/student":"#/teacher"}">← Quay lại</a>`}
      <h1>${mustChange?"Đặt mật khẩu mới":"Hồ sơ"}</h1>
      ${mustChange?`<div class="warning-box"><b>Mật khẩu hiện tại là mật khẩu tạm thời.</b><br>Bạn cần đặt mật khẩu mới trước khi tiếp tục sử dụng hệ thống.</div>`:""}
      <div class="profile-grid">
        <form id="profileNameForm" class="stack"><h3>Thông tin cá nhân</h3>
          <label>Họ và tên<input name="full_name" value="${esc(profile.full_name||"")}" ${canRename?"":"disabled"}></label>
          <label>Email<input value="${esc(session.user.email||"")}" disabled></label>
          ${profile.student_code?`<label>MSSV<input value="${esc(profile.student_code)}" disabled></label>`:""}
          ${canRename?`<button class="primary">Lưu tên</button>`:`<p class="muted">Sinh viên không tự thay đổi họ tên/MSSV.</p>`}
        </form>
        <form id="passwordForm" class="stack"><h3>Đổi mật khẩu</h3>
          <label>Mật khẩu mới<input type="password" name="p1" minlength="6" required autocomplete="new-password"></label>
          <label>Nhập lại mật khẩu<input type="password" name="p2" minlength="6" required autocomplete="new-password"></label>
          <button class="primary">Đổi mật khẩu</button>
        </form>
      </div>
    </section>`;
    if(canRename){
      document.querySelector("#profileNameForm").onsubmit=async e=>{
        e.preventDefault();
        const name=new FormData(e.target).get("full_name"),{data,error}=await sb.rpc("update_own_profile",{p_full_name:name});
        if(error) return toast(error.message);
        profile={...profile,full_name:data.full_name};setProfile(profile);
        invalidateStaffData("users");invalidateStaffPage("teacher");invalidateStaffPage("accounts");renderHeader();toast("Đã đổi tên");
      };
    }
    document.querySelector("#passwordForm").onsubmit=async e=>{
      e.preventDefault();
      const f=new FormData(e.target),p1=String(f.get("p1")||""),p2=String(f.get("p2")||"");
      if(p1.length<6) return toast("Mật khẩu tối thiểu 6 ký tự.");
      if(p1!==p2) return toast("Hai mật khẩu chưa trùng nhau.");
      const btn=e.target.querySelector("button");btn.disabled=true;btn.textContent="Đang đổi...";
      const {error}=await sb.auth.updateUser({password:p1});btn.disabled=false;btn.textContent="Đổi mật khẩu";
      if(error) return toast(error.message);
      if(mustChange){await loadProfile();e.target.reset();toast("Đã đổi mật khẩu. Bạn có thể tiếp tục làm bài.");return go("/student");}
      e.target.reset();toast("Đã đổi mật khẩu");
    };
  }

  return {renderHome,renderLogin,renderForgotPassword,renderResetPassword,renderProfile};
}
