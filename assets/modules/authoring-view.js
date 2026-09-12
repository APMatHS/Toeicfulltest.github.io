import { esc } from "./utils.js";
import { plainText,renderRichText } from "./rich-editor.js";

function questionRow(q,locked=false){
  const media=q.storage_path?(q.media_type==="audio"?" 🔊":" 🖼"):"";
  const search=esc(`${q.source_number} ${plainText(q.content||"")} ${(q.choices||[]).map(c=>plainText(c.content||"")).join(" ")}`.toLowerCase());
  return `<div class="question-author-row author-question" data-search="${search}">
    <div class="author-question-content"><b>Câu ${q.source_number}</b>${media}<div class="rich-content compact">${q.content?renderRichText(q.content):"(không có chữ)"}</div><div class="muted small">Đáp án đúng: ${esc(q.correct_choice_key||"—")}</div></div>
    ${locked?"":`<div class="row wrap question-actions"><button class="secondary sm edit-question" data-id="${q.id}">Sửa</button><button class="ghost sm duplicate-question" data-id="${q.id}">Nhân bản</button><button class="danger sm delete-question" data-id="${q.id}" data-number="${q.source_number}">Xóa</button></div>`}
  </div>`;
}

export function renderAuthoringMarkup(id,parts,questions,groups,draft,locked=false){
  return `<section class="card authoring">
    <div class="row between wrap">
      <div><h2>Soạn đề</h2><p class="muted">Nháp tự lưu. Có thể định dạng chữ, chèn bảng và dán ảnh trực tiếp vào nội dung.</p></div>
      <div class="row wrap"><span id="draftStatus" class="muted">${locked?"Đề đã khóa":draft?"Có bản nháp":"Đã đồng bộ"}</span>${(!locked&&draft)?'<button class="secondary sm" id="restoreDraft">Khôi phục nháp</button><button class="ghost sm" id="discardDraft">Bỏ nháp</button>':""}</div>
    </div>
    ${locked?'<div class="lock-banner"><b>🔒 Không thể sửa nội dung</b><span>Đề đã khóa từ khi sinh viên đầu tiên bắt đầu. Hãy dùng “Tạo từ bài kiểm tra cũ” để tạo phiên bản mới.</span></div>':""}
    <div class="authoring-tools">
      <label class="author-search">Tìm trong đề<input id="authorSearch" type="search" placeholder="Số câu, nội dung, tên nhóm…"></label>
      <div class="row wrap"><button type="button" class="secondary sm" id="expandAuthoring">Mở tất cả</button><button type="button" class="ghost sm" id="collapseAuthoring">Thu gọn tất cả</button></div>
    </div>
    <div id="authorNoResults" class="empty" hidden>Không tìm thấy nội dung phù hợp.</div>
    ${parts.map(p=>{
      const pGroups=groups.filter(g=>g.part_no===p.part_no);
      const pQs=questions.filter(q=>q.part_no===p.part_no);
      return `<details class="part-editor author-part" data-search="part ${p.part_no} ${esc(p.title||"").toLowerCase()}" open>
        <summary><div class="row between wrap"><div><h3>${esc(p.title)}</h3><span class="muted">${pQs.length} câu · ${pGroups.length} nhóm nội dung</span></div>
          <div class="row wrap">${locked?"":`<button class="secondary sm add-group" data-part="${p.id}" data-partno="${p.part_no}">+ Nhóm nội dung</button><button class="primary sm add-question" data-part="${p.id}" data-partno="${p.part_no}">+ Câu hỏi</button>`}</div>
        </div></summary>
        <div class="part-editor-body">
        ${pGroups.map(g=>`<details class="group-box author-group" data-id="${g.id}" data-search="${esc(`${g.title||""} ${g.source_order} ${(g.stimuli||[]).map(s=>plainText(s.content||"")).join(" ")}`.toLowerCase())}" open>
          <summary><div class="row between wrap"><div><b>${esc(g.title||`Nhóm ${g.source_order}`)}</b><div class="muted">Thứ tự ${g.source_order} · ${esc(g.play_mode||"normal")}</div></div>
          ${locked?"":`<div class="row wrap"><button class="ghost sm add-stimulus" data-group="${g.id}">+ Nội dung chung</button><button class="ghost sm edit-group" data-id="${g.id}">Sửa nhóm</button><button class="danger sm delete-group" data-id="${g.id}">Xóa nhóm</button></div>`}</div></summary>
          <div class="group-body"><div class="media-list">${(g.stimuli||[]).map(s=>`<span class="stimulus-chip"><span class="badge">${s.media_type==="image"?"🖼 Ảnh":s.media_type==="audio"?"🔊 Audio":"📝 Text"}</span>${locked?"":`<button class="ghost xs edit-stimulus" data-group="${g.id}" data-id="${s.id}">Sửa</button><button class="danger xs delete-stimulus" data-id="${s.id}">Xóa</button>`}</span>`).join("")||'<span class="muted">Chưa có nội dung chung</span>'}</div>
          ${pQs.filter(q=>q.stimulus_group_id===g.id).map(q=>questionRow(q,locked)).join("")||'<div class="muted mini-empty">Chưa có câu trong nhóm</div>'}
          </div></details>`).join("")}
        <div class="ungrouped">${pQs.filter(q=>!q.stimulus_group_id).map(q=>questionRow(q,locked)).join("")}</div>
        </div></details>`;
    }).join("")}
  </section>`;
}

export function bindAuthoringFilter(root=document){
  const input=root.querySelector("#authorSearch"),parts=[...root.querySelectorAll(".author-part")];
  if(!input) return;
  const apply=()=>{
    const q=input.value.trim().toLowerCase();
    parts.forEach(part=>{
      let partHits=0;
      part.querySelectorAll(".author-question").forEach(row=>{const ok=!q||row.dataset.search.includes(q);row.hidden=!ok;if(ok)partHits++;});
      part.querySelectorAll(".author-group").forEach(group=>{
        const rows=[...group.querySelectorAll(".author-question")],own=group.dataset.search.includes(q),ok=!q||own||rows.some(x=>!x.hidden);
        group.hidden=!ok;if(q&&ok)group.open=true;
      });
      const ok=!q||partHits>0||part.dataset.search.includes(q)||[...part.querySelectorAll(".author-group")].some(x=>!x.hidden);
      part.hidden=!ok;if(q&&ok)part.open=true;
    });
    root.querySelector("#authorNoResults").hidden=!q||parts.some(x=>!x.hidden);
  };
  input.addEventListener("input",apply);
  root.querySelector("#expandAuthoring").onclick=()=>root.querySelectorAll(".author-part,.author-group").forEach(x=>x.open=true);
  root.querySelector("#collapseAuthoring").onclick=()=>root.querySelectorAll(".author-part,.author-group").forEach(x=>x.open=false);
}
