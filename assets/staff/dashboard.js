import { esc,roleLabel } from "../modules/utils.js";

export function createDashboardController(ctx){
  const {showLoading,staffNav,prefetchStaffData,getStaffDataCache,getView,getProfile}=ctx;
  async function renderTeacher(){
    const cache=getStaffDataCache();
    if(!cache.users||!cache.classes||!cache.tests) showLoading();
    await prefetchStaffData();
    const view=getView(),profile=getProfile(),users=cache.users||[],classes=cache.classes||[],tests=cache.tests||[];
    const sCount=users.filter(x=>x.role==="student").length,tCount=users.filter(x=>["teacher","system_admin"].includes(x.role)).length;
    view.innerHTML=`${staffNav("home")}<section class="card"><h1>Bảng điều khiển</h1><div class="muted">${esc(profile.full_name)} · ${esc(roleLabel(profile.role))}</div></section>
    <section class="grid grid-4 kpi-grid">${[["Sinh viên",sCount],["Giảng viên",tCount],["Lớp",classes.length],["Bài kiểm tra",tests.length]].map(([a,b])=>`<div class="card"><div class="muted">${a}</div><div class="kpi">${b}</div></div>`).join("")}</section>
    <h2 class="section-title">Thao tác nhanh</h2><section class="grid grid-3"><a class="card card-link" href="#/accounts"><h3>Tài khoản</h3><p class="muted">Tạo từng người hoặc nhập danh sách sinh viên từ Excel/CSV.</p></a><a class="card card-link" href="#/classes"><h3>Lớp</h3><p class="muted">Tạo lớp và gán sinh viên.</p></a><a class="card card-link" href="#/tests"><h3>Bài kiểm tra</h3><p class="muted">Tạo thủ công, nhập file, nhân bản bài cũ và chuẩn bị AI.</p></a></section>`;
    if(Date.now()-(cache.updatedAt||0)>60000)setTimeout(()=>prefetchStaffData(true),0);
  }
  return {renderTeacher};
}
