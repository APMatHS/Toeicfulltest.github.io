import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const assets=path.join(root,'assets');
const files=[];
const graph=new Map();
function walk(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,ent.name);if(ent.isDirectory())walk(p);else if(ent.isFile()&&p.endsWith('.js'))files.push(p);}}
walk(assets);
let failed=false;
const problems=[];
for(const file of files){
  const rel=path.relative(root,file).replaceAll('\\','/');
  const text=fs.readFileSync(file,'utf8');
  const lines=text.split(/\r?\n/).length;
  if(lines>320) problems.push(`${rel}: ${lines} lines (>320)`);
  if(Buffer.byteLength(text,'utf8')>24*1024) problems.push(`${rel}: file larger than 24 KiB`);
  if(/(?:^|\/)v\d+(?:\.\d+)*[^/]*\.js$/i.test(rel)) problems.push(`${rel}: versioned JS filename is not allowed`);
  if(rel!=='assets/modules/utils.js' && /\blocalStorage\b/.test(text)) problems.push(`${rel}: direct localStorage access is not allowed; use storage helpers`);
  graph.set(file,[]);
  for(const m of text.matchAll(/(?:import|export)\s+(?:[^'";]+?\s+from\s+)?["']([^"']+)["']/g)){
    const spec=m[1].split('?')[0];
    if(!spec.startsWith('.')) continue;
    let target=path.resolve(path.dirname(file),spec);
    if(!path.extname(target)) target+='.js';
    if(!fs.existsSync(target)) problems.push(`${rel}: missing import ${m[1]}`);
    else if(target.startsWith(assets)) graph.get(file).push(target);
  }
}

const visiting=new Set(),visited=new Set(),stack=[];
function visit(node){
  if(visited.has(node)) return;
  if(visiting.has(node)){
    const i=stack.indexOf(node);
    const cycle=[...stack.slice(i),node].map(x=>path.relative(root,x).replaceAll('\\','/')).join(' -> ');
    problems.push(`import cycle: ${cycle}`);
    return;
  }
  visiting.add(node);stack.push(node);
  for(const dep of graph.get(node)||[]) visit(dep);
  stack.pop();visiting.delete(node);visited.add(node);
}
for(const file of files) visit(file);

const indexHtml=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const m of indexHtml.matchAll(/(?:src|href)=["']([^"'#?]+)(?:\?[^"']*)?["']/g)){
  const ref=m[1];
  if(!ref.startsWith('assets/')) continue;
  if(!fs.existsSync(path.join(root,ref))) problems.push(`index.html: missing asset ${ref}`);
}
const combined=files.map(f=>fs.readFileSync(f,'utf8')).join('\n');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'tools','feature-contracts.json'),'utf8'));
for(const [group,items] of Object.entries(manifest)){
  if(!Array.isArray(items)) continue;
  for(const needle of items){
    if(!combined.includes(needle)) problems.push(`baseline contract missing: ${group} (${needle})`);
  }
}
if(problems.length){failed=true;console.error(problems.join('\n'));}
else console.log(`Source check OK: ${files.length} JS files, max 320 lines, imports and feature contracts present.`);
process.exit(failed?1:0);
