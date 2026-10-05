// Deterministic, metre-based demonstration paths. No renderer or frame delta is used.
import {LOADER_PARK,VEHICLE_ROAD_Y} from './stationLayout.js';
export const clamp01 = value => Math.max(0, Math.min(1, value));
export const smooth = value => { const t=clamp01(value); return t*t*(3-2*t); };
export const mix = (a,b,t) => a+(b-a)*t;
const distance=(a,b)=>Math.hypot(b[0]-a[0],b[2]-a[2]);
const blend=(a,b,t)=>[mix(a[0],b[0],t),0,mix(a[2],b[2],t)];
const unwrap=(angle,reference)=>reference+Math.atan2(Math.sin(angle-reference),Math.cos(angle-reference));

function makePath(points){
  const samples=points.filter((point,index)=>index===0||distance(point,points[index-1])>1e-9);
  let length=0,previousYaw=0;
  const table=samples.map((position,index)=>{
    if(index)length+=distance(samples[index-1],position);
    const before=samples[Math.max(0,index-1)],after=samples[Math.min(samples.length-1,index+1)];
    let yaw=-Math.atan2(after[2]-before[2],after[0]-before[0]);
    if(index)yaw=unwrap(yaw,previousYaw);
    previousYaw=yaw;
    return{position,distance:length,yaw};
  });
  return{table,length};
}
export function linePath(a,b){return makePath([a,b]);}
export function cubicPath(a,b,c,d,steps=120){
  const points=[];
  for(let i=0;i<=steps;i++){const t=i/steps,u=1-t;points.push([u*u*u*a[0]+3*u*u*t*b[0]+3*u*t*t*c[0]+t*t*t*d[0],0,u*u*u*a[2]+3*u*u*t*b[2]+3*u*t*t*c[2]+t*t*t*d[2]]);}
  // Exact endpoint tangent avoids heading steps between independently sampled stages.
  const path=makePath(points);
  path.table[0].yaw=unwrap(-Math.atan2(b[2]-a[2],b[0]-a[0]),path.table[1].yaw);
  path.table.at(-1).yaw=unwrap(-Math.atan2(d[2]-c[2],d[0]-c[0]),path.table.at(-2).yaw);
  return path;
}
export function roundedPath(points,radius=3){
  if(points.length<3)return makePath(points);
  const result=[points[0]];
  for(let i=1;i<points.length-1;i++){
    const a=points[i-1],b=points[i],c=points[i+1],incoming=distance(a,b),outgoing=distance(b,c);
    if(incoming<1e-8||outgoing<1e-8)continue;
    const trim=Math.min(radius,incoming*.35,outgoing*.35),entry=blend(b,a,trim/incoming),exit=blend(b,c,trim/outgoing);
    result.push(entry);
    for(let j=1;j<=24;j++){const t=j/24,u=1-t;result.push([u*u*entry[0]+2*u*t*b[0]+t*t*exit[0],0,u*u*entry[2]+2*u*t*b[2]+t*t*exit[2]]);}
  }
  result.push(points.at(-1));
  return makePath(result);
}
export function joinPaths(...paths){
  const result=makePath(paths.flatMap((path,index)=>path.table.slice(index?1:0).map(row=>row.position)));
  result.table[0].yaw=unwrap(paths[0].table[0].yaw,result.table[1].yaw);
  result.table.at(-1).yaw=unwrap(paths.at(-1).table.at(-1).yaw,result.table.at(-2).yaw);
  return result;
}
export function samplePath(path,progress,{reverse=false,referenceYaw,steeringWheelbase=3}={}){
  const fraction=clamp01(progress),travel=fraction*path.length,rows=path.table;
  let index=1;
  while(index<rows.length-1&&rows[index].distance<travel)index++;
  const a=rows[Math.max(0,index-1)],b=rows[index]||a,span=b.distance-a.distance,t=span?clamp01((travel-a.distance)/span):0;
  const heading=mix(a.yaw,b.yaw,t),bodyYaw=heading+(reverse?Math.PI:0);
  const yaw=referenceYaw===undefined?bodyYaw:unwrap(bodyYaw,referenceYaw);
  const lo=rows[Math.max(0,index-2)],hi=rows[Math.min(rows.length-1,index+1)],arc=hi.distance-lo.distance;
  const curvature=arc?-(hi.yaw-lo.yaw)/arc:0;
  const edge=Math.min(1,fraction*10,(1-fraction)*10);
  const steer=Math.max(-.48,Math.min(.48,Math.atan(steeringWheelbase*curvature)))*edge*(reverse?-1:1);
  return{position:blend(a.position,b.position,t),yaw,steer,distance:travel};
}
export function pathPoints(path,progress=1){
  const end=samplePath(path,progress),travel=clamp01(progress)*path.length;
  return[...path.table.filter(row=>row.distance<travel).map(row=>row.position),end.position];
}
export function sampleJourney(parts,progress,referenceYaw){
  const weights=parts.reduce((sum,part)=>sum+(part.weight||part.path.length),0);
  let time=clamp01(progress)*weights,travel=0,wheelTravel=0,trace=[],yaw=referenceYaw;
  for(let index=0;index<parts.length;index++){
    const part=parts[index],weight=part.weight||part.path.length,local=clamp01(time/weight);
    const pose=samplePath(part.path,smooth(local),{reverse:!!part.reverse,referenceYaw:yaw});
    if(time<=weight||index===parts.length-1)return{...pose,distance:travel+pose.distance,wheelTravel:wheelTravel+(part.reverse?-1:1)*pose.distance,trace:[...trace,...pathPoints(part.path,smooth(local))]};
    trace.push(...pathPoints(part.path));travel+=part.path.length;wheelTravel+=(part.reverse?-1:1)*part.path.length;yaw=pose.yaw;time-=weight;
  }
}
export const journeyLength=parts=>parts.reduce((sum,part)=>sum+part.path.length,0);

