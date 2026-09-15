export function buildPracticeQuestions(authoring,answers=[],parts=null){
  const groupMap=new Map((authoring?.stimulus_groups||[]).map(g=>[g.id,g]));
  const partMap=new Map((authoring?.parts||[]).map(p=>[Number(p.part_no),p]));
  const saved=new Map(answers.map(a=>[a.question_id,a]));
  const allowed=Array.isArray(parts)&&parts.length?new Set(parts.map(Number)):null;
  return (authoring?.questions||[]).filter(q=>!allowed||allowed.has(Number(q.part_no))).slice().sort((a,b)=>(a.part_no-b.part_no)||(a.source_order-b.source_order)||(a.source_number-b.source_number)).map(q=>{
    const answer=saved.get(q.id),part=partMap.get(Number(q.part_no));
    return {...q,part:q.part_no,number:q.source_number,shuffle_choices:!!part?.shuffle_choices,selected:answer?.selected,marked:!!answer?.marked,
      choices:(q.choices||[]).map(c=>({...c,key:c.key||c.choice_key})),
      stimuli:(groupMap.get(q.stimulus_group_id)?.stimuli||[]).map(s=>({...s,type:s.media_type}))};
  });
}
