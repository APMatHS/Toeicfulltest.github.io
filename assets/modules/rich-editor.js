import { esc } from "./utils.js?build=20260915-v117";

const ALLOWED=new Set(["P","DIV","BR","STRONG","B","EM","I","U","S","UL","OL","LI","A","TABLE","THEAD","TBODY","TR","TH","TD","IMG"]);
const DROP=new Set(["SCRIPT","STYLE","IFRAME","OBJECT","EMBED","FORM","INPUT","BUTTON","SVG","MATH"]);

function safeHref(value=""){
  const v=String(value).trim();
  return /^(https?:|mailto:)/i.test(v) ? v : "";
}

export function sanitizeRichHtml(html="",{storage=false}={}){
  const doc=new DOMParser().parseFromString(`<div>${String(html)}</div>`,"text/html");
  const root=doc.body.firstElementChild;
  const clean=node=>{
    for(const child of [...node.childNodes]){
      if(child.nodeType===Node.TEXT_NODE) continue;
      if(child.nodeType!==Node.ELEMENT_NODE){ child.remove(); continue; }
      const tag=child.tagName;
      if(DROP.has(tag)){ child.remove(); continue; }
      if(!ALLOWED.has(tag)){
        clean(child);
        child.replaceWith(...child.childNodes);
        continue;
      }
      const keep={};
      if(tag==="A"){
        const href=safeHref(child.getAttribute("href"));
        if(href) Object.assign(keep,{href,target:"_blank",rel:"noopener noreferrer"});
      }
      if(["TD","TH"].includes(tag)){
        const colspan=Number(child.getAttribute("colspan"));
        const rowspan=Number(child.getAttribute("rowspan"));
        if(colspan>1&&colspan<=10) keep.colspan=String(colspan);
        if(rowspan>1&&rowspan<=50) keep.rowspan=String(rowspan);
      }
      if(tag==="IMG"){
        const path=child.getAttribute("data-storage-path")||"";
        const src=child.getAttribute("src")||"";
        if(!path){ child.remove(); continue; }
        keep["data-storage-path"]=path;
        keep.alt=child.getAttribute("alt")||"Ảnh trong nội dung";
        // V1.17: giảm decode ảnh đồng loạt trên điện thoại yếu.
        keep.loading="lazy";
        keep.decoding="async";
        if(!storage && /^(https:|blob:)/i.test(src)) keep.src=src;
      }
      for(const a of [...child.attributes]) child.removeAttribute(a.name);
      for(const [k,v] of Object.entries(keep)) child.setAttribute(k,v);
      clean(child);
    }
  };
  clean(root);
  return root.innerHTML.trim();
}

export function isRichHtml(value=""){
  return /<(p|div|br|strong|b|em|i|u|s|ul|ol|li|a|table|thead|tbody|tr|th|td|img)\b/i.test(String(value));
}

export function plainText(value=""){
  if(!isRichHtml(value)) return String(value);
  const doc=new DOMParser().parseFromString(sanitizeRichHtml(value),"text/html");
  return (doc.body.textContent||"").replace(/\s+/g," ").trim();
}

export function renderRichText(value=""){
  if(!value) return "";
  return isRichHtml(value) ? sanitizeRichHtml(value) : esc(value).replace(/\n/g,"<br>");
}

export function embeddedImagePaths(value=""){
  if(!isRichHtml(value)) return [];
  const doc=new DOMParser().parseFromString(String(value),"text/html");
  return [...doc.querySelectorAll("img[data-storage-path]")].map(x=>x.dataset.storagePath).filter(Boolean);
}

export function hydrateEmbeddedImages(value="",urlMap={}){
  if(!isRichHtml(value)) return value;
  const doc=new DOMParser().parseFromString(sanitizeRichHtml(value),"text/html");
  doc.body.querySelectorAll("img[data-storage-path]").forEach(img=>{
    const url=urlMap[img.dataset.storagePath];
    if(url) img.src=url;
  });
  return doc.body.innerHTML;
}

