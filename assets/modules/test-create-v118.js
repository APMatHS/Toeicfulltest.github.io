const BUILD_KIND={
  listening:{label:"Listening · Part 1–4",duration:20,parts:[
    {part_no:1,title:"Part 1",shuffle_mode:"fixed",shuffle_choices:false,sort_order:1},
    {part_no:2,title:"Part 2",shuffle_mode:"fixed",shuffle_choices:false,sort_order:2},
    {part_no:3,title:"Part 3",shuffle_mode:"fixed",shuffle_choices:true,sort_order:3},
    {part_no:4,title:"Part 4",shuffle_mode:"fixed",shuffle_choices:true,sort_order:4}
  ]},
  reading:{label:"Reading · Part 5–7",duration:75,parts:[
    {part_no:5,title:"Part 5",shuffle_mode:"shuffle_questions",shuffle_choices:false,sort_order:5},
    {part_no:6,title:"Part 6",shuffle_mode:"shuffle_stimulus_groups",shuffle_choices:false,sort_order:6},
    {part_no:7,title:"Part 7",shuffle_mode:"fixed",shuffle_choices:false,sort_order:7}
  ]},
  full:{label:"Full Test · Part 1–7",duration:85,parts:[
    {part_no:1,title:"Part 1",shuffle_mode:"fixed",shuffle_choices:false,sort_order:1},
    {part_no:2,title:"Part 2",shuffle_mode:"fixed",shuffle_choices:false,sort_order:2},
    {part_no:3,title:"Part 3",shuffle_mode:"fixed",shuffle_choices:true,sort_order:3},
    {part_no:4,title:"Part 4",shuffle_mode:"fixed",shuffle_choices:true,sort_order:4},
    {part_no:5,title:"Part 5",shuffle_mode:"shuffle_questions",shuffle_choices:false,sort_order:5},
    {part_no:6,title:"Part 6",shuffle_mode:"shuffle_stimulus_groups",shuffle_choices:false,sort_order:6},
    {part_no:7,title:"Part 7",shuffle_mode:"fixed",shuffle_choices:false,sort_order:7}
  ]}
};

export function testKindLabel(kind){ return BUILD_KIND[kind]?.label||"Reading · Part 5–7"; }

