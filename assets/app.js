
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";
import { esc,fmt,route,go,roleLabel,statusBadge,readJSON,writeJSON,debounce } from "./modules/utils.js";
import { createMediaService } from "./modules/media.js";
import { bindAuthoringFilter,renderAuthoringMarkup } from "./modules/authoring-view.js";
import { createAntiCheatController } from "./modules/anti-cheat.js";
import { createExamApp } from "./app-exam.js";
import { loadAttemptCounts,renderStaffTestsTable } from "./modules/staff-tests.js";
import { createStaffResultsController } from "./modules/staff-results.js";
import {
  bindRichEditors,embeddedImagePaths,hydrateEmbeddedImages,
  renderRichText,richEditorField,sanitizeRichHtml
} from "./modules/rich-editor.js";

const recoveryUrlHint = /(?:^|[&#])type=recovery(?:&|$)/.test(location.hash);
const sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const {uploadMedia,signedUrl,signedUrlMap}=createMediaService(sb);
const appView = document.querySelector("#view");
let view = appView;
const sessionActions = document.querySelector("#sessionActions");
const staffHeaderNav = document.querySelector("#staffHeaderNav");
const toastEl = document.querySelector("#toast");
const modalRoot = document.querySelector("#modalRoot");

let session = null;
let profile = null;
let passwordRecoveryMode = recoveryUrlHint;
let liveChannel = null;
let authorDraftTimer = null;
let testWorkspace = null;
const staffPageCache = new Map();
let activeStaffPageKey = null;
const staffDataCache={users:null,classes:null,tests:null,updatedAt:0};
let staffPrefetchPromise=null;

const examApp=createExamApp({
  sb,modalRoot,signedUrlMap,toast,closeModal,showLoading,staffNav,
  getSession:()=>session,
  getProfile:()=>profile,
  getView:()=>view
});
const {
  renderStudent,renderExam,renderStaffPreview,renderStaffPracticeResult,renderResult,
  saveAttemptUi,flushAnswerQueue,setSaveStatus
}=examApp;

const antiCheat=createAntiCheatController({
  getExamState:()=>examApp.getExamState(),
  getRoute:route,
  registerViolation:({attemptId,eventType,details,clientEventId})=>sb.rpc("register_violation_v2",{
    p_attempt_id:attemptId,p_event_type:eventType,p_details:details,p_client_event_id:clientEventId
  }),
  enforceAbsenceTimeout:({attemptId,leaveEventId})=>sb.rpc("enforce_absence_timeout_v1",{
    p_attempt_id:attemptId,p_leave_event_id:leaveEventId
  }),
  onCountChange:count=>{
    examApp.setViolationCount(count);
    const el=document.querySelector("#antiCheatStatus");
    if(el) el.textContent=`Vi phạm: ${count}/3 · rời màn hình tính ngay · quá 15 giây hoặc lần 3 sẽ tự nộp`;
  },
  onWarning:data=>toast(`Đã ghi nhận vi phạm ${data.violation_count}/3. Quá 15 giây hoặc vi phạm lần thứ 3 sẽ tự động nộp bài.`,6000),
  onSubmitted:data=>{
    const id=examApp.getExamState()?.attemptId;
    const msg=data?.reason==="away_over_15_seconds"
      ? "Bài đã tự động nộp vì bạn rời màn hình quá 15 giây."
      : "Bài đã tự động nộp vì đã đủ 3 lần rời màn hình.";
    alert(msg);
    if(id) go(`/result/${id}`);
  }
});
examApp.setAntiCheat(antiCheat);

function toast(msg, ms=3600){
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(()=>toastEl.hidden=true, ms);
}
function closeModal(){ modalRoot.innerHTML = ""; }
function clearLiveChannel(){
  if(liveChannel){ try{ sb.removeChannel(liveChannel); }catch{} liveChannel=null; }
}
const staffResults=createStaffResultsController({
  sb,XLSX,esc,fmt,statusBadge,toast,
  getWorkspace:()=>testWorkspace,
  setLiveChannel:channel=>{liveChannel=channel;},
  clearLiveChannel,
  refreshCurrentTest:(id,tab)=>refreshCurrentTest(id,tab)
});
const {renderPracticeTab,renderLiveTab,renderSubmissionsTab,exportTestExcel}=staffResults;
function uiStateKey(testId){ return `toeic.ui.${session?.user?.id||"anon"}.${testId}`; }
function authorDraftKey(testId){ return `toeic.authorDraft.${session?.user?.id||"anon"}.${testId}`; }
function staffCacheScrollKey(key){ return `toeic.staffView.${session?.user?.id||"anon"}.${key}`; }
function saveActiveStaffScroll(){
  if(!activeStaffPageKey) return;
  const entry=staffPageCache.get(activeStaffPageKey);
  if(!entry) return;
  entry.scroll=window.scrollY;
  writeJSON(staffCacheScrollKey(activeStaffPageKey),{scroll:entry.scroll,updated_at:Date.now()});
}
function clearTransientView(){
  [...appView.children].forEach(el=>{
    if(!el.classList.contains("staff-page-cache")) el.remove();
  });
}
function deactivateStaffPages(){
  saveActiveStaffScroll();
  staffPageCache.forEach(x=>x.el.hidden=true);
  activeStaffPageKey=null;
  view=appView;
}
function clearStaffPages(){
  staffPageCache.clear();
  activeStaffPageKey=null;
  appView.innerHTML="";
  view=appView;
}
function invalidateStaffPage(key){
  const entry=staffPageCache.get(key);
  if(entry?.el) entry.el.remove();
  staffPageCache.delete(key);
  if(activeStaffPageKey===key){activeStaffPageKey=null;view=appView;}
}
function invalidateStaffData(...keys){
  for(const k of keys) staffDataCache[k]=null;
  staffDataCache.updatedAt=0;
}
async function prefetchStaffData(force=false){
  if(!session||!profile||!["teacher","system_admin"].includes(profile.role)) return staffDataCache;
  if(!force && staffDataCache.users && staffDataCache.classes && staffDataCache.tests) return staffDataCache;
  if(staffPrefetchPromise && !force) return staffPrefetchPromise;
  staffPrefetchPromise=Promise.all([
    sb.from("profiles").select("*").order("created_at",{ascending:false}),
    sb.from("classes").select("*").order("created_at",{ascending:false}),
    sb.from("tests").select("*,classes(name)").is("archived_at",null).order("created_at",{ascending:false})
  ]).then(([u,c,t])=>{
    if(!u.error) staffDataCache.users=u.data||[];
    if(!c.error) staffDataCache.classes=c.data||[];
    if(!t.error) staffDataCache.tests=t.data||[];
    staffDataCache.updatedAt=Date.now();
    return staffDataCache;
  }).finally(()=>{staffPrefetchPromise=null;});
  return staffPrefetchPromise;
}
async function showStaffPage(key,initFn,afterShow=null){
  saveActiveStaffScroll();
  // Preview/exam/result screens render directly in #view. Remove that transient
  // markup before restoring a cached staff page, otherwise both screens remain
  // mounted and visually overlap after browser Back or "Thoát làm thử".
  clearTransientView();
  let entry=staffPageCache.get(key);
  if(!entry){
    const el=document.createElement("section");
    el.className="staff-page-cache";
    el.dataset.cacheKey=key;
    const saved=readJSON(staffCacheScrollKey(key),{});
    entry={el,loaded:false,scroll:saved.scroll||0};
    staffPageCache.set(key,entry);
    appView.appendChild(el);
  }
  staffPageCache.forEach((x,k)=>x.el.hidden=k!==key);
  activeStaffPageKey=key;
  view=entry.el;
  if(!entry.loaded){
    entry.loaded=true;
    await initFn();
  }
  if(afterShow) await afterShow();
  requestAnimationFrame(()=>window.scrollTo({top:entry.scroll||0,behavior:"auto"}));
}
function saveTestUi(testId, patch={}){
  const old=readJSON(uiStateKey(testId),{});
  writeJSON(uiStateKey(testId),{...old,...patch,updated_at:Date.now()});
}
function saveAuthorDraftLocal(testId,state){
  const payload={...state,updated_at:new Date().toISOString()};
  writeJSON(authorDraftKey(testId),payload);
  clearTimeout(authorDraftTimer);
  authorDraftTimer=setTimeout(async()=>{
    try{
      await sb.from("authoring_drafts").upsert({user_id:session.user.id,test_id:testId,state:payload,updated_at:new Date().toISOString()});
      const el=document.querySelector("#draftStatus"); if(el) el.textContent="Đã lưu nháp";
    }catch(err){ console.error(err); }
  },900);
  const el=document.querySelector("#draftStatus"); if(el) el.textContent="Đang lưu nháp…";
}
async function getAuthorDraft(testId){
  const local=readJSON(authorDraftKey(testId),null);
  if(local) return local;
  const {data}=await sb.from("authoring_drafts").select("state").eq("user_id",session.user.id).eq("test_id",testId).maybeSingle();
  if(data?.state){ writeJSON(authorDraftKey(testId),data.state); return data.state; }
  return null;
}
async function clearAuthorDraft(testId){
  localStorage.removeItem(authorDraftKey(testId));
  await sb.from("authoring_drafts").delete().eq("user_id",session.user.id).eq("test_id",testId);
}

async function boot(){
  const {data} = await sb.auth.getSession();
  session = data.session;
  if(session) await loadProfile();
  if(passwordRecoveryMode && session){
    history.replaceState(null,"",`${location.pathname}#/reset-password`);
  }

  sb.auth.onAuthStateChange((event, s)=>{
    session = s;
    profile = null;
    if(event==="PASSWORD_RECOVERY") passwordRecoveryMode=true;
    setTimeout(async ()=>{
      if(s) await loadProfile();
      if(passwordRecoveryMode && s){
        history.replaceState(null,"",`${location.pathname}#/reset-password`);
      }
      render();
    }, 0);
  });

  addEventListener("hashchange", render);
  window.addEventListener("online",()=>{setSaveStatus("Có mạng – đang đồng bộ…","pending");flushAnswerQueue()});
  window.addEventListener("offline",()=>setSaveStatus("Mất mạng – đáp án sẽ lưu tạm","offline"));
  document.addEventListener("fullscreenchange",()=>{
    if(!examApp.getExamState() || examApp.getExamState().preview) return;
    saveAttemptUi();
    flushAnswerQueue();
  });
  document.addEventListener("visibilitychange",()=>{
    if(!examApp.getExamState() || examApp.getExamState().preview) return;
    saveAttemptUi();
    if(document.visibilityState==="visible") flushAnswerQueue();
  });
  window.addEventListener("pagehide",()=>{
    if(!examApp.getExamState() || examApp.getExamState().preview) return;
    saveAttemptUi();
  });
  render();
}
async function loadProfile(){
  if(!session) return;
  const {data,error}=await sb.from("profiles").select("*").eq("id",session.user.id).single();
  if(error){ console.error(error); profile=null; return; }
  profile=data;
}
function staffHeaderActive(){
  const p=route();
  if(p==="/teacher") return "home";
  if(p==="/accounts") return "accounts";
  if(p==="/classes" || p.startsWith("/class/")) return "classes";
  if(p==="/tests" || p.startsWith("/test/") || p.startsWith("/preview/") || p.startsWith("/practice-result/") || p.startsWith("/result/")) return "tests";
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
async function render(){
  examApp.stopTimer();
  const p=route();
  if(!p.startsWith("/preview/") && examApp.getExamState()?.preview){
    examApp.resetExamState();
    closeModal();
  }
  const targetTestId = p.startsWith("/test/") ? p.split("/")[2] : null;
  if(targetTestId && testWorkspace && testWorkspace.id!==targetTestId){
    clearLiveChannel();
    testWorkspace=null;
  }
  renderHeader();

  if(passwordRecoveryMode && session && p!=="/reset-password"){
    history.replaceState(null,"",`${location.pathname}#/reset-password`);
    clearStaffPages();
    return renderResetPassword();
  }
  if(session && profile?.role==="student" && profile?.must_change_password && p!=="/profile" && p!=="/reset-password"){
    return go("/profile");
  }

  if(p.startsWith("/exam/")){
    clearStaffPages();
    return renderExam(p.split("/")[2]);
  }
  if(p.startsWith("/preview/")){
    const id=p.split("/")[2];
    clearStaffPages();
    return requireStaff(()=>renderStaffPreview(id));
  }
  if(p.startsWith("/practice-result/")){
    const bits=p.split("/");
    clearStaffPages();
    return requireStaff(()=>renderStaffPracticeResult(bits[2],bits[3]));
  }
  if(p.startsWith("/result/")){
    const id=p.split("/")[2];
    if(profile && ["teacher","system_admin"].includes(profile.role)) return requireStaff(()=>showStaffPage(`result:${id}`,()=>renderResult(id,true)));
    clearStaffPages();
    return renderResult(id,false);
  }
  if(p==="/forgot-password"){
    clearStaffPages();
    return renderForgotPassword();
  }
  if(p==="/reset-password"){
    clearStaffPages();
    return renderResetPassword();
  }
  if(p==="/login"){
    clearStaffPages();
    return renderLogin();
  }
  if(p==="/student"){
    clearStaffPages();
    return requireStudent(renderStudent);
  }

  if(p==="/profile") return session ? showStaffPage("profile",renderProfile) : go("/login");
  if(p==="/teacher") return requireStaff(()=>showStaffPage("teacher",renderTeacher));
  if(p==="/accounts") return requireStaff(()=>showStaffPage("accounts",renderAccounts));
  if(p==="/classes") return requireStaff(()=>showStaffPage("classes",renderClasses));
  if(p.startsWith("/class/")){
    const id=p.split("/")[2];
    return requireStaff(()=>showStaffPage(`class:${id}`,()=>renderClassDetail(id)));
  }
  if(p==="/tests") return requireStaff(()=>showStaffPage("tests",renderTests));
  if(p.startsWith("/test/")){
    const bits=p.split("/"),id=bits[2],tab=bits[3]||"overview";
    return requireStaff(()=>showStaffPage(`test:${id}`,()=>renderTestDetail(id,tab),async()=>{
      if(testWorkspace?.id===id && document.querySelector(`#testWorkspace[data-test-id="${id}"]`)){
        await activateTestTab(id,tab,{push:false,restore:true});
      }else{
        await renderTestDetail(id,tab);
      }
    }));
  }

  clearStaffPages();
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
  if(profile.is_active===false){
    view.innerHTML=`<section class="card"><h2>Tài khoản đang bị khóa</h2><p class="muted">Liên hệ giảng viên để được mở khóa. Tài khoản bị khóa không thể bắt đầu lượt thi mới.</p></section>`;
    return;
  }
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
    <div class="login-help">
      <a href="#/forgot-password"><b>Quên mật khẩu — Giảng viên / Admin</b></a>
      <p class="muted">Sinh viên quên mật khẩu: vui lòng liên hệ giảng viên để được cấp mật khẩu tạm thời mới.</p>
    </div>
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

function recoveryRedirectUrl(){
  return `${location.origin}${location.pathname}`;
}
function renderForgotPassword(){
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
    const btn=e.target.querySelector("button");
    const out=document.querySelector("#forgotPasswordResult");
    btn.disabled=true;btn.textContent="Đang gửi…";out.textContent="";
    const {data,error}=await sb.functions.invoke("request-password-reset",{body:{email,redirect_to:recoveryRedirectUrl()}});
    btn.disabled=false;btn.textContent="Gửi liên kết đặt lại";
    if(error) return toast("Chưa gửi được yêu cầu. Vui lòng thử lại.",6000);
    out.innerHTML=`<div class="success-box">Nếu email thuộc tài khoản <b>Giảng viên/System Admin đang hoạt động</b>, hệ thống đã gửi liên kết đặt lại mật khẩu. Vui lòng kiểm tra cả thư rác.</div>`;
  };
}
async function renderResetPassword(){
  if(!session){
    view.innerHTML=`<section class="card login-card"><h1>Liên kết không còn hiệu lực</h1><p class="muted">Vui lòng yêu cầu gửi lại liên kết đặt mật khẩu.</p><a class="btn primary" href="#/forgot-password">Gửi lại liên kết</a></section>`;
    return;
  }
  if(!profile) await loadProfile();
  if(profile?.role==="student"){
    view.innerHTML=`<section class="card login-card"><h1>Khôi phục mật khẩu sinh viên</h1><div class="warning-box">Sinh viên không tự khôi phục mật khẩu qua email. Vui lòng liên hệ giảng viên để được cấp mật khẩu tạm thời mới.</div><button class="secondary" id="recoveryStudentSignout">Về đăng nhập</button></section>`;
    document.querySelector("#recoveryStudentSignout").onclick=async()=>{passwordRecoveryMode=false;await sb.auth.signOut();go("/login")};
    return;
  }
  view.innerHTML=`<section class="card login-card">
    <h1>Đặt mật khẩu mới</h1>
    <p class="muted">Tài khoản: ${esc(session.user.email||"")}</p>
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
    passwordRecoveryMode=false;
    history.replaceState(null,"",`${location.pathname}#/teacher`);
    toast("Đã đặt mật khẩu mới");
    render();
  };
}


async function renderProfile(){
  if(!profile) return showLoading("Đang tải hồ sơ...");
  const canRename=["teacher","system_admin"].includes(profile.role);
  const mustChange=profile.role==="student" && !!profile.must_change_password;
  view.innerHTML=`<section class="card profile-card">
    ${mustChange?"":`<a class="muted" href="${profile.role==="student"?"#/student":"#/teacher"}">← Quay lại</a>`}
    <h1>${mustChange?"Đặt mật khẩu mới":"Hồ sơ"}</h1>
    ${mustChange?`<div class="warning-box"><b>Mật khẩu hiện tại là mật khẩu tạm thời.</b><br>Bạn cần đặt mật khẩu mới trước khi tiếp tục sử dụng hệ thống.</div>`:""}
    <div class="profile-grid">
      <form id="profileNameForm" class="stack">
        <h3>Thông tin cá nhân</h3>
        <label>Họ và tên<input name="full_name" value="${esc(profile.full_name||"")}" ${canRename?"":"disabled"}></label>
        <label>Email<input value="${esc(session.user.email||"")}" disabled></label>
        ${profile.student_code?`<label>MSSV<input value="${esc(profile.student_code)}" disabled></label>`:""}
        ${canRename?`<button class="primary">Lưu tên</button>`:`<p class="muted">Sinh viên không tự thay đổi họ tên/MSSV.</p>`}
      </form>
      <form id="passwordForm" class="stack">
        <h3>Đổi mật khẩu</h3>
        <label>Mật khẩu mới<input type="password" name="p1" minlength="6" required autocomplete="new-password"></label>
        <label>Nhập lại mật khẩu<input type="password" name="p2" minlength="6" required autocomplete="new-password"></label>
        <button class="primary">Đổi mật khẩu</button>
      </form>
    </div>
  </section>`;
  if(canRename){
    document.querySelector("#profileNameForm").onsubmit=async e=>{
      e.preventDefault();
      const name=new FormData(e.target).get("full_name");
      const {data,error}=await sb.rpc("update_own_profile",{p_full_name:name});
      if(error) return toast(error.message);
      profile.full_name=data.full_name;
      invalidateStaffData("users"); invalidateStaffPage("teacher"); invalidateStaffPage("accounts");
      renderHeader(); toast("Đã đổi tên");
    };
  }
  document.querySelector("#passwordForm").onsubmit=async e=>{
    e.preventDefault();
    const f=new FormData(e.target),p1=String(f.get("p1")||""),p2=String(f.get("p2")||"");
    if(p1.length<6) return toast("Mật khẩu tối thiểu 6 ký tự.");
    if(p1!==p2) return toast("Hai mật khẩu chưa trùng nhau.");
    const btn=e.target.querySelector("button");btn.disabled=true;btn.textContent="Đang đổi...";
    const {error}=await sb.auth.updateUser({password:p1});
    btn.disabled=false;btn.textContent="Đổi mật khẩu";
    if(error) return toast(error.message);
    if(mustChange){
      await loadProfile();
      e.target.reset();toast("Đã đổi mật khẩu. Bạn có thể tiếp tục làm bài.");
      return go("/student");
    }
    e.target.reset();toast("Đã đổi mật khẩu");
  };
}

function staffNav(_active){ return ""; }
async function renderTeacher(){
  if(!staffDataCache.users||!staffDataCache.classes||!staffDataCache.tests) showLoading();
  await prefetchStaffData();
  const users=staffDataCache.users||[],classes=staffDataCache.classes||[],tests=staffDataCache.tests||[];
  const sCount=users.filter(x=>x.role==="student").length;
  const tCount=users.filter(x=>["teacher","system_admin"].includes(x.role)).length;
  view.innerHTML=`${staffNav("home")}
  <section class="card">
    <h1>Bảng điều khiển</h1>
    <div class="muted">${esc(profile.full_name)} · ${esc(roleLabel(profile.role))}</div>
  </section>
  <section class="grid grid-4 kpi-grid">
    ${[["Sinh viên",sCount],["Giảng viên",tCount],["Lớp",classes.length],["Bài kiểm tra",tests.length]]
      .map(([a,b])=>`<div class="card"><div class="muted">${a}</div><div class="kpi">${b}</div></div>`).join("")}
  </section>
  <h2 class="section-title">Thao tác nhanh</h2>
  <section class="grid grid-3">
    <a class="card card-link" href="#/accounts"><h3>Tài khoản</h3><p class="muted">Tạo từng người hoặc nhập danh sách sinh viên từ Excel/CSV.</p></a>
    <a class="card card-link" href="#/classes"><h3>Lớp</h3><p class="muted">Tạo lớp và gán sinh viên.</p></a>
    <a class="card card-link" href="#/tests"><h3>Bài kiểm tra</h3><p class="muted">Tạo thủ công, nhập file, nhân bản bài cũ và chuẩn bị AI.</p></a>
  </section>`;
  if(Date.now()-(staffDataCache.updatedAt||0)>60000) setTimeout(()=>prefetchStaffData(true),0);
}

async function renderAccounts(){
  if(!staffDataCache.users||!staffDataCache.classes) showLoading();
  await prefetchStaffData();
  const users=staffDataCache.users||[];
  const classes=[...(staffDataCache.classes||[])].sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),"vi"));
  const classById=Object.fromEntries(classes.map(c=>[c.id,c]));
  view.innerHTML=`${staffNav("accounts")}
  <section class="card">
    <div class="row between wrap">
      <div><h1>Tài khoản</h1><p class="muted">Tài khoản tồn tại độc lập với lớp. Giảng viên có thể sinh lại mật khẩu tạm thời cho sinh viên.</p></div>
      <div class="row wrap">
        <button class="secondary" id="bulkUser">↑ Nhập danh sách SV</button>
        <button class="primary" id="newUser">+ Tạo tài khoản</button>
      </div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Họ tên</th><th>Vai trò</th><th>Mã SV</th><th>Email</th><th>Lớp</th><th>Trạng thái</th><th>Ngày tạo</th><th>Thao tác</th></tr></thead>
      <tbody>${users.map(x=>`<tr>
        <td>${esc(x.full_name)}</td><td>${esc(roleLabel(x.role))}</td><td>${esc(x.student_code||"—")}</td><td>${esc(x.email||"—")}</td>
        <td>${x.role==="student"?(x.class_id?`<a href="#/class/${x.class_id}">${esc(classById[x.class_id]?.name||"Lớp")}</a>`:"Chưa gán"):"—"}</td>
        <td>${x.is_active?'<span class="status ok">Hoạt động</span>':'<span class="status off">Khóa</span>'}${x.must_change_password?'<br><span class="status warn">Chờ đổi MK</span>':''}</td>
        <td>${fmt(x.created_at)}</td>
        <td>${x.role==="student"?`<div class="row wrap"><button class="ghost sm reset-student-password" data-id="${x.id}" data-name="${esc(x.full_name)}">Sinh lại mật khẩu</button><button class="ghost sm student-active-action" data-id="${x.id}" data-name="${esc(x.full_name)}" data-active="${x.is_active?"1":"0"}">${x.is_active?"Khóa":"Mở khóa"}</button><button class="danger sm delete-student-account" data-id="${x.id}" data-name="${esc(x.full_name)}">Xóa TK</button></div>`:"—"}</td></tr>`).join("")||`<tr><td colspan="8" class="empty">Chưa có tài khoản</td></tr>`}</tbody>
    </table></div>
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
  const detail=deleting
    ? "Chỉ tài khoản chưa có lịch sử hệ thống mới được xóa. Nếu đã từng làm bài, hệ thống sẽ yêu cầu khóa tài khoản thay vì xóa."
    : (isActive?"Sinh viên sẽ không thể bắt đầu lượt thi mới cho tới khi được mở khóa.":"Sinh viên sẽ được phép truy cập các bài thi đúng lớp trở lại.");
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><h2>${title}</h2><p><b>${esc(name||"Sinh viên")}</b></p><div class="warning-box">${detail}</div><div class="row between"><button class="secondary" data-close>Hủy</button><button class="${deleting?"danger":"primary"}" id="doStudentAccountAction">${deleting?"Xóa tài khoản":(isActive?"Khóa":"Mở khóa")}</button></div></div></div>`;
  modalRoot.querySelector("[data-close]").onclick=closeModal;
  modalRoot.querySelector("#doStudentAccountAction").onclick=async()=>{
    const body=deleting?{action:"delete_student",user_id:studentId}:{action:"set_active",user_id:studentId,is_active:!isActive};
    const {data,error}=await sb.functions.invoke("student-admin",{body});
    if(error||data?.error){
      const msg=data?.error||error?.message||"Không thực hiện được";
      if(deleting){
        closeModal();
        toast(msg,7000);
        return confirmStudentAccountAction("active",studentId,name,true);
      }
      return toast(msg,7000);
    }
    closeModal();toast(deleting?"Đã xóa tài khoản":"Đã cập nhật trạng thái tài khoản");
    invalidateStaffData("users");invalidateStaffPage("accounts");invalidateStaffPage("teacher");invalidateStaffPage("classes");
    const r=route(); if(r.startsWith("/class/")){const cid=r.split("/")[2];invalidateStaffPage(`class:${cid}`);await showStaffPage(`class:${cid}`,()=>renderClassDetail(cid));}else await showStaffPage("accounts",renderAccounts);
  };
}

function openResetStudentPassword(studentId,name){
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal">
    <div class="row between"><h2>Sinh lại mật khẩu?</h2><button class="ghost sm" data-close>Đóng</button></div>
    <p>Sinh mật khẩu tạm thời mới cho <b>${esc(name||"sinh viên")}</b>.</p>
    <div class="warning-box">Mật khẩu cũ sẽ ngừng hoạt động. Sinh viên phải đổi mật khẩu tạm thời ngay lần đăng nhập tiếp theo.</div>
    <div class="row between"><button class="secondary" data-close2>Hủy</button><button class="primary" id="doResetStudentPassword">Sinh mật khẩu mới</button></div>
  </div></div>`;
  modalRoot.querySelector("[data-close]").onclick=closeModal;
  modalRoot.querySelector("[data-close2]").onclick=closeModal;
  modalRoot.querySelector("#doResetStudentPassword").onclick=async()=>{
    const btn=modalRoot.querySelector("#doResetStudentPassword");btn.disabled=true;btn.textContent="Đang sinh…";
    const {data,error}=await sb.functions.invoke("manage-user",{body:{action:"reset_student_password",user_id:studentId}});
    if(error||data?.error){btn.disabled=false;btn.textContent="Sinh mật khẩu mới";return toast(data?.error||error.message,6000);}
    const temp=String(data.temporary_password||"");
    modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal">
      <h2>Mật khẩu tạm thời mới</h2>
      <p><b>${esc(data.student_name||name||"Sinh viên")}</b></p>
      <div class="temporary-password-box"><code id="temporaryPasswordValue">${esc(temp)}</code><button class="secondary sm" id="copyTemporaryPassword">Sao chép</button></div>
      <div class="warning-box"><b>Chỉ hiển thị mật khẩu này một lần.</b><br>Gửi trực tiếp cho sinh viên. Khi đăng nhập, sinh viên bắt buộc đặt mật khẩu mới.</div>
      <div class="row end"><button class="primary" id="closeTemporaryPassword">Đã lưu mật khẩu</button></div>
    </div></div>`;
    modalRoot.querySelector("#copyTemporaryPassword").onclick=async()=>{
      try{await navigator.clipboard.writeText(temp);toast("Đã sao chép mật khẩu");}
      catch{toast("Không sao chép tự động được. Hãy chọn và sao chép thủ công.");}
    };
    modalRoot.querySelector("#closeTemporaryPassword").onclick=()=>{
      closeModal();invalidateStaffData("users");invalidateStaffPage("accounts");invalidateStaffPage("teacher");
    };
  };
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
    const btn=e.submitter || e.target.querySelector("button[type='submit'],button:not([type])");
    btn.disabled=true; btn.textContent="Đang tạo...";
    const {data,error}=await sb.functions.invoke("manage-user",{body:{
      action:"create_user",...f,student_code:f.student_code||null,class_id:f.class_id||null
    }});
    btn.disabled=false; btn.textContent="Tạo tài khoản";
    if(error||data?.error) return toast(data?.error||error.message);
    closeModal(); toast("Đã tạo tài khoản"); invalidateStaffData("users"); invalidateStaffPage("accounts"); invalidateStaffPage("teacher"); showStaffPage("accounts",renderAccounts);
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
    <div class="row between"><div><h2>Nhập danh sách sinh viên</h2><p class="muted">Excel/CSV: Họ tên · MSSV · Email · Password. Password bắt buộc với sinh viên mới; sinh viên đã tồn tại có thể để trống và sẽ được gán/chuyển vào lớp đã chọn, không tạo trùng email.</p></div><button class="ghost sm" data-close>Đóng</button></div>
    <div class="form-grid">
      <label class="span-2">File Excel/CSV<input id="studentFile" type="file" accept=".xlsx,.xls,.csv" required></label>
      <label class="span-2">Gán vào lớp<select id="bulkClass"><option value="">Chưa gán lớp</option>${classes.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label>
    </div>
    <div id="bulkPreview" class="preview-box muted">Chọn file để xem trước.</div>
    <div class="row between"><span id="bulkSummary" class="muted"></span><button class="primary" id="doBulk" disabled>Nhập sinh viên</button></div>
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
      const invalid=parsed.filter(r=>!r.full_name||!r.email);
      preview.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Dòng</th><th>Họ tên</th><th>MSSV</th><th>Email</th><th>Password</th><th></th></tr></thead>
      <tbody>${parsed.slice(0,100).map(r=>`<tr><td>${r._row}</td><td>${esc(r.full_name)}</td><td>${esc(r.student_code)}</td><td>${esc(r.email)}</td><td>${r.password?"••••••":"—"}</td><td>${(!r.full_name||!r.email)?'<span class="status off">Lỗi</span>':'<span class="status ok">OK</span>'}</td></tr>`).join("")}</tbody></table></div>
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
    const {data,error}=await sb.functions.invoke("student-admin",{body:{
      action:"bulk_students",
      class_id:modalRoot.querySelector("#bulkClass").value||null,
      users
    }});
    goBtn.disabled=false; goBtn.textContent="Nhập sinh viên";
    if(error||data?.error) return toast(data?.error||error.message,6000);
    const failed=(data.results||[]).filter(x=>!x.ok);
    if(failed.length){
      preview.innerHTML=`<div class="warning-box"><b>${data.success}/${data.total} thành công.</b><br>${failed.map(x=>`${esc(x.email)}: ${esc(x.error)}`).join("<br>")}</div>`;
      summary.textContent=`${data.success} thành công · ${data.failed} lỗi`;
      return;
    }
    closeModal(); toast(`Đã xử lý ${data.success} sinh viên`); invalidateStaffData("users"); invalidateStaffPage("accounts"); invalidateStaffPage("teacher"); showStaffPage("accounts",renderAccounts);
  };
}

async function renderClasses(){
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
      <td>${s.is_active?'<span class="status ok">Hoạt động</span>':'<span class="status off">Khóa</span>'}${s.must_change_password?'<br><span class="status warn">Chờ đổi MK</span>':''}</td>
      <td><div class="row wrap"><button class="ghost sm reset-student-password" data-id="${s.id}" data-name="${esc(s.full_name)}">Sinh lại mật khẩu</button><button class="ghost sm student-active-action" data-id="${s.id}" data-name="${esc(s.full_name)}" data-active="${s.is_active?"1":"0"}">${s.is_active?"Khóa":"Mở khóa"}</button><button class="ghost sm remove-class-member" data-id="${s.id}" data-name="${esc(s.full_name)}">Bỏ khỏi lớp</button><button class="danger sm delete-student-account" data-id="${s.id}" data-name="${esc(s.full_name)}">Xóa TK</button></div></td></tr>`).join("")||`<tr><td colspan="5" class="empty">Lớp chưa có sinh viên.</td></tr>`}</tbody></table></div>
  </section>`;
  document.querySelector("#editClass").onclick=()=>openClass(cls);
  document.querySelector("#addStudentsToClass").onclick=()=>openAddStudentsToClass(cls,users);
  document.querySelectorAll(".reset-student-password").forEach(b=>b.onclick=()=>openResetStudentPassword(b.dataset.id,b.dataset.name));
  document.querySelectorAll(".student-active-action").forEach(b=>b.onclick=()=>confirmStudentAccountAction("active",b.dataset.id,b.dataset.name,b.dataset.active==="1"));
  document.querySelectorAll(".remove-class-member").forEach(b=>b.onclick=()=>confirmRemoveStudentFromClass(cls,b.dataset.id,b.dataset.name));
  document.querySelectorAll(".delete-student-account").forEach(b=>b.onclick=()=>confirmStudentAccountAction("delete",b.dataset.id,b.dataset.name,true));
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

async function renderTests(){
  if(!staffDataCache.tests) showLoading();
  await prefetchStaffData();
  const data=staffDataCache.tests||[];
  const counts=await loadAttemptCounts(sb,data);
  view.innerHTML=`${staffNav("tests")}
  <section class="card">
    <div class="row between wrap"><div><h1>Bài kiểm tra</h1><p class="muted">Lượt đã làm là số lượt thật trong hệ thống; giới hạn/SV là số lần tối đa mỗi sinh viên được phép làm.</p></div><button id="newTest" class="primary">+ Tạo bài kiểm tra</button></div>
    ${renderStaffTestsTable({tests:data,counts,esc,statusBadge})}
  </section>`;
  document.querySelector("#newTest").onclick=openNewTest;
}
function toLocalInput(dt){
  if(!dt) return "";
  const d=new Date(dt),pad=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
async function createReadingParts(testId){
  for(const p of [
    {part_no:5,title:"Part 5",shuffle_mode:"shuffle_questions",sort_order:1},
    {part_no:6,title:"Part 6",shuffle_mode:"shuffle_stimulus_groups",sort_order:2},
    {part_no:7,title:"Part 7",shuffle_mode:"fixed",sort_order:3}
  ]){
    const r=await sb.rpc("staff_upsert_part",{p_data:{...p,test_id:testId}});
    if(r.error) throw r.error;
  }
}
async function openNewTest(){
  const [{data:classes=[]},{data:oldTests=[]}] = await Promise.all([
    sb.from("classes").select("id,name").order("name"),
    sb.from("tests").select("id,title,class_id,duration_minutes,max_attempts").is("archived_at",null).order("created_at",{ascending:false})
  ]);
  const classOptions=`<option value="">Chưa gán lớp</option>${classes.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")}`;
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal wide create-test-modal">
    <div class="row between wrap"><div><h2>Tạo bài kiểm tra</h2><p class="muted">Bốn luồng dùng chung một cấu trúc đề; AI chỉ tạo bản nháp và sẽ nối ở giai đoạn sau.</p></div><button class="ghost sm" data-close>Đóng</button></div>
    <div class="tabs create-mode-tabs">
      <button type="button" class="btn tab active create-mode" data-mode="manual">Tạo thủ công</button>
      <button type="button" class="btn tab create-mode" data-mode="import">Nhập từ file</button>
      <button type="button" class="btn tab create-mode" data-mode="clone">Từ bài kiểm tra cũ</button>
      <button type="button" class="btn tab create-mode" data-mode="ai">Tạo đề bằng AI <span class="soon-badge">Sau</span></button>
    </div>

    <section class="create-mode-panel" data-mode-panel="manual">
      <form id="manualTestForm" class="form-grid">
        <label class="span-2">Tên bài<input name="title" required></label>
        <label>Lớp<select name="class_id">${classOptions}</select></label>
        <label>Thời gian (phút)<input type="number" name="duration_minutes" value="75" min="1" required></label>
        <label>Số lần làm<input type="number" name="max_attempts" value="1" min="1" required></label>
        <label>Chống gian lận<select name="anti_cheat_mode"><option value="warn_then_submit">Cảnh báo rồi tự nộp</option><option value="strict">Nghiêm ngặt</option><option value="off">Tắt</option></select></label>
        <label>Mở lúc<input type="datetime-local" name="opens_at"></label>
        <label>Đóng lúc<input type="datetime-local" name="closes_at"></label>
        <label class="span-2">Mô tả<textarea name="description" rows="3"></textarea></label>
        <label class="check-row span-2"><input type="checkbox" name="show_answers_after_submit" checked> Cho xem đáp án sau khi nộp</label>
        <div class="span-2 warning-box"><b>Tạo thủ công</b><br>Web tạo sẵn Part 5, 6, 7. Sau đó giảng viên vào Soạn đề để thêm stimulus, câu hỏi, ảnh/audio và đáp án.</div>
        <button type="submit" class="primary span-2">Tạo bài nháp</button>
      </form>
    </section>

    <section class="create-mode-panel" data-mode-panel="import" hidden>
      <div class="form-grid">
        <label class="span-2">File đề<input id="importTestFile" type="file" accept=".pdf,.docx,.xlsx,.xls"></label>
        <label>Kiểu nhập<select id="importMode"><option value="original">Giữ nguyên đề gốc</option><option value="structured">Tách thành câu hỏi có cấu trúc</option></select></label>
        <label>Loại đề<select id="importTestType"><option>Reading</option><option>Listening</option><option>Full Test</option><option>Tùy chỉnh</option></select></label>
        <label class="span-2">Đáp án (tùy chọn)<textarea id="importAnswers" rows="4" placeholder="Ví dụ: 101 B, 102 C, 103 A, ..."></textarea></label>
      </div>
      <div id="importFilePreview" class="file-drop-preview muted">Chọn PDF/DOCX/XLSX để xem thông tin file. File chưa được gửi đi ở phiên bản này.</div>
      <div class="ai-placeholder-card">
        <div><b>Nhận diện bằng AI</b><p class="muted">Frontend đã sẵn sàng. Sau này Edge Function + AI sẽ phân tích file và trả bản nháp để giảng viên duyệt.</p></div>
        <button class="primary" disabled>Phân tích đề bằng AI · Sắp hỗ trợ</button>
      </div>
    </section>

    <section class="create-mode-panel" data-mode-panel="clone" hidden>
      <form id="cloneTestForm" class="form-grid">
        <label class="span-2">Bài kiểm tra nguồn<select name="source_test_id" required><option value="">Chọn bài…</option>${oldTests.map(t=>`<option value="${t.id}" data-duration="${t.duration_minutes}" data-max="${t.max_attempts}" data-class="${t.class_id||""}">${esc(t.title)}</option>`).join("")}</select></label>
        <label class="span-2">Tên bài mới<input name="title" required placeholder="Tên bài kiểm tra mới"></label>
        <label>Lớp<select name="class_id">${classOptions}</select></label>
        <label>Thời gian (phút)<input type="number" name="duration_minutes" value="75" min="1" required></label>
        <label>Số lần làm<input type="number" name="max_attempts" value="1" min="1" required></label>
        <label>Mở lúc<input type="datetime-local" name="opens_at"></label>
        <label>Đóng lúc<input type="datetime-local" name="closes_at"></label>
        <div class="span-2 warning-box"><b>Chỉ sao chép nội dung đề.</b><br>Part, stimulus, media, câu hỏi và đáp án được nhân bản. Lượt làm, điểm, LIVE và vi phạm của bài cũ không được sao chép.</div>
        <button type="submit" class="primary span-2">Tạo bản sao</button>
      </form>
    </section>

    <section class="create-mode-panel" data-mode-panel="ai" hidden>
      <div class="form-grid">
        <label>Part<select><option>Part 5</option><option>Part 6</option><option>Part 7</option><option>Nhiều Part</option></select></label>
        <label>Số câu<input type="number" value="10" min="1"></label>
        <label>Mức độ<select><option>Cơ bản</option><option>Trung bình</option><option>Nâng cao</option><option>Phối hợp</option></select></label>
        <label>Media<select><option>Không bắt buộc</option><option>Có hình ảnh</option><option>Có audio</option></select></label>
        <label class="span-2">Chủ đề / ngữ cảnh<textarea rows="3" placeholder="Ví dụ: workplace, travel, customer service…"></textarea></label>
        <label class="span-2">Nguồn tham chiếu<textarea rows="3" placeholder="Có thể bổ sung tài liệu tham chiếu sau này"></textarea></label>
      </div>
      <div class="ai-placeholder-card"><div><b>Tạo đề bằng AI</b><p class="muted">Giao diện được dành sẵn để sau này nối AI. AI sẽ chỉ tạo Draft; giảng viên phải duyệt trước khi Publish.</p></div><button class="primary" disabled>Tạo bản nháp bằng AI · Sắp hỗ trợ</button></div>
    </section>
  </div></div>`;
  modalRoot.querySelector("[data-close]").onclick=closeModal;
  const showMode=mode=>{
    modalRoot.querySelectorAll(".create-mode").forEach(b=>b.classList.toggle("active",b.dataset.mode===mode));
    modalRoot.querySelectorAll(".create-mode-panel").forEach(p=>p.hidden=p.dataset.modePanel!==mode);
  };
  modalRoot.querySelectorAll(".create-mode").forEach(b=>b.onclick=()=>showMode(b.dataset.mode));

  const importFile=modalRoot.querySelector("#importTestFile"),importPreview=modalRoot.querySelector("#importFilePreview");
  importFile.onchange=()=>{
    const f=importFile.files?.[0];
    if(!f){importPreview.textContent="Chọn PDF/DOCX/XLSX để xem thông tin file.";return;}
    importPreview.innerHTML=`<b>${esc(f.name)}</b><br><span class="muted">${(f.size/1024/1024).toFixed(2)} MB · ${esc(f.type||"không xác định")}</span><br><span class="small">Chưa upload. Khi nối AI, file sẽ được gửi qua backend để phân tích và tạo Draft.</span>`;
  };

  modalRoot.querySelector("#manualTestForm").onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(e.target),f=Object.fromEntries(fd);
    f.class_id=f.class_id||null;
    f.duration_minutes=Number(f.duration_minutes);
    f.max_attempts=Number(f.max_attempts);
    ["opens_at","closes_at"].forEach(k=>f[k]=f[k]?new Date(f[k]).toISOString():null);
    Object.assign(f,{status:"draft",show_answers_after_submit:fd.has("show_answers_after_submit"),allowed_violations:2});
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
  };

  const cloneForm=modalRoot.querySelector("#cloneTestForm");
  cloneForm.querySelector("[name=source_test_id]").onchange=e=>{
    const o=e.target.selectedOptions[0]; if(!o?.value) return;
    cloneForm.querySelector("[name=title]").value=`${o.textContent} - Bản sao`;
    cloneForm.querySelector("[name=duration_minutes]").value=o.dataset.duration||75;
    cloneForm.querySelector("[name=max_attempts]").value=o.dataset.max||1;
    cloneForm.querySelector("[name=class_id]").value=o.dataset.class||"";
  };
  cloneForm.onsubmit=async e=>{
    e.preventDefault();
    const f=Object.fromEntries(new FormData(e.target)); const source=f.source_test_id; delete f.source_test_id;
    ["opens_at","closes_at"].forEach(k=>f[k]=f[k]?new Date(f[k]).toISOString():"");
    const btn=e.submitter || e.target.querySelector("button[type='submit'],button:not([type])");btn.disabled=true;btn.textContent="Đang nhân bản…";
    const {data,error}=await sb.rpc("staff_clone_test",{p_source_test_id:source,p_overrides:f});
    btn.disabled=false;btn.textContent="Tạo bản sao";
    if(error) return toast(error.message,6000);
    invalidateStaffData("tests"); invalidateStaffPage("tests"); invalidateStaffPage("teacher"); closeModal(); toast("Đã tạo bài từ bài kiểm tra cũ"); go(`/test/${data}`);
  };
}


function testTabs(testId,active){
  const items=[["overview","Tổng quan"],["practice","Làm thử"],["live","LIVE"],["submissions","Bài làm"],["authoring","Soạn đề"],["settings","Cài đặt"]];
  return `<div class="tabs test-tabs">${items.map(([k,l])=>`<button type="button" class="btn tab test-tab-btn ${active===k?"active":""}" data-tab="${k}" data-test="${testId}">${l}</button>`).join("")}</div>`;
}
function saveWorkspaceTabScroll(){
  if(!testWorkspace || !testWorkspace.activeTab) return;
  testWorkspace.scrolls[testWorkspace.activeTab] = window.scrollY;
  saveTestUi(testWorkspace.id,{tab:testWorkspace.activeTab,scrolls:testWorkspace.scrolls,scrollY:window.scrollY});
}
function setTestUrl(id,tab,push=true){
  const next=`#/test/${id}/${tab}`;
  if(location.hash===next) return;
  if(push) history.pushState({testId:id,tab},"",next);
  else history.replaceState({testId:id,tab},"",next);
}
async function activateTestTab(id,tab,{push=true,restore=true}={}){
  if(!testWorkspace || testWorkspace.id!==id) return renderTestDetail(id,tab);
  const valid=["overview","practice","live","submissions","authoring","settings"];
  if(!valid.includes(tab)) tab="overview";
  saveWorkspaceTabScroll();
  document.querySelectorAll(".test-panel").forEach(el=>el.hidden=el.dataset.panel!==tab);
  document.querySelectorAll(".test-tab-btn").forEach(btn=>btn.classList.toggle("active",btn.dataset.tab===tab));
  testWorkspace.activeTab=tab;
  setTestUrl(id,tab,push);
  if(tab==="live" && !testWorkspace.loaded.live){
    testWorkspace.loaded.live=true;
    await renderLiveTab(id);
  }else if(tab==="submissions" && !testWorkspace.loaded.submissions){
    testWorkspace.loaded.submissions=true;
    await renderSubmissionsTab(id);
  }else if(tab==="practice" && !testWorkspace.loaded.practice){
    testWorkspace.loaded.practice=true;
    await renderPracticeTab(id);
  }
  const target=(testWorkspace.scrolls?.[tab]??0);
  if(restore) requestAnimationFrame(()=>window.scrollTo({top:target,behavior:"auto"}));
}
function invalidateTestWorkspace(id){
  if(testWorkspace?.id===id){
    saveWorkspaceTabScroll();
    clearLiveChannel();
    testWorkspace=null;
  }
}
async function renderTestDetail(id,tab="overview"){
  const mounted=document.querySelector(`#testWorkspace[data-test-id="${id}"]`);
  if(testWorkspace?.id===id && mounted){
    return activateTestTab(id,tab,{push:false,restore:true});
  }

  showLoading();
  const {data,error}=await sb.rpc("get_test_authoring",{p_test_id:id});
  if(error){ view.innerHTML=`${staffNav("tests")}<div class="card">${esc(error.message)}</div>`; return; }
  const t=data.test, parts=data.parts||[], qs=data.questions||[], groups=data.stimulus_groups||[];
  await hydrateAuthoringRichContent(qs,groups);
  const draft=await getAuthorDraft(id);
  const savedUi=readJSON(uiStateKey(id),{});
  const scrolls=savedUi.scrolls||{authoring:savedUi.scrollY||0};
  const locked=!!t.content_locked_at;
  const staticCount=groups.flatMap(g=>g.stimuli||[]).filter(s=>String(s.storage_path||"").startsWith("static:")).length;

  testWorkspace={id,data,t,parts,qs,groups,draft,activeTab:null,scrolls,loaded:{practice:false,live:false,submissions:false},liveFilter:"all"};
  const head=`${staffNav("tests")}
  <section class="card">
    <div class="row between wrap">
      <div><a href="#/tests" class="muted">← Danh sách</a><h1>${esc(t.title)}</h1>
        <div class="row wrap">${statusBadge(t.status)}<span class="badge">${t.duration_minutes} phút</span><span class="badge">${qs.length} câu</span><span class="badge">${t.max_attempts} lượt</span>${locked?'<span class="status warn">🔒 Đã khóa nội dung</span>':''}</div>
      </div>
      <div class="row wrap"><a class="btn secondary" href="#/preview/${id}">▶ Làm thử</a><button class="ghost" id="editTestTop">✎ Chỉnh sửa</button><button class="secondary" id="exportExcelTop">↓ Excel</button><button id="publishBtn" class="${t.status==="published"?"secondary":"primary"}">${t.status==="published"?"Đóng bài":"Xuất bản"}</button></div>
    </div>
  </section>
  ${testTabs(id,tab)}`;

  const overview=`<section class="test-panel" data-panel="overview">
    ${staticCount?`<div class="warning-box security-warning"><b>⚠ ${staticCount} ảnh đề demo vẫn đang ở GitHub.</b><br>Trước khi thi thật, vào Cài đặt → “Chuyển media vào Supabase Storage”.</div>`:""}
    ${locked?`<div class="lock-banner"><b>🔒 Nội dung đề đã được khóa</b><span>Từ khi sinh viên đầu tiên bắt đầu, câu hỏi/đáp án/stimulus không thể sửa để bảo toàn kết quả.</span></div>`:""}
    <section class="grid grid-3 part-summary">${parts.map(p=>`<div class="card"><h3>${esc(p.title)}</h3><div class="muted">${esc(p.shuffle_mode)}</div><div class="kpi">${qs.filter(q=>q.part_no===p.part_no).length}</div><div class="muted">câu hỏi</div></div>`).join("")}</section>
    <section class="grid grid-3 overview-actions">
      <button class="card card-link frozen-link" data-go-tab="practice"><h3>Làm thử</h3><p class="muted">Làm như sinh viên, tự lưu đáp án và xem lại lịch sử các lượt thử.</p></button>
      <button class="card card-link frozen-link" data-go-tab="live"><h3>LIVE</h3><p class="muted">Theo dõi đang làm, đã nộp, tiến độ và vi phạm gần thời gian thực.</p></button>
      <button class="card card-link frozen-link" data-go-tab="submissions"><h3>Bài làm</h3><p class="muted">Xem kết quả, reset/xóa lượt và tải Excel.</p></button>
      <button class="card card-link frozen-link" data-go-tab="authoring"><h3>Soạn đề</h3><p class="muted">Autosave nháp, paste ảnh và phục hồi đúng vị trí.</p></button>
    </section>
  </section>`;
  const practice=`<section class="test-panel" data-panel="practice" hidden><section id="practiceRoot" class="card"><div class="muted">Lịch sử làm thử sẽ tải khi mở lần đầu.</div></section></section>`;
  const live=`<section class="test-panel" data-panel="live" hidden><section id="liveRoot" class="card"><div class="muted">LIVE sẽ tải một lần khi mở lần đầu.</div></section></section>`;
  const submissions=`<section class="test-panel" data-panel="submissions" hidden><section id="submissionsRoot" class="card"><div class="muted">Bài làm sẽ tải một lần khi mở lần đầu.</div></section></section>`;
  const authoring=`<section class="test-panel" data-panel="authoring" hidden>${renderAuthoringMarkup(id,parts,qs,groups,draft,locked)}</section>`;
  const settings=`<section class="test-panel" data-panel="settings" hidden>
    <section class="card"><div class="row between wrap"><div><h2>Cài đặt bài kiểm tra</h2><p class="muted">Các thay đổi nhạy cảm sẽ tự khóa sau khi có sinh viên bắt đầu.</p></div><button class="primary" id="editTestSettings">✎ Chỉnh sửa bài kiểm tra</button></div>
      <div class="grid grid-2 settings-grid">
        <div><div class="muted">Lớp liên kết</div><b>${esc(t.class_id?"Đã gán lớp":"Chưa gán")}</b></div>
        <div><div class="muted">Thời lượng</div><b>${t.duration_minutes} phút ${locked?"🔒":""}</b></div>
        <div><div class="muted">Số lượt làm</div><b>${t.max_attempts}</b></div>
        <div><div class="muted">Mở lúc</div><b>${fmt(t.opens_at)}</b></div>
        <div><div class="muted">Đóng lúc</div><b>${fmt(t.closes_at)}</b></div>
        <div><div class="muted">Chống gian lận</div><b>${esc(t.anti_cheat_mode)}</b></div>
        <div><div class="muted">Ngưỡng tự nộp</div><b>${t.anti_cheat_mode==="off"?"Tắt":t.anti_cheat_mode==="strict"?"Rời màn hình lần đầu":"Rời >15 giây hoặc lần rời thứ 3"}</b></div>
        <div><div class="muted">Xem đáp án sau nộp</div><b>${t.show_answers_after_submit?"Có":"Không"}</b></div>
      </div>
    </section>
    ${staticCount?`<section class="card security-card"><h2>Bảo mật media</h2><p class="muted">${staticCount} ảnh demo đang dùng đường dẫn tĩnh trên GitHub. Chuyển chúng vào bucket private <code>test-media</code> trước khi Publish.</p><button class="primary" id="migrateStaticMedia">🔒 Chuyển ${staticCount} ảnh vào Supabase Storage</button><div id="migrateProgress" class="muted small"></div></section>`:""}
    <section class="card danger-zone"><h2>Vùng quản trị</h2><p class="muted">Nếu đã có bài làm, nên lưu trữ thay vì xóa vĩnh viễn. Mọi thao tác đều ghi audit log.</p><div class="row wrap"><button class="secondary" id="archiveTest">Lưu trữ bài kiểm tra</button><button class="danger" id="deleteTest">Xóa bài kiểm tra</button></div></section>
  </section>`;

  view.innerHTML=`<div id="testWorkspace" data-test-id="${id}">${head}${overview}${practice}${live}${submissions}${authoring}${settings}</div>`;
  bindTestHeaderActions(id,t,staticCount);
  bindAuthoringActions(id,parts,qs,groups,draft,locked);
  document.querySelector("#editTestSettings")?.addEventListener("click",()=>openEditTest(t));
  document.querySelector("#editTestTop")?.addEventListener("click",()=>openEditTest(t));
  document.querySelector("#archiveTest")?.addEventListener("click",()=>confirmArchiveTest(id,t));
  document.querySelector("#deleteTest")?.addEventListener("click",()=>confirmDeleteTest(id,t));
  document.querySelector("#migrateStaticMedia")?.addEventListener("click",()=>migrateStaticMedia(id,groups));
  document.querySelectorAll(".test-tab-btn").forEach(btn=>btn.onclick=()=>activateTestTab(id,btn.dataset.tab,{push:true,restore:true}));
  document.querySelectorAll("[data-go-tab]").forEach(btn=>btn.onclick=()=>activateTestTab(id,btn.dataset.goTab,{push:true,restore:true}));
  window.addEventListener("scroll",()=>{
    if(!testWorkspace || testWorkspace.id!==id) return;
    testWorkspace.scrolls[testWorkspace.activeTab]=window.scrollY;
  },{passive:true});
  await activateTestTab(id,tab,{push:false,restore:true});
}

async function hydrateAuthoringRichContent(questions,groups){
  const values=[
    ...questions.flatMap(q=>[q.content,...(q.choices||[]).map(c=>c.content)]),
    ...groups.flatMap(g=>(g.stimuli||[]).map(s=>s.content))
  ];
  const directPaths=[
    ...questions.flatMap(q=>[q.storage_path,...(q.choices||[]).map(c=>c.storage_path)]),
    ...groups.flatMap(g=>(g.stimuli||[]).map(s=>s.storage_path))
  ].filter(p=>p && !String(p).startsWith("static:"));
  const paths=[...new Set([...values.flatMap(embeddedImagePaths),...directPaths])];
  if(!paths.length) return;
  const urls=await signedUrlMap(paths);
  for(const q of questions){
    q.content=hydrateEmbeddedImages(q.content,urls);
    if(q.storage_path) q.url=String(q.storage_path).startsWith("static:")?q.storage_path.slice(7):urls[q.storage_path];
    for(const c of q.choices||[]){ c.content=hydrateEmbeddedImages(c.content,urls); if(c.storage_path) c.url=String(c.storage_path).startsWith("static:")?c.storage_path.slice(7):urls[c.storage_path]; }
  }
  for(const g of groups) for(const st of g.stimuli||[]){ st.content=hydrateEmbeddedImages(st.content,urls); if(st.storage_path) st.url=String(st.storage_path).startsWith("static:")?st.storage_path.slice(7):urls[st.storage_path]; }
}
function bindTestHeaderActions(id,t,staticCount=0){
  document.querySelector("#publishBtn")?.addEventListener("click",async()=>{
    if(t.status==="published"){
      const {error}=await sb.rpc("staff_upsert_test",{p_data:{id:t.id,status:"closed"}});
      if(error) return toast(error.message);
      toast("Đã đóng bài");
      return refreshCurrentTest(id);
    }
    const {data:check,error:checkErr}=await sb.rpc("staff_preflight_test",{p_test_id:id});
    if(checkErr) return toast(checkErr.message,6000);
    if(!check?.ok) return showPreflight(check);
    if((check.static_media_count||0)>0) return toast("Còn media công khai trên GitHub. Hãy chuyển vào Supabase Storage trước khi Publish.",7000);
    modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><h2>Xuất bản bài kiểm tra?</h2><div class="warning-box">Sau khi sinh viên đầu tiên bắt đầu, nội dung câu hỏi/đáp án sẽ bị khóa.</div><p>${check.question_count} câu · ${t.duration_minutes} phút · tối đa ${t.max_attempts} lượt.</p><div class="row between"><button class="secondary" data-close>Hủy</button><button class="primary" id="doPublish">Xuất bản</button></div></div></div>`;
    modalRoot.querySelector("[data-close]").onclick=closeModal;
    modalRoot.querySelector("#doPublish").onclick=async()=>{
      const {error}=await sb.rpc("staff_upsert_test",{p_data:{id:t.id,status:"published"}});
      if(error) return toast(error.message);
      closeModal();toast("Đã xuất bản");refreshCurrentTest(id);
    };
  });
  document.querySelector("#exportExcelTop")?.addEventListener("click",()=>exportTestExcel(id));
}
function showPreflight(check={}){
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="row between"><h2>Chưa thể xuất bản</h2><button class="ghost sm" data-close>Đóng</button></div><div class="stack preflight-list">
    <div>${check.class_missing?"❌":"✅"} Đã gán lớp</div>
    <div>${check.class_empty?"❌":"✅"} ${check.active_student_count||0} sinh viên hoạt động trong lớp</div>
    <div>${check.show_answers_after_submit?"⚠":"✅"} ${check.show_answers_after_submit?"Đang bật xem đáp án sau khi nộp":"Đáp án đúng đang được ẩn sau khi nộp"}</div>
    <div>${check.question_count>0?"✅":"❌"} ${check.question_count||0} câu hỏi</div>
    <div>${check.missing_or_extra_choices===0?"✅":"❌"} ${check.missing_or_extra_choices||0} câu không đủ đúng 4 lựa chọn</div>
    <div>${check.invalid_correct_choice===0?"✅":"❌"} ${check.invalid_correct_choice||0} câu có đáp án đúng không hợp lệ</div>
    <div>${check.schedule_invalid?"❌":"✅"} Lịch mở/đóng hợp lệ</div>
    <div>${check.reading_standard?"✅":"⚠"} Cấu trúc Reading chuẩn: Part 5 = ${check.part5_count||0}, Part 6 = ${check.part6_count||0}, Part 7 = ${check.part7_count||0}</div>
    <div>${check.static_media_count===0?"✅":"⚠"} ${check.static_media_count||0} media tĩnh chưa nằm trong Storage private</div>
  </div></div></div>`;
  modalRoot.querySelector("[data-close]").onclick=closeModal;
}
async function refreshCurrentTest(id,tab=null){
  const target=tab||testWorkspace?.activeTab||route().split("/")[3]||"overview";
  invalidateTestWorkspace(id);
  invalidateStaffPage(`test:${id}`);
  invalidateStaffData("tests");
  invalidateStaffPage("tests");
  invalidateStaffPage("teacher");
  await showStaffPage(`test:${id}`,()=>renderTestDetail(id,target));
}

async function openEditTest(t){
  const {data:classes=[]}=await sb.from("classes").select("id,name").order("name");
  const locked=!!t.content_locked_at;
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal wide">
    <div class="row between wrap"><div><h2>Chỉnh sửa bài kiểm tra</h2><p class="muted">${locked?"Nội dung đã khóa: lớp và thời lượng không thể thay đổi.":"Chưa có sinh viên bắt đầu: có thể chỉnh đầy đủ."}</p></div><button class="ghost sm" data-close>Đóng</button></div>
    <form id="editTestForm" class="form-grid">
      <label class="span-2">Tên bài<input name="title" value="${esc(t.title||"")}" required></label>
      <label>Lớp<select name="class_id" ${locked?"disabled":""}><option value="">Chưa gán lớp</option>${classes.map(c=>`<option value="${c.id}" ${c.id===t.class_id?"selected":""}>${esc(c.name)}</option>`).join("")}</select>${locked?'<span class="hint">🔒 Khóa sau khi có lượt làm đầu tiên.</span>':''}</label>
      <label>Thời gian (phút)<input type="number" name="duration_minutes" value="${t.duration_minutes}" min="1" ${locked?"disabled":""}>${locked?'<span class="hint">🔒 Deadline của lượt đã bắt đầu phải giữ nhất quán.</span>':''}</label>
      <label>Số lần làm<input type="number" name="max_attempts" value="${t.max_attempts}" min="1"></label>
      <label>Chống gian lận<select name="anti_cheat_mode"><option value="warn_then_submit" ${t.anti_cheat_mode==="warn_then_submit"?"selected":""}>Cảnh báo rồi tự nộp</option><option value="strict" ${t.anti_cheat_mode==="strict"?"selected":""}>Nghiêm ngặt</option><option value="off" ${t.anti_cheat_mode==="off"?"selected":""}>Tắt</option></select></label>
      <label>Ngưỡng chống gian lận<input value="${t.anti_cheat_mode==="off"?"Tắt":t.anti_cheat_mode==="strict"?"Rời màn hình lần đầu":"Rời >15 giây hoặc lần rời thứ 3"}" disabled></label>
      <label>Mở lúc<input type="datetime-local" name="opens_at" value="${toLocalInput(t.opens_at)}"></label>
      <label>Đóng lúc<input type="datetime-local" name="closes_at" value="${toLocalInput(t.closes_at)}"></label>
      <label class="span-2">Mô tả<textarea name="description" rows="3">${esc(t.description||"")}</textarea></label>
      <label class="check-row span-2"><input type="checkbox" name="show_answers_after_submit" ${t.show_answers_after_submit?"checked":""}> Cho xem đáp án sau khi nộp</label>
      <div class="span-2 warning-box"><b>Quy tắc an toàn</b><br>Sau khi có sinh viên bắt đầu, không thể đổi lớp hoặc thời lượng; số lượt làm chỉ có thể tăng, không thể giảm.</div>
      <button class="primary span-2">Lưu thay đổi</button>
    </form>
  </div></div>`;
  modalRoot.querySelector("[data-close]").onclick=closeModal;
  modalRoot.querySelector("#editTestForm").onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(e.target),f=Object.fromEntries(fd); f.id=t.id;
    if(!locked){f.class_id=f.class_id||"";f.duration_minutes=+f.duration_minutes;}
    f.max_attempts=+f.max_attempts;
    f.show_answers_after_submit=fd.has("show_answers_after_submit");
    ["opens_at","closes_at"].forEach(k=>f[k]=f[k]?new Date(f[k]).toISOString():"");
    const btn=e.submitter || e.target.querySelector("button[type='submit'],button:not([type])");btn.disabled=true;btn.textContent="Đang lưu…";
    const {error}=await sb.rpc("staff_upsert_test",{p_data:f});
    btn.disabled=false;btn.textContent="Lưu thay đổi";
    if(error) return toast(error.message,6000);
    closeModal();toast("Đã cập nhật bài kiểm tra");await refreshCurrentTest(t.id,"settings");
  };
}
async function confirmArchiveTest(id,t){
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><h2>Lưu trữ bài kiểm tra?</h2><p><b>${esc(t.title)}</b></p><p class="muted">Bài sẽ được đóng và ẩn khỏi danh sách hoạt động, nhưng dữ liệu/lượt làm vẫn còn để đối soát.</p><div class="row between"><button class="secondary" data-close>Hủy</button><button class="primary" id="doArchive">Lưu trữ</button></div></div></div>`;
  modalRoot.querySelector("[data-close]").onclick=closeModal;
  modalRoot.querySelector("#doArchive").onclick=async()=>{
    const {error}=await sb.rpc("staff_archive_test",{p_test_id:id}); if(error) return toast(error.message);
    closeModal();clearLiveChannel();testWorkspace=null;invalidateStaffData("tests");invalidateStaffPage(`test:${id}`);invalidateStaffPage("tests");invalidateStaffPage("teacher");toast("Đã lưu trữ bài kiểm tra");go("/tests");
  };
}
async function confirmDeleteTest(id,t){
  const {data:check,error}=await sb.rpc("staff_preflight_test",{p_test_id:id});
  if(error) return toast(error.message);
  const hasAttempts=(check?.attempt_count||0)>0;
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal">
    <h2>Xóa bài kiểm tra?</h2>
    <div class="warning-box"><b>Hành động không thể hoàn tác.</b><br>${hasAttempts?`Bài có ${check.attempt_count} lượt làm. Khuyến nghị dùng “Lưu trữ” thay vì xóa.`:"Bài chưa có lượt làm."}</div>
    ${hasAttempts?`<label>Nhập lại tên bài để xác nhận<input id="deleteTestConfirm" placeholder="${esc(t.title)}"></label>`:""}
    <div class="row between"><button class="secondary" data-close>Hủy</button><button class="danger" id="doDeleteTest" ${hasAttempts?"disabled":""}>Xóa vĩnh viễn</button></div>
  </div></div>`;
  modalRoot.querySelector("[data-close]").onclick=closeModal;
  const confirmInput=modalRoot.querySelector("#deleteTestConfirm"),doBtn=modalRoot.querySelector("#doDeleteTest");
  if(confirmInput) confirmInput.oninput=()=>doBtn.disabled=confirmInput.value!==t.title;
  doBtn.onclick=async()=>{
    doBtn.disabled=true;doBtn.textContent="Đang xóa…";
    const {error}=await sb.rpc("staff_delete_test",{p_test_id:id});
    if(error){doBtn.disabled=false;doBtn.textContent="Xóa vĩnh viễn";return toast(error.message,6000);}
    closeModal();clearLiveChannel();testWorkspace=null;invalidateStaffData("tests");invalidateStaffPage(`test:${id}`);invalidateStaffPage("tests");invalidateStaffPage("teacher");toast("Đã xóa bài kiểm tra");go("/tests");
  };
}
async function migrateStaticMedia(testId,groups){
  const items=[];
  for(const g of groups) for(const s of g.stimuli||[]) if(String(s.storage_path||"").startsWith("static:")) items.push({...s,groupId:g.id});
  if(!items.length) return toast("Không còn media tĩnh cần chuyển.");
  const btn=document.querySelector("#migrateStaticMedia"),progress=document.querySelector("#migrateProgress");
  if(btn){btn.disabled=true;btn.textContent="Đang chuyển…";}
  let done=0;
  try{
    for(const s of items){
      const rel=s.storage_path.slice(7);
      const res=await fetch(rel,{cache:"no-store"}); if(!res.ok) throw new Error(`Không đọc được ${rel}`);
      const blob=await res.blob();
      const name=rel.split("/").pop()||`image-${done+1}.jpg`;
      const file=new File([blob],name,{type:blob.type||"image/jpeg"});
      const uploaded=await uploadMedia(file,`tests/${testId}/imported`);
      const {error}=await sb.rpc("staff_upsert_stimulus",{p_data:{id:s.id,media_type:uploaded.media_type,storage_path:uploaded.storage_path,sort_order:s.sort_order||1}});
      if(error) throw error;
      done++; if(progress) progress.textContent=`Đã chuyển ${done}/${items.length} ảnh…`;
    }
    toast(`Đã chuyển ${done} ảnh vào Supabase Storage private`);
    await refreshCurrentTest(testId,"settings");
  }catch(err){toast(`Dừng ở ${done}/${items.length}: ${err.message}`,8000);if(btn){btn.disabled=false;btn.textContent="Thử chuyển lại";}}
}

function bindAuthoringActions(id,parts,qs,groups,draft,locked=false){
  bindAuthoringFilter();
  if(locked) return;
  document.querySelectorAll(".add-group").forEach(b=>b.onclick=e=>{e.preventDefault();openGroupEditor(id,b.dataset.part,+b.dataset.partno,null,null,groups)});
  document.querySelectorAll(".add-stimulus").forEach(b=>b.onclick=e=>{e.preventDefault();const g=groups.find(x=>x.id===b.dataset.group);openStimulusEditor(id,b.dataset.group,null,null,g?.stimuli||[])});
  document.querySelectorAll(".add-question").forEach(b=>b.onclick=e=>{e.preventDefault();openQuestionEditor(id,b.dataset.part,+b.dataset.partno,groups,null,null,qs)});
  document.querySelectorAll(".edit-question").forEach(b=>{
    const q=qs.find(x=>x.id===b.dataset.id);
    b.onclick=e=>{e.preventDefault();openQuestionEditor(id,q.test_part_id,q.part_no,groups,q,null,qs)};
  });
  document.querySelectorAll(".duplicate-question").forEach(b=>{const q=qs.find(x=>x.id===b.dataset.id);b.onclick=e=>{e.preventDefault();openQuestionEditor(id,q.test_part_id,q.part_no,groups,q,null,qs,true)}});
  document.querySelectorAll(".delete-question").forEach(b=>b.onclick=e=>{e.preventDefault();confirmDeleteAuthorItem("question",id,b.dataset.id,`Câu ${b.dataset.number}`)});
  document.querySelectorAll(".edit-group").forEach(b=>{const g=groups.find(x=>x.id===b.dataset.id);b.onclick=e=>{e.preventDefault();openGroupEditor(id,g.test_part_id,g.part_no,null,g,groups)}});
  document.querySelectorAll(".delete-group").forEach(b=>{const g=groups.find(x=>x.id===b.dataset.id);b.onclick=e=>{e.preventDefault();confirmDeleteAuthorItem("group",id,g.id,g.title||`Nhóm ${g.source_order}`)}});
  document.querySelectorAll(".edit-stimulus").forEach(b=>{const g=groups.find(x=>x.id===b.dataset.group),s=(g?.stimuli||[]).find(x=>x.id===b.dataset.id);b.onclick=e=>{e.preventDefault();openStimulusEditor(id,g.id,null,s,g.stimuli||[])}});
  document.querySelectorAll(".delete-stimulus").forEach(b=>b.onclick=e=>{e.preventDefault();confirmDeleteAuthorItem("stimulus",id,b.dataset.id,"nội dung chung này")});
  document.querySelector("#discardDraft")?.addEventListener("click",async()=>{await clearAuthorDraft(id);toast("Đã bỏ bản nháp");invalidateTestWorkspace(id);renderTestDetail(id,"authoring")});
  document.querySelector("#restoreDraft")?.addEventListener("click",()=>{
    if(!draft) return;
    if(draft.kind==="question"){
      const existing=draft.existingId?qs.find(q=>q.id===draft.existingId):null;
      openQuestionEditor(id,draft.partId,draft.partNo,groups,existing,draft,qs);
    }else if(draft.kind==="stimulus"){
      const g=groups.find(x=>x.id===draft.groupId),existing=(g?.stimuli||[]).find(x=>x.id===draft.existingId);
      openStimulusEditor(id,draft.groupId,draft,existing,g?.stimuli||[]);
    }else if(draft.kind==="group"){
      const existing=groups.find(x=>x.id===draft.existingId);
      openGroupEditor(id,draft.partId,draft.partNo,draft,existing,groups);
    }
  });
}
async function confirmDeleteAuthorItem(kind,testId,itemId,label){
  const meta={question:["câu hỏi","staff_delete_question"],group:["nhóm nội dung","staff_delete_stimulus_group"],stimulus:["nội dung chung","staff_delete_stimulus"]}[kind];
  if(!meta) return;
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><h2>Xóa ${meta[0]}?</h2><p>Bạn sắp xóa <b>${esc(label)}</b>.</p>${kind==="group"?'<div class="warning-box">Các câu trong nhóm sẽ được chuyển thành câu không thuộc nhóm; passage/ảnh/audio chung của nhóm sẽ bị xóa.</div>':""}<div class="row between"><button type="button" class="secondary" data-close>Hủy</button><button type="button" class="danger" id="confirmDeleteAuthor">Xóa</button></div></div></div>`;
  modalRoot.querySelector("[data-close]").onclick=closeModal;
  modalRoot.querySelector("#confirmDeleteAuthor").onclick=async e=>{
    const btn=e.currentTarget;btn.disabled=true;btn.textContent="Đang xóa…";
    const params=kind==="question"?{p_question_id:itemId}:kind==="group"?{p_group_id:itemId}:{p_stimulus_id:itemId};
    const {error}=await sb.rpc(meta[1],params);
    if(error){btn.disabled=false;btn.textContent="Xóa";return toast(error.message,6000)}
    closeModal();toast(`Đã xóa ${meta[0]}`);invalidateTestWorkspace(testId);renderTestDetail(testId,"authoring");
  };
}

function mediaPasteField(key,label,currentPath=null,currentType=null){
  return `<div class="media-paste-field" data-media-key="${key}">
    <div class="row between wrap"><b>${esc(label)}</b><span class="hint">Chọn file hoặc click vùng dưới rồi Ctrl+V ảnh</span></div>
    <input class="media-file-input" data-key="${key}" type="file" accept="image/png,image/jpeg,image/webp,audio/mpeg,audio/mp4,audio/wav">
    <input type="hidden" name="${key}_path" value="${esc(currentPath||"")}">
    <input type="hidden" name="${key}_type" value="${esc(currentType||"")}">
    <div class="paste-zone" tabindex="0" data-key="${key}">Dán ảnh/audio vào đây</div>
    <div class="media-preview" data-preview="${key}">${currentPath?`<span class="badge">${currentType==="audio"?"🔊 Audio":"🖼 Media"} hiện có</span>`:""}</div>
  </div>`;
}
async function showMediaPreview(container,key,path,type){
  const prev=container.querySelector(`[data-preview="${key}"]`);
  if(!prev) return;
  const url=await signedUrl(path);
  if(type==="image"&&url) prev.innerHTML=`<img class="draft-preview-img" src="${url}" alt="Ảnh vừa dán"><button type="button" class="ghost sm clear-media" data-key="${key}">Xóa ảnh</button>`;
  else if(type==="audio"&&url) prev.innerHTML=`<audio controls src="${url}"></audio><button type="button" class="ghost sm clear-media" data-key="${key}">Xóa audio</button>`;
  else prev.innerHTML=path?`<span class="badge">Media đã chọn</span>`:"";
}
function serializeDraftForm(form,extra={}){
  const fd=new FormData(form),fields={};
  for(const [k,v] of fd.entries()){
    if(v instanceof File) continue;
    fields[k]=v;
  }
  return {...extra,fields};
}
function hydrateDraftForm(form,draft){
  if(!draft?.fields) return;
  for(const [k,v] of Object.entries(draft.fields)){
    const el=form.elements.namedItem(k);
    if(el && !(el instanceof RadioNodeList)) el.value=v??"";
  }
}
function bindDraftAutosave(form,testId,extra){
  const save=debounce(()=>saveAuthorDraftLocal(testId,serializeDraftForm(form,extra)),220);
  form.addEventListener("input",save);
  form.addEventListener("change",save);
  save();
}
function bindPasteMedia(form,testId,prefix,extra){
  const save=()=>saveAuthorDraftLocal(testId,serializeDraftForm(form,extra));
  const setMedia=async(key,file)=>{
    if(!(file instanceof File)||!file.size) return;
    try{
      const zone=form.querySelector(`.paste-zone[data-key="${key}"]`);
      if(zone){zone.textContent="Đang tải media…";zone.classList.add("busy")}
      const up=await uploadMedia(file,`${prefix}/${testId}/drafts`);
      form.elements.namedItem(`${key}_path`).value=up.storage_path;
      form.elements.namedItem(`${key}_type`).value=up.media_type;
      await showMediaPreview(form,key,up.storage_path,up.media_type);
      if(zone){zone.textContent="Dán ảnh/audio khác vào đây";zone.classList.remove("busy")}
      save();
    }catch(err){toast(err.message,6000)}
  };
  form.querySelectorAll(".media-file-input").forEach(inp=>inp.addEventListener("change",()=>setMedia(inp.dataset.key,inp.files?.[0])));
  form.querySelectorAll(".paste-zone").forEach(zone=>{
    zone.addEventListener("paste",e=>{
      const files=[...(e.clipboardData?.files||[])];
      const file=files.find(f=>f.type.startsWith("image/")||f.type.startsWith("audio/"));
      if(file){e.preventDefault();setMedia(zone.dataset.key,file);}
    });
  });
  form.addEventListener("click",e=>{
    const b=e.target.closest(".clear-media"); if(!b) return;
    const key=b.dataset.key;
    form.elements.namedItem(`${key}_path`).value="";
    form.elements.namedItem(`${key}_type`).value="";
    const p=form.querySelector(`[data-preview="${key}"]`); if(p)p.innerHTML="";
    save();
  });
}
function openGroupEditor(testId, partId, partNo, draft=null, existing=null, allGroups=[]){
  const nextOrder=Math.max(0,...allGroups.filter(g=>g.part_no===partNo).map(g=>Number(g.source_order)||0))+1;
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal">
    <div class="row between"><div><h2>${existing?"Sửa":"Tạo"} nhóm nội dung · Part ${partNo}</h2><p class="muted">Dùng chung passage, ảnh hoặc audio cho nhiều câu.</p></div><button class="ghost sm" data-close>Đóng</button></div>
    <form id="groupForm" class="form-grid">
      <label class="span-2">Tên nhóm<input name="title" value="${esc(existing?.title||"")}" placeholder="Ví dụ: Conversation 1 / Passage 1"></label>
      <label>Thứ tự nguồn<input type="number" name="source_order" value="${existing?.source_order??nextOrder}" min="1" required></label>
      <label>Chế độ phát<select name="play_mode"><option value="normal" ${existing?.play_mode==="normal"?"selected":""}>Bình thường</option><option value="once" ${existing?.play_mode==="once"?"selected":""}>Nghe một lần</option><option value="auto" ${existing?.play_mode==="auto"?"selected":""}>Tự phát</option></select></label>
      <label>Cho nghe lại<select name="allow_replay"><option value="true" ${existing?.allow_replay!==false?"selected":""}>Có</option><option value="false" ${existing?.allow_replay===false?"selected":""}>Không</option></select></label>
      <label>Cho tua<select name="allow_seek"><option value="true" ${existing?.allow_seek!==false?"selected":""}>Có</option><option value="false" ${existing?.allow_seek===false?"selected":""}>Không</option></select></label>
      <label>Số lượt nghe tối đa<input type="number" name="max_plays" value="${existing?.max_plays??""}" min="1" placeholder="Để trống = không giới hạn"></label>
      <button class="primary span-2">${existing?"Lưu thay đổi":"Tạo nhóm"}</button>
    </form>
  </div></div>`;
  modalRoot.querySelector("[data-close]").onclick=closeModal;
  const form=modalRoot.querySelector("#groupForm");
  hydrateDraftForm(form,draft);
  bindDraftAutosave(form,testId,{kind:"group",partId,partNo,existingId:existing?.id||null});
  form.onsubmit=async e=>{
    e.preventDefault();
    const f=Object.fromEntries(new FormData(e.target));
    const {error}=await sb.rpc("staff_upsert_stimulus_group",{p_data:{
      id:existing?.id||undefined,test_part_id:partId, source_order:+f.source_order, title:f.title||null,
      play_mode:f.play_mode, allow_replay:f.allow_replay==="true", allow_seek:f.allow_seek==="true",
      max_plays:f.max_plays?+f.max_plays:null
    }});
    if(error) return toast(error.message);
    await clearAuthorDraft(testId);
    closeModal(); toast(existing?"Đã cập nhật nhóm":"Đã tạo nhóm nội dung"); invalidateTestWorkspace(testId); renderTestDetail(testId,"authoring");
  };
}
function openStimulusEditor(testId, groupId, draft=null, existing=null, groupStimuli=[]){
  const nextOrder=Math.max(0,...groupStimuli.map(s=>Number(s.sort_order)||0))+1;
  const textValue=draft?.fields?.content??existing?.content??"";
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal">
    <div class="row between"><div><h2>${existing?"Sửa":"Thêm"} nội dung chung</h2><p class="muted">Text, ảnh hoặc audio này dùng chung cho các câu thuộc nhóm.</p></div><button class="ghost sm" data-close>Đóng</button></div>
    <form id="stimForm" class="stack">
      <label>Loại<select name="kind" id="stimKind"><option value="text" ${!existing||existing.media_type==="text"?"selected":""}>Văn bản</option><option value="file" ${existing&&existing.media_type!=="text"?"selected":""}>Ảnh / Audio</option></select></label>
      <div id="stimTextWrap">${richEditorField("content","Nội dung",textValue)}</div>
      <div id="stimFileWrap" hidden>${mediaPasteField("stimulus_media","Ảnh / Audio",existing?.storage_path,existing?.media_type)}</div>
      <label>Thứ tự<input type="number" name="sort_order" value="${existing?.sort_order??nextOrder}" min="1"></label>
      <button class="primary">${existing?"Lưu thay đổi":"Lưu nội dung"}</button>
    </form>
  </div></div>`;
  modalRoot.querySelector("[data-close]").onclick=closeModal;
  const form=modalRoot.querySelector("#stimForm");
  hydrateDraftForm(form,draft);
  const kind=modalRoot.querySelector("#stimKind");
  const syncKind=()=>{
    modalRoot.querySelector("#stimTextWrap").hidden=kind.value!=="text";
    modalRoot.querySelector("#stimFileWrap").hidden=kind.value!=="file";
  };
  kind.onchange=syncKind; syncKind();
  if(draft?.fields?.stimulus_media_path||existing?.storage_path) showMediaPreview(form,"stimulus_media",draft?.fields?.stimulus_media_path||existing.storage_path,draft?.fields?.stimulus_media_type||existing.media_type);
  bindPasteMedia(form,testId,"groups",{kind:"stimulus",groupId,existingId:existing?.id||null});
  bindDraftAutosave(form,testId,{kind:"stimulus",groupId,existingId:existing?.id||null});
  bindRichEditors(form,{
    uploadImage:async file=>{
      const up=await uploadMedia(file,`tests/${testId}/rich`);
      return {...up,url:await signedUrl(up.storage_path)};
    },
    onChange:()=>form.dispatchEvent(new Event("input",{bubbles:true})),
    onError:err=>toast(err.message,6000)
  });
  form.onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const payload={id:existing?.id||undefined,stimulus_group_id:groupId,sort_order:+fd.get("sort_order")||1};
    if(fd.get("kind")==="text"){
      payload.media_type="text"; payload.content=sanitizeRichHtml(String(fd.get("content")||""),{storage:true}); payload.storage_path=null;
    }else{
      const path=fd.get("stimulus_media_path"),type=fd.get("stimulus_media_type");
      if(!path||!type) return toast("Chưa chọn hoặc paste media.");
      payload.media_type=type; payload.storage_path=path; payload.content=null;
    }
    const {error}=await sb.rpc("staff_upsert_stimulus",{p_data:payload});
    if(error) return toast(error.message);
    await clearAuthorDraft(testId);
    closeModal(); toast(existing?"Đã cập nhật nội dung chung":"Đã thêm nội dung chung"); invalidateTestWorkspace(testId); renderTestDetail(testId,"authoring");
  };
}
function openQuestionEditor(testId, partId, partNo, allGroups, existing=null, draft=null, allQuestions=[],duplicate=false){
  const groups=allGroups.filter(g=>g.part_no===partNo);
  const choices=Object.fromEntries((existing?.choices||[]).map(c=>[c.key,c]));
  const defaultStart=({5:101,6:131,7:147})[partNo]||1;
  const nextNumber=Math.max(defaultStart-1,...allQuestions.filter(q=>q.part_no===partNo).map(q=>Number(q.source_number)||0))+1;
  const sourceNumber=duplicate?nextNumber:(existing?.source_number??nextNumber);
  const sourceOrder=duplicate?nextNumber:(existing?.source_order??sourceNumber);
  const draftFields=draft?.fields||{};
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal wide">
    <div class="row between"><div><h2>${duplicate?"Nhân bản":existing?"Sửa":"Thêm"} câu hỏi · Part ${partNo}</h2><p class="muted">Số câu và thứ tự được tự động điền; vẫn có thể sửa thủ công.</p></div><button class="ghost sm" data-close>Đóng</button></div>
    <form id="questionForm" class="stack">
      <div class="form-grid">
        <label>Số câu nguồn<input type="number" name="source_number" value="${sourceNumber}" required></label>
        <label>Thứ tự<input type="number" name="source_order" value="${sourceOrder}" required></label>
        <label class="span-2">Nhóm nội dung<select name="stimulus_group_id"><option value="">Không dùng nhóm</option>${groups.map(g=>`<option value="${g.id}" ${existing?.stimulus_group_id===g.id?"selected":""}>${esc(g.title||`Nhóm ${g.source_order}`)}</option>`).join("")}</select></label>
        <div class="span-2">${richEditorField("content","Nội dung câu hỏi",draftFields.content??existing?.content??"")}</div>
        <div class="span-2">${mediaPasteField("question_media","Media riêng của câu hỏi",existing?.storage_path,existing?.media_type)}</div>
      </div>
      <div class="row between wrap"><h3>Đáp án</h3><span class="muted small">Mỗi đáp án có thể là chữ, ảnh hoặc cả hai.</span></div>
      <div class="choices-editor">
        ${["A","B","C","D"].map(k=>`<div class="choice-edit-v2">
          <div class="choice-key">${k}</div>
          ${richEditorField(`choice_${k}`,`Nội dung đáp án ${k}`,draftFields[`choice_${k}`]??choices[k]?.content??"",{compact:true})}
          <div>${mediaPasteField(`choice_${k}_media`,`Media đáp án ${k}`,choices[k]?.storage_path,choices[k]?.media_type)}</div>
        </div>`).join("")}
      </div>
      <label>Đáp án đúng<select name="correct_choice_key">${["A","B","C","D"].map(k=>`<option ${existing?.correct_choice_key===k?"selected":""}>${k}</option>`).join("")}</select></label>
      <div class="row between wrap"><span id="draftStatus" class="muted">Tự động lưu nháp</span><button class="primary">${duplicate?"Tạo bản sao":existing?"Lưu thay đổi":"Thêm câu hỏi"}</button></div>
    </form>
  </div></div>`;
  modalRoot.querySelector("[data-close]").onclick=closeModal;
  const form=modalRoot.querySelector("#questionForm");
  hydrateDraftForm(form,draft);
  const initialMedia=[
    ["question_media",existing?.storage_path,existing?.media_type],
    ...["A","B","C","D"].map(k=>[`choice_${k}_media`,choices[k]?.storage_path,choices[k]?.media_type])
  ];
  for(const [key,path,type] of initialMedia){
    const dpath=draft?.fields?.[`${key}_path`],dtype=draft?.fields?.[`${key}_type`];
    if(dpath||path) showMediaPreview(form,key,dpath||path,dtype||type);
  }
  const extra={kind:"question",partId,partNo,existingId:duplicate?null:(existing?.id||null)};
  bindPasteMedia(form,testId,"authoring",extra);
  bindDraftAutosave(form,testId,extra);
  bindRichEditors(form,{
    uploadImage:async file=>{
      const up=await uploadMedia(file,`tests/${testId}/rich`);
      return {...up,url:await signedUrl(up.storage_path)};
    },
    onChange:()=>form.dispatchEvent(new Event("input",{bubbles:true})),
    onError:err=>toast(err.message,6000)
  });
  form.onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const btn=e.submitter || e.target.querySelector("button[type='submit'],button:not([type])"); btn.disabled=true; btn.textContent="Đang lưu...";
    try{
      const choiceRows=["A","B","C","D"].map(k=>({
        key:k,
        content:sanitizeRichHtml(String(fd.get(`choice_${k}`)||""),{storage:true}),
        media_type:fd.get(`choice_${k}_media_type`)||null,
        storage_path:fd.get(`choice_${k}_media_path`)||null
      }));
      const payload={
        id:duplicate?undefined:(existing?.id||undefined), test_part_id:partId,
        source_number:+fd.get("source_number"), source_order:+fd.get("source_order"),
        stimulus_group_id:fd.get("stimulus_group_id")||null,
        content:sanitizeRichHtml(String(fd.get("content")||""),{storage:true}),
        media_type:fd.get("question_media_type")||null,
        storage_path:fd.get("question_media_path")||null,
        correct_choice_key:fd.get("correct_choice_key"), score_weight:1, choices:choiceRows
      };
      const {error}=await sb.rpc("staff_upsert_question",{p_data:payload});
      if(error) throw error;
      await clearAuthorDraft(testId);
      closeModal(); toast(duplicate?"Đã nhân bản câu hỏi":existing?"Đã lưu câu hỏi":"Đã thêm câu hỏi");
      saveTestUi(testId,{tab:"authoring",scrollY:window.scrollY});
      invalidateTestWorkspace(testId);
      renderTestDetail(testId,"authoring");
    }catch(err){toast(err.message,6000)}
    finally{btn.disabled=false;btn.textContent=duplicate?"Tạo bản sao":existing?"Lưu thay đổi":"Thêm câu hỏi";}
  };
}


boot();
