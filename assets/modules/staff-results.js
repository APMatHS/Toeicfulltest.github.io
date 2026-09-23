import { loadXlsx } from "../services/xlsx-service.js";
import { formatScore10,scoreOutOfTen } from "./score-utils.js";

export function createStaffResultsController({sb,esc,fmt,statusBadge,toast,getWorkspace,setLiveChannel,clearLiveChannel,refreshCurrentTest}){
  async function renderPracticeTab(testId){
    const root=document.querySelector("#practiceRoot"); if(!root) return;
    const {data,error}=await sb.rpc("staff_list_practice_attempts",{p_test_id:testId});
    if(error) return root.innerHTML=`<div class="warning-box">${esc(error.message)}</div>`;
    const rows=data||[],open=rows.find(x=>x.status==="in_progress");
    root.innerHTML=`<div class="row between wrap"><div><h2>Làm thử như sinh viên</h2><p class="muted">Mỗi đáp án được lưu vào khu vực riêng của giảng viên, không xuất hiện trong LIVE hoặc kết quả lớp.</p></div><a class="btn primary" href="#/preview/${testId}">${open?"Tiếp tục lượt đang làm":"Bắt đầu lượt làm thử"}</a></div>
    <div class="table-wrap"><table><thead><tr><th>Lượt</th><th>Trạng thái</th><th>Đã trả lời</th><th>Số câu đúng</th><th>Điểm /10</th><th>Bắt đầu</th><th>Kết thúc</th><th></th></tr></thead>
    <tbody>${rows.map((x,i)=>`<tr><td>${rows.length-i}</td><td>${x.status==="in_progress"?'<span class="status warn">Đang làm</span>':x.status==="expired"?'<span class="status off">Hết giờ</span>':'<span class="status ok">Đã nộp</span>'}</td><td>${x.answered_count||0}/${x.total_questions||0}</td><td>${x.correct_count==null?"—":`${x.correct_count}/${x.total_questions}`}</td><td>${x.correct_count==null?"—":formatScore10(x.correct_count,x.total_questions)}</td><td>${fmt(x.started_at)}</td><td>${fmt(x.submitted_at)}</td><td>${x.status==="in_progress"?`<a class="btn primary sm" href="#/preview/${testId}">Tiếp tục</a>`:`<a class="btn secondary sm" href="#/practice-result/${testId}/${x.id}">Xem</a>`}</td></tr>`).join("")||'<tr><td colspan="8" class="empty">Chưa có lượt làm thử.</td></tr>'}</tbody></table></div>`;
  }

  function liveRow(r,totalQuestions=100){
    let remain="—";
    if(r.status==="in_progress"&&r.expires_at){const sec=Math.max(0,Math.floor((new Date(r.expires_at)-Date.now())/1000));remain=`${Math.floor(sec/60)}:${String(sec%60).padStart(2,"0")}`;}
    const st=!r.attempt_id?"Chưa làm":r.status==="in_progress"?"Đang làm":r.status==="auto_submitted"?"Tự nộp":"Đã nộp";
    return `<tr data-status="${esc(r.status||"none")}"><td>${(r.attempt_id&&r.status!=="in_progress")?`<a href="#/result/${r.attempt_id}">${esc(r.full_name)}</a>`:esc(r.full_name)}</td><td>${esc(r.student_code||"—")}</td><td>${r.attempt_no||"—"}</td><td>${st}</td><td>${r.answered_count||0}</td><td>${fmt(r.started_at)}</td><td>${remain}</td><td>${r.violation_count||0}</td><td>${r.correct_count==null?"—":formatScore10(r.correct_count,totalQuestions)}</td></tr>`;
  }

  async function renderLiveTab(testId){
    const load=async()=>{
      const {data,error}=await sb.rpc("staff_get_test_live",{p_test_id:testId});
      const root=document.querySelector("#liveRoot"); if(!root) return;
      if(error) return root.innerHTML=`<div class="warning-box">${esc(error.message)}</div>`;
      const rows=data.rows||[],workspace=getWorkspace(),totalQuestions=workspace?.qs?.length||100;
      const counts={roster:Number(data.roster_count??rows.length),attempts:Number(data.attempt_count??rows.filter(r=>r.attempt_id).length),in:rows.filter(r=>r.status==="in_progress").length,done:rows.filter(r=>["submitted","auto_submitted"].includes(r.status)).length,none:rows.filter(r=>!r.attempt_id).length,viol:rows.filter(r=>(r.violation_count||0)>0).length};
      root.innerHTML=`<div class="row between wrap"><div><h2>LIVE</h2><p class="muted">Tự cập nhật khi sinh viên làm bài.</p></div><button class="secondary" id="liveExcel">↓ Excel hiện tại</button></div>
      <div class="live-kpis">${[["Sĩ số",counts.roster],["Lượt thi",counts.attempts],["Đang làm",counts.in],["Đã nộp",counts.done],["Chưa vào",counts.none],["Có vi phạm",counts.viol]].map(([a,b])=>`<div><span>${a}</span><b>${b}</b></div>`).join("")}</div>
      <div class="row wrap live-filters">${["all","in_progress","done","none","viol"].map(k=>`<button class="${(getWorkspace()?.liveFilter||"all")===k?"primary":"secondary"} sm live-filter" data-filter="${k}">${({all:"Tất cả",in_progress:"Đang làm",done:"Đã nộp",none:"Chưa làm",viol:"Có vi phạm"})[k]}</button>`).join("")}</div>
      <div class="table-wrap"><table id="liveTable"><thead><tr><th>Họ tên</th><th>MSSV</th><th>Lượt</th><th>Trạng thái</th><th>Tiến độ</th><th>Bắt đầu</th><th>Còn lại</th><th>Vi phạm</th><th>Điểm /10</th></tr></thead><tbody>${rows.map(r=>liveRow(r,totalQuestions)).join("")||`<tr><td colspan="9" class="empty">Lớp chưa có sinh viên.</td></tr>`}</tbody></table></div>`;
      document.querySelector("#liveExcel").onclick=()=>exportTestExcel(testId);
      const applyLiveFilter=f=>{const w=getWorkspace();if(w?.id===testId)w.liveFilter=f;document.querySelectorAll(".live-filter").forEach(x=>x.className=`${x.dataset.filter===f?"primary":"secondary"} sm live-filter`);document.querySelector("#liveTable tbody").innerHTML=rows.filter(r=>f==="all"||(f==="in_progress"&&r.status==="in_progress")||(f==="done"&&["submitted","auto_submitted"].includes(r.status))||(f==="none"&&!r.attempt_id)||(f==="viol"&&(r.violation_count||0)>0)).map(r=>liveRow(r,totalQuestions)).join("")||`<tr><td colspan="9" class="empty">Không có dữ liệu.</td></tr>`;};
      document.querySelectorAll(".live-filter").forEach(btn=>btn.onclick=()=>applyLiveFilter(btn.dataset.filter));applyLiveFilter(getWorkspace()?.liveFilter||"all");
    };
    await load(); let pending=null; const refresh=()=>{clearTimeout(pending);pending=setTimeout(load,450)};
    clearLiveChannel();
    const channel=sb.channel(`test-live-${testId}`).on("postgres_changes",{event:"*",schema:"public",table:"attempts",filter:`test_id=eq.${testId}`},refresh).on("postgres_changes",{event:"*",schema:"public",table:"answers"},refresh).on("postgres_changes",{event:"*",schema:"public",table:"anti_cheat_events"},refresh).subscribe();
    setLiveChannel(channel);
  }

  function submissionActions(r){
    if(!r.attempt_id) return ""; const viewBtn=r.status==="in_progress"?"":`<a class="btn secondary sm" href="#/result/${r.attempt_id}">Xem</a>`; const delBtn=`<button class="danger sm delete-attempt" data-id="${r.attempt_id}" data-name="${esc(r.full_name)}">Xóa</button>`;
    if(r.status==="reset") return `<div class="row wrap">${viewBtn}<span class="status off">Đã reset</span>${delBtn}</div>`;
    return `<div class="row wrap">${viewBtn}<button class="ghost sm reset-attempt" data-id="${r.attempt_id}" data-name="${esc(r.full_name)}">Reset lượt</button>${delBtn}</div>`;
  }

  async function renderSubmissionsTab(testId){
    const {data,error}=await sb.rpc("staff_get_test_export",{p_test_id:testId}),root=document.querySelector("#submissionsRoot"); if(!root)return;if(error)return root.innerHTML=`<div class="warning-box">${esc(error.message)}</div>`;
    const rows=data.students||[];
    root.innerHTML=`<div class="row between wrap"><div><h2>Bài làm sinh viên</h2><p class="muted">Xem từng lượt, reset để cho làm lại hoặc xóa lượt. Mọi thao tác quản trị đều được ghi log.</p></div><button class="primary" id="subExcel">↓ Tải Excel</button></div>
    <div class="table-wrap"><table><thead><tr><th>Họ tên</th><th>MSSV</th><th>Lần</th><th>Trạng thái</th><th>Bắt đầu</th><th>Nộp</th><th>Đúng</th><th>Điểm /10</th><th>Vi phạm</th><th>Thao tác</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.full_name)}</td><td>${esc(r.student_code||"—")}</td><td>${r.attempt_no||"—"}</td><td>${r.attempt_id?statusBadge(r.status):'<span class="status off">Chưa làm</span>'}</td><td>${fmt(r.started_at)}</td><td>${fmt(r.submitted_at)}</td><td>${r.correct_count??"—"}</td><td>${r.correct_count==null?"—":formatScore10(r.correct_count,(r.answers||[]).length||100)}</td><td>${r.violation_count||0}</td><td>${submissionActions(r)}</td></tr>`).join("")||'<tr><td colspan="10" class="empty">Chưa có lượt làm nào.</td></tr>'}</tbody></table></div>`;
    document.querySelector("#subExcel").onclick=()=>exportTestExcel(testId);document.querySelectorAll(".reset-attempt").forEach(b=>b.onclick=()=>confirmAttemptAction("reset",testId,b.dataset.id,b.dataset.name));document.querySelectorAll(".delete-attempt").forEach(b=>b.onclick=()=>confirmAttemptAction("delete",testId,b.dataset.id,b.dataset.name));
  }

  async function confirmAttemptAction(action,testId,attemptId,name){
    const isDelete=action==="delete",modalRoot=document.querySelector("#modalRoot");modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><h2>${isDelete?"Xóa bài làm":"Reset lượt làm"}?</h2><p><b>${esc(name||"Sinh viên")}</b></p><div class="warning-box">${isDelete?"Bài làm, câu trả lời và sự kiện chống gian lận của lượt này sẽ bị xóa. Sinh viên có thể làm lại nếu còn lượt.":"Lượt cũ vẫn được giữ để đối soát nhưng chuyển trạng thái Reset; sinh viên được phép bắt đầu lượt mới."}</div><div class="row between"><button class="secondary" data-close>Hủy</button><button class="${isDelete?"danger":"primary"}" id="doAttemptAction">${isDelete?"Xóa bài làm":"Reset lượt"}</button></div></div></div>`;
    const close=()=>modalRoot.innerHTML="";modalRoot.querySelector("[data-close]").onclick=close;modalRoot.querySelector("#doAttemptAction").onclick=async()=>{const fn=isDelete?"staff_delete_attempt":"staff_reset_attempt";const {data:result,error}=await sb.rpc(fn,{p_attempt_id:attemptId});if(error)return toast(error.message,6000);close();if(isDelete){toast(result?.content_unlocked?"Đã xóa bài làm · đề đã được mở khóa":"Đã xóa bài làm");await refreshCurrentTest(testId,"submissions");return;}toast("Đã reset lượt làm");const w=getWorkspace();if(w?.id===testId){w.loaded.submissions=false;w.loaded.live=false;}clearLiveChannel();await renderSubmissionsTab(testId);};
  }

  async function exportTestExcel(testId){
    toast("Đang tạo Excel…");
    let XLSX;
    try{ XLSX=await loadXlsx(); }catch(err){ console.error(err); return toast("Không tải được thư viện Excel. Hãy kiểm tra mạng và thử lại.",6000); }
    const {data,error}=await sb.rpc("staff_get_test_export",{p_test_id:testId});if(error)return toast(error.message,6000);const students=data.students||[];
    const summary=students.map((s,i)=>({STT:i+1,"Họ tên":s.full_name,MSSV:s.student_code||"","Lần làm":s.attempt_no||"","Trạng thái":s.status||"Chưa làm","Bắt đầu":s.started_at?new Date(s.started_at).toLocaleString("vi-VN"):"","Nộp bài":s.submitted_at?new Date(s.submitted_at).toLocaleString("vi-VN"):"","Số câu đúng":s.correct_count??"","Điểm /10":s.correct_count==null?"":scoreOutOfTen(s.correct_count,(s.answers||[]).length||100),"Vi phạm":s.violation_count||0,"Lý do nộp":s.submission_reason||""}));
    const detail=[];for(const s of students)for(const a of s.answers||[])detail.push({"Họ tên":s.full_name,MSSV:s.student_code||"","Lần làm":s.attempt_no||"","Câu":a.number,"Đã chọn":a.selected||"","Đáp án":a.correct||"","Đúng/Sai":a.is_correct?"Đúng":"Sai"});
    const violations=[];for(const s of students)for(const v of s.violations||[])violations.push({"Họ tên":s.full_name,MSSV:s.student_code||"","Lần làm":s.attempt_no||"","Sự kiện":v.event_type,"Lần":v.violation_number,"Thời điểm":new Date(v.occurred_at).toLocaleString("vi-VN")});
    const roster=(data.roster||[]).map((r,i)=>({STT:i+1,"Họ tên":r.full_name,MSSV:r.student_code||"",Email:r.email||"","Trạng thái":r.is_active?"Hoạt động":"Khóa"}));const resetHistory=(data.reset_history||[]).map(r=>({"Họ tên":r.full_name,MSSV:r.student_code||"","Lần làm":r.attempt_no||"","Trạng thái":r.status,"Bắt đầu":r.started_at?new Date(r.started_at).toLocaleString("vi-VN"):"","Kết thúc":r.submitted_at?new Date(r.submitted_at).toLocaleString("vi-VN"):"","Lý do":r.submission_reason||""}));
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(summary),"Tong_hop");XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(detail),"Chi_tiet");XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(violations),"Vi_pham");XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(roster),"Danh_sach_lop");if(resetHistory.length)XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(resetHistory),"Lich_su_reset");const safe=(data.test?.title||"ket-qua").replace(/[\\/:*?"<>|]+/g,"-");XLSX.writeFile(wb,`${safe}.xlsx`);toast("Đã tạo file Excel");
  }
  return {renderPracticeTab,renderLiveTab,renderSubmissionsTab,exportTestExcel};
}
