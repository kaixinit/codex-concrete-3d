import React, { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { getWorkflowState, INBOUND_ROUTE, OUTBOUND_ROUTE } from './workflow.js';
import {AGGREGATE_BIN_X,WEIGHBRIDGE_LAYOUT,WEST_LANE_X,ENTRY_CANOPY_Z} from './stationLayout.js';

const usePaintEffect=typeof window==='undefined'?useEffect:useLayoutEffect;
const projectWorld=p=>[76+(p[0]+107)*2.48,84+(p[2]+29)*1.3];
export function getMapVehiclePose(workflow={},clockState){
  const scenarioId=clockState?.scenarioId||workflow.scenarioId,time=Number(clockState?.time);
  const live=clockState&&scenarioId&&Number.isFinite(time)?getWorkflowState(scenarioId,time):workflow;
  const position=projectWorld(live.vehiclePosition||[-82,0,60]),yaw=Number(live.vehicleYaw)||0;
  // Three.js +Y yaw sends local +X toward -Z; SVG screen Y grows with world Z.
  const angle=Math.atan2(-Math.sin(yaw)*1.3,Math.cos(yaw)*2.48)*180/Math.PI;
  return {position,angle,translation:`translate(${position[0]} ${position[1]})`,rotation:`rotate(${angle})`};
}
function paintVehicle(marker,body,inputs){
  if(!marker||!body)return;
  const pose=getMapVehiclePose(inputs.workflow,inputs.visualClock?.current);
  marker.setAttribute('transform',pose.translation);body.setAttribute('transform',pose.rotation);
}

export function getMapVehicleKind(workflow={}){
  if(workflow.flowKind==='concrete'||workflow.materialKind==='concrete')return 'mixer';
  if(workflow.flowKind==='powder'||['cement','flyash'].includes(workflow.materialKind))return 'powder-tanker';
  return 'dump-truck';
}
const VEHICLE_NAMES={'mixer':'混凝土搅拌车','powder-tanker':'散装粉料罐车','dump-truck':'砂石自卸车'};
function MapTruckWheels({axles=[-11,-4,14]}){
  return <g className="v5-map-truck-wheels" fill="#344b56" stroke="#233e4b" strokeWidth=".55">{[-1,1].flatMap(side=>axles.map(x=><g key={`${side}/${x}`}><rect x={x-2.25} y={side<0?-10.7:7.4} width="4.5" height="3.3" rx=".8"/><path d={`M${x-1.4} ${side<0?-9:9}h2.8`} stroke="#85969d" strokeWidth=".65"/></g>))}</g>;
}
function MapTruckCab({x=10}){
  return <g className="v5-map-truck-cab"><path d={`M${x} -7.4h7.1q3.2 0 3.2 3.2v8.4q0 3.2-3.2 3.2H${x}Z`} fill="#397493" stroke="#284f64" strokeWidth=".8"/><path d={`M${x+1} -6.2h8.2v12.4H${x+1}Z`} fill="#f4f8f5"/><path d={`M${x+7.2} -5.6h2.5v11.2h-2.5Z`} fill="#577e93"/><path d={`M${x+7.8} -4.7h1.2v3.1h-1.2Z`} fill="#b6d2dc"/><path d={`M${x+1.7} -6.2v1.6h4.3v-1.6m-4.3 12.4V4.6h4.3v1.6`} fill="#87acbb"/><path d={`M${x+10.4} -4.5v2m0 5v2`} stroke="#f4d37b" strokeWidth="1.2"/><path d={`M${x+6.2} -7.4v-1.1h2m-2 16v1.1h2`} fill="none" stroke="#344f5d" strokeWidth=".75" strokeLinecap="round"/></g>;
}
export function MapVehicleShape({kind='mixer'}){
  // Local +X is the cab direction. Only this group turns; the vehicle code stays level.
  return <g className={'v5-map-truck-shape '+kind} data-vehicle-kind={kind} role="img" aria-label={VEHICLE_NAMES[kind]}>
    <title>{VEHICLE_NAMES[kind]}</title>
    <MapTruckWheels axles={kind==='powder-tanker'?[-15,-8,14]:[-11,-4,14]}/>
    <path d="M-18-3H16V3H-18Z" fill="#526f7e"/>
    {kind==='mixer'?<g className="v5-map-mixer-drum">
      <path d="M-17-3.2-13-6.5-8-8H1Q7-7.5 8.5-3.9V3.9Q7 7.5 1 8H-8L-13 6.5-17 3.2Z" fill="#f4f7f3" stroke="#3e6a80" strokeWidth=".95"/>
      <path d="M-16 2.4-12 5.2-8 6.5H1Q5.9 6.1 7.4 3.1V4Q5.3 7.4.8 7.4H-8L-13 6-16 3Z" fill="#c9dadd"/>
      <path d="M-11-7Q-4-4-7 7M-3-8Q4-3.5 1 8" fill="none" stroke="#397493" strokeWidth="2.8"/>
      <path d="M-14-4.5-10-6.6M-5-6.7H-.8" stroke="#fff" strokeWidth="1.15" strokeLinecap="round"/>
      <path d="M-18-4.2-14-3V3L-18 4.2Z" fill="#93abb7" stroke="#3e6277" strokeWidth=".75"/>
      <path d="M-18-1.4H-23.5V1.4H-18Z" fill="#dce6e7" stroke="#4c6b7b" strokeWidth=".75"/>
      <path d="M-22.8-.8H-18.5" stroke="#8299a5" strokeWidth=".65"/>
    </g>:kind==='powder-tanker'?<g className="v5-map-powder-tank">
      <path d="M-20-3.5Q-19-7.6-14-7.6H3Q8-7.6 8.5-3.5V3.5Q8 7.6 3 7.6H-14Q-19 7.6-20 3.5Z" fill="#edf3ef" stroke="#3e6a80" strokeWidth=".95"/>
      <path d="M-19 3.7Q-17 6.5-14 6.5H3Q6.5 6.5 7.6 3.7V4.6Q5.8 7 3 7H-14Q-17.5 7-19 4.6Z" fill="#c4d7df"/>
      {[-12,-3,5].map(x=><g key={x}><path d={`M${x}-7.3V7.3`} stroke="#7298ac" strokeWidth="1.25"/><circle cx={x} cy="0" r="1.7" fill="#a3bac7" stroke="#688a9e" strokeWidth=".55"/></g>)}
      <path d="M-17-5.6H1" stroke="#fff" strokeWidth="1.2" strokeLinecap="round"/>
    </g>:<g className="v5-map-dump-bed">
      <rect x="-19" y="-7.6" width="27" height="15.2" rx="1.2" fill="#8eadbd" stroke="#3c657d" strokeWidth=".95"/>
      <path d="M-16.7-5.4H5.6V5.4H-16.7Z" fill="#c0b59a" stroke="#5f8194" strokeWidth=".7"/>
      <path d="M-15-1.3-10-4-5-2 0-3.7 4 .2.6 4-6 2.2-11 3.5Z" fill="#d4c8ab"/>
      <path d="M-17.9-6.6V6.6M7-6.6V6.6" stroke="#d4e1e4" strokeWidth=".8"/>
      <path d="M-18-4.5h1m-1 9h1" stroke="#edc779" strokeWidth="1"/>
    </g>}
    <MapTruckCab/>
  </g>;
}

const C={white:'#eef0ed',blue:'#397493',blueDark:'#2d607b',steel:'#a4b4ba',steelDark:'#768e99',yellow:'#d3ae46',sand:'#cbbb9b',stone:'#a0afb0',ground:'#dce5e2',road:'#c0ccd1',line:'#f6f7f3'};
const iso=(x,z,y=0)=>[110+(x-z)*1.7,76+(x+z)*.82-y*2.45];
const pts=a=>a.map(p=>p.join(',')).join(' ');
function Ground({x=0,z=0,w=54,d=40}){
  const top=[iso(x-w/2,z-d/2),iso(x+w/2,z-d/2),iso(x+w/2,z+d/2),iso(x-w/2,z+d/2)];
  return <><polygon points={pts(top.map(([a,b])=>[a,b+4]))} fill="#b7c8c9"/><polygon points={pts(top)} fill={C.ground} stroke="#bbcbd0" strokeWidth=".8"/></>;
}
function IsoBox({x=0,z=0,y=0,w=4,d=4,h=4,top=C.white,left=C.steel,right=C.blue}){
  const a=iso(x-w/2,z-d/2,y+h),b=iso(x+w/2,z-d/2,y+h),c=iso(x+w/2,z+d/2,y+h),e=iso(x-w/2,z+d/2,y+h);
  return <g stroke="#718996" strokeOpacity=".32" strokeWidth=".6" strokeLinejoin="round"><polygon points={pts([b,c,iso(x+w/2,z+d/2,y),iso(x+w/2,z-d/2,y)])} fill={right}/><polygon points={pts([c,e,iso(x-w/2,z+d/2,y),iso(x+w/2,z+d/2,y)])} fill={left}/><polygon points={pts([a,b,c,e])} fill={top}/></g>;
}
function IsoSilo({x,z,h=16,kind='cement'}){
  const [cx,ty]=iso(x,z,h),[,by]=iso(x,z,4.5),r=4.2;
  return <g><path d={`M${cx-r} ${ty}V${by}Q${cx} ${by+4.5} ${cx+r} ${by}V${ty}Z`} fill={C.white} stroke={C.steelDark} strokeWidth=".7"/><path d={`M${cx} ${ty+1.7}V${by+1.9}Q${cx+r} ${by+1.5} ${cx+r} ${by}V${ty}Z`} fill="#d9e3e5"/><ellipse cx={cx} cy={ty} rx={r} ry="1.9" fill="#f8faf7" stroke={C.steelDark} strokeWidth=".7"/>{[.33,.65].map(t=><path key={t} d={`M${cx-r} ${ty+(by-ty)*t}Q${cx} ${ty+(by-ty)*t+3.3} ${cx+r} ${ty+(by-ty)*t}`} fill="none" stroke={C.steel} strokeWidth=".6"/>)}<path d={`M${cx-r} ${by-7}Q${cx} ${by-3.7} ${cx+r} ${by-7}V${by-4.5}Q${cx} ${by-1.2} ${cx-r} ${by-4.5}Z`} fill={kind==='cement'?C.blue:'#9bb9c8'}/><path d={`M${cx-r} ${by}L${cx} ${by+5.5}L${cx+r} ${by}`} fill="#b7c7cc"/>{[-2.7,2.7].map(dx=><line key={dx} x1={cx+dx} y1={by+2} x2={cx+dx} y2={iso(x,z)[1]} stroke={C.steelDark} strokeWidth="1.2"/>)}<line x1={cx+r+1.4} y1={ty+1} x2={cx+r+1.4} y2={by+3} stroke={C.steelDark} strokeWidth=".7"/><rect x={cx-1.2} y={ty-3.4} width="2.4" height="3.3" rx=".7" fill={C.steel}/></g>;
}
function Pile({x,z,r=5,kind='sand'}){
  const [cx,cy]=iso(x,z),[tx,ty]=iso(x-.5,z-.4,3.1);
  return <g><ellipse cx={cx} cy={cy} rx={r*2.15} ry={r*.9} fill={kind==='sand'?'#bbaa88':'#8fa0a2'}/><path d={`M${cx-r*2.15} ${cy}Q${tx-5} ${ty-2} ${tx} ${ty}Q${tx+5} ${ty-1} ${cx+r*2.15} ${cy}Q${cx} ${cy+r*.8} ${cx-r*2.15} ${cy}`} fill={kind==='sand'?C.sand:C.stone}/>{kind!=='sand'&&[[-4,0],[3,1],[0,-3],[6,-2]].map(([a,b],i)=><path key={i} d={`m${cx+a} ${cy+b-2} 2-1 2 2-3 1Z`} fill="#899da2"/>)}</g>;
}
function IsoLine({points,stroke=C.steelDark,width=1.5,dash}){return <polyline points={pts(points.map(p=>iso(...p)))} fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash}/>;}
function Fence({w=54,d=40,x=0,z=0}){
  return <g><IsoLine points={[[x-w/2,z+d/2,1.2],[x-w/2,z-d/2,1.2],[x+w/2,z-d/2,1.2],[x+w/2,z+d/2,1.2]]} stroke="#a4b8bd" width="1"/>{[-1,0,1].map(t=><IsoLine key={t} points={[[x+t*w/2,z-d/2],[x+t*w/2,z-d/2,1.2]]} stroke="#9bafb5" width="1"/>)}</g>;
}
function SupplierOutline(){return <>
  <Ground z={-10} w={50} d={37}/><IsoBox x={0} z={1} w={48} d={7} h={.08} top={C.road} left={C.road} right={C.road}/><IsoLine points={[[-22,1,.1],[21,1,.1]]} stroke={C.line} width=".8" dash="4 4"/>
  <IsoBox x={15} z={-21} w={15} d={8} h={5.6} top={C.blue} left="#e5edeb" right="#c9d9df"/><IsoBox x={15} z={-16.8} y={.1} w={8} d={.1} h={3.8} top={C.steel} left={C.blueDark} right={C.blueDark}/>
  {[-13,-6,1].map((x,i)=><IsoSilo key={x} x={x} z={-21} h={13.5} kind={i===2?'flyash':'cement'}/>)}
  <Pile x={10} z={-7.8} r={4.8}/><Pile x={19} z={-7.8} r={4.8} kind="stone"/>
  {[-5.8,5.8].flatMap(x=>[-4.5,4.5].map(z=><IsoBox key={`${x}/${z}`} {...{x,z}} w={.5} d={.5} h={7.2} top={C.blue} left={C.blue} right={C.blue}/>))}
  <IsoBox z={-4.5} y={7.2} w={12} d={.6} h={.35} top={C.blue} left={C.blue} right={C.blue}/><IsoBox z={4.5} y={7.2} w={12} d={.6} h={.35} top={C.blue} left={C.blue} right={C.blue}/>
  <IsoLine points={[[10,-7.8,.9],[0,0,6.8]]} stroke={C.steelDark} width="5"/><IsoLine points={[[10,-7.8,1.2],[0,0,7.1]]} stroke="#647e89" width="2.7"/>
  <IsoBox x={-1} y={4.7} w={3} d={3} h={1.8} top={C.white} left={C.steel} right={C.blue}/><IsoBox x={-1} y={4.2} w={.7} d={.7} h={.7} top={C.steel} left={C.steel} right={C.steel}/>
  <IsoBox x={-18.5} z={-5.7} w={5.5} d={4.5} h={3.2} top={C.blue} left={C.white} right="#cedce1"/><Fence x={0} z={-10} w={50} d={37}/>
</>;}
function PlantOutline(){return <>
  <Ground x={-4.5} w={71} d={43}/><IsoBox x={-4.5} z={14.3} w={68} d={6} h={.05} top={C.road} left={C.road} right={C.road}/><IsoLine points={[[-34,14.3,.1],[26,14.3,.1]]} stroke={C.line} width="1" dash="4 4"/>
  <IsoBox x={WEST_LANE_X} z={-.5} w={8} d={35} h={.05} top={C.road} left={C.road} right={C.road}/><IsoBox x={WEIGHBRIDGE_LAYOUT.center[0]} z={26} w={8} d={28} h={.05} top={C.road} left={C.road} right={C.road}/>
  <IsoBox x={-16.6} z={-8.8} w={21} d={9.5} h={1.6} top="#c6d2d4" left={C.steel} right={C.steel}/>{[-23.4,-16.6,-9.8].map((x,i)=><Pile key={x} x={x} z={-8.8} r={2.6} kind={i===2?'stone':'sand'}/>)}
  <IsoBox x={-16.6} z={-8.8} y={5} w={22} d={10} h={.15} top="#a7c0ca" left={C.blueDark} right={C.blue}/>{[-26.8,-20,-13.2,-6.4].map(x=><IsoLine key={x} points={[[x,-4,0],[x,-4,5]]} stroke={C.steelDark} width="1.4"/>)}
  {[1.15,5.15,9.15,13.15].map((x,i)=><IsoSilo key={x} {...{x}} z={-8.9} h={16.5} kind={i<2?'cement':'flyash'}/>)}
  {AGGREGATE_BIN_X.map((x,i)=><g key={x}><IsoBox {...{x}} w={3.6} d={3} y={1.2} h={1.3} top={i===2?C.stone:C.sand} left={C.blueDark} right={C.blue}/><IsoLine points={[[x,0],[x,0,1.2]]} stroke={C.steelDark} width="1.5"/></g>)}
  <IsoLine points={[[-21,.1,.08],[-7.2,.1,.08]]} stroke={C.steel} width="4.5"/><IsoLine points={[[-7.2,.1,.08],[-4.4,0,.7],[8.6,3,11.6]]} stroke={C.blue} width="4.5"/><IsoLine points={[[-4.4,0,1],[8.6,3,11.85]]} stroke="#617b85" width="2.3"/>
  {[.28,.6].map(t=><IsoLine key={t} points={[[-4.4+13*t,3*t,0],[-4.4+13*t,3*t,.77+10.78*t]]} stroke={C.steelDark} width="1.2"/>)}
  {[-3.8,3.8].flatMap(x=>[-3.35,3.35].map(z=><IsoBox key={`${x}/${z}`} x={10.3+x} z={3+z} w={.45} d={.45} h={11} top={C.blue} left={C.blue} right={C.blue}/>))}
  <IsoBox x={10.3} z={3} y={5.8} w={7.5} d={6.3} h={3.7} top={C.steel} left={C.white} right="#c6d9e1"/><IsoBox x={10.3} z={3} y={9.7} w={8.4} d={7.1} h={.22} top={C.blue} left={C.blue} right={C.blue}/><IsoBox x={8.6} z={3} y={9.9} w={2.6} d={2.6} h={1.6} top={C.white} left={C.steel} right={C.steel}/>
  <IsoBox x={WEIGHBRIDGE_LAYOUT.center[0]} z={WEIGHBRIDGE_LAYOUT.center[2]} w={WEIGHBRIDGE_LAYOUT.width} d={WEIGHBRIDGE_LAYOUT.length} h={WEIGHBRIDGE_LAYOUT.surfaceY} top="#91aab4" left={C.steel} right={C.steel}/><IsoBox x={-18.2} z={ENTRY_CANOPY_Z-.6} w={3.4} d={3} h={2.6} top={C.blue} left={C.white} right="#cadae0"/><IsoBox x={9} z={19.6} w={10} d={5} h={3.8} top={C.blue} left={C.white} right="#cadae0"/><Fence x={-4.5} w={71} d={43}/>
</>;}
function SiteOutline(){return <>
  <Ground x={9} z={10} w={58} d={48}/><IsoBox x={3} z={-8} w={32} d={7} h={.05} top={C.road} left={C.road} right={C.road}/>
  {[-5,3,11].flatMap(x=>[0,8,16].map(z=><IsoBox key={`${x}/${z}`} {...{x,z}} w={5} d={5} h={.5} top="#c6d2d1" left={C.steel} right={C.steel}/>))}
  {[5,10,15,20].map(y=><g key={y}><IsoBox x={11} z={15} y={y} w={20} d={16} h={.3} top="#dee6e2" left={C.steel} right={C.steel}/>{[1,11,21].flatMap(x=>[7,15,23].map(z=><IsoBox key={`${x}/${z}`} {...{x,z}} y={y-5} w={.5} d={.5} h={5} top={C.steel} left={C.steelDark} right={C.steel}/>))}</g>)}
  <IsoLine points={[[29,5],[29,5,27],[29,5,27.5]]} stroke={C.yellow} width="2.5"/><IsoLine points={[[13,5,27],[36,5,27]]} stroke={C.yellow} width="2"/><IsoLine points={[[29,5,31],[13,5,27],[36,5,27],[29,5,31]]} stroke="#b99b4a" width=".8"/>
  <IsoBox x={-12} z={-3} w={11} d={5} h={3.2} top={C.blue} left={C.white} right="#c4d6dc"/>
  <IsoBox x={8} z={-11} y={.4} w={7} d={2.5} h={1} top={C.white} left={C.blue} right={C.blue}/><IsoBox x={10.7} z={-11} y={.4} w={1.8} d={2.5} h={1.8} top={C.white} left={C.blue} right={C.blue}/>
  <IsoLine points={[[7,-11,1.6],[10,-11,12],[15,1,16],[18,10,12],[12,15,10]]} stroke={C.yellow} width="2.4"/>{[[-6,-8],[0,-8],[6,-8]].map(([x,z],i)=><IsoLine key={i} points={[[x,z],[x,z,1.2]]} stroke={C.steelDark} width="1.3"/>)}<Fence x={9} z={10} w={58} d={48}/>
</>;}