export function richEditorField(name,label,value="",{compact=false}={}){
  const html=isRichHtml(value)?value:esc(value).replace(/\n/g,"<br>");
  const safe=sanitizeRichHtml(html);
  return `<div class="rich-field ${compact?"compact":""}" data-rich-field>
    <label>${esc(label)}</label>
    <div class="rich-toolbar" role="toolbar" aria-label="Định dạng nội dung">
      <button type="button" data-command="bold" title="In đậm"><b>B</b></button>
      <button type="button" data-command="italic" title="In nghiêng"><i>I</i></button>
      <button type="button" data-command="underline" title="Gạch chân"><u>U</u></button>
      <button type="button" data-command="insertUnorderedList" title="Danh sách">• DS</button>
      <button type="button" data-command="insertOrderedList" title="Danh sách số">1. DS</button>
      <button type="button" data-action="link">Liên kết</button>
      <button type="button" data-action="table">Bảng</button>
      <button type="button" data-action="image">Ảnh</button>
      <button type="button" data-command="removeFormat">Xóa định dạng</button>
    </div>
    <div class="rich-editor" contenteditable="true" role="textbox" aria-multiline="true" spellcheck="true" lang="en">${safe}</div>
    <input type="file" class="rich-image-input" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
    <textarea name="${esc(name)}" hidden>${esc(sanitizeRichHtml(safe,{storage:true}))}</textarea>
  </div>`;
}

function insertHtml(html){ document.execCommand("insertHTML",false,html); }

export function bindRichEditors(form,{uploadImage,onChange,onError}={}){
  const fields=[...form.querySelectorAll("[data-rich-field]")];
  for(const field of fields){
    const editor=field.querySelector(".rich-editor");
    const value=field.querySelector("textarea");
    const fileInput=field.querySelector(".rich-image-input");
    const sync=()=>{
      const clean=sanitizeRichHtml(editor.innerHTML,{storage:true});
      value.value=clean==="<br>"?"":clean;
      onChange?.();
    };
    const uploadAtCursor=async file=>{
      if(!uploadImage||!file) return;
      const selection=getSelection();
      const savedRange=selection?.rangeCount&&editor.contains(selection.anchorNode) ? selection.getRangeAt(0).cloneRange() : null;
      try{
        field.classList.add("busy");
        const up=await uploadImage(file);
        editor.focus();
        if(savedRange){
          const current=getSelection();
          current.removeAllRanges();
          current.addRange(savedRange);
        }
        insertHtml(`<img data-storage-path="${esc(up.storage_path)}" src="${esc(up.url||"")}" alt="Ảnh trong nội dung" loading="lazy" decoding="async"><br>`);
        sync();
      }catch(err){ onError?.(err); }
      finally{field.classList.remove("busy");}
    };
    field.querySelector(".rich-toolbar").addEventListener("mousedown",e=>e.preventDefault());
    field.querySelector(".rich-toolbar").addEventListener("click",e=>{
      const btn=e.target.closest("button"); if(!btn) return;
      editor.focus();
      if(btn.dataset.command) document.execCommand(btn.dataset.command,false,null);
      if(btn.dataset.action==="link"){
        const href=prompt("Địa chỉ liên kết (https://…)");
        if(href&&safeHref(href)) document.execCommand("createLink",false,href);
      }
      if(btn.dataset.action==="table") insertHtml("<table><tbody><tr><td>Ô 1</td><td>Ô 2</td></tr><tr><td>Ô 3</td><td>Ô 4</td></tr></tbody></table><p><br></p>");
      if(btn.dataset.action==="image") fileInput.click();
      sync();
    });
    fileInput.addEventListener("change",()=>uploadAtCursor(fileInput.files?.[0]));
    editor.addEventListener("input",sync);
    editor.addEventListener("blur",()=>{ editor.innerHTML=sanitizeRichHtml(editor.innerHTML); sync(); });
    editor.addEventListener("paste",e=>{
      const image=[...(e.clipboardData?.files||[])].find(f=>f.type.startsWith("image/"));
      if(image){ e.preventDefault(); uploadAtCursor(image); return; }
      setTimeout(()=>{editor.innerHTML=sanitizeRichHtml(editor.innerHTML);sync();},0);
    });
    sync();
  }
  return fields;
}
