export async function loadAttemptCounts(sb,tests=[]){
  const pairs=await Promise.all(tests.map(async t=>{
    const {data,error}=await sb.rpc("staff_get_test_live",{p_test_id:t.id});
    return [t.id,error?null:Number(data?.attempt_count||0)];
  }));
  return Object.fromEntries(pairs);
}

export function renderStaffTestsTable({tests=[],counts={},esc,statusBadge}){
  return `<div class="table-wrap"><table><thead><tr><th>Tên bài</th><th>Lớp</th><th>Thời gian</th><th>Lượt đã làm</th><th>Giới hạn/SV</th><th>Trạng thái</th><th></th></tr></thead>
  <tbody>${tests.map(x=>`<tr><td>${esc(x.title)}</td><td>${esc(x.classes?.name||"—")}</td><td>${x.duration_minutes} phút</td><td><b>${counts[x.id]??"—"}</b></td><td>${x.max_attempts??1}</td><td>${statusBadge(x.status)}</td><td><a class="btn secondary sm" href="#/test/${x.id}">Chi tiết</a></td></tr>`).join("")||`<tr><td colspan="7" class="empty">Chưa có bài kiểm tra</td></tr>`}</tbody></table></div>`;
}