export const LOADER_TIMING={approach:7,scoop:3,curl:2,reverse:2,haul:6,raise:3,dump:5,lower:2,return:8};
const loaderPaths=new Map();
function getLoaderPaths(bayX,binX){
  const key=`${bayX}:${binX}`;
  if(loaderPaths.has(key))return loaderPaths.get(key);
  const park=LOADER_PARK,pickup=[bayX,0,1],clear=[bayX,0,5.5],bin=[binX,0,4],binClear=[binX,0,5.5];
  const approach=cubicPath(park,[park[0]+5,0,park[2]],[bayX,0,8.5],pickup);
  const pickupExit=[bayX,0,.42],scoop=linePath(pickup,pickupExit),backing=linePath(pickupExit,clear);
  const haul=cubicPath(clear,[bayX,0,4.9],[binX,0,6.8],bin);
  const returnBacking=linePath(bin,binClear);
  const returning=cubicPath(binClear,[binX,0,1.5],[park[0]-6,0,park[2]],park,480);
  const result={park,pickup,pickupExit,scoop,clear,bin,approach,backing,haul,returnBacking,returning};loaderPaths.set(key,result);return result;
}
export function loaderMotion(bayX,binX,stage,elapsed,feed){
  const paths=getLoaderPaths(bayX,binX),carry=.15,lift=1.05;
  let pose={position:paths.park,yaw:0,steer:0,distance:0},arm=-.22,pitch=.03,pickup=0,transfer=0,action='idle',label='停放待命';
  const approachLength=paths.approach.length,scoopLength=paths.scoop.length,backLength=paths.backing.length,haulLength=paths.haul.length;
  if(stage==='loading'){
    const t=Math.max(0,elapsed);
    if(t<7){pose=samplePath(paths.approach,smooth(t/7),{referenceYaw:0,steeringWheelbase:2.5});action='approaching';label='接近料堆';}
    else if(t<10){pose=samplePath(paths.scoop,smooth((t-7)/3),{referenceYaw:Math.PI/2});pose.distance+=approachLength;pickup=smooth((t-7)/3);arm=mix(-.22,-.18,pickup);pitch=mix(.03,-.06,pickup);action='scooping';label='铲入料堆并取料';}
    else if(t<12){pose=samplePath(paths.scoop,1,{referenceYaw:Math.PI/2});pose.distance+=approachLength;const q=smooth((t-10)/2);pickup=1;arm=mix(-.18,carry,q);pitch=mix(-.06,.10,q);action='curling';label='收斗携料';}
    else{pose=samplePath(paths.backing,smooth((t-12)/2),{reverse:true,referenceYaw:Math.PI/2});pose.distance+=approachLength+scoopLength;pickup=1;arm=carry;pitch=.10;action='reversing';label='倒车退出料堆';}
  }
  if(stage==='supply'){
    const t=Math.max(0,elapsed),baseDistance=approachLength+scoopLength+backLength;pickup=1;arm=carry;pitch=.10;
    if(t<6){pose=samplePath(paths.haul,smooth(t/6),{referenceYaw:Math.PI/2,steeringWheelbase:2.5});pose.distance+=baseDistance;action=t<1.8?'turning':'transporting';label=t<1.8?'铰接转向':'转运至配料斗';}
    else if(t<9){pose=samplePath(paths.haul,1,{referenceYaw:Math.PI/2});pose.distance+=baseDistance;arm=mix(carry,lift,smooth((t-6)/3));action='raising';label='举臂对准料斗';}
    else if(t<14){pose=samplePath(paths.haul,1,{referenceYaw:Math.PI/2});pose.distance+=baseDistance;arm=lift;pitch=mix(.10,-.82,smooth((t-9)/5));transfer=clamp01((-pitch-.08)/.74);action='dumping';label=transfer>0?'卸斗至配料仓':'前倾打开卸料口';}
    else if(t<16){pose=samplePath(paths.haul,1,{referenceYaw:Math.PI/2});pose.distance+=baseDistance;const q=smooth((t-14)/2);arm=mix(lift,carry,q);pitch=mix(-.82,.10,q);transfer=1;action='lowering';label='空斗回正降臂';}
    else if(t<17.8){pose=samplePath(paths.returnBacking,smooth((t-16)/1.8),{reverse:true,referenceYaw:Math.PI/2});pose.distance+=baseDistance+haulLength;transfer=1;action='return_reversing';label='空斗倒车退让';}
    else if(t<22.8){pose=samplePath(paths.returning,smooth((t-17.8)/5),{referenceYaw:Math.PI/2,steeringWheelbase:2.5});pose.distance+=baseDistance+haulLength+paths.returnBacking.length;transfer=1;action='returning';label='返回停放位';}
    else{pose=samplePath(paths.returning,1,{referenceYaw:Math.PI/2});pose.distance+=baseDistance+haulLength+paths.returnBacking.length;const q=smooth((t-22.8)/1.2);arm=mix(carry,-.22,q);pitch=mix(.10,.03,q);transfer=1;action='parking';label='降斗待命';}
  }
  if(stage==='complete'){pose={position:paths.park,yaw:0,steer:0,distance:approachLength+scoopLength+backLength+haulLength+paths.returnBacking.length+paths.returning.length};pickup=1;transfer=1;}
  const fill=pickup*(1-transfer);
  let wheelTravel=pose.distance;
  if(stage==='loading'&&elapsed>=12)wheelTravel=2*(approachLength+scoopLength)-pose.distance;
  if(stage==='supply')wheelTravel=elapsed<16?pose.distance-2*backLength:elapsed<17.8?2*(approachLength+scoopLength+haulLength)-pose.distance:pose.distance-2*(backLength+paths.returnBacking.length);
  if(stage==='complete')wheelTravel=pose.distance-2*(backLength+paths.returnBacking.length);
  return{loaderPosition:[pose.position[0],VEHICLE_ROAD_Y,pose.position[2]],loaderYaw:pose.yaw,loaderSteer:pose.steer,loaderDistance:pose.distance,loaderWheelTravel:wheelTravel,loaderArm:arm,loaderTilt:pitch-arm,loaderPitch:pitch,loaderBucket:clamp01((arm+.22)/1.2),loaderFill:fill,loaderPickupProgress:pickup,loaderTransferProgress:transfer,loaderMaterialAmount:feed*fill,aggregateBinAdded:feed*transfer,loaderAction:action,loaderActionLabel:label};
}

