import assert from 'node:assert/strict';
import { createListeningAudio } from '../assets/exam/listening/audio-session.js';
import { writeJSON,readJSON } from '../assets/modules/utils.js';

Object.defineProperty(globalThis.navigator,'onLine',{value:true,configurable:true});
const state={attemptId:'audio-smoke',audioStates:new Map(),activeAudio:null};
const calls=[];
const sb={rpc:async(name,args)=>{
  calls.push([name,args]);
  if(name==='get_audio_states_v118')return {data:[],error:null};
  if(name==='update_audio_unit_v118')return {data:{unit_key:args.p_unit_key,last_position_seconds:args.p_position_seconds,completed_at:'2026-09-15T00:00:00Z'},error:null};
  return {data:null,error:null};
}};
writeJSON('smoke.audio.pending.audio-smoke',{'stimulus:s1':17.5});
const audio=createListeningAudio({
  sb,modalRoot:{innerHTML:'',querySelector:()=>null},signedUrlMap:async()=>({}),toast:()=>{},
  getState:()=>state,onChanged:()=>{},localPrefix:'smoke.audio'
});
await audio.loadStates();
assert.equal(audio.hasPending(),false,'pending completed audio must flush when connectivity is restored');
assert.equal(readJSON('smoke.audio.pending.audio-smoke',null),null,'pending completion storage must be removed after successful sync');
assert.ok(calls.some(([name,args])=>name==='update_audio_unit_v118'&&args.p_completed===true&&args.p_unit_key==='stimulus:s1'),'pending sync must mark the exact audio unit complete on the server');
assert.ok(state.audioStates.get('stimulus:s1')?.completed_at,'synced audio state must be reflected in memory');

Object.defineProperty(globalThis.navigator,'onLine',{value:false,configurable:true});
const offlineState={attemptId:'audio-offline',audioStates:new Map(),activeAudio:null};
writeJSON('smoke.offline.pending.audio-offline',{'question:q2':9});
const offlineAudio=createListeningAudio({
  sb:{rpc:async name=>name==='get_audio_states_v118'?{data:null,error:new Error('offline')}:{data:null,error:new Error('offline')}},
  modalRoot:{innerHTML:'',querySelector:()=>null},signedUrlMap:async()=>({}),toast:()=>{},
  getState:()=>offlineState,onChanged:()=>{},localPrefix:'smoke.offline'
});
const oldWarn=console.warn;console.warn=()=>{};await offlineAudio.loadStates();console.warn=oldWarn;
assert.equal(offlineAudio.hasPending(),true,'pending completion must remain queued while offline');
assert.equal(offlineState.audioStates.get('question:q2')?.completed_at,'pending_sync','offline reload must still remember that completed audio cannot be replayed');
console.log('Audio pending-sync smoke OK');
