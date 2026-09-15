import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function check(file,requiredFunctions=[],markers=[]){
  const sql=fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8');
  assert.equal(sql.split('$$').length%2,1,`${file}: unbalanced $$ delimiters`);
  const creates=[...sql.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)/gi)].map(m=>m[1]);
  const anonymousDo=(sql.match(/\bdo\s+\$\$/gi)||[]).length;
  assert.equal((sql.match(/end\s+\$\$;/gi)||[]).length,creates.length+anonymousDo,`${file}: function/DO body-end count mismatch`);
  for(const name of requiredFunctions)assert.ok(creates.includes(name),`${file}: missing function ${name}`);
  for(const marker of markers)assert.ok(sql.includes(marker),`${file}: missing marker ${marker}`);
  let state='normal',balance=0,min=0;
  for(let i=0;i<sql.length;i++){
    const ch=sql[i];
    if(state==='normal'){
      if(sql.startsWith('$$',i)){state='dollar';i++;continue;}
      if(ch==="'"){state='single';continue;}
      if(ch==='(')balance++;
      if(ch===')'){balance--;min=Math.min(min,balance);}
    }else if(state==='single'){
      if(ch==="'"){if(sql[i+1]==="'"){i++;continue;}state='normal';}
    }else if(state==='dollar'&&sql.startsWith('$$',i)){state='normal';i++;}
  }
  assert.equal(state,'normal',`${file}: unterminated SQL string/dollar block`);
  assert.equal(balance,0,`${file}: unbalanced parentheses outside function bodies`);
  assert.ok(min>=0,`${file}: closing parenthesis before opening parenthesis`);
  return creates.length;
}
const a=check('v1.18_listening_full_test.sql',['get_attempt_mode_v118','get_audio_states_v118','start_audio_unit_v118','update_audio_unit_v118','complete_listening_phase_v118','staff_get_practice_audio_states_v118','staff_start_practice_audio_unit_v118','staff_update_practice_audio_unit_v118','staff_complete_practice_listening_v118','get_attempt_result','staff_preflight_test'],['shuffle_choices','staff_practice_audio_states']);
const b=check('v1.18b_single_listening_audio.sql',['staff_set_listening_audio_v118b','get_listening_audio_v118b','start_audio_unit_v118','update_audio_unit_v118','complete_listening_phase_v118','staff_start_practice_audio_unit_v118','staff_update_practice_audio_unit_v118','staff_complete_practice_listening_v118','staff_preflight_test','staff_clone_test_v118b'],['listening_audio_storage_path',"'listening:main'",'listening_audio_ready']);
console.log(`Migration static check OK: V1.18 ${a} functions + V1.18b ${b} functions, balanced delimiters/parentheses.`);
