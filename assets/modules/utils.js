export const esc = (s="") => String(s).replace(/[&<>"']/g, m => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[m]));

export const fmt = dt => dt ? new Date(dt).toLocaleString("vi-VN") : "—";
export const route = () => location.hash.slice(1) || "/";
export const go = p => { location.hash = p; };
export const roleLabel = r => ({system_admin:"System Admin",teacher:"Giáo viên",student:"Sinh viên"})[r] || r;

// localStorage có thể ném QuotaExceededError/SecurityError trên một số
// trình duyệt/WebView. Không để lỗi storage làm dừng render hoặc luồng nộp bài.
const memoryStorage = new Map();

export const readJSON = (key,fallback=null) => {
  // Ưu tiên bản in-memory nếu phiên hiện tại đã ghi dữ liệu; điều này tránh
  // đọc lại bản localStorage cũ khi setItem vừa thất bại vì quota/security.
  if(memoryStorage.has(key)){
    try{return JSON.parse(memoryStorage.get(key)) ?? fallback;}catch{}
  }
  try{
    const raw=localStorage.getItem(key);
    return raw==null ? fallback : (JSON.parse(raw) ?? fallback);
  }catch{return fallback;}
};

export const writeJSON = (key,val) => {
  let raw;
  try{ raw=JSON.stringify(val); }
  catch{ return false; }
  memoryStorage.set(key,raw);
  try{ localStorage.setItem(key,raw); return true; }
  catch{ return false; }
};

export const removeStorage = key => {
  memoryStorage.delete(key);
  try{ localStorage.removeItem(key); return true; }
  catch{ return false; }
};

export const debounce = (fn,ms=350) => { let t; return (...args)=>{clearTimeout(t);t=setTimeout(()=>fn(...args),ms)}; };

export function statusBadge(status){
  const cls=["published","submitted"].includes(status)?"ok":status==="in_progress"?"warn":"off";
  return `<span class="status ${cls}">${esc(status)}</span>`;
}
