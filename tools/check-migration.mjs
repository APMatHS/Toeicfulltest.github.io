import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file=path.join(root,'supabase/migrations/v1.18_listening_full_test.sql');
const sql=fs.readFileSync(file,'utf8');
assert.equal(sql.split('$$').length%2,1,'unbalanced $$ delimiters');
const creates=[...sql.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)/gi)].map(m=>m[1]);
const anonymousDo=(sql.match(/\bdo\s+\$\$/gi)||[]).length;
assert.equal((sql.match(/end\s+\$\$;/gi)||[]).length,creates.length+anonymousDo,'function/DO body-end count mismatch');
for(const name of [
  'get_attempt_mode_v118','get_audio_states_v118','start_audio_unit_v118','update_audio_unit_v118','complete_listening_phase_v118',
  'staff_get_practice_audio_states_v118','staff_start_practice_audio_unit_v118','staff_update_practice_audio_unit_v118','staff_complete_practice_listening_v118',
  'get_attempt_result','staff_preflight_test'
]) assert.ok(creates.includes(name),`missing migration function ${name}`);
for(const marker of ["'shuffle_choices',tp.shuffle_choices",'missing_listening_audio_questions','left join lateral','staff_practice_audio_states']) assert.ok(sql.includes(marker),`missing migration marker ${marker}`);

// Parenthesis balance outside SQL strings and $$ function bodies. This is not a PostgreSQL parser,
// but catches common truncation/merge mistakes before the migration reaches Supabase.
let state='normal',balance=0,min=0;
for(let i=0;i<sql.length;i++){
  const ch=sql[i];
  if(state==='normal'){
    if(sql.startsWith('$$',i)){state='dollar';i++;continue;}
    if(ch==="'"){state='single';continue;}
    if(ch==='(')balance++;
    if(ch===')'){balance--;min=Math.min(min,balance);}
  }else if(state==='single'){
    if(ch==="'"){
      if(sql[i+1]==="'"){i++;continue;}
      state='normal';
    }
  }else if(state==='dollar'&&sql.startsWith('$$',i)){state='normal';i++;}
}
assert.equal(state,'normal','unterminated SQL string/dollar block');
assert.equal(balance,0,'unbalanced parentheses outside function bodies');
assert.ok(min>=0,'closing parenthesis before opening parenthesis');
console.log(`Migration static check OK: ${creates.length} functions, balanced delimiters/parentheses.`);
