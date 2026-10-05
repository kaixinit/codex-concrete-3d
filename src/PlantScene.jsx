import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Canvas, useFrame, useThree} from '@react-three/fiber';
import {OrbitControls} from '@react-three/drei/core/OrbitControls.js';
import * as THREE from 'three';
import LogisticsWorld from './LogisticsWorld';
import {getWorkflowState} from './workflow';
import {StaticInstances,RegionPreviewCapture,QualityRuntime,ObjectFeedback,VehicleContactGround} from './SceneRuntime';
import {SceneQualityProvider,useSceneQuality} from './SceneQuality.jsx';
import {qualityProfile,normalizeQuality} from './sceneQuality.js';
import {planCameraFlight} from './cameraSafety.js';
import {entityAncestor} from './sceneVisualRules.js';
import {getProductionAssetState} from './assetMotion.js';
import {WEIGHBRIDGE_LAYOUT,ENTRY_BARRIER_Z,ENTRY_CANOPY_Z,ENTRY_QUEUE_Z,WEST_LANE_X,AGGREGATE_BIN_X,AGGREGATE_BIN_Z,LOADER_PARK} from './stationLayout.js';
import ControlRoom from './ControlRoom';
import {SceneLabelProvider,SceneLabel} from './SceneLabels';
import {Box, Cylinder, Ball, Beam, Silo, AggregateShed, AggregateBins, Conveyor, MixerTower, ScrewConveyors, Weighbridge} from './IndustrialAssets';

const FixedSilo=React.memo(Silo),FixedShed=React.memo(AggregateShed),FixedBins=React.memo(AggregateBins);
const FixedConveyor=React.memo(Conveyor),FixedTower=React.memo(MixerTower),FixedScrews=React.memo(ScrewConveyors),FixedScale=React.memo(Weighbridge);
const INITIAL_CAMERA={position:[52,41,69],fov:37,near:.1,far:900};
const INITIAL_CONTROL_TARGET=[-5,3.5,6];

function Label({children,at,selected=false,small=false,role='entity',fault=false,priority=0}){
  return <SceneLabel {...{at,selected,small,role,fault,priority}}>{children}</SceneLabel>;
}
function Entity({id,at=[0,0,0],radius=3,markerAt=[0,0,0],selectedId,onSelect,label,labelY=4,permanentLabel=false,fault=false,children}){
  const selected=selectedId===id;
  return <group name={id} userData={{entityId:id,assetType:id.split('-')[0]}} position={at}
    onClick={event=>{event.stopPropagation();onSelect?.(entityAncestor(event.object)?.userData.entityId||id);}}
    onPointerOver={event=>{event.stopPropagation();}}
    onPointerOut={()=>{}}>
    {children}
    {(permanentLabel||selected||fault)&&label&&<Label at={[markerAt[0],labelY,markerAt[2]]} selected={selected} fault={fault} role={permanentLabel?'area':'entity'} priority={fault?90:permanentLabel?2:0}>{label}</Label>}
  </group>;
}

