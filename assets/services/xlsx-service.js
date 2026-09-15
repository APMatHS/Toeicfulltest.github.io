let xlsxPromise=null;

export function loadXlsx(){
  xlsxPromise ||= import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
  return xlsxPromise;
}

export async function readWorkbook(file){
  const XLSX=await loadXlsx();
  const buf=await file.arrayBuffer();
  return {XLSX,workbook:XLSX.read(buf)};
}
