import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stripMp3Tags} from '../assets/question-bank/bank-listening-package.js';

const frame=Uint8Array.from([0xff,0xfb,0x90,0x64,1,2,3,4,5,6,7,8]);
const id3=Uint8Array.from([0x49,0x44,0x33,4,0,0,0,0,0,0]);
const id3v1=new Uint8Array(128);id3v1.set([0x54,0x41,0x47]);
const tagged=new Uint8Array(id3.length+frame.length+id3v1.length);tagged.set(id3);tagged.set(frame,id3.length);tagged.set(id3v1,id3.length+frame.length);
assert.deepEqual([...stripMp3Tags(tagged)],[...frame],'MP3 packaging must remove ID3v2 and ID3v1 tags without touching frames');
assert.throws(()=>stripMp3Tags(Uint8Array.from([1,2,3,4])),/MP3 hợp lệ/,'invalid audio must be rejected');

const generator=fs.readFileSync(new URL('../assets/question-bank/bank-generator.js',import.meta.url),'utf8');
const materializer=fs.readFileSync(new URL('../supabase/migrations/20260926163840_question_bank_listening_and_stats.sql',import.meta.url),'utf8');
for(const token of ['packageListeningAudio','staff_set_listening_audio_v118b','Listening phải được tạo trọn bộ một lần'])assert.ok(generator.includes(token),`missing Listening generator contract: ${token}`);
for(const token of ["bs.media_type='audio'","Part 1 requires an image","bank_attempt_stats_refresh"])assert.ok(materializer.includes(token),`missing Listening/stat migration contract: ${token}`);

console.log('Question-bank Listening smoke OK: MP3 tags, master-audio wiring, and migration contracts.');
