import { embeddedImagePaths,hydrateEmbeddedImages,renderRichText } from "../modules/rich-editor.js";

export function createExamMedia({signedUrlMap,getExamState}){
  const cache=new Map();
  const staticUrl=p=>p?.startsWith("static:")?p.slice(7):null;

  function collectMediaPaths(q){
    const paths=new Set();if(!q)return paths;
    if(q.storage_path&&!staticUrl(q.storage_path))paths.add(q.storage_path);embeddedImagePaths(q.content).forEach(p=>paths.add(p));
    for(const s of q.stimuli||[]){if(s.storage_path&&!staticUrl(s.storage_path))paths.add(s.storage_path);embeddedImagePaths(s.content).forEach(p=>paths.add(p));}
    for(const c of q.choices||[]){if(c.storage_path&&!staticUrl(c.storage_path))paths.add(c.storage_path);embeddedImagePaths(c.content).forEach(p=>paths.add(p));}
    return paths;
  }
  async function ensureQuestionMedia(q){
    if(!q||q._mediaHydrated)return;if(q._mediaPromise)return q._mediaPromise;
    q._mediaPromise=(async()=>{const paths=[...collectMediaPaths(q)],missing=paths.filter(p=>!cache.has(p));if(missing.length){const m=await signedUrlMap(missing);for(const [p,url] of Object.entries(m||{}))if(url)cache.set(p,url);}const map=Object.fromEntries(paths.map(p=>[p,cache.get(p)]).filter(([,u])=>u)),resolve=p=>staticUrl(p)||cache.get(p)||null;if(q.storage_path)q.url=resolve(q.storage_path);q.content=hydrateEmbeddedImages(q.content,map);for(const s of q.stimuli||[]){if(s.storage_path)s.url=resolve(s.storage_path);s.content=hydrateEmbeddedImages(s.content,map);}for(const c of q.choices||[]){if(c.storage_path)c.url=resolve(c.storage_path);c.content=hydrateEmbeddedImages(c.content,map);}q._mediaHydrated=true;})().finally(()=>{q._mediaPromise=null;});
    return q._mediaPromise;
  }
  async function hydrateMedia(questions,{batchSize=10}={}){for(let i=0;i<questions.length;i+=batchSize){await Promise.all(questions.slice(i,i+batchSize).map(ensureQuestionMedia));if(i+batchSize<questions.length)await new Promise(r=>setTimeout(r,0));}}
  function prefetchQuestion(index){const state=getExamState();if(!state||index<0||index>=state.payload.questions.length)return;const run=()=>ensureQuestionMedia(getExamState()?.payload?.questions?.[index]).catch(()=>{});if("requestIdleCallback" in window)requestIdleCallback(run,{timeout:1500});else setTimeout(run,120);}
  function renderMedia(type,url,content,cls=""){if(type==="image"&&url)return `<img class="question-media ${cls}" src="${url}" alt="Nội dung câu hỏi" loading="lazy" decoding="async">`;if(type==="audio"&&url)return `<audio class="${cls}" controls preload="metadata" src="${url}"></audio>`;if(type==="text"||content)return content?`<div class="rich-content ${cls}">${renderRichText(content)}</div>`:"";return "";}
  return {clear:()=>cache.clear(),ensureQuestionMedia,hydrateMedia,prefetchQuestion,renderMedia,renderRichText};
}
