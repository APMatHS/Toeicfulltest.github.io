import assert from 'node:assert/strict';
import { createListeningAudio,LISTENING_AUDIO_UNIT_KEY } from '../assets/exam/listening/audio-session.js';
import { writeJSON,readJSON,removeStorage } from '../assets/modules/utils.js';

Object.defineProperty(globalThis.navigator,'onLine',{value:true,configurable:true});
const state={attemptId:'audio-smoke',audioStates:new Map(),activeAudio:null,listeningAudio:{path:'tests/t/listening.mp3',filename:'listening.mp3'}};
const calls=[];
const sb={rpc:async(name,args)=>{
  calls.push([name,args]);
  if(name==='get_audio_states_v118')return {data:[],error:null};
  if(name==='update_audio_unit_v118')return {data:{unit_key:args.p_unit_key,last_position_seconds:args.p_position_seconds,completed_at:'2026-09-15T00:00:00Z'},error:null};
  return {data:null,error:null};
}};
writeJSON('smoke.audio.pending.audio-smoke',{[LISTENING_AUDIO_UNIT_KEY]:17.5});
const audio=createListeningAudio({
  sb,modalRoot:{innerHTML:'',querySelector:()=>null},signedUrlMap:async()=>({}),toast:()=>{},
  getState:()=>state,onChanged:()=>{},localPrefix:'smoke.audio'
});
await audio.loadStates();
assert.equal(audio.hasPending(),false,'pending completed master audio must flush when connectivity is restored');
assert.equal(readJSON('smoke.audio.pending.audio-smoke',null),null,'pending completion storage must be removed after successful sync');
assert.ok(calls.some(([name,args])=>name==='update_audio_unit_v118'&&args.p_completed===true&&args.p_unit_key===LISTENING_AUDIO_UNIT_KEY),'pending sync must mark the single Listening audio complete');
assert.ok(state.audioStates.get(LISTENING_AUDIO_UNIT_KEY)?.completed_at,'synced master audio state must be reflected in memory');

Object.defineProperty(globalThis.navigator,'onLine',{value:false,configurable:true});
const offlineState={attemptId:'audio-offline',audioStates:new Map(),activeAudio:null,listeningAudio:{path:'tests/t/listening.mp3'}};
writeJSON('smoke.offline.pending.audio-offline',{[LISTENING_AUDIO_UNIT_KEY]:9});
const offlineAudio=createListeningAudio({
  sb:{rpc:async name=>name==='get_audio_states_v118'?{data:null,error:new Error('offline')}:{data:null,error:new Error('offline')}},
  modalRoot:{innerHTML:'',querySelector:()=>null},signedUrlMap:async()=>({}),toast:()=>{},
  getState:()=>offlineState,onChanged:()=>{},localPrefix:'smoke.offline'
});
const oldWarn=console.warn;console.warn=()=>{};await offlineAudio.loadStates();console.warn=oldWarn;
assert.equal(offlineAudio.hasPending(),true,'pending master-audio completion must remain queued while offline');
assert.equal(offlineState.audioStates.get(LISTENING_AUDIO_UNIT_KEY)?.completed_at,'pending_sync','offline reload must still remember that the master audio cannot be replayed');
removeStorage('smoke.offline.pending.audio-offline');
console.log('Single Listening audio pending-sync smoke OK');
