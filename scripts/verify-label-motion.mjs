import assert from 'node:assert/strict';
import {advanceLabelOffset,labelScreenPose} from '../src/labelMotion.js';

const placement={width:70,height:24,offsetX:-35,offsetY:-34};
const viewport={width:960,height:540};
let checks=0;
function check(name,fn){fn();checks++;console.log('PASS '+name);}
check('moving anchors stay attached while avoidance offset stays fixed',()=>{
  let offset=null;
  for(let frame=0;frame<1200;frame++){
    const anchor={x:180+frame*.24,y:230+Math.sin(frame/60)*12};
    offset=advanceLabelOffset(offset,placement,1/60);
    const pose=labelScreenPose(anchor,offset,placement,viewport,1.25);
    assert.equal(offset.x,placement.offsetX);assert.equal(offset.y,placement.offsetY);
    assert.ok(Math.abs(pose.x-anchor.x-offset.x)<=.4+1e-9);
    assert.ok(Math.abs(pose.y-anchor.y-offset.y)<=.4+1e-9);
  }
});
check('necessary avoidance changes ease without a discontinuous first step',()=>{
  let offset=advanceLabelOffset(null,placement,1/60);
  const displaced={...placement,offsetX:65,offsetY:-94};
  let previousError=Math.hypot(100,60);
  for(let frame=0;frame<180;frame++){
    const dt=[1/60,1/30,1/48][frame%3],next=advanceLabelOffset(offset,displaced,dt);
    assert.ok(Math.hypot(next.x-offset.x,next.y-offset.y)<=240*dt+1e-9);
    const error=Math.hypot(next.x-displaced.offsetX,next.y-displaced.offsetY);
    assert.ok(error<=previousError+1e-9);previousError=error;offset=next;
  }
  assert.equal(offset.moving,false);assert.equal(previousError,0);
});
check('paused motion is identical and seeking moves the anchor immediately',()=>{
  const offset=advanceLabelOffset(null,placement,1/60),anchor={x:220,y:210};
  const paused=labelScreenPose(anchor,offset,placement,viewport);
  for(let i=0;i<100;i++)assert.deepEqual(labelScreenPose(anchor,offset,placement,viewport),paused);
  const sought=labelScreenPose({x:520,y:410},offset,placement,viewport);
  assert.equal(sought.x-paused.x,300);assert.equal(sought.y-paused.y,200);
  assert.deepEqual(advanceLabelOffset(offset,{...placement,offsetX:100},0),{...offset,moving:true});
});
check('device pixel alignment and viewport clamping keep text readable',()=>{
  for(const ratio of [1,1.25,2])for(const anchor of [{x:220.123,y:145.987},{x:1,y:1},{x:959,y:539}]){
    const pose=labelScreenPose(anchor,{x:-35,y:-34},placement,viewport,ratio);
    assert.ok(pose.x>=8&&pose.x+placement.width<=viewport.width-8);
    assert.ok(pose.y>=8&&pose.y+placement.height<=viewport.height-8);
    assert.ok(Math.abs(pose.x*ratio-Math.round(pose.x*ratio))<1e-8);
    assert.ok(Math.abs(pose.y*ratio-Math.round(pose.y*ratio))<1e-8);
  }
});
check('leader endpoints follow the displayed rectangle during relocation',()=>{
  const anchor={x:220,y:180};
  const pose=labelScreenPose(anchor,{x:60,y:-70},placement,viewport);
  assert.equal(pose.nearX,pose.x);assert.equal(pose.nearY,pose.y+placement.height);
  assert.equal(pose.leaderDistance,Math.hypot(anchor.x-pose.nearX,anchor.y-pose.nearY));
});
console.log(`Label motion: ${checks} regression checks passed.`);
