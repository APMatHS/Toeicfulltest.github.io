const guardedSelectors=[".exam-layout",".listening-shell"];

function applyTranslateGuard(root=document){
  for(const selector of guardedSelectors){
    root.querySelectorAll?.(selector).forEach(el=>{
      el.setAttribute("translate","no");
      el.classList.add("notranslate");
    });
  }
}

const view=document.querySelector("#view");
if(view){
  applyTranslateGuard(view);
  new MutationObserver(()=>applyTranslateGuard(view)).observe(view,{childList:true,subtree:true});
}
