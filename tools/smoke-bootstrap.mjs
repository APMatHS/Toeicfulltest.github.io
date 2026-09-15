import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const assets=path.join(root,'assets');
const appPath=path.join(assets,'app.js');
const smokeApp=path.join(assets,'__smoke-app.mjs');
const smokeSupabase=path.join(assets,'__smoke-supabase.mjs');

const element=()=>({
  innerHTML:'',textContent:'',hidden:false,children:[],dataset:{},className:'',
  addEventListener(){},remove(){},querySelector(){return null;},querySelectorAll(){return [];}
});
const nodes=new Map(['#view','#sessionActions','#staffHeaderNav','#toast','#modalRoot'].map(k=>[k,element()]));

globalThis.location={hash:'#/',pathname:'/index.html',search:'',origin:'http://localhost'};
globalThis.history={state:null,replaceState(){},pushState(){},back(){}};
Object.defineProperty(globalThis,'navigator',{value:{userAgent:'Node smoke',platform:'Linux',maxTouchPoints:0,onLine:true},configurable:true});
globalThis.document={
  visibilityState:'visible',fullscreenElement:null,documentElement:{requestFullscreen:async()=>{}},
  querySelector(sel){return nodes.get(sel)||null;},querySelectorAll(){return [];},
  addEventListener(){},createElement(){return element();},exitFullscreen:async()=>{}
};
globalThis.window=globalThis;
globalThis.addEventListener=()=>{};
globalThis.requestAnimationFrame=fn=>{fn();return 1;};
globalThis.localStorage={getItem(){return null;},setItem(){},removeItem(){}};
globalThis.alert=()=>{};

const source=fs.readFileSync(appPath,'utf8').replace(
  'import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";',
  'import { createClient } from "./__smoke-supabase.mjs";'
);
fs.writeFileSync(smokeSupabase,`export function createClient(){return {auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){},signOut:async()=>{}},removeChannel(){}}}`);
fs.writeFileSync(smokeApp,source);
try{
  await import(pathToFileURL(smokeApp).href+`?t=${Date.now()}`);
  await new Promise(r=>setTimeout(r,0));
  console.log('Bootstrap smoke OK');
}finally{
  for(const p of [smokeApp,smokeSupabase]){try{fs.unlinkSync(p);}catch{}}
}
