import assert from 'node:assert/strict';
import {advanceOcclusion} from '../src/sceneVisualRules.js';
import {advanceOcclusionWork} from '../src/labelOcclusionWork.js';

let checks=0;
function check(name,test){test();checks++;console.log('PASS '+name);}
function sampler(ids,states=new Map(),maxSettleMs=1800){
  let work=null;
  return {states,get work(){return work;},sample(now,{key='paused-view',budget=3,blocked=()=>false}={}){
    const input={key,ids,states,now,maxSettleMs};
    work=advanceOcclusionWork(work,input);
    const checkedIds=[];
    for(const id of work.pending.slice(0,budget)){
      const value=blocked(id);
      if(value==null)continue;
      states.set(id,advanceOcclusion(states.get(id),value,now));checkedIds.push(id);
    }
    work=advanceOcclusionWork(work,{...input,checkedIds});
    return work;
  }};
}
check('paused closing cutaway confirms a newly obstructed label before ending demand refresh',()=>{
  const run=sampler(['operator']);
  let work=run.sample(0,{blocked:()=>true});
  assert.equal(run.states.get('operator').blocked,false,'first sample only starts debounce');
  assert.equal(work.needsMore,true);assert.equal(work.delay,110);
  work=run.sample(110,{blocked:()=>true});
  assert.equal(run.states.get('operator').blocked,true,'timer sample confirms the wall');
  assert.equal(work.needsMore,false);assert.deepEqual(work.pending,[]);
  assert.equal(run.sample(1000,{blocked:()=>true}).needsMore,false,'settled static view stays asleep');
});
check('paused opening cutaway completes the longer reveal debounce and then stops',()=>{
  const run=sampler(['operator'],new Map([['operator',{blocked:true,candidate:true,since:-1000}]]));
  assert.equal(run.sample(0).needsMore,true);
  assert.equal(run.sample(110).needsMore,true,'110ms is insufficient for the 160ms reveal debounce');
  const work=run.sample(220);
  assert.equal(run.states.get('operator').blocked,false);assert.equal(work.needsMore,false);
});
check('ray budget exhaustion causes bounded later batches to inspect every label',()=>{
  const ids=Array.from({length:9},(_,index)=>'label-'+index),run=sampler(ids),blocked=id=>id==='label-8';
  assert.equal(run.sample(0,{blocked}).pending.length,6);
  assert.equal(run.sample(110,{blocked}).pending.length,3);
  assert.equal(run.sample(220,{blocked}).needsMore,true,'last obstruction still requires confirmation');
  assert.equal(run.states.size,9,'all labels eventually receive a real sample');
  assert.equal(run.sample(330,{blocked}).needsMore,false);
  assert.equal(run.states.get('label-8').blocked,true);
});
check('an exhausted time budget cannot keep a static demand scene rendering forever',()=>{
  const run=sampler(['never-checked'],new Map(),450);
  let requests=0;
  for(let now=0;now<=450;){
    const work=run.sample(now,{blocked:()=>null});
    if(!work.needsMore)break;
    requests++;assert.ok(work.delay>0&&work.delay<=110);now+=work.delay;
  }
  assert.equal(requests,5);assert.equal(run.work.needsMore,false);assert.equal(run.work.deadline,450);
  assert.equal(run.sample(5000,{blocked:()=>null}).needsMore,false,'an expired unchanged batch is not restarted');
});
check('a camera or cutaway revision starts a fresh scan after a settled or expired batch',()=>{
  const run=sampler(['label']);
  assert.equal(run.sample(0).needsMore,false);
  assert.equal(run.sample(500,{key:'new-cutaway',budget:0}).needsMore,true);
  assert.equal(run.work.startedAt,500);
  assert.equal(run.sample(610,{key:'new-cutaway'}).needsMore,false);
});
console.log(`Label occlusion demand settle: ${checks} checks passed.`);
