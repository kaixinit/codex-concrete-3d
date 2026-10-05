import assert from 'node:assert/strict';
import {FILM_FPS,FILM_SHOTS,FILM_FRAMES,FILM_SECONDS,filmSample,makeIvfHeader} from '../src/showreelTimeline.js';
import {getWorkflowState} from '../src/workflow.js';

// Check that the edited reel still contains real material transfer and delivery
// actions; a valid frame count alone could accept a reel of idle scenes.
const seen=new Set();let dump=false,scoop=false,feed=false,cement=false,flyash=false,production=false,load=false,pump=false,signed=false,wash=false,travel=false,returning=false;
for(let frame=0;frame<FILM_FRAMES;frame++){
  const sample=filmSample(frame),state=getWorkflowState(sample.shot.scenario,sample.time);
  seen.add(sample.index);
  assert.equal(Number.isFinite(sample.time),true);
  assert.ok(state.vehiclePosition.every(Number.isFinite));
  dump ||= state.dumpFlowActive;
  scoop ||= state.loaderAction==='scooping';
  feed ||= state.loaderAction==='dumping'&&state.loaderTransferProgress>0;
  cement ||= state.materialKind==='cement'&&state.powderFlowActive;
  flyash ||= state.materialKind==='flyash'&&state.powderFlowActive;
  production ||= state.flowKind==='concrete'&&state.stageName==='production';
  load ||= state.flowKind==='concrete'&&state.stageName==='loading'&&state.vehicleFill>0&&state.vehicleFill<1;
  pump ||= state.flowKind==='concrete'&&state.stageName==='unloading';
  signed ||= state.flowKind==='concrete'&&state.stageName==='signature'&&state.delivered;
  travel ||= state.stageName==='outbound';returning ||= state.stageName==='return';
  wash ||= state.stageName==='wash'&&state.stageProgress>=.5;
  const timestamp=Math.round(frame*1e6/FILM_FPS);
  assert.equal(Math.round(timestamp*FILM_FPS/1e6),frame,'IVF timestamp roundtrip');
}
assert.equal(seen.size,FILM_SHOTS.length);
assert.deepEqual({dump,scoop,feed,cement,flyash,production,load,pump,signed,wash,travel,returning},Object.fromEntries(['dump','scoop','feed','cement','flyash','production','load','pump','signed','wash','travel','returning'].map(key=>[key,true])));
const header=makeIvfHeader(1280,720,FILM_FRAMES),dv=new DataView(header.buffer);
assert.equal(new TextDecoder().decode(header.slice(0,4)),'DKIF');
assert.equal(new TextDecoder().decode(header.slice(8,12)),'VP80');
assert.equal(dv.getUint16(12,true),1280);assert.equal(dv.getUint16(14,true),720);
assert.equal(dv.getUint32(16,true),FILM_FPS);assert.equal(dv.getUint32(20,true),1);
assert.equal(dv.getUint32(24,true),FILM_FRAMES);
console.log(`Showreel: ${FILM_SHOTS.length} shots, ${FILM_FRAMES} frames, ${FILM_SECONDS}s; material transfer, both powder types, delivery/signature/return/washing and IVF clock verified.`);