const Fence=React.memo(function Fence({from,to,gap}){
  const count=Math.ceil(Math.hypot(to[0]-from[0],to[1]-from[1])/2.4);
  return <StaticInstances name="perimeter-fence">{Array.from({length:count},(_,i)=>{
    const t=i/count,nt=(i+1)/count,x=THREE.MathUtils.lerp(from[0],to[0],t),z=THREE.MathUtils.lerp(from[1],to[1],t),nx=THREE.MathUtils.lerp(from[0],to[0],nt),nz=THREE.MathUtils.lerp(from[1],to[1],nt);
    if(gap&&gap((x+nx)/2,(z+nz)/2))return null;
    return <group key={i}><Box at={[x,.9,z]} size={[.065,1.8,.065]} mat="steel"/>{[.45,1.35].map(y=><Beam key={y} from={[x,y,z]} to={[nx,y,nz]} radius={.025}/>)}<Beam from={[x,.45,z]} to={[nx,1.35,nz]} radius={.014}/><Beam from={[x,1.35,z]} to={[nx,.45,nz]} radius={.014}/></group>;
  })}</StaticInstances>;
});
const Tree=React.memo(function Tree({at,scale=1}){
  return <group position={at} scale={scale} name="landscape-tree"><Cylinder at={[0,1.15,0]} top={.13} bottom={.18} height={2.3} mat="trunk" segments={8}/><Ball at={[0,2.75,0]} size={[1.25,1.38,1.16]} mat="leaf"/><Ball at={[.55,3.17,.22]} size={[.92,1.05,.95]} mat="leafLight"/><Ball at={[-.6,2.6,-.35]} size={[.85,.93,.86]} mat="leaf"/></group>;
});
const SiteGround=React.memo(function SiteGround({gateOpen=false}){
  return <StaticInstances name="station-platform-roads-and-entrances" exclude={['operable-entry-barrier']}>
    <Box at={[-4.5,-.38,0]} size={[73,.76,46]} mat="ground"/><Box at={[-4.5,-.02,0]} size={[71,.16,44]} mat="concrete"/>
    <Box at={[-4.5,.065,14.3]} size={[68,.055,7]} mat="asphalt"/><Box at={[-4.5,.065,-17.5]} size={[68,.055,6.2]} mat="asphalt"/>
    <Box at={[24,.065,-.5]} size={[6.3,.055,35]} mat="asphalt"/><Box name="clear-west-truck-bypass" at={[WEST_LANE_X,.065,-.5]} size={[8,.055,35]} mat="asphalt"/>
    <Box name="northwest-turning-ground" at={[-32.5,-.38,-21]} size={[17,.76,16]} mat="ground"/><Box at={[-32.5,-.02,-20.5]} size={[15,.16,15]} mat="concrete"/>
    <Box name="northwest-truck-turning-hardstand" at={[-32.5,.068,-18.2]} size={[14,.055,15.5]} mat="asphalt"/>
    <Box name="southwest-truck-turning-hardstand" at={[-30,.068,11.8]} size={[17,.055,11.8]} mat="asphalt"/>
    <Box name="off-route-loader-parking-hardstand" at={[LOADER_PARK[0],WEIGHBRIDGE_LAYOUT.surfaceY-.0275,LOADER_PARK[2]]} size={[9,.055,5.5]} mat="asphalt"/>
    {[-2.5,2.5].map(offset=><Box key={offset} at={[LOADER_PARK[0],WEIGHBRIDGE_LAYOUT.surfaceY+.004,LOADER_PARK[2]+offset]} size={[8.4,.008,.08]} mat="markings"/>)}
    <Box name="entry-weighing-forecourt-foundation" at={[-25,-.11,(14.3+ENTRY_QUEUE_Z)/2]} size={[11,.22,ENTRY_QUEUE_Z-14.3+3]} mat="concrete"/>
    <Box name="entry-through-weighing-road" at={[-25,.068,(14.3+ENTRY_QUEUE_Z)/2]} size={[8,.055,ENTRY_QUEUE_Z-14.3+3]} mat="asphalt"/><Box at={[29,.065,14.3]} size={[6,.055,7]} mat="asphalt"/>
    {[-28.35,-21.65].map(x=><Box key={x} at={[x,.099,(14.3+ENTRY_QUEUE_Z)/2]} size={[.08,.008,ENTRY_QUEUE_Z-14.3+3]} mat="markings"/>)}
    {Array.from({length:18},(_,i)=><group key={i}><Box at={[-27+i*3.1,.103,14.3]} size={[1.5,.02,.1]} mat="markings"/><Box at={[-27+i*3.1,.103,-17.5]} size={[1.5,.02,.1]} mat="markings"/></group>)}
    {Array.from({length:10},(_,i)=><Box key={i} at={[24,.103,-14.5+i*3]} size={[.1,.02,1.4]} mat="markings"/>)}
    {[-7,-2].map(x=><group key={x}><Box at={[x,.11,19.5]} size={[.08,.03,3.5]} mat="markings"/><Box at={[x+2.5,.11,21.2]} size={[5,.03,.08]} mat="markings"/></group>)}
    <Box at={[18.2,.13,-6.2]} size={[1.65,.24,12]} mat="concrete"/><Box at={[18.2,.27,-6.2]} size={[1.42,.035,11.5]} mat="grass"/>
    <Box at={[-14,.12,20]} size={[4.2,.22,2.8]} mat="concrete"/><Box at={[-14,.24,20]} size={[3.8,.04,2.45]} mat="grass"/>
    <Fence from={[-40,-28]} to={[-25,-28]}/><Fence from={[-25,-28]} to={[-25,-21.5]}/><Fence from={[-25,-21.5]} to={[30.5,-21.5]}/>
    <Fence from={[-40,21.5]} to={[30.5,21.5]} gap={x=>x< -20&&x> -30}/>
    <Fence from={[-40,-28]} to={[-40,21.5]}/><Fence from={[30.5,-21.5]} to={[30.5,21.5]} gap={(_,z)=>z>10&&z<18.5}/>
    <Fence from={[-30.5,21.5]} to={[-30.5,ENTRY_CANOPY_Z+1.2]}/><Fence from={[-20.5,21.5]} to={[-20.5,ENTRY_CANOPY_Z+1.2]}/>
    {[[-38.6,0,-6.2],[29,0,-19.6],[28.8,0,-9.5],[28.8,0,.5],[18.3,.28,-11],[18.3,.28,-5.5],[-14,.23,20],[22.5,0,20.1]].map((at,i)=><Tree key={i} at={at} scale={i>3?.8:1}/>)}
    <group name="entry-guard-house-and-hardstand" position={[-18.2,0,ENTRY_CANOPY_Z-.6]}>
      <Box at={[0,.005,0]} size={[4.2,.15,4]} mat="concrete"/>
      <Box at={[0,1.27,0]} size={[3.4,2.4,3]} mat="white"/><Box at={[0,2.58,0]} size={[3.7,.16,3.25]} mat="blue"/>
      <Box at={[0,1.75,1.54]} size={[2.7,.95,.045]} mat="glass"/><Box at={[-1.73,1.75,0]} size={[.045,.95,2]} mat="glass"/>
    </group>
    {[-29,-21].map(x=><Cylinder key={x} at={[x,2.95,ENTRY_CANOPY_Z]} top={.1} height={5.9} mat="steel"/>)}<Box at={[-25,6,ENTRY_CANOPY_Z]} size={[8.2,.17,.17]} mat="blue"/>
    <Box at={[-21.1,.95,ENTRY_BARRIER_Z]} size={[.4,1.9,.4]} mat="blue"/>
    <group name="operable-entry-barrier" position={[-21.1,1.5,ENTRY_BARRIER_Z]} rotation={[0,0,gateOpen?-Math.PI/2:0]}><Box at={[-3.15,0,0]} size={[6.3,.12,.12]} mat="markings"/>{[-.55,-1.55,-2.55,-3.55,-4.55,-5.55].map(x=><Box key={x} at={[x,0,0]} size={[.34,.124,.124]} mat="red"/>)}</group>
    <group name="recycled-water-tank-and-air-compressor"><Cylinder at={[18,1.7,6.3]} top={1.25} height={3.2} mat="paleBlue"/><Cylinder at={[18,3.37,6.3]} top={1.3} height={.12} mat="white"/><Beam from={[18,.65,6.3]} to={[16.7,.65,6.3]} radius={.08} mat="blue"/><Beam from={[16.7,.65,6.3]} to={[16.7,7.7,6.3]} radius={.08} mat="blue"/><Box at={[18.2,1,9]} size={[2.9,1.8,2.1]} mat="white"/><Box at={[18.2,1.15,10.07]} size={[2.45,1.1,.05]} mat="darkSteel"/>{Array.from({length:7},(_,i)=><Box key={i} at={[17.1+i*.35,1.15,10.11]} size={[.06,1.02,.02]} mat="steel"/>)}</group>
  </StaticInstances>;
});

