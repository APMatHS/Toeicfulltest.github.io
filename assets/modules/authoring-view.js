function plainText(x){return x}
function questionHasIssue(q){
  const choices=q.choices||[];
  const partNo=Number(q.part_no);
  const expectedChoices=partNo===2?3:4;
  const choiceContentMissing=partNo>=3 && choices.some(c=>!plainText(c.content||"")&&!c.storage_path);
  return !q.correct_choice_key || choices.length!==expectedChoices || choiceContentMissing || (!plainText(q.content||"")&&!q.storage_path&&partNo===5);
}