export function dumpMotion(progress,active,finished){
  const p=clamp01(progress),flow=finished?1:active?smooth((p-.18)/.62):0;
  return{tip:!active?0:p<.18?.95*smooth(p/.18):p<.8?.95:.95*(1-smooth((p-.8)/.2)),dumpStage:!active?'idle':p<.18?'raising':p<.8?'discharging':'lowering',dumpActionLabel:!active?'停止卸料':p<.18?'举升车厢':p<.8?'保持举升排料':'排空后落斗',dumpFlowProgress:flow,dumpFlowActive:active&&p>.18&&p<.8,dumpGateOpen:active?smooth((p-.13)/.05)*(1-smooth((p-.8)/.08)):0};
}
export function powderMotion(progress,active,finished){
  const p=clamp01(progress),stage=!active?'idle':p<.15?'connecting':p<.25?'preparing':p<.75?'transferring':p<.85?'clearing':'disconnecting';
  const connection=!active?0:p<.15?smooth(p/.15):p<.85?1:1-smooth((p-.85)/.15);
  const labels={idle:'气力卸料停止',connecting:'连接卸料软管',preparing:'升压与输送准备',transferring:'气力输送入筒仓',clearing:'清管与泄压',disconnecting:'断开卸料软管'};
  return{powderStage:stage,powderActionLabel:labels[stage],powderConnectionProgress:connection,powderFlowProgress:finished?1:active?smooth((p-.25)/.5):0,powderFlowActive:active&&p>.25&&p<.75,powderPressure:active?(p<.25?smooth((p-.15)/.1):p<.75?1:1-smooth((p-.75)/.1)):0};
}