const StationPlant=React.memo(function StationPlant({selectedId,onSelect,paused,faultActive,cutaway,phase,materialKind,delivered=0,powderFill=.65,conveyorActive=false,mixerActive=false,screwActive=false,gateOpen=false,regional=false,workflow,visualClock,visualState}){
  const common={selectedId,onSelect};
  const siloCutaway=id=>cutaway&&(!/^(cement|flyash)-/.test(selectedId)||selectedId===id);
  return <group name="station-industrial-process-assets">
    <SiteGround gateOpen={gateOpen}/>
    <Entity id="aggregate-a02" at={[-16.6,0,-8.8]} radius={10.8} label="砂石仓" labelY={5.85} permanentLabel={!regional} {...common}>
      <FixedShed visualState={visualState} materialKind={materialKind} delivered={delivered} selectedId={selectedId} onSelect={onSelect}/>
      {selectedId==='aggregate-sand'&&<Label at={[-6.8,3.68,4.56]} small selected>砂仓</Label>}
      {selectedId==='aggregate-stone'&&<Label at={[6.8,3.68,4.56]} small selected>石仓</Label>}
    </Entity>
    <Entity id="automatic-bins" radius={8.6} markerAt={[(AGGREGATE_BIN_X[0]+AGGREGATE_BIN_X[2])/2,0,AGGREGATE_BIN_Z]} label="自动配料仓" labelY={3.45} {...common}>
      <FixedBins {...{visualState,workflow,materialKind}} active={conveyorActive}/>
    </Entity>
    <Entity id="conveyor-b01" radius={3.2} markerAt={[-1,0,1.4]} label={faultActive?'输送带 · 异常':'输送带'} labelY={7.7} fault={faultActive} {...common}><FixedConveyor materialKind={materialKind} visualClock={visualClock} visualState={visualState} workflow={workflow} paused={paused} faultActive={faultActive} active={conveyorActive}/></Entity>
    <Entity id="cement-c01" at={[1.15,0,-8.9]} radius={2} label="C01 · 水泥" labelY={18.05} {...common}><FixedSilo kind="cement" code="C01" visualClock={visualClock} visualState={visualState} materialKind={materialKind} capacity={220} transferActive={workflow?.materialKind==='cement'&&workflow?.powderFlowActive} cutaway={siloCutaway("cement-c01")||materialKind==='cement'&&workflow?.stageName==='unloading'} fill={materialKind==='cement'?powderFill:.65}/></Entity>
    <Entity id="cement-c02" at={[5.15,0,-8.9]} radius={2} label="C02 · 水泥" labelY={18.05} {...common}><FixedSilo kind="cement" code="C02" cutaway={siloCutaway("cement-c02")}/></Entity>
    <Entity id="flyash-f01" at={[9.15,0,-8.9]} radius={2} label="F01 · 粉煤灰" labelY={18.05} {...common}><FixedSilo kind="flyash" code="F01" visualClock={visualClock} visualState={visualState} materialKind={materialKind} capacity={120} transferActive={workflow?.materialKind==='flyash'&&workflow?.powderFlowActive} cutaway={siloCutaway("flyash-f01")||materialKind==='flyash'&&workflow?.stageName==='unloading'} fill={materialKind==='flyash'?powderFill:.72}/></Entity>
    <Entity id="flyash-f02" at={[13.15,0,-8.9]} radius={2} label="F02 · 粉煤灰" labelY={18.05} {...common}><FixedSilo kind="flyash" code="F02" cutaway={siloCutaway("flyash-f02")}/></Entity>
    <FixedScrews cutaway={cutaway} visualClock={visualClock} visualState={visualState} workflow={workflow} active={screwActive} paused={paused} materialKind={materialKind}/>
    <Entity id="mixer-m01" at={[10.3,0,3]} radius={5.6} label="主楼" labelY={13.25} permanentLabel={!regional} {...common}><FixedTower onSelect={onSelect} visualClock={visualClock} visualState={visualState} workflow={workflow} paused={paused} active={mixerActive} cutaway={cutaway}/></Entity>
    {regional&&<Label at={[0,22,-1]} role="area" priority={5}>搅拌站</Label>}
    <Entity id="weighbridge-w01" at={WEIGHBRIDGE_LAYOUT.center} radius={7.3} label="地磅" labelY={3.35} {...common}><FixedScale/></Entity>
  </group>;
});

