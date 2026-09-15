import { esc,statusBadge } from "../modules/utils.js";
import { loadAttemptCounts,renderStaffTestsTable } from "../modules/staff-tests.js";

export function createTestListController(ctx){
  const {sb,showLoading,staffNav,prefetchStaffData,getStaffDataCache,getView,getTestCreate}=ctx;
  async function renderTests(){
    const cache=getStaffDataCache();if(!cache.tests)showLoading();await prefetchStaffData();
    const data=cache.tests||[],counts=await loadAttemptCounts(sb,data),view=getView();
    view.innerHTML=`${staffNav("tests")}<section class="card"><div class="row between wrap"><div><h1>Bài kiểm tra</h1><p class="muted">Reading, Listening và Full Test dùng chung danh sách; lượt đã làm là số lượt thật trong hệ thống.</p></div><button id="newTest" class="primary">+ Tạo bài kiểm tra</button></div>${renderStaffTestsTable({tests:data,counts,esc,statusBadge})}</section>`;
    document.querySelector("#newTest").onclick=()=>getTestCreate().open();
  }
  return {renderTests,openNewTest:()=>getTestCreate().open()};
}
