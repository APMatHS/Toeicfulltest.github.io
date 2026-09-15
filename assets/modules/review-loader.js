let loading=null;
function maybeLoadReview(){
  if(!location.hash.startsWith("#/result/")) return;
  loading ||= import("./review-ui.js").catch(err=>{
    console.error("Review UI load failed:",err);
    loading=null;
  });
}
window.addEventListener("hashchange",maybeLoadReview);
addEventListener("DOMContentLoaded",maybeLoadReview,{once:true});
maybeLoadReview();