function LoadingMaterialStream({active,paused,visualClock,visualState,workflow}){
  const stream=useRef(),clock=useRef(0);
  useFrame((_,dt)=>{if(!stream.current)return;const mechanism=getProductionAssetState(visualState?.current||workflow);stream.current.visible=active&&mechanism.dischargeGate>.02&&mechanism.mixerFill>.005;if(!active)return;clock.current=visualClock?.current?.time??(paused?clock.current:clock.current+dt);stream.current.children.forEach((child,i)=>{child.position.y=4.22-((clock.current*.52+i*.035)%.24);});});
  if(!active)return null;
  return <group ref={stream} name="m01-to-mc012-loading-concrete-stream">{Array.from({length:8},(_,i)=><Ball key={i} at={[6.74,4.22-i*.03,3]} size={[.06,.075,.06]} mat="wetConcrete"/>)}</group>;
}
const CAMERA_VIEWS={
  overview:{position:[52,41,69],target:[-5,3.5,6]},
  materials:{position:[-36,25,29],target:[-12,3.3,-3]},
  delivery:{position:[34,21,32],target:[9,3.4,5]},
  detail:{position:[27,17,21],target:[9.3,7,1.5]},
  regional:{position:[36,195,258],target:[12,3,58]},
  region:{position:[36,195,258],target:[12,3,58]},
  powder:{position:[-23,25,-47],target:[5,7.5,-10]},
  site:{position:[63,38,63],target:[109,6,113]},
  supplier:{position:[-116,32,98],target:[-82,6,57]},
  control:{position:[19,9,31],target:[9,4.3,19.65]},
};
function useReducedMotion(){
  const [reduced,setReduced]=useState(()=>typeof window!=='undefined'&&window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useEffect(()=>{const query=window.matchMedia?.('(prefers-reduced-motion: reduce)');if(!query)return;const update=()=>setReduced(query.matches);update();query.addEventListener?.('change',update);return()=>query.removeEventListener?.('change',update);},[]);
  return reduced;
}
function CameraRig({view,materialKind,workflow,visualClock,visualState,focusId,focusRequest,onFocus,onManualControl,followRequest=0}){
  const {camera,size,scene,invalidate}=useThree(),controls=useRef(),transition=useRef(false),reduced=useReducedMotion();
  const goal=useRef({position:new THREE.Vector3(...CAMERA_VIEWS.overview.position),target:new THREE.Vector3(...CAMERA_VIEWS.overview.target)});
  const tracking=useRef(null),lastTrack=useRef(new THREE.Vector3()),scratch=useMemo(()=>({point:new THREE.Vector3(),direction:new THREE.Vector3(),box:new THREE.Box3(),sphere:new THREE.Sphere()}),[]);
  const callbacks=useRef({onFocus,onManualControl});callbacks.current={onFocus,onManualControl};
  const manual=useRef(false),manualKey=useRef(''),lastFollow=useRef(followRequest),flight=useRef([]);
  const requestId=typeof focusRequest==='object'&&focusRequest?focusRequest.id||focusId:focusId;
  const requestToken=typeof focusRequest==='object'&&focusRequest?focusRequest.requestId??focusRequest.nonce??0:focusRequest;
  const feedView=view==='materials'&&workflow?.flowKind==='aggregate'&&workflow?.stageName==='supply';
  const pickupView=view==='materials'&&workflow?.flowKind==='aggregate'&&workflow?.stageName==='loading';
  const weighingView=view==='materials'&&['registration','gross','acceptance','tare'].includes(workflow?.stageName);
  const detailShot=view==='detail'?workflow?.stageName==='loading'?'discharge':'metering':'';
  const moveTo=(position,target)=>{
    const boxes=[];
    for(const id of ['mixer-m01','control-room','aggregate-a02','cement-c01','cement-c02','flyash-f01','flyash-f02']){
      const object=scene.getObjectByName(id);if(!object)continue;object.updateWorldMatrix(true,true);scratch.box.setFromObject(object);
      if(!scratch.box.isEmpty())boxes.push({min:scratch.box.min.toArray(),max:scratch.box.max.toArray()});
    }
    flight.current=planCameraFlight(camera.position.toArray(),position.toArray(),boxes).map(point=>new THREE.Vector3(...point));
    goal.current.position.copy(position);goal.current.target.copy(target);transition.current=true;invalidate();
    if(reduced&&controls.current){camera.position.copy(position);controls.current.target.copy(target);controls.current.update();transition.current=false;}
  };
  useEffect(()=>{
    const explicitFollow=lastFollow.current!==followRequest;lastFollow.current=followRequest;
    const workKey=(workflow?.scenarioId||'')+'|'+view;
    if(manual.current&&manualKey.current===workKey&&!explicitFollow)return;
    manual.current=false;
    const regional=['regional','region'].includes(view),v=workflow?.vehiclePosition||[10.3,0,3];
    const binX=AGGREGATE_BIN_X[materialKind==='stone'?2:0];
    const bayX=materialKind==='stone'?-9.8:-23.4;
    const bridge=WEIGHBRIDGE_LAYOUT.center;
    const preset=view==='wash'?{position:[v[0]+16,13,v[2]+19],target:[v[0],2.2,v[2]]}:view==='vehicle'?{position:[v[0]+11,8,v[2]+11],target:[v[0]-1,2.2,v[2]]}:weighingView?{position:[bridge[0]+19,18,bridge[2]+22],target:[bridge[0],1.7,bridge[2]+4]}:feedView?{position:[binX-12,11,17],target:[binX+2,2.3,1.4]}:pickupView?{position:[bayX-12,13,12],target:[bayX,2,-4.2]}:detailShot==='discharge'?{position:[26,13,23],target:[9.3,5,2.4]}:CAMERA_VIEWS[view==='materials'&&['cement','flyash'].includes(materialKind)?'powder':view]||CAMERA_VIEWS.overview;
    const target=new THREE.Vector3(...preset.target),fit=regional?Math.max(1,1.6/(size.width/size.height)):Math.max(1,1.28/(size.width/size.height));
    const position=new THREE.Vector3(...preset.position).sub(target).multiplyScalar(fit).add(target);
    camera.fov=regional?40:37;camera.updateProjectionMatrix();
    // A phase update in the same work area does not undo the user's orbit.
    if(explicitFollow||position.distanceToSquared(goal.current.position)>.01||target.distanceToSquared(goal.current.target)>.01)moveTo(position,target);
    tracking.current=['vehicle','wash'].includes(view)?'vehicle':null;lastTrack.current.set(...v);
  },[view,materialKind,feedView,pickupView,weighingView,detailShot,workflow?.scenarioId,followRequest,camera,size.width,size.height,reduced]);
  useEffect(()=>{
    if(!requestId)return;
    manual.current=false;
    scene.updateMatrixWorld(true);
    const object=scene.getObjectByName(requestId);
    if(!object){callbacks.current.onFocus?.({id:requestId,found:false});return;}
    scratch.box.setFromObject(object);scratch.box.getBoundingSphere(scratch.sphere);
    const target=scratch.sphere.center.clone();
    if(!Number.isFinite(scratch.sphere.radius)||scratch.box.isEmpty()){object.getWorldPosition(target);target.y+=2;}
    const vertical=THREE.MathUtils.degToRad(camera.fov),horizontal=2*Math.atan(Math.tan(vertical/2)*(size.width/size.height));
    const distance=THREE.MathUtils.clamp(Math.max(2.7,scratch.sphere.radius)/Math.sin(Math.min(vertical,horizontal)/2)*1.18,11,210);
    if(/^(cement|flyash)-/.test(requestId))scratch.direction.set(-.58,.58,-1).normalize();
    else scratch.direction.copy(camera.position).sub(controls.current?.target||target).normalize();
    if(scratch.direction.y<.25)scratch.direction.set(1,.65,1).normalize();
    moveTo(target.clone().addScaledVector(scratch.direction,distance),target);
    tracking.current=requestId===workflow?.vehicleId?'vehicle':requestId==='loader-l01'?'loader':null;
    if(tracking.current)lastTrack.current.set(...(tracking.current==='loader'?workflow?.loaderPosition||[0,0,0]:workflow?.vehiclePosition||[0,0,0]));
    callbacks.current.onFocus?.({id:requestId,found:true});
  },[requestId,requestToken,scene,camera,size.width,size.height,reduced]);
  useFrame((_,dt)=>{
    if(!controls.current)return;
    if(tracking.current){
      const live=visualState?.current||workflow;
      const point=tracking.current==='loader'?live?.loaderPosition:live?.vehiclePosition;
      if(point){scratch.point.set(...point).sub(lastTrack.current);goal.current.position.add(scratch.point);goal.current.target.add(scratch.point);if(!transition.current){camera.position.add(scratch.point);controls.current.target.add(scratch.point);}else for(const waypoint of flight.current)waypoint.add(scratch.point);lastTrack.current.set(...point);}
    }
    if(transition.current){
      const alpha=reduced?1:1-Math.exp(-Math.min(dt,.1)*4.3),waypoint=flight.current[0]||goal.current.position;
      camera.position.lerp(waypoint,alpha);controls.current.target.lerp(goal.current.target,alpha);
      if(flight.current.length>1&&camera.position.distanceToSquared(waypoint)<.04)flight.current.shift();
      if(camera.position.distanceToSquared(goal.current.position)<.005&&controls.current.target.distanceToSquared(goal.current.target)<.003){camera.position.copy(goal.current.position);controls.current.target.copy(goal.current.target);transition.current=false;}
    }
    if(transition.current)invalidate();
  },-1.5);
  return <OrbitControls ref={controls} makeDefault target={INITIAL_CONTROL_TARGET} enableDamping={!reduced} dampingFactor={.08} minDistance={7} maxDistance={620} minPolarAngle={.13} maxPolarAngle={Math.PI*.47} onStart={()=>{
    transition.current=false;tracking.current=null;flight.current=[];manual.current=true;manualKey.current=(workflow?.scenarioId||'')+'|'+view;
    goal.current.position.copy(camera.position);goal.current.target.copy(controls.current.target);callbacks.current.onManualControl?.();
  }}/>
}
function ReadySignal({onReady,onSceneReady}){
  const {scene}=useThree(),callbacks=useRef({onReady,onSceneReady});callbacks.current={onReady,onSceneReady};
  useEffect(()=>{const frame=requestAnimationFrame(()=>{scene.updateMatrixWorld(true);callbacks.current.onSceneReady?.(scene);callbacks.current.onReady?.();});return()=>cancelAnimationFrame(frame);},[scene]);return null;
}

function PlantWorld(props){
  const {selectedId,onSelect,paused,view,showRoutes,faultActive,cutaway,workflow,onReady,onSceneReady,onControlAction,focusId,focusRequest,onFocus,onManualControl,followRequest,visualClock,visible,sampling,onPerformance,onThumbnails,quality,onEffectiveQuality,onQualityChange}=props;
  const profile=useSceneQuality();
  const visualState=useRef(workflow);
  useFrame(()=>{visualState.current=visualClock?.current?getWorkflowState(visualClock.current.scenarioId,visualClock.current.time):workflow;},-4);
  const requestedId=typeof focusRequest==='object'&&focusRequest?focusRequest.id||focusId:focusId;
  const isolatedVehicle=view==='vehicle'&&(!requestedId||requestedId===workflow?.vehicleId);
  const siteTarget=useMemo(()=>{const target=new THREE.Object3D();target.position.set(100,0,108);target.name='construction-sun-target';return target;},[]);
  const phase=workflow?.stageName||workflow?.phase?.key||(typeof workflow?.phase==='string'?workflow.phase:'');
  const conveyorActive=!faultActive&&((workflow?.flowKind==='aggregate'&&workflow?.supplyActive)||(workflow?.flowKind==='concrete'&&phase==='production'));
  const mixerActive=workflow?.flowKind==='concrete'&&(phase==='loading'||phase==='production'&&!faultActive);
  const screwActive=(workflow?.flowKind==='powder'&&workflow?.supplyActive)||(!faultActive&&workflow?.flowKind==='concrete'&&phase==='production');
  const gateOpen=workflow?.flowKind==='concrete'?['release','outbound','return','wash','complete'].includes(phase):!!phase&&!['supplier_loading','arrival','complete'].includes(phase)&&(phase!=='registration'||workflow?.phaseProgress>.4);
  const powderFill=workflow?.flowKind==='powder'?Math.min(1,(workflow.initialStock+workflow.net*(workflow.unloadProgress||0)-(workflow.materialConsumed||0))/(workflow.materialKind==='cement'?220:120)):.65;
  return <>
    <color attach="background" args={['#edf1f2']}/><fog attach="fog" args={['#edf1f2',320,740]}/>
    <ambientLight intensity={.48}/><hemisphereLight args={['#edf3f8','#9aa397',1.35]}/>
    <directionalLight name="station-soft-sun" position={[-18,38,22]} intensity={2.1} color="#fff7eb" castShadow={profile.shadows&&visible&&!['site','supplier','vehicle'].includes(view)} shadow-mapSize={[profile.shadowMapSize,profile.shadowMapSize]} shadow-camera-left={-43} shadow-camera-right={43} shadow-camera-top={39} shadow-camera-bottom={-39} shadow-camera-near={1} shadow-camera-far={110} shadow-normalBias={.04} shadow-bias={-.00008} shadow-radius={3}/>
    <primitive object={siteTarget}/><directionalLight name="construction-soft-sun" target={siteTarget} position={[75,58,145]} intensity={.72} color="#e6edf4" castShadow={profile.shadows&&visible&&['site','regional','region'].includes(view)} shadow-mapSize={[profile.siteShadowMapSize,profile.siteShadowMapSize]} shadow-camera-left={-31} shadow-camera-right={31} shadow-camera-top={31} shadow-camera-bottom={-31} shadow-camera-near={1} shadow-camera-far={125} shadow-normalBias={.05} shadow-radius={3}/>
    <group name="concrete-batching-plant" userData={{modelVersion:'6.0',units:'metres',description:'Integrated batching line with aggregate bins, belt, adjacent silos, control room and manufacturer-to-site workflow. All data are simulated.'}} dispose={null}>
      <group visible={!isolatedVehicle&&!['supplier','site'].includes(view)}><StationPlant {...{selectedId,onSelect,paused,faultActive,cutaway,phase,conveyorActive,mixerActive,screwActive,gateOpen,powderFill,workflow,visualClock,visualState}} regional={['regional','region'].includes(view)} materialKind={workflow?.materialKind||'sand'} delivered={workflow?.flowKind==='aggregate'?(workflow?.unloadProgress||0)*(1-(workflow.materialConsumed||0)/(workflow.net||1)):0}/></group>
      <LogisticsWorld {...{selectedId,onSelect,paused,view,showRoutes,faultActive,cutaway,workflow,isolatedVehicle,visualClock,visualState}}/>
      <group visible={!isolatedVehicle&&!['supplier','site'].includes(view)}><ControlRoom {...{selectedId,onSelect,paused,workflow}} cutaway={view==='control'&&cutaway} onAction={onControlAction}/></group>
      <LoadingMaterialStream active={phase==='loading'&&workflow?.flowKind==='concrete'} paused={paused} visualClock={visualClock} visualState={visualState} workflow={workflow}/>
      {isolatedVehicle&&<VehicleContactGround visualState={visualState} workflow={workflow}/>}
    </group>
    <QualityRuntime requested={quality} {...{paused,visible,sampling,onPerformance,onQualityChange,view,cutaway}} onEffectiveChange={onEffectiveQuality}/>
    <ObjectFeedback {...{selectedId,visible,view,cutaway}}/><RegionPreviewCapture onThumbnails={onThumbnails}/>
    <CameraRig {...{view,workflow,visualClock,visualState,focusId,focusRequest,onFocus,onManualControl,followRequest}} materialKind={workflow?.materialKind}/><ReadySignal onReady={onReady} onSceneReady={onSceneReady}/>
  </>;
}

export default function PlantScene({selectedId='mixer-m01',onSelect,paused=false,view='overview',showRoutes=true,faultActive=false,cutaway=false,workflow,onReady,onSceneReady,onControlAction,focusId,focusRequest=0,onFocus,onManualControl,followRequest=0,quality='auto',onQualityChange,labelReservedRects=[],visible=true,visualClock,sampling=false,onPerformance,onThumbnails,renderController=null,captureDpr}){
  const requested=normalizeQuality(quality),[effectiveQuality,setEffectiveQuality]=useState(requested==='auto'?'balanced':requested);
  useEffect(()=>{setEffectiveQuality(requested==='auto'?'balanced':requested);},[requested]);
  const profile=qualityProfile(effectiveQuality);
  return <Canvas frameloop={!visible?'never':paused&&!sampling?'demand':'always'} shadows={profile.shadows} dpr={captureDpr??[.65,profile.dprMax]} camera={INITIAL_CAMERA}
    gl={{antialias:true,alpha:false,powerPreference:'high-performance',toneMapping:THREE.ACESFilmicToneMapping,toneMappingExposure:1.02}}
    style={{width:'100%',height:'100%',touchAction:'none'}}>
    <SceneQualityProvider value={profile}><SceneLabelProvider view={view} visible={visible} cutaway={cutaway} reservedRects={labelReservedRects}>
      <PlantWorld {...{selectedId,onSelect,paused,view,showRoutes,faultActive,cutaway,workflow,onReady,onSceneReady,onControlAction,focusId,focusRequest,onFocus,onManualControl,followRequest,visualClock,visible,sampling,onPerformance,onThumbnails,onQualityChange}} quality={requested} onEffectiveQuality={setEffectiveQuality}/>
      {renderController}
    </SceneLabelProvider></SceneQualityProvider>
  </Canvas>;
}

