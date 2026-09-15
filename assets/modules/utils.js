export const esc = (s="") => String(s).replace(/[&<>"']/g, m => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[m]));

export const fmt = dt => dt ? new Date(dt).toLocaleString("vi-VN") : "—";
export const route = () => location.hash.slice(1) || "/";
export const go = p => { location.hash = p; };
export const roleLabel = r => ({system_admin:"System Admin",teacher:"Giáo viên",student:"Sinh viên"})[r] || r;
export const readJSON = (key,fallback=null) => { try{return JSON.parse(localStorage.getItem(key)) ?? fallback}catch{return fallback} };
export const writeJSON = (key,val) => localStorage.setItem(key,JSON.stringify(val));
export const debounce = (fn,ms=350) => { let t; return (...args)=>{clearTimeout(t);t=setTimeout(()=>fn(...args),ms)}; };

export function statusBadge(status){
  const cls=["published","submitted"].includes(status)?"ok":status==="in_progress"?"warn":"off";
  return `<span class="status ${cls}">${esc(status)}</span>`;
}
