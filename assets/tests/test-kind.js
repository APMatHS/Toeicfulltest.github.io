export const TEST_KINDS={
  listening:{
    label:"Listening · Part 1–4",
    shortLabel:"Listening",
    duration:20,
    parts:[
      {part_no:1,title:"Part 1",shuffle_mode:"fixed",shuffle_choices:false,sort_order:1},
      {part_no:2,title:"Part 2",shuffle_mode:"fixed",shuffle_choices:false,sort_order:2},
      {part_no:3,title:"Part 3",shuffle_mode:"fixed",shuffle_choices:true,sort_order:3},
      {part_no:4,title:"Part 4",shuffle_mode:"fixed",shuffle_choices:true,sort_order:4}
    ]
  },
  reading:{
    label:"Reading · Part 5–7",
    shortLabel:"Reading",
    duration:75,
    parts:[
      {part_no:5,title:"Part 5",shuffle_mode:"shuffle_questions",shuffle_choices:false,sort_order:5},
      {part_no:6,title:"Part 6",shuffle_mode:"shuffle_stimulus_groups",shuffle_choices:false,sort_order:6},
      {part_no:7,title:"Part 7",shuffle_mode:"fixed",shuffle_choices:false,sort_order:7}
    ]
  },
  full:{
    label:"Full Test · Part 1–7",
    shortLabel:"Full Test",
    duration:85,
    parts:[
      {part_no:1,title:"Part 1",shuffle_mode:"fixed",shuffle_choices:false,sort_order:1},
      {part_no:2,title:"Part 2",shuffle_mode:"fixed",shuffle_choices:false,sort_order:2},
      {part_no:3,title:"Part 3",shuffle_mode:"fixed",shuffle_choices:true,sort_order:3},
      {part_no:4,title:"Part 4",shuffle_mode:"fixed",shuffle_choices:true,sort_order:4},
      {part_no:5,title:"Part 5",shuffle_mode:"shuffle_questions",shuffle_choices:false,sort_order:5},
      {part_no:6,title:"Part 6",shuffle_mode:"shuffle_stimulus_groups",shuffle_choices:false,sort_order:6},
      {part_no:7,title:"Part 7",shuffle_mode:"fixed",shuffle_choices:false,sort_order:7}
    ]
  }
};

export const testKindLabel=kind=>TEST_KINDS[kind]?.label||TEST_KINDS.reading.label;
export const testKindShortLabel=kind=>TEST_KINDS[kind]?.shortLabel||TEST_KINDS.reading.shortLabel;
export const testKindConfig=kind=>TEST_KINDS[kind]||TEST_KINDS.reading;

export async function createPartsForKind(sb,testId,kind){
  for(const part of testKindConfig(kind).parts){
    const {error}=await sb.rpc("staff_upsert_part",{p_data:{...part,test_id:testId}});
    if(error)throw error;
  }
}
