import assert from 'node:assert/strict';
import {SCENARIOS,getWorkflowState,totalTime,SCALE} from '../src/workflow.js';
import {WEIGHBRIDGE_LAYOUT,ENTRY_QUEUE_Z,VEHICLE_ROAD_Y,AGGREGATE_BIN_X,AGGREGATE_BIN_Z} from '../src/stationLayout.js';
import {layoutLabels} from '../src/labelLayout.js';
const delta=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const angle=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
const near=(actual,expected,tolerance=1e-8)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
const failures=[];
let samples=0,boundaries=0,headingChecks=0,lipChecks=0,powderChecks=0,wheelChecks=0,forwardPasses=0,bridgeClearances=0;
function check(name,fn){try{fn();}catch(error){failures.push(`${name}: ${error.message}`);}}
for(const scenario of Object.values(SCENARIOS)){
  const id=scenario.id,total=totalTime(id),raw=scenario.flowKind!=='concrete';
  const boundaryTimes=scenario.stages.slice(1).map(stage=>stage.start);
  if(scenario.flowKind==='aggregate'){
    const loading=scenario.stages.find(stage=>stage.key==='loading'),supply=scenario.stages.find(stage=>stage.key==='supply');
    boundaryTimes.push(...[7,10,12].map(seconds=>loading.start+seconds),...[6,9,14,16,17.8,22.8].map(seconds=>supply.start+seconds));
  }
  for(const time of boundaryTimes){
    const left=getWorkflowState(id,time-1e-5),right=getWorkflowState(id,time+1e-5);boundaries++;
    check(`${id} boundary ${time}`,()=>{
      assert.ok(delta(left.vehiclePosition,right.vehiclePosition)<.003,'vehicle teleport');
      assert.ok(angle(left.vehicleYaw,right.vehicleYaw)<.02,'vehicle heading step');
      assert.ok(delta(left.loaderPosition,right.loaderPosition)<.003,'loader teleport');
      assert.ok(angle(left.loaderYaw,right.loaderYaw)<.02,'loader heading step');
      near(left.loaderArm,right.loaderArm,.0002);near(left.loaderTilt,right.loaderTilt,.0002);near(left.loaderFill,right.loaderFill,.0002);near(left.tip,right.tip,.0002);
      near(left.vehicleWheelTravel,right.vehicleWheelTravel,.003);near(left.loaderWheelTravel,right.loaderWheelTravel,.003);
    });
  }
  let previousDistance=0,previousLoaderDistance=0;
  for(let time=0;time<=total;time+=.04){
    const state=getWorkflowState(id,time);samples++;
    check(`${id} quantities ${time.toFixed(2)}`,()=>{
      assert.ok(state.vehicleDistance+1e-7>=previousDistance,'truck distance decreased');
      assert.ok(state.loaderDistance+1e-7>=previousLoaderDistance,'loader distance decreased');
      assert.ok(state.vehicleFill>=-1e-9&&state.vehicleFill<=1+1e-9);
      assert.ok(state.loaderFill>=-1e-9&&state.loaderFill<=1+1e-9);
      if(raw){
        if(!state.tareMeasured){near(state.stockAdded,0);near(state.stock,scenario.initialStock);assert.equal(state.netMeasured,null);}
        near(state.stock,scenario.initialStock+state.stockAdded-state.materialConsumed);
        near(state.stockAdded,state.tareMeasured?scenario.net:0);
        if(scenario.flowKind==='aggregate'){
          near(state.aggregateBinAdded,state.materialConsumed);
          near(state.loaderMaterialAmount+state.aggregateBinAdded,scenario.feed*state.loaderPickupProgress);
          assert.ok(state.aggregateBinDischarged<=state.aggregateBinAdded+1e-9);
          if(state.dumpStage==='lowering'){near(state.dumpFlowProgress,1);near(state.vehicleFill,0);assert.equal(state.dumpFlowActive,false);}
          if(state.loaderTransferProgress>0&&state.loaderTransferProgress<1){
            assert.equal(state.loaderAction,'dumping');
            assert.ok(state.loaderPitch<-.08);
            const lipY=state.loaderPosition[1]+1.47+2.6*Math.sin(state.loaderArm)+1.18*Math.sin(state.loaderPitch)-.27*Math.cos(state.loaderPitch);
            const lipX=.63+2.6*Math.cos(state.loaderArm)+1.18*Math.cos(state.loaderPitch)+.27*Math.sin(state.loaderPitch);
            const lipZ=state.loaderPosition[2]-lipX;
            assert.ok(lipY>2.51,`bucket lip below hopper rim: ${lipY}`);
            near(state.loaderPosition[0],AGGREGATE_BIN_X[scenario.materialKind==='stone'?2:0],.001);
            assert.ok(Math.abs(lipZ-AGGREGATE_BIN_Z)<1.55,`bucket lip outside hopper: ${lipZ}`);lipChecks++;
          }
        }else if(state.powderFlowActive){near(state.powderConnectionProgress,1);assert.equal(state.powderStage,'transferring');powderChecks++;}
      }else if(!state.delivered)near(state.deliveredVolume,0);
      assert.deepEqual(getWorkflowState(id,time),state,'seek is not deterministic');
      const end=state.completedRoutePoints.at(-1);assert.ok(delta(end,state.vehiclePosition)<1e-8,'trace endpoint differs from same vehicle');
    });
    for(const [positionKey,yawKey] of [['vehiclePosition','vehicleYaw'],['loaderPosition','loaderYaw']]){
      const before=getWorkflowState(id,Math.max(0,time-.001)),after=getWorkflowState(id,Math.min(total,time+.001));
      const dx=after[positionKey][0]-before[positionKey][0],dz=after[positionKey][2]-before[positionKey][2],distance=Math.hypot(dx,dz);
      if(distance>1e-5){
        const lateral=Math.abs(dx*Math.sin(state[yawKey])+dz*Math.cos(state[yawKey]))/distance;
        check(`${id} ${positionKey} tangent ${time.toFixed(2)}`,()=>assert.ok(lateral<.06,`side slide ${lateral}`));headingChecks++;
        const wheelKey=positionKey==='vehiclePosition'?'vehicleWheelTravel':'loaderWheelTravel';
        const wheelDelta=after[wheelKey]-before[wheelKey],longitudinal=dx*Math.cos(state[yawKey])-dz*Math.sin(state[yawKey]);
        check(`${id} ${wheelKey} ${time.toFixed(2)}`,()=>{
          assert.ok(wheelDelta*longitudinal>0,'wheel turns against driving/reversing direction');
          assert.ok(Math.abs(Math.abs(wheelDelta)-distance)/distance<.02,'wheel travel differs from actual path length');
        });wheelChecks++;
      }
    }
    previousDistance=state.vehicleDistance;previousLoaderDistance=state.loaderDistance;
  }
  const complete=getWorkflowState(id,total);
  check(`${id} completion`,()=>{assert.equal(complete.completed,true);near(complete.vehicleFill,0);near(complete.loaderFill,0);if(raw){near(complete.materialConsumed,scenario.feed);near(complete.stockAdded,scenario.net);}else near(complete.deliveredVolume,12);});
  if(raw){
    const at=(key,p)=>{const phase=scenario.stages.find(stage=>stage.key===key);return getWorkflowState(id,phase.start+phase.duration*p);};
    check(`${id} shared entrance and two forward weighing stops`,()=>{
      const queue=at('registration',.5),gross=at('gross',.8),tare=at('tare',.8);
      near(queue.vehiclePosition[0],SCALE[0]);near(queue.vehiclePosition[2],ENTRY_QUEUE_Z);
      for(const state of [gross,tare]){near(state.vehiclePosition[0],SCALE[0]);near(state.vehiclePosition[2],SCALE[2]);near(state.vehiclePosition[1],VEHICLE_ROAD_Y);}
      near(Math.sin(gross.vehicleYaw),1);near(Math.sin(tare.vehicleYaw),-1);
    });
    for(const key of ['gross','return_scale','exit',...(scenario.flowKind==='powder'?['to_unload']:[])]){
      const phase=scenario.stages.find(stage=>stage.key===key);
      for(let t=phase.start+.01;t<phase.end-.01;t+=.04){
        const before=getWorkflowState(id,t-.001),state=getWorkflowState(id,t),after=getWorkflowState(id,t+.001);
        const dx=after.vehiclePosition[0]-before.vehiclePosition[0],dz=after.vehiclePosition[2]-before.vehiclePosition[2];
        if(Math.hypot(dx,dz)<1e-8)continue;
        check(`${id} forward ${key} ${t.toFixed(2)}`,()=>{
          assert.ok(dx*Math.cos(state.vehicleYaw)-dz*Math.sin(state.vehicleYaw)>0,'truck reverses during a through-lane pass');
          assert.ok(after.vehicleWheelTravel>before.vehicleWheelTravel,'wheel travel reverses during a through-lane pass');
        });forwardPasses++;
      }
    }
    // Include the rear overhang and mirrors when checking the first turn after
    // gross weighing. A clear vehicle centre is insufficient: the tail must
    // leave the north end of the 14m deck before the body starts turning.
    const depart=scenario.stages.find(stage=>stage.key==='to_unload');
    for(let t=depart.start;t<depart.end;t+=.01){
      const state=getWorkflowState(id,t);if(Math.abs(state.vehiclePosition[0]-SCALE[0])<=.001)continue;
      const rear=scenario.flowKind==='powder'?-5.3:-4.45,front=scenario.flowKind==='powder'?5:4.15,halfWidth=1.52;
      const yaw=state.vehicleYaw,c=Math.cos(yaw),s=Math.sin(yaw);
      const footprint=[[rear,-halfWidth],[front,-halfWidth],[front,halfWidth],[rear,halfWidth]].map(([x,z])=>[state.vehiclePosition[0]+x*c+z*s,state.vehiclePosition[2]-x*s+z*c]);
      check(`${id} full tail clear before turning off bridge`,()=>assert.ok(Math.max(...footprint.map(p=>p[1]))<SCALE[2]-WEIGHBRIDGE_LAYOUT.length/2,'rear overhang still on bridge when the turn begins'));
      bridgeClearances++;break;
    }
  }
}
let labelSeed=43,labelsChecked=0;
const random=()=>{labelSeed=(labelSeed*1664525+1013904223)>>>0;return labelSeed/4294967296;};
for(let n=0;n<250;n++){
  const width=320+random()*1500,height=220+random()*700;
  const items=Array.from({length:30},(_,i)=>({id:i,x:random()*width,y:random()*height,text:i%2?'自动配料仓':'MC012',selected:i===17,priority:i%3}));
  const placed=layoutLabels(items,width,height);assert.equal(placed[0].id,17);
  for(let i=0;i<placed.length;i++){
    const a=placed[i];assert.ok(a.x>=8&&a.y>=8&&a.x+a.width<=width-8&&a.y+a.height<=height-8);
    for(const b of placed.slice(i+1))assert.ok(a.x+a.width+6<=b.x||b.x+b.width+6<=a.x||a.y+a.height+6<=b.y||b.y+b.height+6<=a.y);
    labelsChecked++;
  }
}
console.log(`Labels: ${labelsChecked} placements within viewport and without overlap.`);
if(failures.length){console.error(failures.slice(0,35).join('\n'));console.error(`FAIL ${failures.length} checks`);process.exitCode=1;}
else console.log(`PASS V6: ${samples} samples; ${boundaries} boundaries; ${headingChecks} tangent checks; ${wheelChecks} signed wheel-travel checks; ${lipChecks} bucket/hopper alignment checks; ${powderChecks} connected powder-flow checks; ${forwardPasses} forward entry/return/exit samples; ${bridgeClearances} full-body bridge departure clearances. Quantity balance, weighing/signature gates and deterministic seek passed.`);
