export function scoreOutOfTen(correct,total){
  const c=Number(correct); const t=Number(total);
  if(!Number.isFinite(c)||!Number.isFinite(t)||t<=0) return null;
  return Math.round((c*10/t)*100)/100;
}
export function formatScore10(correct,total){
  const s=scoreOutOfTen(correct,total);
  return s==null?"—":`${s.toFixed(2)}/10`;
}
