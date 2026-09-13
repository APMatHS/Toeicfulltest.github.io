
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";
import { esc,fmt,route,go,roleLabel,statusBadge,readJSON,writeJSON,debounce } from "./modules/utils.js";
import { createMediaService } from "./modules/media.js";
import { bindAuthoringFilter,renderAuthoringMarkup } from "./modules/authoring-view.js";
import { createAntiCheatController } from "./modules/anti-cheat.js";
import {
  bindRichEditors,embeddedImagePaths,hydrateEmbeddedImages,
  renderRichText,richEditorField,sanitizeRichHtml
} from "./modules/rich-editor.js";

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
let examState = null;
let timerId = null;
let liveChannel = null;
let authorDraftTimer = null;
let answerFlushBusy = false;
let testWorkspace = null;
const staffPageCache = new Map();
let activeStaffPageKey = null;
const staffDataCache={users:null,classes:null,tests:null,updatedAt:0};
let staffPrefetchPromise=null;

const antiCheat=createAntiCheatController({
  getExamState:()=>examState,
  getRoute:route,
  registerViolation:({attemptId,eventType,details,clientEventId})=>sb.rpc("register_violation_v2",{
    p_attempt_id:attemptId,p_event_type:eventType,p_details:details,p_client_event_id:clientEventId
  }),
  enforceAbsenceTimeout:({attemptId,leaveEventId})=>sb.rpc("enforce_absence_timeout_v1",{
    p_attempt_id:attemptId,p_leave_event_id:leaveEventId
  }),
  onCountChange:count=>{
    if(examState?.payload?.attempt) examState.payload.attempt.violation_count=count;
    const el=document.querySelector("#antiCheatStatus");
    if(el) el.textContent=`Vi phạm: ${count}/3 · rời màn hình tính ngay · quá 15 giây hoặc lần 3 sẽ tự nộp`;
  },
  onWarning:data=>toast(`Đã ghi nhận vi phạm ${data.violation_count}/3. Quá 15 giây hoặc vi phạm lần thứ 3 sẽ tự động nộp bài.`,6000),
  onSubmitted:data=>{
    const id=examState?.attemptId;
    const msg=data?.reason==="away_over_15_seconds"
      ? "Bài đã tự động nộp vì bạn rời màn hình quá 15 giây."
      : "Bài đã tự động nộp vì đã đủ 3 lần rời màn hình.";
    alert(msg);
    if(id) go(`/result/${id}`);
  }
});

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
function uiStateKey(testId){ return `toeic.ui.${session?.user?.id||"anon"}.${testId}`; }
function authorDraftKey(testId){ return `toeic.authorDraft.${session?.user?.id||"anon"}.${testId}`; }
function attemptQueueKey(attemptId){ return `toeic.answerQueue.${attemptId}`; }
function attemptUiKey(attemptId){ return `toeic.attemptUi.${attemptId}`; }
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

  sb.auth.onAuthStateChange((_event, s)=>{
    session = s;
    profile = null;
    setTimeout(async ()=>{
      if(s) await loadProfile();
      render();
    }, 0);
  });

  addEventListener("hashchange", render);
  window.addEventListener("online",()=>{setSaveStatus("Có mạng – đang đồng bộ…","pending");flushAnswerQueue()});
  window.addEventListener("offline",()=>setSaveStatus("Mất mạng – đáp án sẽ lưu tạm","offline"));
  document.addEventListener("fullscreenchange",()=>{
    if(!examState || examState.preview) return;
    saveAttemptUi();
    flushAnswerQueue();
  });
  document.addEventListener("visibilitychange",()=>{
    if(!examState || examState.preview) return;
    saveAttemptUi();
    if(document.visibilityState==="visible") flushAnswerQueue();
  });
  window.addEventListener("pagehide",()=>{
    if(!examState || examState.preview) return;
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
  clearInterval(timerId); timerId=null;
  const p=route();
  if(!p.startsWith("/preview/") && examState?.preview){
    examState=null;
    closeModal();
  }
  const targetTestId = p.startsWith("/test/") ? p.split("/")[2] : null;
  if(targetTestId && testWorkspace && testWorkspace.id!==targetTestId){
    clearLiveChannel();
    testWorkspace=null;
  }
  renderHeader();

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


async function renderProfile(){
  if(!profile) return showLoading("Đang tải hồ sơ...");
  const canRename=["teacher","system_admin"].includes(profile.role);
  view.innerHTML=`<section class="card profile-card">
    <a class="muted" href="${profile.role==="student"?"#/student":"#/teacher"}">← Quay lại</a>
    <h1>Hồ sơ</h1>
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
    closeModal(); toast(`Đã tạo ${data.success} sinh viên`); invalidateStaffData("users"); invalidateStaffPage("accounts"); invalidateStaffPage("teacher"); showStaffPage("accounts",renderAccounts);
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

async function renderTests(){
  if(!staffDataCache.tests) showLoading();
  await prefetchStaffData();
  const data=staffDataCache.tests||[];
  view.innerHTML=`${staffNav("tests")}
  <section class="card">
    <div class="row between wrap"><div><h1>Bài kiểm tra</h1><p class="muted">Tạo thủ công, nhập file, nhân bản bài cũ; khu vực AI đã được chuẩn bị cho giai đoạn sau.</p></div><button id="newTest" class="primary">+ Tạo bài kiểm tra</button></div>
    <div class="table-wrap"><table><thead><tr><th>Tên bài</th><th>Lớp</th><th>Thời gian</th><th>Lượt làm</th><th>Trạng thái</th><th></th></tr></thead>
    <tbody>${data.map(x=>`<tr><td>${esc(x.title)}</td><td>${esc(x.classes?.name||"—")}</td><td>${x.duration_minutes} phút</td><td>${x.max_attempts}</td><td>${statusBadge(x.status)}</td><td><a class="btn secondary sm" href="#/test/${x.id}">Chi tiết</a></td></tr>`).join("")||`<tr><td colspan="6" class="empty">Chưa có bài kiểm tra</td></tr>`}</tbody></table></div>
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
  const paths=values.flatMap(embeddedImagePaths);
  if(!paths.length) return;
  const urls=await signedUrlMap(paths);
  for(const q of questions){
    q.content=hydrateEmbeddedImages(q.content,urls);
    for(const c of q.choices||[]) c.content=hydrateEmbeddedImages(c.content,urls);
  }
  for(const g of groups) for(const s of g.stimuli||[]) s.content=hydrateEmbeddedImages(s.content,urls);
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
async function renderPracticeTab(testId){
  const root=document.querySelector("#practiceRoot");
  if(!root) return;
  const {data,error}=await sb.rpc("staff_list_practice_attempts",{p_test_id:testId});
  if(error) return root.innerHTML=`<div class="warning-box">${esc(error.message)}</div>`;
  const rows=data||[];
  const open=rows.find(x=>x.status==="in_progress");
  root.innerHTML=`<div class="row between wrap"><div><h2>Làm thử như sinh viên</h2><p class="muted">Mỗi đáp án được lưu vào khu vực riêng của giảng viên, không xuất hiện trong LIVE hoặc kết quả lớp.</p></div><a class="btn primary" href="#/preview/${testId}">${open?"Tiếp tục lượt đang làm":"Bắt đầu lượt làm thử"}</a></div>
  <div class="table-wrap"><table><thead><tr><th>Lượt</th><th>Trạng thái</th><th>Đã trả lời</th><th>Số câu đúng</th><th>Bắt đầu</th><th>Kết thúc</th><th></th></tr></thead>
  <tbody>${rows.map((x,i)=>`<tr><td>${rows.length-i}</td><td>${x.status==="in_progress"?'<span class="status warn">Đang làm</span>':x.status==="expired"?'<span class="status off">Hết giờ</span>':'<span class="status ok">Đã nộp</span>'}</td><td>${x.answered_count||0}/${x.total_questions||0}</td><td>${x.correct_count==null?"—":`${x.correct_count}/${x.total_questions}`}</td><td>${fmt(x.started_at)}</td><td>${fmt(x.submitted_at)}</td><td>${x.status==="in_progress"?`<a class="btn primary sm" href="#/preview/${testId}">Tiếp tục</a>`:`<a class="btn secondary sm" href="#/practice-result/${testId}/${x.id}">Xem</a>`}</td></tr>`).join("")||'<tr><td colspan="7" class="empty">Chưa có lượt làm thử.</td></tr>'}</tbody></table></div>`;
}
async function renderLiveTab(testId){
  const load=async()=>{
    const {data,error}=await sb.rpc("staff_get_test_live",{p_test_id:testId});
    if(error) return document.querySelector("#liveRoot").innerHTML=`<div class="warning-box">${esc(error.message)}</div>`;
    const rows=data.rows||[];
    const counts={
      total:rows.length,
      in:rows.filter(r=>r.status==="in_progress").length,
      done:rows.filter(r=>["submitted","auto_submitted"].includes(r.status)).length,
      none:rows.filter(r=>!r.attempt_id).length,
      viol:rows.filter(r=>(r.violation_count||0)>0).length
    };
    const root=document.querySelector("#liveRoot"); if(!root) return;
    root.innerHTML=`<div class="row between wrap"><div><h2>LIVE</h2><p class="muted">Tự cập nhật khi sinh viên làm bài.</p></div><button class="secondary" id="liveExcel">↓ Excel hiện tại</button></div>
    <div class="live-kpis">${[["Tổng",counts.total],["Đang làm",counts.in],["Đã nộp",counts.done],["Chưa vào",counts.none],["Có vi phạm",counts.viol]].map(([a,b])=>`<div><span>${a}</span><b>${b}</b></div>`).join("")}</div>
    <div class="row wrap live-filters">${["all","in_progress","done","none","viol"].map(k=>`<button class="${(testWorkspace?.liveFilter||"all")===k?"primary":"secondary"} sm live-filter" data-filter="${k}">${({all:"Tất cả",in_progress:"Đang làm",done:"Đã nộp",none:"Chưa làm",viol:"Có vi phạm"})[k]}</button>`).join("")}</div>
    <div class="table-wrap"><table id="liveTable"><thead><tr><th>Họ tên</th><th>MSSV</th><th>Lượt</th><th>Trạng thái</th><th>Tiến độ</th><th>Bắt đầu</th><th>Còn lại</th><th>Vi phạm</th><th>Điểm</th></tr></thead>
    <tbody>${rows.map(r=>liveRow(r)).join("")||`<tr><td colspan="9" class="empty">Lớp chưa có sinh viên.</td></tr>`}</tbody></table></div>`;
    root.dataset.rows=JSON.stringify(rows);
    document.querySelector("#liveExcel").onclick=()=>exportTestExcel(testId);
    const applyLiveFilter=(f)=>{
      if(testWorkspace?.id===testId) testWorkspace.liveFilter=f;
      document.querySelectorAll(".live-filter").forEach(x=>x.className=`${x.dataset.filter===f?"primary":"secondary"} sm live-filter`);
      document.querySelector("#liveTable tbody").innerHTML=rows.filter(r=>
        f==="all" || (f==="in_progress"&&r.status==="in_progress") || (f==="done"&&["submitted","auto_submitted"].includes(r.status)) || (f==="none"&&!r.attempt_id) || (f==="viol"&&(r.violation_count||0)>0)
      ).map(liveRow).join("")||`<tr><td colspan="9" class="empty">Không có dữ liệu.</td></tr>`;
    };
    document.querySelectorAll(".live-filter").forEach(btn=>btn.onclick=()=>applyLiveFilter(btn.dataset.filter));
    applyLiveFilter(testWorkspace?.liveFilter||"all");
  };
  await load();
  let pending=null;
  const refresh=()=>{clearTimeout(pending);pending=setTimeout(load,450)};
  liveChannel=sb.channel(`test-live-${testId}`)
    .on("postgres_changes",{event:"*",schema:"public",table:"attempts",filter:`test_id=eq.${testId}`},refresh)
    .on("postgres_changes",{event:"*",schema:"public",table:"answers"},refresh)
    .on("postgres_changes",{event:"*",schema:"public",table:"anti_cheat_events"},refresh)
    .subscribe();
}
function liveRow(r){
  let remain="—";
  if(r.status==="in_progress"&&r.expires_at){
    const sec=Math.max(0,Math.floor((new Date(r.expires_at)-Date.now())/1000));
    remain=`${Math.floor(sec/60)}:${String(sec%60).padStart(2,"0")}`;
  }
  const st=!r.attempt_id?"Chưa làm":r.status==="in_progress"?"Đang làm":r.status==="auto_submitted"?"Tự nộp":"Đã nộp";
  return `<tr data-status="${esc(r.status||"none")}"><td>${(r.attempt_id&&r.status!=="in_progress")?`<a href="#/result/${r.attempt_id}">${esc(r.full_name)}</a>`:esc(r.full_name)}</td><td>${esc(r.student_code||"—")}</td><td>${r.attempt_no||"—"}</td><td>${st}</td><td>${r.answered_count||0}</td><td>${fmt(r.started_at)}</td><td>${remain}</td><td>${r.violation_count||0}</td><td>${r.correct_count==null?"—":r.correct_count}</td></tr>`;
}
function submissionActions(r){
  if(!r.attempt_id) return "";
  const viewBtn=r.status==="in_progress"?"":`<a class="btn secondary sm" href="#/result/${r.attempt_id}">Xem</a>`;
  const delBtn=`<button class="danger sm delete-attempt" data-id="${r.attempt_id}" data-name="${esc(r.full_name)}">Xóa</button>`;
  if(r.status==="reset") return `<div class="row wrap">${viewBtn}<span class="status off">Đã reset</span>${delBtn}</div>`;
  return `<div class="row wrap">${viewBtn}<button class="ghost sm reset-attempt" data-id="${r.attempt_id}" data-name="${esc(r.full_name)}">Reset lượt</button>${delBtn}</div>`;
}
async function renderSubmissionsTab(testId){
  const {data,error}=await sb.rpc("staff_get_test_export",{p_test_id:testId});
  const root=document.querySelector("#submissionsRoot");
  if(!root) return;
  if(error) return root.innerHTML=`<div class="warning-box">${esc(error.message)}</div>`;
  const rows=data.students||[];
  root.innerHTML=`<div class="row between wrap"><div><h2>Bài làm sinh viên</h2><p class="muted">Xem từng lượt, reset để cho làm lại hoặc xóa lượt. Mọi thao tác quản trị đều được ghi log.</p></div><button class="primary" id="subExcel">↓ Tải Excel</button></div>
  <div class="table-wrap"><table><thead><tr><th>Họ tên</th><th>MSSV</th><th>Lần</th><th>Trạng thái</th><th>Bắt đầu</th><th>Nộp</th><th>Đúng</th><th>Vi phạm</th><th>Thao tác</th></tr></thead>
  <tbody>${rows.map(r=>`<tr><td>${esc(r.full_name)}</td><td>${esc(r.student_code||"—")}</td><td>${r.attempt_no||"—"}</td><td>${r.attempt_id?statusBadge(r.status):'<span class="status off">Chưa làm</span>'}</td><td>${fmt(r.started_at)}</td><td>${fmt(r.submitted_at)}</td><td>${r.correct_count??"—"}</td><td>${r.violation_count||0}</td><td>${submissionActions(r)}</td></tr>`).join("")}</tbody></table></div>`;
  document.querySelector("#subExcel").onclick=()=>exportTestExcel(testId);
  document.querySelectorAll(".reset-attempt").forEach(b=>b.onclick=()=>confirmAttemptAction("reset",testId,b.dataset.id,b.dataset.name));
  document.querySelectorAll(".delete-attempt").forEach(b=>b.onclick=()=>confirmAttemptAction("delete",testId,b.dataset.id,b.dataset.name));
}
async function confirmAttemptAction(action,testId,attemptId,name){
  const isDelete=action==="delete";
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><h2>${isDelete?"Xóa bài làm":"Reset lượt làm"}?</h2><p><b>${esc(name||"Sinh viên")}</b></p><div class="warning-box">${isDelete?"Bài làm, câu trả lời và sự kiện chống gian lận của lượt này sẽ bị xóa. Sinh viên có thể làm lại nếu còn lượt.":"Lượt cũ vẫn được giữ để đối soát nhưng chuyển trạng thái Reset; sinh viên được phép bắt đầu lượt mới."}</div><div class="row between"><button class="secondary" data-close>Hủy</button><button class="${isDelete?"danger":"primary"}" id="doAttemptAction">${isDelete?"Xóa bài làm":"Reset lượt"}</button></div></div></div>`;
  modalRoot.querySelector("[data-close]").onclick=closeModal;
  modalRoot.querySelector("#doAttemptAction").onclick=async()=>{
    const fn=isDelete?"staff_delete_attempt":"staff_reset_attempt";
    const {data:result,error}=await sb.rpc(fn,{p_attempt_id:attemptId}); if(error) return toast(error.message,6000);
    closeModal();
    if(isDelete){
      toast(result?.content_unlocked?"Đã xóa bài làm · đề đã được mở khóa":"Đã xóa bài làm");
      await refreshCurrentTest(testId,"submissions");
      return;
    }
    toast("Đã reset lượt làm");
    if(testWorkspace?.id===testId){testWorkspace.loaded.submissions=false;testWorkspace.loaded.live=false;}
    clearLiveChannel();
    await renderSubmissionsTab(testId);
  };
}
async function exportTestExcel(testId){
  toast("Đang tạo Excel…");
  const {data,error}=await sb.rpc("staff_get_test_export",{p_test_id:testId});
  if(error) return toast(error.message,6000);
  const students=data.students||[];
  const summary=students.map((s,i)=>({
    STT:i+1,"Họ tên":s.full_name,MSSV:s.student_code||"","Lần làm":s.attempt_no||"","Trạng thái":s.status||"Chưa làm",
    "Bắt đầu":s.started_at?new Date(s.started_at).toLocaleString("vi-VN"):"",
    "Nộp bài":s.submitted_at?new Date(s.submitted_at).toLocaleString("vi-VN"):"",
    "Số câu đúng":s.correct_count??"","Điểm":s.score??"","Vi phạm":s.violation_count||0,"Lý do nộp":s.submission_reason||""
  }));
  const detail=[];
  for(const s of students) for(const a of s.answers||[]) detail.push({
    "Họ tên":s.full_name,MSSV:s.student_code||"","Lần làm":s.attempt_no||"","Câu":a.number,"Đã chọn":a.selected||"","Đáp án":a.correct||"","Đúng/Sai":a.is_correct?"Đúng":"Sai"
  });
  const violations=[];
  for(const s of students) for(const v of s.violations||[]) violations.push({
    "Họ tên":s.full_name,MSSV:s.student_code||"","Lần làm":s.attempt_no||"","Sự kiện":v.event_type,"Lần":v.violation_number,"Thời điểm":new Date(v.occurred_at).toLocaleString("vi-VN")
  });
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(summary),"Tong_hop");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(detail),"Chi_tiet");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(violations),"Vi_pham");
  const safe=(data.test?.title||"ket-qua").replace(/[\\/:*?"<>|]+/g,"-");
  XLSX.writeFile(wb,`${safe}.xlsx`);
  toast("Đã tạo file Excel");
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
async function renderStudent(){
  showLoading();
  const [{data:tests=[],error},{data:attempts=[]}] = await Promise.all([
    sb.from("tests").select("*,classes(name)").eq("status","published").is("archived_at",null).order("created_at",{ascending:false}),
    sb.from("attempts").select("*").eq("student_id",session.user.id).order("attempt_no",{ascending:false})
  ]);
  if(error) console.error(error);
  const byTest={};
  for(const a of attempts){(byTest[a.test_id]??=[]).push(a);}
  view.innerHTML=`<section class="card"><h1>Bài kiểm tra của tôi</h1><p class="muted">${esc(profile.full_name)} · ${esc(profile.student_code||"")}</p></section>
  <section class="grid grid-2 student-tests">
    ${tests.map(t=>{
      const all=byTest[t.id]||[];
      const valid=all.filter(a=>a.status!=="reset");
      const inProgress=valid.find(a=>a.status==="in_progress");
      const latest=inProgress||valid.sort((a,b)=>(b.attempt_no||0)-(a.attempt_no||0))[0];
      const used=valid.length,remaining=Math.max(0,(t.max_attempts||1)-used);
      let action="";
      if(inProgress) action=`<a class="btn primary" href="#/exam/${inProgress.id}">Tiếp tục lượt ${inProgress.attempt_no||1}</a>`;
      else if(remaining>0) action=`<button class="primary start-test" data-id="${t.id}" data-max="${t.max_attempts||1}" data-used="${used}">${used?`Làm lượt ${used+1}`:"Bắt đầu"}</button>${latest?`<a class="btn secondary" href="#/result/${latest.id}">Xem lượt trước</a>`:""}`;
      else if(latest) action=`<a class="btn secondary" href="#/result/${latest.id}">Xem kết quả</a>`;
      return `<div class="card"><div class="row between"><span class="badge">${esc(t.classes?.name||"TOEIC")}</span>${latest?statusBadge(latest.status):'<span class="status off">Chưa làm</span>'}</div>
      <h2>${esc(t.title)}</h2><p class="muted">${esc(t.description||"Bài kiểm tra TOEIC")}</p><div class="row wrap"><span>⏱ ${t.duration_minutes} phút</span><span>•</span><span>${used}/${t.max_attempts||1} lượt đã dùng</span>${remaining?`<span>• còn ${remaining}</span>`:""}</div>
      <div class="test-action row wrap">${action}</div></div>`;
    }).join("")||`<div class="card empty">Hiện chưa có bài kiểm tra được mở.</div>`}
  </section>`;
  document.querySelectorAll(".start-test").forEach(b=>b.onclick=()=>confirmStart(b.dataset.id,+b.dataset.max||1,+b.dataset.used||0));
}
function confirmStart(testId,maxAttempts=1,used=0){
  const nextNo=used+1;
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal">
    <h2>Trước khi bắt đầu lượt ${nextNo}</h2>
    <div class="warning-box"><b>Quy định chống gian lận</b><br>Mỗi lần rời màn hình được tính ngay 1 vi phạm. Quay lại trong 15 giây để tiếp tục; quá 15 giây hoặc rời màn hình lần thứ 3, hệ thống tự động nộp bài.</div>
    <p>Bài cho phép tối đa <b>${maxAttempts} lượt</b>. Bạn đã dùng <b>${used}</b> lượt. Đồng hồ bắt đầu ngay khi nhấn Bắt đầu.</p>
    <div class="row between"><button class="secondary" data-close>Hủy</button><button class="primary" id="confirmStart">Bắt đầu lượt ${nextNo}</button></div>
  </div></div>`;
  modalRoot.querySelector("[data-close]").onclick=closeModal;
  modalRoot.querySelector("#confirmStart").onclick=async()=>{
    antiCheat.armAudio();
    const btn=modalRoot.querySelector("#confirmStart");btn.disabled=true;btn.textContent="Đang bắt đầu…";
    const {data,error}=await sb.rpc("start_attempt",{p_test_id:testId});
    if(error){btn.disabled=false;btn.textContent=`Bắt đầu lượt ${nextNo}`;return toast(error.message,6000);}
    closeModal();
    try{ await document.documentElement.requestFullscreen?.(); }catch{}
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
  const ui=readJSON(attemptUiKey(attemptId),{current:0});
  examState={attemptId,payload:data,current:Math.min(ui.current||0,(data.questions?.length||1)-1),saveStatus:"Đã lưu"};
  mergeQueuedAnswers(attemptId,data.questions||[]);
  await hydrateMedia(data.questions||[]);
  drawExam(); antiCheat.bind(); flushAnswerQueue();
}
function buildPracticeQuestions(authoring,answers=[]){
  const groupMap=new Map((authoring?.stimulus_groups||[]).map(g=>[g.id,g]));
  const savedAnswers=new Map(answers.map(a=>[a.question_id,a]));
  return (authoring?.questions||[]).slice()
    .sort((a,b)=>(a.part_no-b.part_no)||(a.source_order-b.source_order)||(a.source_number-b.source_number))
    .map(q=>{
      const a=savedAnswers.get(q.id);
      return {...q,part:q.part_no,number:q.source_number,selected:a?.selected,marked:!!a?.marked,
        choices:(q.choices||[]).map(c=>({...c,key:c.key||c.choice_key})),
        stimuli:(groupMap.get(q.stimulus_group_id)?.stimuli||[]).map(s=>({...s,type:s.media_type}))};
    });
}
async function renderStaffPreview(testId){
  showLoading("Đang mở chế độ làm thử...");
  const {data:start,error:startError}=await sb.rpc("staff_start_practice_attempt",{p_test_id:testId});
  if(startError) return view.innerHTML=`<div class="card"><a href="#/test/${testId}">← Quay lại</a><p>${esc(startError.message)}</p></div>`;
  const practiceId=start?.attempt_id;
  const [{data,error},{data:practice,error:practiceError}]=await Promise.all([
    sb.rpc("get_test_authoring",{p_test_id:testId}),
    sb.rpc("staff_get_practice_attempt",{p_attempt_id:practiceId})
  ]);
  if(error||practiceError) return view.innerHTML=`<div class="card"><a href="#/test/${testId}">← Quay lại</a><p>${esc((error||practiceError).message)}</p></div>`;
  const t=data?.test||{};
  const questions=buildPracticeQuestions(data,practice?.answers||[]);
  if(!questions.length) return view.innerHTML=`<div class="card"><a href="#/test/${testId}">← Quay lại</a><h2>${esc(t.title||"Bài kiểm tra")}</h2><p>Chưa có câu hỏi để làm thử.</p></div>`;
  if(practice?.attempt?.status!=="in_progress") return renderStoredPracticeResult(testId,practiceId,questions,practice.attempt);
  const ui=readJSON(attemptUiKey(practiceId),{current:0});
  examState={
    attemptId:practiceId,
    preview:true,
    persistedPractice:true,
    testId,
    payload:{
      test:t,
      questions,
      attempt:{...practice.attempt,
        anti_cheat_mode:"off",
        violation_count:0, allowed_violations:0
      }
    },
    current:Math.min(ui.current||0,questions.length-1),
    saveStatus:start?.resumed?"Đã phục hồi lượt làm thử":"Lượt làm thử đã được lưu"
  };
  await hydrateMedia(questions);
  drawExam();
}
async function renderStaffPracticeResult(testId,attemptId){
  showLoading("Đang tải kết quả làm thử...");
  const [{data,error},{data:practice,error:practiceError}]=await Promise.all([
    sb.rpc("get_test_authoring",{p_test_id:testId}),
    sb.rpc("staff_get_practice_attempt",{p_attempt_id:attemptId})
  ]);
  if(error||practiceError) return view.innerHTML=`<div class="card"><a href="#/test/${testId}/practice">← Quay lại</a><p>${esc((error||practiceError).message)}</p></div>`;
  const questions=buildPracticeQuestions(data,practice?.answers||[]);
  renderStoredPracticeResult(testId,attemptId,questions,practice?.attempt||{});
}
function mergeQueuedAnswers(attemptId,questions){
  const queue=readJSON(attemptQueueKey(attemptId),[]);
  for(const ev of queue){
    const q=questions.find(x=>x.id===ev.question_id);
    if(q){q.selected=ev.choice;q.marked=ev.marked;}
  }
}
async function hydrateMedia(questions){
  const paths=new Set();
  const staticUrl=p=>p?.startsWith("static:") ? p.slice(7) : null;
  for(const q of questions){
    if(q.storage_path && !staticUrl(q.storage_path)) paths.add(q.storage_path);
    embeddedImagePaths(q.content).forEach(p=>paths.add(p));
    for(const s of q.stimuli||[]) if(s.storage_path && !staticUrl(s.storage_path)) paths.add(s.storage_path);
    for(const s of q.stimuli||[]) embeddedImagePaths(s.content).forEach(p=>paths.add(p));
    for(const c of q.choices||[]){
      if(c.storage_path && !staticUrl(c.storage_path)) paths.add(c.storage_path);
      embeddedImagePaths(c.content).forEach(p=>paths.add(p));
    }
  }
  const m=await signedUrlMap([...paths]);
  const resolve=p=>staticUrl(p)||m[p];
  for(const q of questions){
    if(q.storage_path) q.url=resolve(q.storage_path);
    q.content=hydrateEmbeddedImages(q.content,m);
    for(const s of q.stimuli||[]){if(s.storage_path)s.url=resolve(s.storage_path);s.content=hydrateEmbeddedImages(s.content,m);}
    for(const c of q.choices||[]){if(c.storage_path)c.url=resolve(c.storage_path);c.content=hydrateEmbeddedImages(c.content,m);}
  }
}
function renderMedia(type,url,content,cls=""){
  if(type==="image" && url) return `<img class="question-media ${cls}" src="${url}" alt="Nội dung câu hỏi">`;
  if(type==="audio" && url) return `<audio class="${cls}" controls src="${url}"></audio>`;
  if(type==="text" || content) return content?`<div class="rich-content ${cls}">${renderRichText(content)}</div>`:"";
  return "";
}
function saveAttemptUi(){
  if(!examState) return;
  writeJSON(attemptUiKey(examState.attemptId),{current:examState.current,updated_at:Date.now()});
}
function setSaveStatus(text,cls=""){
  if(examState) examState.saveStatus=text;
  const el=document.querySelector("#saveStatus");
  if(el){el.textContent=text;el.className=`save-status ${cls}`;}
}
function drawExam(){
  const {payload,current}=examState;
  const q=payload.questions[current], a=payload.attempt;
  if(!q) return view.innerHTML=`<div class="card">Không có câu hỏi.</div>`;
  const antiText=examState.preview?"Giảng viên làm thử · lưu lịch sử riêng, không tính vào kết quả sinh viên":a.anti_cheat_mode==="off"?"Chống gian lận: Tắt":a.anti_cheat_mode==="strict"?`Vi phạm: ${a.violation_count||0}/1 · rời màn hình tính ngay`:`Vi phạm: ${a.violation_count||0}/3 · rời màn hình tính ngay · quá 15 giây hoặc lần 3 sẽ tự nộp`;
  saveAttemptUi();
  view.innerHTML=`${examState.preview?`<section class="card preview-banner"><div class="row between wrap"><div><b>Chế độ làm thử</b><div class="muted">Giao diện như sinh viên · tự lưu trong lịch sử riêng của giảng viên</div></div><a class="btn secondary" href="#/test/${examState.testId}/practice">← Thoát làm thử</a></div></section>`:""}<section class="exam-layout"><div class="exam-main">
    <div class="card"><div class="row between wrap"><div><b>Part ${q.part}</b><div class="muted">Câu ${q.number} · ${current+1}/${payload.questions.length}</div></div><div class="exam-status"><span id="saveStatus" class="save-status">${esc(examState.saveStatus||"Đã lưu")}</span><div id="timer" class="timer"></div></div></div></div>
    ${(q.stimuli||[]).map(s=>`<div class="stimulus">${renderMedia(s.type,s.url,s.content)}</div>`).join("")}
    <div class="card question">
      ${renderMedia(q.media_type,q.url,null)}
      <div class="question-title"><b>${q.number}.</b><div class="rich-content">${renderRichText(q.content||"")}</div></div>
      ${(q.choices||[]).map(c=>`<label class="choice">
        <input type="radio" name="choice" value="${c.key}" ${q.selected===c.key?"checked":""}>
        <b>${c.key}.</b>
        <div class="choice-body">${renderMedia(c.media_type,c.url,null,"choice-media")}<div class="rich-content">${renderRichText(c.content||"")}</div></div>
      </label>`).join("")}
      <div class="divider"></div>
      <label class="review-label"><input id="markReview" type="checkbox" ${q.marked?"checked":""}> Đánh dấu xem lại</label>
    </div>
    <div class="exam-toolbar"><button class="secondary" id="prevBtn" ${current===0?"disabled":""}>← Câu trước</button><button class="secondary" id="nextBtn" ${current===payload.questions.length-1?"disabled":""}>Câu sau →</button></div>
  </div>
  <aside class="exam-side"><div class="card sticky"><div class="row between"><b>Câu hỏi</b><span class="muted">${payload.questions.filter(x=>x.selected).length}/${payload.questions.length}</span></div>
  <div class="palette">${payload.questions.map((x,i)=>`<button class="qbtn ${x.selected?"done":""} ${x.marked?"review":""} ${i===current?"current":""}" data-i="${i}">${x.number}</button>`).join("")}</div>
  <button class="${examState.preview?"primary":"danger"} full" id="submitBtn">${examState.preview?"Kết thúc làm thử":"Nộp bài"}</button>${examState.preview?"":'<button class="secondary full" id="fullscreenBtn" type="button">⛶ Toàn màn hình</button>'}<p id="antiCheatStatus" class="muted small">${esc(antiText)}</p></div></aside></section>`;

  document.querySelectorAll(".qbtn").forEach(b=>b.onclick=()=>{examState.current=+b.dataset.i;drawExam()});
  document.querySelector("#prevBtn").onclick=()=>{examState.current--;drawExam()};
  document.querySelector("#nextBtn").onclick=()=>{examState.current++;drawExam()};
  document.querySelectorAll('input[name="choice"]').forEach(r=>r.onchange=()=>saveCurrent(r.value));
  document.querySelector("#markReview").onchange=e=>saveCurrent(q.selected,e.target.checked);
  document.querySelector("#submitBtn").onclick=confirmSubmit;
  const fullscreenBtn=document.querySelector("#fullscreenBtn");
  if(fullscreenBtn) fullscreenBtn.onclick=async()=>{
    saveAttemptUi();
    flushAnswerQueue();
    try{ await document.documentElement.requestFullscreen?.(); }catch{}
  };
  clearInterval(timerId);
  updateTimer(); timerId=setInterval(updateTimer,1000);
}
function enqueueAnswer(attemptId,event){
  const q=readJSON(attemptQueueKey(attemptId),[]);
  q.push(event);
  writeJSON(attemptQueueKey(attemptId),q);
}
async function saveCurrent(choice,marked=document.querySelector("#markReview")?.checked||false){
  if(!examState) return;
  const q=examState.payload.questions[examState.current];
  q.marked=marked;
  if(examState.preview){
    if(choice) q.selected=choice;
    drawPaletteOnly();
    setSaveStatus("Đang lưu…","pending");
    const state=examState;
    const previous=state.pendingSave||Promise.resolve();
    const saveTask=previous.then(()=>sb.rpc("staff_save_practice_answer",{
      p_attempt_id:state.attemptId,p_question_id:q.id,p_choice:choice||null,p_marked:marked
    })).then(result=>{
      if(result.error) throw result.error;
      return result;
    });
    const settled=saveTask.then(result=>({result}),error=>({error}));
    state.pendingSave=settled;
    const outcome=await settled;
    if(outcome.error){
      if(examState===state) setSaveStatus(`Chưa lưu: ${outcome.error.message}`,"offline");
    }else if(examState===state){
      setSaveStatus("Đã lưu","saved");
    }
    if(state.pendingSave===settled) state.pendingSave=null;
    return;
  }
  if(choice) q.selected=choice;
  const ev={client_event_id:crypto.randomUUID(),question_id:q.id,choice:choice||null,marked,created_at:Date.now()};
  enqueueAnswer(examState.attemptId,ev);
  setSaveStatus(navigator.onLine?"Đang lưu…":"Mất mạng – đã lưu tạm",navigator.onLine?"pending":"offline");
  drawPaletteOnly();
  flushAnswerQueue();
}
function drawPaletteOnly(){
  const side=document.querySelector(".exam-side");
  if(!side) return;
  side.querySelectorAll(".qbtn").forEach((b,i)=>{
    const x=examState.payload.questions[i];
    b.classList.toggle("done",!!x.selected);
    b.classList.toggle("review",!!x.marked);
  });
}
async function flushAnswerQueue(){
  if(answerFlushBusy||!examState||!navigator.onLine) return;
  answerFlushBusy=true;
  try{
    let queue=readJSON(attemptQueueKey(examState.attemptId),[]);
    while(queue.length){
      const ev=queue[0];
      setSaveStatus("Đang lưu…","pending");
      const {data,error}=await sb.rpc("save_answer_v2",{
        p_attempt_id:examState.attemptId,p_question_id:ev.question_id,p_choice:ev.choice,
        p_marked:ev.marked,p_client_event_id:ev.client_event_id
      });
      if(error){ setSaveStatus("Lưu tạm – chờ mạng","offline"); break; }
      queue.shift(); writeJSON(attemptQueueKey(examState.attemptId),queue);
      if(data?.submitted){ go(`/result/${examState.attemptId}`); return; }
    }
    if(!queue.length) setSaveStatus("Đã lưu","saved");
  }finally{answerFlushBusy=false;}
}
function updateTimer(){
  if(!examState) return;
  const left=Math.max(0,new Date(examState.payload.attempt.expires_at)-Date.now());
  const el=document.querySelector("#timer"); if(!el) return;
  const s=Math.floor(left/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),ss=s%60;
  el.textContent=`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
  el.classList.toggle("danger-text",s<300);
  if(left<=0){
    clearInterval(timerId);
    if(examState.preview) renderPreviewResult("expired");
    else go(`/result/${examState.attemptId}`);
  }
}
function confirmSubmit(){
  if(examState?.preview){
    modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal">
      <h2>Kết thúc làm thử?</h2><p>Thầy đã trả lời <b>${examState.payload.questions.filter(x=>x.selected).length}/${examState.payload.questions.length}</b> câu. Kết quả sẽ được lưu vào lịch sử làm thử riêng.</p>
      <div class="row between"><button class="secondary" data-close>Tiếp tục làm</button><button class="primary" id="finishPreview">Xem kết quả thử</button></div>
    </div></div>`;
    modalRoot.querySelector("[data-close]").onclick=closeModal;
    modalRoot.querySelector("#finishPreview").onclick=()=>{closeModal();renderPreviewResult("submitted")};
    return;
  }
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal">
    <h2>Nộp bài?</h2><p>Bạn đã trả lời <b>${examState.payload.questions.filter(x=>x.selected).length}/${examState.payload.questions.length}</b> câu.</p>
    <div class="row between"><button class="secondary" data-close>Tiếp tục làm</button><button class="danger" id="doSubmit">Nộp bài</button></div>
  </div></div>`;
  modalRoot.querySelector("[data-close]").onclick=closeModal;
  modalRoot.querySelector("#doSubmit").onclick=async()=>{
    if(readJSON(attemptQueueKey(examState.attemptId),[]).length){
      await flushAnswerQueue();
      if(readJSON(attemptQueueKey(examState.attemptId),[]).length) return toast("Còn đáp án chưa đồng bộ. Hãy chờ mạng ổn định trước khi nộp.",6000);
    }
    const {error}=await sb.rpc("submit_attempt",{p_attempt_id:examState.attemptId});
    if(error) return toast(error.message);
    localStorage.removeItem(attemptQueueKey(examState.attemptId));
    localStorage.removeItem(attemptUiKey(examState.attemptId));
    closeModal(); go(`/result/${examState.attemptId}`);
  };
}
async function renderPreviewResult(status="submitted"){
  if(!examState?.preview) return;
  clearInterval(timerId); timerId=null;
  if(examState.pendingSave) await examState.pendingSave;
  const {questions}=examState.payload, testId=examState.testId;
  const attemptId=examState.attemptId;
  const {data,error}=await sb.rpc("staff_finish_practice_attempt",{p_attempt_id:attemptId,p_status:status});
  if(error) return toast(error.message,6000);
  localStorage.removeItem(attemptUiKey(attemptId));
  history.replaceState({practiceResult:true},"",`#/practice-result/${testId}/${attemptId}`);
  renderStoredPracticeResult(testId,attemptId,questions,{...data,status});
}
function renderStoredPracticeResult(testId,attemptId,questions,attempt={}){
  clearInterval(timerId); timerId=null;
  const correct=attempt.correct_count??questions.filter(q=>q.selected && q.selected===q.correct_choice_key).length;
  const answered=questions.filter(q=>q.selected).length;
  view.innerHTML=`<section class="card">
    <span class="eyebrow">Kết quả làm thử</span><h1>${correct}/${questions.length} câu đúng</h1>
    <p class="muted">Đã trả lời ${answered}/${questions.length} câu. Lượt này đã lưu trong lịch sử làm thử riêng của giảng viên.</p>
    <div class="row wrap"><button class="primary" id="retryPreview">Làm lượt mới</button><a class="btn secondary" href="#/test/${testId}/practice">← Về lịch sử làm thử</a></div>
  </section>
  <section class="card result-list"><h2>Đối chiếu đáp án</h2>${questions.map(q=>`<div class="result-row"><b>Câu ${q.number}</b> · Đã chọn: <b>${esc(q.selected||"—")}</b> · Đáp án: <b>${esc(q.correct_choice_key||"—")}</b> · <span class="${q.selected===q.correct_choice_key?"correct":"wrong"}">${q.selected===q.correct_choice_key?"Đúng":"Sai"}</span></div>`).join("")}</section>`;
  examState=null;
  document.querySelector("#retryPreview")?.addEventListener("click",()=>go(`/preview/${testId}`));
}
function renderAttemptReview(questions,showAnswers){
  let previousGroup=null;
  return questions.map(q=>{
    const showStimuli=!!q.stimulus_group_id && q.stimulus_group_id!==previousGroup;
    if(q.stimulus_group_id) previousGroup=q.stimulus_group_id;
    else previousGroup=null;
    const selected=q.selected||null;
    const correct=showAnswers?q.correct:null;
    const stateText=!selected?"Chưa trả lời":showAnswers?(q.is_correct?"Đúng":"Sai"):`Đã chọn ${selected}`;
    const stateClass=!selected?"unanswered":showAnswers?(q.is_correct?"correct":"wrong"):"selected-only";
    const choices=(q.choices||[]).map(c=>{
      const isSelected=selected===c.key;
      const isCorrect=showAnswers && correct===c.key;
      const cls=["review-choice",isSelected?"selected":"",isCorrect?"correct-choice":"",showAnswers&&isSelected&&!isCorrect?"wrong-choice":""].filter(Boolean).join(" ");
      const tag=isCorrect?'<span class="review-choice-tag correct">Đáp án đúng</span>':isSelected?'<span class="review-choice-tag">Bạn chọn</span>':"";
      return `<div class="${cls}"><div class="review-choice-key"><b>${esc(c.key)}.</b></div><div class="choice-body">${renderMedia(c.media_type,c.url,null,"choice-media")}<div class="rich-content">${renderRichText(c.content||"")}</div></div>${tag}</div>`;
    }).join("");
    return `<article class="review-question">
      ${showStimuli?(q.stimuli||[]).map(st=>`<div class="stimulus review-stimulus">${renderMedia(st.type,st.url,st.content)}</div>`).join(""):""}
      <div class="review-question-head"><div><b>Part ${q.part}</b> · Câu ${q.number}</div><span class="review-state ${stateClass}">${esc(stateText)}</span></div>
      ${renderMedia(q.media_type,q.url,null)}
      <div class="question-title"><b>${q.number}.</b><div class="rich-content">${renderRichText(q.content||"")}</div></div>
      <div class="review-choices">${choices}</div>
      <div class="review-summary">Bạn chọn: <b>${esc(selected||"—")}</b>${showAnswers?` · Đáp án đúng: <b>${esc(correct||"—")}</b>`:' · <span class="muted">Đáp án đúng chưa được công bố</span>'}</div>
    </article>`;
  }).join("");
}

async function renderResult(attemptId,staffView=false){
  showLoading("Đang tải kết quả...");
  const {data,error}=await sb.rpc("get_attempt_result",{p_attempt_id:attemptId});
  if(error){
    if(error.message.includes("not submitted")){
      setTimeout(()=>renderResult(attemptId,staffView),1200);
      return view.innerHTML=`<div class="card">Đang chốt bài...</div>`;
    }
    return view.innerHTML=`<div class="card">${esc(error.message)}</div>`;
  }
  examState=null;
  antiCheat.reset();
  try{ if(document.fullscreenElement) await document.exitFullscreen(); }catch{}
  const ans=data.answers||[],questions=data.questions||[];
  if(questions.length) await hydrateMedia(questions);
  const total=data.total_questions||questions.length||ans.length||100;
  const pct=total?Math.round((Number(data.correct_count||0)/total)*1000)/10:0;
  const showAnswers=staffView || !!data.show_answers;
  const autoReason=data.submission_reason==="anti_cheat"
    ? '<div class="warning-box result-warning"><b>Bài được hệ thống tự động nộp do chống gian lận.</b></div>'
    : data.submission_reason==="timeout"
      ? '<div class="warning-box result-warning"><b>Bài được hệ thống tự động nộp vì hết thời gian.</b></div>'
      : "";
  const review=questions.length
    ? renderAttemptReview(questions,showAnswers)
    : ans.length
      ? ans.map(x=>`<div class="result-row"><b>Câu ${x.number}</b> · Bạn chọn: <b>${esc(x.selected||"—")}</b>${showAnswers?` · Đáp án: <b>${esc(x.correct||"—")}</b> · <span class="${x.is_correct?"correct":"wrong"}">${x.is_correct?"Đúng":"Sai"}</span>`:""}</div>`).join("")
      : '<div class="empty">Chưa có dữ liệu xem lại bài làm. Hãy áp dụng migration Supabase V1.10.</div>';
  view.innerHTML=`${staffView?staffNav("tests"):""}<section class="card">
    <span class="eyebrow">Kết quả${data.attempt_no?` · Lượt ${data.attempt_no}`:""}</span><h1>Hoàn thành bài thi</h1>
    <div class="row score-row"><div><div class="big-score">${data.correct_count}/${total}</div><div class="muted">${pct}%</div></div><div>${statusBadge(data.status)}</div></div>
    <p class="muted">Nộp lúc ${fmt(data.submitted_at)}${data.violation_count!=null?` · Vi phạm: ${data.violation_count}/3`:""}</p>${autoReason}${staffView?'<button class="btn primary" id="backFromResult">← Quay lại bài kiểm tra</button>':'<a class="btn primary" href="#/student">Về danh sách bài</a>'}
  </section>
  <section class="card result-list"><div class="row between wrap"><div><h2>Xem lại bài làm</h2><p class="muted">${showAnswers?"Đáp án đúng được hiển thị theo cài đặt của bài kiểm tra.":"Bạn được xem lại câu hỏi và phương án đã chọn; đáp án đúng chưa được công bố."}</p></div></div>${review}</section>`;
  document.querySelector("#backFromResult")?.addEventListener("click",()=>history.back());
}


boot();