const LOCATION_DEFS=[{id:'supplier',title:'原料厂家',sub:'备料 · 装料 · 发运',position:[-82,0,60],outline:React.memo(SupplierOutline)},{id:'plant',title:'一号搅拌站',sub:'入库 · 生产 · 装车',position:[0,0,-5],outline:React.memo(PlantOutline)},{id:'site',title:'南城建设工地',sub:'到车 · 泵送 · 签收',position:[106,0,106],outline:React.memo(SiteOutline)}];
export default function RegionMap({workflow={},onEnter,selectedLocationId,thumbnails,visualClock,showRoutes=true}){
  const marker=useRef(null),vehicleBody=useRef(null),inputs=useRef({workflow,visualClock});
  inputs.current={workflow,visualClock};
  // React may repaint from a slower UI snapshot. Restore live coordinates before paint.
  usePaintEffect(()=>{paintVehicle(marker.current,vehicleBody.current,inputs.current);});
  useEffect(()=>{
    if(!visualClock||typeof requestAnimationFrame!=='function')return;
    let frame,lastTime,lastScenario,cancelled=false;
    const update=()=>{
      if(cancelled)return;
      const clock=visualClock.current;
      if(clock&&(clock.time!==lastTime||clock.scenarioId!==lastScenario)){
        paintVehicle(marker.current,vehicleBody.current,inputs.current);
        lastTime=clock.time;lastScenario=clock.scenarioId;
      }
      frame=requestAnimationFrame(update);
    };
    frame=requestAnimationFrame(update);
    return()=>{cancelled=true;cancelAnimationFrame(frame);};
  },[visualClock]);
  const rawId=useId(),id='v5-region-'+rawId.replace(/[^a-zA-Z0-9_-]/g,''),P=projectWorld;
  const path=a=>a.map((p,i)=>(i?'L':'M')+P(p).join(',')).join(' '),concrete=workflow.flowKind==='concrete',vehiclePose=getMapVehiclePose(workflow);
  const route=workflow.routePoints?.length?workflow.routePoints:concrete?OUTBOUND_ROUTE:INBOUND_ROUTE;
  const vehicleCode=workflow.vehicleCode||'当前车辆',vehicleKind=getMapVehicleKind(workflow);
  const entering=location=>onEnter?.(location);
  return <section className="v5-region-map" aria-label="厂家、搅拌站与工地的运输总览">
    <div className="v5-map-heading"><div><strong>运输总览</strong><span>进入地点，查看现场与作业</span></div><span className="v5-map-current"><i/>{vehicleCode} · {workflow.vehicleStatus||workflow.phaseLabel||'待命'}</span></div>
    <svg className="v5-map-svg" viewBox="0 0 720 360" role="group" aria-label="三个地点与当前任务路线">
      <defs><pattern id={id+'-grid'} width="36" height="36" patternUnits="userSpaceOnUse"><path d="M36 0H0V36" fill="none" stroke="#d7e3e6" strokeWidth=".65"/></pattern><filter id={id+'-shadow'} x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#6e8997" floodOpacity=".13"/></filter></defs>
      <rect width="720" height="360" fill="#edf2f1"/><rect width="720" height="360" fill={'url(#'+id+'-grid)'}/>
      <path d="M0 319Q125 285 255 324T720 331" fill="none" stroke="#dce7dc" strokeWidth="37"/><path d="M530 0Q580 113 720 124" fill="none" stroke="#dfe9e6" strokeWidth="29"/>
      {[INBOUND_ROUTE,OUTBOUND_ROUTE].map((r,i)=><g key={i}><path d={path(r)} fill="none" stroke="#fafcf9" strokeWidth="21" strokeLinejoin="round"/><path d={path(r)} fill="none" stroke="#c7d5d9" strokeWidth="13" strokeLinejoin="round"/><path d={path(r)} fill="none" stroke="#edf4f2" strokeWidth="1.2" strokeDasharray="5 7"/></g>)}
      {showRoutes&&<path d={path(route)} className={'v5-task-route '+(concrete?'concrete':'raw')} fill="none" stroke={concrete?'#477f9b':'#b5964e'} strokeWidth="3.2" strokeLinejoin="round" strokeDasharray={workflow.isReturning?'6 5':undefined}/>}
      {LOCATION_DEFS.map(location=>{const [x,y]=P(location.position),Outline=location.outline,image=typeof thumbnails?.[location.id]==='string'?thumbnails[location.id]:thumbnails?.[location.id]?.url,selected=selectedLocationId===location.id;return <g key={location.id} className={'v5-location-entry'+(selected?' is-selected':'')} transform={`translate(${x-110} ${y-105})`} role="button" tabIndex="0" aria-label={`进入${location.title}，${location.sub}`} aria-pressed={selected} onClick={()=>entering(location.id)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();entering(location.id);}}}>
        <rect className="v5-entry-hit" x="5" y="-5" width="210" height="176" rx="18"/>
        <g className="v5-entry-model" filter={'url(#'+id+'-shadow)'}>{image?<image href={image} x="8" y="-5" width="204" height="138" preserveAspectRatio="xMidYMid meet"/>:<Outline/>}</g>
        <rect className="v5-entry-label-back" x="31" y="123" width="158" height="43" rx="9"/>
        <text className="v5-entry-title" x="110" y="139" textAnchor="middle">{location.title}<tspan className="v5-entry-chevron" dx="7">›</tspan></text><text className="v5-entry-subtitle" x="110" y="155" textAnchor="middle">{location.sub}</text>
      </g>;})}
      <g ref={marker} className="v5-map-vehicle" transform={vehiclePose.translation} aria-label={vehicleCode+'，'+VEHICLE_NAMES[vehicleKind]+'，'+(workflow.vehicleStatus||'当前车位')} pointerEvents="none">
        <g ref={vehicleBody} className="v5-map-vehicle-body" transform={vehiclePose.rotation}><MapVehicleShape kind={vehicleKind}/></g>
        <g className="v5-map-vehicle-label"><path d="M0-25V-30" fill="none" stroke="#63879a" strokeWidth=".8"/><rect x="-29" y="-48" width="58" height="18" rx="5" fill="#2d607b"/><text y="-35" textAnchor="middle" fill="#f6faf7" fontSize="10" fontWeight="600">{vehicleCode}</text></g>
      </g>
      <g className="v5-map-compass" transform="translate(674 31)"><path d="M0 7V-9m-4 5 4-5 4 5" fill="none" stroke="#8a9ea7" strokeWidth="1.3"/><text x="0" y="20" textAnchor="middle">示意</text></g>
    </svg>
    <div className="v5-map-footnote"><span><i className={concrete?'concrete':'raw'}/>{concrete?'混凝土配送':'原料运输'}任务路线</span><span>示意路线</span></div>
  </section>;
}