export function openNewTestV118(ctx){
  const {sb,modalRoot,esc,closeModal,toast,go,onCreated}=ctx;
  return Promise.all([
    sb.from("classes").select("id,name").order("name")
  ]).then(([classesRes])=>{
    const classes=classesRes.data||[];
    const classOptions=`<option value="">Chưa gán lớp</option>${classes.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")}`;
    modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal wide create-test-modal v118-create-test">
      <div class="row between wrap"><div><h2>Tạo bài kiểm tra</h2><p class="muted">Chọn đúng phạm vi đề. V1.18 bỏ luồng tải/nhập file khi tạo bài.</p></div><button type="button" class="ghost sm" data-close>Đóng</button></div>
      <div class="v118-test-kind-grid" role="radiogroup" aria-label="Loại bài kiểm tra">
        ${Object.entries(BUILD_KIND).map(([key,cfg],i)=>`<button type="button" class="card v118-test-kind ${i===1?"active":""}" data-kind="${key}" role="radio" aria-checked="${i===1?"true":"false"}">
          <b>${cfg.label}</b><span class="muted">Mặc định ${cfg.duration} phút</span>
        </button>`).join("")}
      </div>
      <form id="v118TestForm" class="form-grid">
        <input type="hidden" name="test_kind" value="reading">
        <label class="span-2">Tên bài<input name="title" required></label>
        <label>Lớp<select name="class_id">${classOptions}</select></label>
        <label>Thời lượng (phút)<input type="number" name="duration_minutes" value="75" min="1" required></label>
        <label>Số lần làm<input type="number" name="max_attempts" value="1" min="1" required></label>
        <label>Chống gian lận<select name="anti_cheat_mode"><option value="warn_then_submit">Cảnh báo rồi tự nộp</option><option value="strict">Nghiêm ngặt</option><option value="off">Tắt</option></select></label>
        <label>Mở lúc <span class="hint">24 giờ</span><input type="datetime-local" name="opens_at"></label>
        <label>Đóng lúc <span class="hint">24 giờ</span><input type="datetime-local" name="closes_at"></label>
        <label class="span-2">Mô tả<textarea name="description" rows="3"></textarea></label>
        <label class="check-row span-2"><input type="checkbox" name="show_answers_after_submit"> Cho xem đáp án đúng sau khi nộp</label>
        <div class="span-2 info-box v118-kind-note"></div>
        <button type="submit" class="primary span-2">Tạo bài nháp</button>
      </form>
    </div></div>`;

    modalRoot.querySelector("[data-close]").onclick=closeModal;
    const form=modalRoot.querySelector("#v118TestForm");
    const kindInput=form.elements.namedItem("test_kind");
    const duration=form.elements.namedItem("duration_minutes");
    const note=modalRoot.querySelector(".v118-kind-note");
    const syncKind=kind=>{
      const cfg=BUILD_KIND[kind]||BUILD_KIND.reading;
      kindInput.value=kind;
      duration.value=String(cfg.duration);
      modalRoot.querySelectorAll(".v118-test-kind").forEach(btn=>{
        const active=btn.dataset.kind===kind;
        btn.classList.toggle("active",active);
        btn.setAttribute("aria-checked",active?"true":"false");
      });
      note.innerHTML=kind==="listening"
        ? "<b>Listening:</b> Part 1–2 giữ nguyên thứ tự câu/đáp án; Part 3–4 giữ nguyên câu/nhóm nhưng có thể trộn nội dung đáp án theo từng lượt. Audio dùng cơ chế một lần ở module Listening riêng."
        : kind==="full"
          ? "<b>Full Test:</b> Listening Part 1–4 chạy trước, sau đó điều phối sang nguyên logic Reading Part 5–7. Tổng thời lượng mặc định 85 phút và vẫn chỉnh được."
          : "<b>Reading:</b> giữ nguyên logic V1.17: Part 5 trộn câu, Part 6 trộn nhóm, Part 7 cố định.";
    };
    modalRoot.querySelectorAll(".v118-test-kind").forEach(btn=>btn.onclick=()=>syncKind(btn.dataset.kind));
    syncKind("reading");

    form.onsubmit=async e=>{
      e.preventDefault();
      const fd=new FormData(form),f=Object.fromEntries(fd);
      const cfg=BUILD_KIND[f.test_kind]||BUILD_KIND.reading;
      f.class_id=f.class_id||null;
      f.duration_minutes=Number(f.duration_minutes);
      f.max_attempts=Number(f.max_attempts);
      ["opens_at","closes_at"].forEach(k=>f[k]=f[k]?new Date(f[k]).toISOString():null);
      Object.assign(f,{status:"draft",show_answers_after_submit:fd.has("show_answers_after_submit"),allowed_violations:2});
      const btn=e.submitter||form.querySelector('button[type="submit"]');
      btn.disabled=true;btn.textContent="Đang tạo…";
      try{
        const {data,error}=await sb.rpc("staff_upsert_test",{p_data:f});
        if(error) throw error;
        const testId=typeof data==="string"?data:(data?.id||data?.test_id);
        if(!testId) throw new Error("Backend không trả về mã bài kiểm tra.");
        for(const part of cfg.parts){
          const r=await sb.rpc("staff_upsert_part",{p_data:{...part,test_id:testId}});
          if(r.error) throw r.error;
        }
        closeModal();
        toast(`Đã tạo ${cfg.label}`);
        await onCreated?.(testId);
        go(`/test/${testId}/authoring`);
      }catch(err){
        console.error(err);
        toast(`Không tạo được bài: ${err.message||err}`,7000);
      }finally{
        btn.disabled=false;btn.textContent="Tạo bài nháp";
      }
    };
  });
}
