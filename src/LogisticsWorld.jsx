import React, { createContext, useContext, memo, useEffect, useMemo, useRef } from 'react';
import {useFrame} from '@react-three/fiber';
import { SceneLabel } from './SceneLabels';
import * as THREE from 'three';
import { MixerTruck, PowderTruck, DumpTruck, Loader, MaterialPile } from './IndustrialAssets.jsx';
import { getWorkflowState, getRawUnloadRoute, OUTBOUND_ROUTE, INBOUND_ROUTE } from './workflow.js';
import {visualTime,loaderLipLocal} from './visualTime.js';
import {chuteDischargeLipLocal} from './assetMotion.js';
import {AGGREGATE_BIN_X} from './stationLayout.js';

// All coordinates are illustrative metres. Motion consumes the business clock;
// no vehicle follows an independent loop or advances while the clock is paused.
const palette = {
  road: ['#8c9ba2', 0.02, 0.96], earth: ['#d6ccb8', 0, 1], landscape: ['#d7dfd1', 0, 1],
  meadow: ['#cbd6c3', 0, 1], leaf: ['#a6b996', 0, .98], trunk: ['#9b9284', 0, .97],
  concrete: ['#cbd1d0', 0, 0.93], white: ['#eef0ed', 0.07, 0.65], blue: ['#397493', 0.12, 0.6],
  steel: ['#8a98a0', 0.42, 0.52], dark: ['#435660', 0.32, 0.6], yellow: ['#dab34c', 0.1, 0.6],
  red: ['#cc6553', 0.1, 0.65], green: ['#4da582', 0.04, 0.55], glass: ['#38718a', 0.27, 0.25],
  timber: ['#a78a64', 0, 0.93], rebar: ['#776a5f', 0.42, 0.62], sand: ['#cbb589', 0, 1],
  gravel: ['#9da7a9', 0, 0.94], stone: ['#8d999c',0,.96], cement: ['#d5dad7', 0, 0.92], flyash: ['#abb4b6', 0, 0.95],
  route: ['#378cdb', 0.08, 0.46], routeRaw: ['#d9963d', 0.08, 0.46], routeConcrete: ['#3488df', 0.08, 0.46],
  planRaw: ['#dcba85', 0, 0.8], planConcrete: ['#9abbdc', 0, 0.8],
  markings: ['#f6f7ef', 0, 0.88], hose: ['#384b58', 0.1, 0.8],
};
const materials = Object.fromEntries(Object.entries(palette).map(([name, [color, metalness, roughness]]) =>
  [name, new THREE.MeshStandardMaterial({ color, metalness, roughness })]));
materials.flowHose = new THREE.MeshStandardMaterial({ color: '#405965', metalness: 0.1, roughness: 0.65, transparent: true, opacity: 0.42, depthWrite: false });
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const sphereGeometry = new THREE.SphereGeometry(1, 12, 8);
const gravelGeometry = new THREE.DodecahedronGeometry(1, 0);
const cylinderCache = new Map();
const up = new THREE.Vector3(0, 1, 0);
const clamp = value => THREE.MathUtils.clamp(Number(value) || 0, 0, 1);
const WorldViewContext=createContext('overview');
const WorkflowFrameContext=createContext(null);

function cylinder(top, bottom, height, segments = 16) {
  const key = `${top}/${bottom}/${segments}`;
  if (!cylinderCache.has(key)) cylinderCache.set(key, new THREE.CylinderGeometry(top, bottom, 1, segments));
  return cylinderCache.get(key);
}
function Box({ at = [0, 0, 0], size = [1, 1, 1], mat = 'white', rotation, ...props }) {
  return <mesh geometry={boxGeometry} material={materials[mat]} position={at} scale={size} rotation={rotation} castShadow receiveShadow {...props} />;
}
function Cylinder({ at = [0, 0, 0], top = 1, bottom = top, height = 1, mat = 'steel', rotation, segments = 16 }) {
  return <mesh geometry={cylinder(top, bottom, 1, segments)} material={materials[mat]} position={at} scale={[1,height,1]} rotation={rotation} castShadow receiveShadow />;
}
function Ball({ at, size = [0.12, 0.12, 0.12], mat = 'cement' }) {
  return <mesh geometry={sphereGeometry} material={materials[mat]} position={at} scale={size} castShadow />;
}
function Beam({ from, to, radius = 0.055, mat = 'steel' }) {
  const transform = useMemo(() => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), vector = b.clone().sub(a);
    return { midpoint: a.add(b).multiplyScalar(0.5), length: vector.length(), quaternion: new THREE.Quaternion().setFromUnitVectors(up, vector.normalize()) };
  }, [from.join(','), to.join(',')]);
  return <mesh position={transform.midpoint} quaternion={transform.quaternion} scale={[radius,transform.length,radius]} geometry={cylinder(1,1,1,8)} material={materials[mat]} castShadow receiveShadow />;
}
function Label({ at, children, selected = false, large = false, active=false, role=large?'area':'entity', priority=large?5:0 }) {
  const view=useContext(WorldViewContext);
  if(['regional','region'].includes(view)&&!large&&!selected&&!active)return null;
  return <SceneLabel {...{at,selected,active,role,priority}} small={!large}>{children}</SceneLabel>;
}
function Entity({ id, at = [0, 0, 0], yaw = 0, selectedId, onSelect, radius = 5, children, motion }) {
  const selected = id === selectedId;
  const group=useRef(),frame=useContext(WorkflowFrameContext);
  useFrame(()=>{if(!motion||!group.current||!frame?.current)return;const s=frame.current,p=motion==='loader'?s.loaderPosition:s.vehiclePosition;group.current.position.set(...p);group.current.rotation.y=(motion==='loader'?s.loaderYaw:s.vehicleYaw)||0;},-2);
  return <group ref={group} name={id} position={at} rotation={[0, yaw, 0]} userData={{ entityId: id }}
    onClick={event => { event.stopPropagation(); onSelect?.(id); }}
    onPointerOver={event => { event.stopPropagation(); }}>
    {children}
    {selected && !motion && <mesh name={`${id}-selection`} userData={{uiOnly:true}} position={[0, 0.15, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[radius - 0.09, radius + 0.09, 48]} />
      <meshStandardMaterial color="#2f8de7" emissive="#246caf" emissiveIntensity={0.22} transparent opacity={0.9} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>}
  </group>;
}

function RoadSegment({ from, to, width = 9, gate = false }) {
  const dx = to[0] - from[0], dz = to[1] - from[1];
  const length = Math.hypot(dx, dz), angle = -Math.atan2(dz, dx);
  const count = Math.floor(length / 7.5);
  return <group position={[(from[0] + to[0]) / 2, 0, (from[1] + to[1]) / 2]} rotation={[0, angle, 0]} name="business-road-segment">
    <Box at={[0, 0.0125, 0]} size={[length + width, 0.13, width]} mat="road" />
    {[-1, 1].map(side => <group key={side}>
      <Box at={[0, 0.025, side * (width / 2 + 0.16)]} size={[length, 0.18, 0.3]} mat="concrete" />
      <Box at={[0, 0.085, side * (width / 2 - 0.28)]} size={[length, 0.008, 0.08]} mat="markings" />
    </group>)}
    {!gate && Array.from({ length: count }, (_, i) => <Box key={i} at={[-length / 2 + 3.7 + i * 7.5, 0.085, 0]} size={[3.2, 0.008, 0.11]} mat="markings" />)}
  </group>;
}
function StreetLamp({ at, yaw = 0 }) {
  return <group position={at} rotation={[0, yaw, 0]}>
    <Cylinder at={[0, 3.5, 0]} top={0.065} bottom={0.1} height={7} mat="steel" />
    <Beam from={[0, 6.9, 0]} to={[1.3, 7.35, 0]} radius={0.07} />
    <Box at={[1.35, 7.35, 0]} size={[0.75, 0.11, 0.32]} mat="white" />
    <Box at={[0, 0.17, 0]} size={[0.43, 0.34, 0.43]} mat="concrete" />
  </group>;
}
function RouteTrace({ points = [], planned = false, concrete = false }) {
  if (points.length < 2) return null;
  const mat=planned?(concrete?'planConcrete':'planRaw'):(concrete?'routeConcrete':'routeRaw');
  return <group name={planned?'planned-task-route':'completed-task-route'} userData={{ routeType: planned?'planned-route':'business-stage-trace', flowKind:concrete?'concrete':'raw' }}>
    {points.slice(1).map((point, i) => {
      const previous = points[i];
      const length=Math.hypot(point[0] - previous[0], point[2] - previous[2]);
      if (length < 0.05) return null;
      if(!planned)return <Beam key={i} from={[previous[0], 0.21, previous[2]]} to={[point[0], 0.21, point[2]]} radius={0.085} mat={mat} />;
      return <group key={i}>{Array.from({length:Math.ceil(length/4.3)},(_,part)=>{
        const a=Math.min(part*4.3/length,1),b=Math.min((part*4.3+2.3)/length,1);
        const at=t=>[THREE.MathUtils.lerp(previous[0],point[0],t),0.16,THREE.MathUtils.lerp(previous[2],point[2],t)];
        return <Beam key={part} from={at(a)} to={at(b)} radius={0.045} mat={mat}/>;
      })}</group>;
    })}
  </group>;
}
function completedStageRoute(state) {
  // The same sampled journey drives the truck and its trail, including the
  // forecourt turns and the independent outbound weighing pass.
  return getWorkflowState(state.scenarioId||'delivery',state.time||0).completedRoutePoints||[];
}
function LiveRouteTrace({concrete=false}){
  const frame=useContext(WorkflowFrameContext),mesh=useRef();
  const capacity=1024;
  const scratch=useMemo(()=>({a:new THREE.Vector3(),b:new THREE.Vector3(),d:new THREE.Vector3(),direction:new THREE.Vector3(),dummy:new THREE.Object3D()}),[]);
  useFrame(()=>{const s=frame?.current;if(!s||!mesh.current)return;const points=s.completedRoutePoints||completedStageRoute(s),segments=Math.max(0,points.length-1);mesh.current.count=Math.min(capacity,segments);for(let i=0;i<mesh.current.count;i++){
    const first=Math.floor(i*segments/mesh.current.count),next=Math.floor((i+1)*segments/mesh.current.count);
    scratch.a.set(...points[first]);scratch.b.set(...(next===segments&&!s.completedRoutePoints?s.vehiclePosition:points[next]));scratch.a.y=.21;scratch.b.y=.21;scratch.d.subVectors(scratch.b,scratch.a);const length=scratch.d.length();
    scratch.dummy.position.copy(scratch.a).addScaledVector(scratch.d,.5);scratch.direction.copy(scratch.d).normalize();scratch.dummy.quaternion.setFromUnitVectors(up,scratch.direction);scratch.dummy.scale.set(.072,length,.072);scratch.dummy.updateMatrix();mesh.current.setMatrixAt(i,scratch.dummy.matrix);
  }mesh.current.instanceMatrix.needsUpdate=true;});
  return <instancedMesh ref={mesh} name="completed-task-route" userData={{routeType:'business-stage-trace'}} args={[cylinder(1,1,1,8),materials[concrete?'routeConcrete':'routeRaw'],capacity]} frustumCulled={false} castShadow={false} receiveShadow={false}/>;
}
function RoadNetwork() {
  return <group name="supplier-plant-construction-road-network" userData={{ units: 'metres', geometryRole: 'illustrative-road-layout' }}>
    <Box at={[8, -0.31, 91]} size={[254, 0.48, 147]} mat="landscape" />
    <group name="regional-landscape-tonal-zones">
      <Box at={[5,-.052,102]} size={[112,.025,40]} mat="meadow"/>
      <Box at={[30,-.052,149]} size={[140,.025,21]} mat="meadow"/>
      {[[-58,69],[-40,72],[-6,72],[33,71],[59,70],[77,73],[85,91],[-10,142],[44,139]].map(([x,z])=><group key={`${x}:${z}`} position={[x,0,z]}>
        <Cylinder at={[0,.7,0]} top={.1} height={1.4} mat="trunk" segments={8}/>
        <Ball at={[0,1.8,0]} size={[1.02,1.2,.96]} mat="leaf"/>
      </group>)}
    </group>
    <RoadSegment from={[-88, 60]} to={[100, 60]} />
    <RoadSegment from={[-25, 24]} to={[-25, 60]} gate />
    <RoadSegment from={[100, 60]} to={[100, 98]} gate />
    <Box at={[-25, 0.026, 60]} size={[11, 0.02, 11]} mat="road" />
    <Box at={[100, 0.026, 60]} size={[11, 0.02, 11]} mat="road" />
    {[[-52, 0, 66], [-4, 0, 66], [42, 0, 66], [85, 0, 66], [106, 0, 82]].map((at, i) => <StreetLamp key={i} at={at} yaw={i === 4 ? Math.PI / 2 : -Math.PI / 2} />)}
    <group position={[-34, 0, 54]}>
      <Cylinder at={[0, 2.25, 0]} top={0.055} height={4.5} />
      <Box at={[0, 4.1, 0]} size={[4.1, 1.4, 0.1]} mat="blue" />
    </group>
    <group position={[91, 0, 67]}>
      <Cylinder at={[0, 1.8, 0]} top={0.05} height={3.6} />
      <Box at={[0, 3.3, 0]} size={[2.8, 1.1, 0.12]} mat="blue" />
    </group>
  </group>;
}

function Pile({ at, scale = [1, 1, 1], mat = 'gravel' }) {
  return <group position={at} scale={scale}>
    <mesh geometry={sphereGeometry} material={materials[mat]} position={[0, 0.18, 0]} scale={[2.8, 1.8, 2.3]} castShadow receiveShadow />
    {[[-1.8, 0.35, -0.8], [1.7, 0.4, 0.4], [-0.5, 0.4, 1.7], [0.6, 0.3, -1.6]].map((p, i) => <mesh key={i} geometry={gravelGeometry} material={materials[mat]} position={p} scale={[0.65, 0.48, 0.55]} castShadow />)}
  </group>;
}
function SupplierAggregateBelt() {
  const from=[12,1.35,-7.8],to=[-1.4,7.65,0];
  const frame=useMemo(()=>{
    const a=new THREE.Vector3(...from),b=new THREE.Vector3(...to),delta=b.clone().sub(a);
    return {at:a.add(b).multiplyScalar(.5),length:delta.length(),quaternion:new THREE.Quaternion().setFromUnitVectors(up,delta.normalize())};
  },[]);
  return <group name="supplier-aggregate-inclined-loading-conveyor">
    <Box at={frame.at} quaternion={frame.quaternion} size={[1.2,frame.length,.12]} mat="dark"/>
    {[-.68,.68].map(z=><Beam key={z} from={[from[0],from[1]-.15,from[2]+z]} to={[to[0],to[1]-.15,to[2]+z]} radius={.07} mat="blue"/>)}
    {Array.from({length:10},(_,i)=>{const p=i/9,x=THREE.MathUtils.lerp(from[0],to[0],p),y=THREE.MathUtils.lerp(from[1],to[1],p),z=THREE.MathUtils.lerp(from[2],to[2],p);return <Beam key={i} from={[x,y-.13,z-.7]} to={[x,y-.13,z+.7]} radius={.075}/>;})}
    {[.2,.6,.88].map(p=>{const x=THREE.MathUtils.lerp(from[0],to[0],p),y=THREE.MathUtils.lerp(from[1],to[1],p),z=THREE.MathUtils.lerp(from[2],to[2],p);return <group key={p}><Beam from={[x,.1,z-.6]} to={[x,y-.15,z-.6]} radius={.08} mat="blue"/><Beam from={[x,.1,z+.6]} to={[x,y-.15,z+.6]} radius={.08} mat="blue"/></group>;})}
    <Cylinder at={from} top={.23} height={1.4} rotation={[Math.PI/2,0,0]} mat="steel"/>
    <Box at={[12,.6,-7.8]} size={[2.2,1.1,1.9]} mat="steel"/>
  </group>;
}
function SupplierYard({ selectedId, onSelect, materialKind }) {
  const isPowder=['cement','flyash'].includes(materialKind),powderX=materialKind==='flyash'?1:-6;
  return <Entity id="supplier-yard" at={[-82, 0, 60]} selectedId={selectedId} onSelect={onSelect} radius={15}>
    <group name="raw-material-supplier-loading-yard">
      <Box at={[0, -0.015, -12]} size={[48, 0.16, 36]} mat="earth" />
      <Box at={[0, 0.08, 0]} size={[16, 0.1, 10]} mat="concrete" />
      {[-13, -6, 1].map((x, i) => <group key={x} position={[x, 0, -21]}>
        {[-1.2, 1.2].map(z => <Box key={z} at={[0, 2.25, z]} size={[0.13, 4.5, 0.13]} mat="blue" />)}
        <Cylinder at={[0, 4.2, 0]} top={1.9} bottom={0.34} height={2.4} mat="white" />
        <Cylinder at={[0, 9.35, 0]} top={1.9} height={8} mat={i === 2 ? 'blue' : 'white'} segments={24} />
        <Cylinder at={[0, 13.48, 0]} top={0.9} bottom={1.9} height={0.4} mat="white" />
        <Beam from={[0, 3.2, 0]} to={[0, 3.2, 12.5]} radius={0.18} />
        <Beam from={[0, 3.2, 12.5]} to={[0, 6.15, 12.5]} radius={0.18} />
      </group>)}
      <Box at={[15, 2.85, -20]} size={[15, 5.7, 8]} mat="white" />
      <Box at={[15, 5.78, -20]} size={[16, 0.2, 9]} mat="blue" />
      <Box at={[14, 2.15, -15.94]} size={[9, 3.8, 0.08]} mat="dark" />
      <Box at={[21.3, 3.55, -15.9]} size={[2.2, 1.2, 0.08]} mat="glass" />
      <Pile at={[10, 0.15, -7.8]} mat="sand" scale={[1.5, 1.15, 1.12]} />
      <Pile at={[19, 0.15, -7.8]} mat="gravel" scale={[1.45, 1.23, 1.12]} />
      {[-5.8, 5.8].flatMap(x => [-4.5, 4.5].map(z => <Box key={`${x}/${z}`} at={[x, 3.6, z]} size={[0.21, 7.2, 0.21]} mat="blue" />))}
      {[-4.7,4.7].map(z=><Box key={z} at={[0,7.35,z]} size={[13.1,.25,.22]} mat="blue"/>)}
      {[-6.2,6.2].map(x=><Box key={x} at={[x,7.35,0]} size={[.22,.25,9.5]} mat="blue"/>)}
      {isPowder?<group name="supplier-powder-tanker-loading-header">
        <Beam from={[powderX,6.15,-8.5]} to={[-1.1,6.15,-8.5]} radius={.18} mat="steel"/>
        <Beam from={[-1.1,6.15,-8.5]} to={[-1.1,6.15,0]} radius={.18} mat="steel"/>
        <Beam from={[-1.1,6.15,0]} to={[-1.1,4.2,0]} radius={.14} mat="steel"/>
        <Cylinder at={[-1.1,4.2,0]} top={.21} height={.18} mat="blue"/>
        <Box at={[-1.1,5.9,0]} size={[.6,.65,.58]} mat="blue"/>
      </group>:<group name="supplier-gravity-aggregate-loading-hopper">
        <SupplierAggregateBelt/>
        <Cylinder at={[-1.4,6.1,0]} top={1.7} bottom={.23} height={2.2} mat="steel"/>
        <Cylinder at={[-1.4,4.68,0]} top={.22} height={.68} mat="dark"/>
        <Box at={[-1.4,4.53,0]} size={[.67,.12,.62]} mat="blue"/>
        <Box at={[-2.0,4.62,0]} size={[.36,.45,.38]} mat="steel"/>
      </group>}
      <Box at={[-18.5, 1.6, -5.7]} size={[5.5, 3.2, 4.5]} mat="white" />
      <Box at={[-18.5, 3.3, -5.7]} size={[6, 0.17, 5]} mat="blue" />
      <Label at={[-1, 15.5, -16]} large selected={selectedId==='supplier-yard'}>原料厂家</Label>
    </group>
  </Entity>;
}

function Scaffold({ x, z, alongX = true, length = 22, height = 15.7 }) {
  const count = Math.round(length / 3.2);
  const point = (offset, y, depth = 0) => alongX ? [x + offset, y, z + depth] : [x + depth, y, z + offset];
  return <group name="external-construction-scaffolding">
    {Array.from({ length: count + 1 }, (_, i) => <group key={i}>
      <Beam from={point(i * length / count, 0.3)} to={point(i * length / count, height)} radius={0.038} />
      <Beam from={point(i * length / count, 0.3, 0.85)} to={point(i * length / count, height, 0.85)} radius={0.032} />
    </group>)}
    {[3.15, 6.35, 9.55, 12.75, 15.5].map(y => <group key={y}>
      <Beam from={point(0, y)} to={point(length, y)} radius={0.035} />
      <Beam from={point(0, y + 0.8)} to={point(length, y + 0.8)} radius={0.029} mat="yellow" />
      <Box at={point(length / 2, y - 0.12, 0.43)} size={alongX ? [length, 0.09, 0.95] : [0.95, 0.09, length]} mat="timber" />
    </group>)}
    {Array.from({ length: count }, (_, i) => <Beam key={i} from={point(i * length / count, 0.4)} to={point((i + 1) * length / count, 3.1)} radius={0.029} />)}
  </group>;
}
function BuildingFrame() {
  const xs = [3, 10, 17, 24], zs = [8, 15, 22, 29];
  return <group name="five-level-building-under-construction" userData={{ constructionStage: 'structural-frame-and-upper-floor-pouring' }}>
    <Box at={[13.5, 0.06, 18.5]} size={[23, 0.18, 24]} mat="concrete" />
    {[0.28, 3.48, 6.68, 9.88, 13.08].map((y, level) => <group key={level} name={`building-floor-${level + 1}`}>
      <Box at={[13.5, y, 18.5]} size={[23, 0.24, 24]} mat={level === 4 ? 'timber' : 'concrete'} />
      {xs.flatMap(x => zs.map(z => <Box key={`${x}/${z}`} at={[x, y + 1.6, z]} size={[0.48, 3.1, 0.48]} mat="concrete" />))}
      {level < 3 && <>
        <Box at={[13.5, y + 1.4, 29.35]} size={[22.5, 2.7, 0.17]} mat="concrete" />
        <Box at={[24.35, y + 1.4, 18.5]} size={[0.17, 2.7, 23]} mat="concrete" />
        {[6.5, 13.5, 20.5].map(x => <Box key={x} at={[x, y + 1.55, 29.45]} size={[3.2, 1.3, 0.08]} mat="glass" />)}
      </>}
      {level === 4 && <>
        <Box at={[19.5, y + 0.16, 24.5]} size={[8, 0.18, 7]} mat="concrete" />
        {Array.from({ length: 8 }, (_, i) => <Beam key={i} from={[2.3 + i * 1.3, y + 0.2, 9]} to={[2.3 + i * 1.3, y + 0.2, 21]} radius={0.018} mat="rebar" />)}
        {[10, 14, 18, 22].map(z => <Beam key={z} from={[2, y + 0.22, z]} to={[13, y + 0.22, z]} radius={0.019} mat="rebar" />)}
        <Box at={[24.2, y + 0.48, 24.5]} size={[0.16, 0.9, 8]} mat="timber" />
      </>}
    </group>)}
    <Scaffold x={1.2} z={6.4} length={24.5} />
    <Scaffold x={1.2} z={31.3} length={24.5} />
    <Scaffold x={26.2} z={6.4} alongX={false} length={24.8} />
    <group name="upper-floor-formwork-props">
      {[5, 12, 19].flatMap(x => [11, 18, 25].map(z => <Beam key={`${x}/${z}`} from={[x, 10.03, z]} to={[x, 12.9, z]} radius={0.037} mat="steel" />))}
    </group>
  </group>;
}
function FoundationWorks() {
  return <group name="foundation-rebar-and-formwork" position={[-12, 0, 21]}>
    <Box at={[0, -0.05, 0]} size={[13, 0.15, 18]} mat="earth" />
    <Box at={[0, 0.1, 0]} size={[9.6, 0.16, 13.5]} mat="concrete" />
    {[-5, 5].map(x => <Box key={x} at={[x, 0.74, 0]} size={[0.17, 1.25, 14]} mat="timber" />)}
    {[-7, 7].map(z => <Box key={z} at={[0, 0.74, z]} size={[10.3, 1.25, 0.17]} mat="timber" />)}
    {Array.from({ length: 12 }, (_, i) => <Beam key={i} from={[-4.6 + i * 0.83, 0.32, -6.5]} to={[-4.6 + i * 0.83, 0.32, 6.5]} radius={0.023} mat="rebar" />)}
    {Array.from({ length: 15 }, (_, i) => <Beam key={i} from={[-4.6, 0.35, -6.5 + i * 0.93]} to={[4.6, 0.35, -6.5 + i * 0.93]} radius={0.023} mat="rebar" />)}
    {[-3, 3].flatMap(x => [-4, 4].map(z => <group key={`${x}/${z}`} position={[x, 0, z]}>
      {[-0.17, 0.17].flatMap(dx => [-0.17, 0.17].map(dz => <Beam key={`${dx}/${dz}`} from={[dx, 0.3, dz]} to={[dx, 2.45, dz]} radius={0.028} mat="rebar" />))}
      {[0.6, 1, 1.4, 1.8, 2.2].map(y => <group key={y}>
        <Beam from={[-0.2, y, -0.2]} to={[0.2, y, -0.2]} radius={0.018} mat="rebar" />
        <Beam from={[-0.2, y, 0.2]} to={[0.2, y, 0.2]} radius={0.018} mat="rebar" />
      </group>)}
    </group>))}
  </group>;
}
function TowerCrane() {
  return <group name="construction-tower-crane" position={[-6, 0, 7]}>
    <Box at={[0, 0.32, 0]} size={[5, 0.65, 5]} mat="concrete" />
    {[-0.85, 0.85].flatMap(x => [-0.85, 0.85].map(z => <Beam key={`${x}/${z}`} from={[x, 0.7, z]} to={[x, 24, z]} radius={0.09} mat="yellow" />))}
    {Array.from({ length: 10 }, (_, i) => <group key={i}>
      <Beam from={[-0.85, 1 + i * 2.3, 0.85]} to={[0.85, 3.3 + i * 2.3, 0.85]} radius={0.048} mat="yellow" />
      <Beam from={[0.85, 1 + i * 2.3, -0.85]} to={[0.85, 3.3 + i * 2.3, 0.85]} radius={0.048} mat="yellow" />
      <Box at={[0, 1 + i * 2.3, 0]} size={[1.9, 0.075, 1.9]} mat="yellow" />
    </group>)}
    <Box at={[9, 24.2, 0]} size={[34, 0.24, 1.35]} mat="yellow" />
    <Box at={[-5.6, 24.8, 0]} size={[2.7, 1.2, 2.15]} mat="concrete" />
    <Box at={[1.2, 24.15, 1.25]} size={[2.0, 1.7, 1.25]} mat="glass" />
    <Beam from={[-0.8, 24.3, 0]} to={[0, 28, 0]} radius={0.09} mat="yellow" />
    <Beam from={[0.8, 24.3, 0]} to={[0, 28, 0]} radius={0.09} mat="yellow" />
    <Beam from={[0, 27.9, 0]} to={[25.8, 24.35, 0]} radius={0.025} mat="dark" />
    <Beam from={[0, 27.9, 0]} to={[-7.9, 24.35, 0]} radius={0.025} mat="dark" />
    {Array.from({ length: 11 }, (_, i) => <Beam key={i} from={[-7.7 + i * 3, 24.3, -0.62]} to={[-4.7 + i * 3, 25.7, -0.62]} radius={0.04} mat="yellow" />)}
    <Box at={[19.5, 24.1, 0]} size={[1.2, 0.3, 1.5]} mat="steel" />
    <Beam from={[19.5, 24, 0]} to={[19.5, 17.2, 0]} radius={0.022} mat="dark" />
    <Cylinder at={[19.5, 17.02, 0]} top={0.16} height={0.36} mat="yellow" />
    <Box at={[19.5, 16.6, 0]} size={[0.1, 0.5, 0.1]} mat="dark" />
  </group>;
}
function ConstructionFence() {
  return <group name="construction-site-perimeter-hoarding">
    <Box at={[9, 1.25, 41]} size={[58, 2.5, 0.15]} mat="blue" />
    <Box at={[-20, 1.25, 15]} size={[0.15, 2.5, 52]} mat="blue" />
    <Box at={[38, 1.25, 15]} size={[0.15, 2.5, 52]} mat="blue" />
    <Box at={[-12.7, 1.25, -10.8]} size={[14.5, 2.5, 0.15]} mat="blue" />
    <Box at={[26, 1.25, -10.8]} size={[24, 2.5, 0.15]} mat="blue" />
    {[-6, 14].map(x => <Box key={x} at={[x, 2.0, -10.8]} size={[0.3, 4, 0.3]} mat="steel" />)}
    <Box at={[4, 4.0, -10.8]} size={[20.5, 0.4, 0.3]} mat="blue" />
  </group>;
}
function ConstructionSite({ selectedId, onSelect, delivered }) {
  return <Entity id="construction-site" at={[100, 0, 108]} selectedId={selectedId} onSelect={onSelect} radius={20}>
    <Box at={[9, -0.01, 15]} size={[58, 0.16, 52]} mat="earth" />
    <Box at={[7, 0.035, -10]} size={[28, 0.09, 14]} mat="concrete" />
    <Box at={[4, 0.035, -4]} size={[24, 0.09, 13]} mat="concrete" />
    <BuildingFrame />
    <FoundationWorks />
    <TowerCrane />
    <ConstructionFence />
    <group name="site-office-and-stored-reinforcement">
      <Box at={[-12, 1.6, -3]} size={[11, 3.2, 5]} mat="white" />
      <Box at={[-12, 3.25, -3]} size={[11.5, 0.14, 5.5]} mat="blue" />
      {[-15.8, -12.6, -9.4].map(x => <Box key={x} at={[x, 1.7, -0.46]} size={[1.6, 1.05, 0.06]} mat="glass" />)}
      <Box at={[-12, 0.17, 5.5]} size={[9.5, 0.3, 2.7]} mat="timber" />
      {Array.from({ length: 9 }, (_, i) => <Beam key={i} from={[-16.1, 0.5, 4.55 + i * 0.22]} to={[-7.7, 0.5, 4.55 + i * 0.22]} radius={0.043} mat="rebar" />)}
      <Box at={[32, 0.36, 32]} size={[5, 0.7, 5]} mat="timber" />
      <Box at={[31, 1.1, 32]} size={[3, 0.9, 3.5]} mat="concrete" />
    </group>
    <Label at={[10, 29.6, 15]} large selected={selectedId==='construction-site'}>施工工地</Label>
  </Entity>;
}

const pumpPath = [[105.4, 2.85, 98.1], [106.6, 5.3, 97.5], [109.8, 11.8, 104], [114.6, 18.5, 113.5], [121.4, 16.1, 128.4], [120.9, 13.45, 128.4]];
function PumpTruck({ selectedId, onSelect, active }) {
  return <Entity id="pump-p01" at={[108, 0, 97]} selectedId={selectedId} onSelect={onSelect} radius={5.3}>
    <group name="concrete-boom-pump-truck">
      <Box at={[0, 0.92, 0]} size={[8.6, 0.35, 2.25]} mat="dark" />
      <Box at={[2.8, 1.93, 0]} size={[2.1, 2.1, 2.3]} mat="white" />
      <Box at={[3.88, 2.3, 0]} size={[0.07, 0.84, 2.05]} mat="glass" />
      <Box at={[2.85, 2.34, 1.19]} size={[1.7, 0.8, 0.04]} mat="glass" />
      <Box at={[2.85, 2.34, -1.19]} size={[1.7, 0.8, 0.04]} mat="glass" />
      <Box at={[-0.25, 1.63, -0.25]} size={[2.4, 1.13, 1.65]} mat="white" />
      <group name="open-concrete-receiving-hopper" position={[-2.4,0,1.2]}>
        <Box at={[0,1.12,0]} size={[1.4,0.09,1.35]} mat="steel" />
        {[-0.7,0.7].map(x=><Box key={x} at={[x,1.29,0]} size={[0.07,0.35,1.42]} mat="steel"/>)}
        {[-0.675,0.675].map(z=><Box key={z} at={[0,1.29,z]} size={[1.4,0.35,0.07]} mat="steel"/>)}
        <Box at={[0,1.25,0]} size={[1.26,0.03,1.21]} mat="cement" />
      </group>
      <Beam from={[-2.4,1.1,1.2]} to={[-2.6,1.25,0]} radius={0.13} mat="flowHose" />
      <Beam from={[-2.6,1.25,0]} to={[-2.6,2.85,0]} radius={0.10} mat="flowHose" />
      <Cylinder at={[-2.6, 2.6, 0]} top={0.65} height={0.75} mat="blue" />
      {[-2.9, -1.6, 2.85].flatMap(x => [-1, 1].map(side => <group key={`${x}/${side}`}>
        <Cylinder at={[x, 0.63, side * 1.16]} top={0.52} height={0.35} rotation={[Math.PI / 2, 0, 0]} mat="dark" segments={24} />
        <Cylinder at={[x, 0.63, side * 1.36]} top={0.3} height={0.04} rotation={[Math.PI / 2, 0, 0]} mat="steel" />
      </group>))}
      {[-2.4, 1.1].flatMap(x => [-1, 1].map(side => <group key={`${x}/${side}`}>
        <Box at={[x, 0.75, side * 2.3]} size={[0.28, 0.26, 3.8]} mat="blue" />
        <Cylinder at={[x, 0.42, side * 3.65]} top={0.09} height={0.8} mat="steel" />
        <Box at={[x, 0.07, side * 3.65]} size={[0.75, 0.13, 0.75]} mat="concrete" />
      </group>))}
      <Ball at={[-3.3, 2.35, 0.55]} size={[0.11, 0.11, 0.11]} mat={active ? 'green' : 'steel'} />
    </group>
    <Label at={[0, 3.9, -1.5]} selected={selectedId==='pump-p01'} active={active}>P01 · 泵车</Label>
  </Entity>;
}
function PumpBoom() {
  return <group name="articulated-pump-boom-and-delivery-hose" userData={{ entityId: 'pump-p01' }}>
    <Beam from={[105.4,2.85,97]} to={pumpPath[0]} radius={0.19} mat="blue" />
    <Ball at={[105.4,2.85,97]} size={[0.22,0.22,0.22]} mat="steel" />
    {pumpPath.slice(1, -1).map((p, i) => <group key={i}>
      <Beam from={pumpPath[i]} to={p} radius={i === 0 ? 0.19 : 0.14} mat="blue" />
      <Beam from={[pumpPath[i][0] + 0.2, pumpPath[i][1], pumpPath[i][2]]} to={[p[0] + 0.2, p[1], p[2]]} radius={0.09} mat="flowHose" />
      <Ball at={p} size={[0.22, 0.22, 0.22]} mat="steel" />
    </group>)}
    <Beam from={[pumpPath[pumpPath.length - 2][0] + 0.2, pumpPath[pumpPath.length - 2][1], pumpPath[pumpPath.length - 2][2]]} to={[pumpPath[pumpPath.length - 1][0] + 0.2, pumpPath[pumpPath.length - 1][1], pumpPath[pumpPath.length - 1][2]]} radius={0.10} mat="flowHose" />
  </group>;
}
function FlowAlongCurve({ points, time=0, kind='cement', count=20, radius=.055, pipe=false, active, flowActive, connection, progress }) {
  const frame=useContext(WorkflowFrameContext),group=useRef(),particles=useRef();
  const signature=typeof points==='function'?'dynamic:'+count:points.map(p=>p.join(',')).join('/');
  const curve=useMemo(()=>new THREE.CatmullRomCurve3((typeof points==='function'?points(frame?.current||{}):points).map(p=>new THREE.Vector3(...p))),[signature]);
  const tube=useMemo(()=>pipe?new THREE.TubeGeometry(curve,48,radius+.065,8,false):null,[curve,radius,pipe]);
  const scratch=useMemo(()=>({point:new THREE.Vector3(),dummy:new THREE.Object3D()}),[]);
  const mat=['sand','stone','gravel','flyash','blue'].includes(kind)?kind:'cement';
  useEffect(()=>{if(particles.current)particles.current.instanceMatrix.setUsage(THREE.DynamicDrawUsage);return()=>tube?.dispose();},[tube]);
  useFrame(()=>{
    const s=frame?.current||{time},visible=active?Boolean(active(s)):true;
    if(!group.current||!particles.current)return;group.current.visible=visible;if(!visible)return;
    if(typeof points==='function'){const next=points(s);next.forEach((p,i)=>curve.points[i]?.set(...p));}
    if(tube&&connection)tube.setDrawRange(0,Math.floor(clamp(connection(s))*48)*8*6);
    const flowing=flowActive?Boolean(flowActive(s)):true;particles.current.visible=flowing;if(!flowing)return;
    const front=progress?Math.min(1,Math.max(.015,progress(s)*6)):1;
    for(let i=0;i<count;i++){
      const t=((Number.isFinite(s.time)?s.time:time)*.55+i/count)%1;
      const falling=!pipe&&curve.points[0].y-curve.points.at(-1).y>.35;
      curve.getPoint(falling?t*t:t,scratch.point);scratch.dummy.position.copy(scratch.point);
      if(falling){scratch.dummy.position.x+=Math.sin(i*2.1+t*4)*radius*.65;scratch.dummy.position.z+=Math.cos(i*2.3+t*3)*radius*.65;}
      scratch.dummy.rotation.set(i*.51,i*.31,i*.71);
      const size=t<=front?radius*(.8+(i%4)*.1):0;
      scratch.dummy.scale.set(size,kind==='sand'?size*.75:size,size);scratch.dummy.updateMatrix();particles.current.setMatrixAt(i,scratch.dummy.matrix);
    }
    particles.current.instanceMatrix.needsUpdate=true;
  });
  return <group ref={group} name={`${kind}-material-flow`}>
    {tube&&<mesh geometry={tube} material={materials.flowHose} castShadow={false} receiveShadow={false}/>}
    <instancedMesh ref={particles} args={[kind==='stone'||kind==='gravel'?gravelGeometry:sphereGeometry,materials[mat],count]} frustumCulled={false} castShadow={false} receiveShadow={false}/>
  </group>;
}
function vehicleLocal(position, yaw, local) {
  const p = new THREE.Vector3(...local).applyAxisAngle(up, yaw || 0).add(new THREE.Vector3(...position));
  return p.toArray();
}
function LiveVisual({children,update,name}){
  const frame=useContext(WorkflowFrameContext),group=useRef();
  useFrame(()=>{if(group.current&&frame?.current)update(group.current,frame.current);});
  return <group ref={group} name={name}>{children}</group>;
}
function TaskMaterialFlow({ state, time, materialKind, scenarioId }) {
  const visualState=useContext(WorkflowFrameContext);
  const position = state.vehiclePosition || [3.1, 0, -13.65], yaw = state.vehicleYaw || 0;
  const isDelivery = scenarioId === 'delivery' || state.flowKind === 'concrete';
  const isPowder = !isDelivery && (state.flowKind === 'powder' || materialKind === 'cement' || materialKind === 'flyash');
  const bayX = materialKind === 'sand' ? -23.4 : -9.8;
  const binX=AGGREGATE_BIN_X[materialKind==='stone'?2:0];
  const sourceLoading=state.supplierLoading || state.stageName==='supplier_loading';
  const sourceVehicle=state.supplierVehiclePosition || position;
  // The fixed gantry's world origin; vehicle/top-port positions still come
  // from the workflow, so a port coordinate cannot offset the gantry twice.
  const sourceBase=[-82,0,60];
  const sourceAt=local=>[sourceBase[0]+local[0],(sourceBase[1]||0)+local[1],sourceBase[2]+local[2]];
  return <group name="workflow-controlled-material-transfer">
    {sourceLoading&&!isDelivery&&isPowder&&<FlowAlongCurve pipe kind={materialKind} radius={.10} count={20} time={time} points={[
      sourceAt([-1.1,4.2,0]),sourceAt([-1.1,3.7,0]),vehicleLocal(sourceVehicle,yaw,[-1.1,3.3,0]),
    ]}/>}
    {sourceLoading&&!isDelivery&&!isPowder&&<>
      <FlowAlongCurve kind={materialKind==='sand'?'sand':'stone'} radius={.11} count={26} time={time} points={[
        sourceAt([12,1.5,-7.8]),sourceAt([5,4.95,-3.9]),sourceAt([-1.4,7.75,0]),sourceAt([-1.4,7.2,0]),
      ]}/>
      <FlowAlongCurve kind={materialKind==='sand'?'sand':'stone'} radius={.15} count={22} time={time} points={s=>[
        sourceAt([-1.4,4.34,0]),sourceAt([-1.4,3.55,0]),vehicleLocal(s.supplierVehiclePosition||sourceVehicle,s.vehicleYaw,[-1.4,1.74+(s.sourceLoadProgress||0)*.84,0]),
      ]}/>
    </>}
    {state.unloading && isPowder && <><FlowAlongCurve pipe kind={materialKind} radius={0.12} time={time} connection={s=>s.powderConnectionProgress??1} flowActive={s=>s.powderFlowActive??s.unloading} progress={s=>s.powderFlowProgress??s.unloadProgress} points={[
      vehicleLocal(position, yaw, [-3.67, 1.32, 1.385]),
      vehicleLocal(position, yaw, [-4.85,1.30,1.385]),
      vehicleLocal(position, yaw, [-5.2,0.35,0]),
      vehicleLocal(position, yaw, [-5.2,0.28,-1.8]),
      [materialKind === 'flyash' ? 5.7 : -2.3, 0.27, -11.6],
      [materialKind === 'flyash' ? 7.58 : -0.42, 0.9, -9.4],
    ]} />
      <FlowAlongCurve pipe kind={materialKind} radius={.052} count={34} time={time} flowActive={s=>s.powderFlowActive??s.unloading} progress={s=>s.powderFlowProgress??s.unloadProgress} points={[
        [materialKind==='flyash'?7.58:-.42,.9,-9.4],[materialKind==='flyash'?7.58:-.42,7,-9.4],
        [materialKind==='flyash'?7.58:-.42,15.68,-9.4],[materialKind==='flyash'?8.55:.55,16.28,-9.4],
        [materialKind==='flyash'?9.15:1.15,16.28,-8.9],[materialKind==='flyash'?9.15:1.15,15.6,-8.9],
      ]}/>
    </>}
    {state.unloading && isDelivery && <>
      <FlowAlongCurve kind="cement" radius={0.10} time={time} count={12} points={[
        vehicleLocal(position, yaw, chuteDischargeLipLocal(state)), [105.67, 1.49, 98.08], [105.6, 1.29, 98.2],
      ]} />
      <FlowAlongCurve kind="cement" radius={0.07} time={time} points={pumpPath.map(([x, y, z]) => [x + 0.2, y, z])} count={30} />
      <FlowAlongCurve kind="cement" radius={0.13} time={time} count={8} points={[[121.1, 13.45, 128.4], [121.1, 13.28, 128.4], [121.1, 13.24, 128.4]]} />
    </>}
    {!isPowder && !isDelivery && <>
      <LiveVisual name="continuous-received-aggregate-pile" update={(group,s)=>{const value=Math.max(0,((s.net||1)*(s.unloadProgress||0)-(s.materialConsumed||0)-(s.loaderMaterialAmount||0))/(s.net||1));group.visible=value>0;group.position.set(bayX,.18,-4.35);group.scale.set(.28+value*.65,.13+value*.65,.28+value*.5);}}><MaterialPile at={[0,0,0]} type={materialKind==='sand'?'sand':'stone'} seed={41} visualState={visualState} getCut={s=>s?.loaderPickupProgress||0}/></LiveVisual>
      <FlowAlongCurve kind={materialKind === 'sand' ? 'sand' : 'stone'} time={time} count={23} radius={0.12} active={s=>s.unloading&&(s.dumpStage?s.dumpStage==='discharging':s.vehicleFill>.005)} points={s=>[
        vehicleLocal(s.vehiclePosition,s.vehicleYaw,[-3.78,1.58,0]),vehicleLocal(s.vehiclePosition,s.vehicleYaw,[-4.5,1.1,0]),vehicleLocal(s.vehiclePosition,s.vehicleYaw,[-5.35,.35,0]),
      ]}/>
    </>}
    {isDelivery&&<LiveVisual name="continuous-site-pour-volume" update={(group,s)=>{const amount=s.unloadProgress||0;group.visible=amount>0;group.position.set(121.1,13.27,128.4);group.scale.x=Math.max(.15,3.2*amount);}}><Box size={[1,.11,3.1]} mat="cement"/></LiveVisual>}
    {!isDelivery&&!isPowder&&<FlowAlongCurve time={time} kind={materialKind === 'sand' ? 'sand' : 'stone'} count={30} radius={materialKind==='stone'?.11:.085} active={s=>s.stageName==='supply'&&(s.loaderTransferProgress??s.feedProgress)>0&&(s.loaderTransferProgress??s.feedProgress)<1&&s.loaderFill>.001} points={s=>{
      const lip=vehicleLocal(s.loaderPosition,s.loaderYaw,loaderLipLocal(s));return[lip,[lip[0],lip[1]-.24,lip[2]],[binX,2.06,Math.max(-.9,Math.min(.9,lip[2]))]];
    }}/>} 
    {isDelivery&&[-2,0,2].map(offset=><FlowAlongCurve key={offset} kind="blue" radius={0.055} count={8} time={time} active={s=>s.stageName==='wash'&&s.stageProgress>=.5} points={[[37+offset,4.1,14.3],[37+offset,3.7,14.3],[37+offset,2.2,14.3]]}/>)}
  </group>;
}

const StaticRoadNetwork=memo(RoadNetwork),StaticSupplierYard=memo(SupplierYard),StaticConstructionSite=memo(ConstructionSite),StaticPumpTruck=memo(PumpTruck),StaticPumpBoom=memo(PumpBoom);
export default function LogisticsWorld({ workflow, paused = false, showRoutes = true, selectedId, onSelect, view='overview', isolatedVehicle=view==='vehicle',visualClock,visualState:sharedState }) {
  const scenarioId = workflow?.scenarioId || 'delivery';
  const time = Number(workflow?.time) || 0;
  const state = workflow?.vehiclePosition?workflow:getWorkflowState(scenarioId,time);
  const ownState=useRef(state),visualState=sharedState||ownState;
  useFrame(()=>{if(sharedState)return;const sampled=visualClock?getWorkflowState(scenarioId,visualTime(visualClock,time)):state;
    ownState.current=sampled;
  },-3);
  const materialKind = state.materialKind || workflow?.materialKind || (scenarioId === 'delivery' ? 'concrete' : ['sand', 'stone', 'cement', 'flyash'].includes(scenarioId) ? scenarioId : scenarioId === 'aggregate' ? 'gravel' : 'cement');
  const isDelivery = scenarioId === 'delivery' || state.flowKind === 'concrete';
  const isPowder = !isDelivery && (state.flowKind === 'powder' || materialKind === 'cement' || materialKind === 'flyash');
  const vehicleId = state.vehicleId || (isDelivery ? 'truck-mc012' : scenarioId === 'flyash' ? 'raw-rc021' : isPowder ? 'raw-rc018' : scenarioId === 'stone' ? 'raw-rc022' : 'raw-rc020');
  const position = state.vehiclePosition || (isDelivery ? [10.3, 0, 3] : [-82, 0, 60]);
  const common = { selectedId, onSelect };
  const loaderActive=!isDelivery&&!isPowder&&['loading','supply'].includes(state.stageName);
  const plannedRoute=useMemo(()=>isDelivery?OUTBOUND_ROUTE:[...INBOUND_ROUTE,...getRawUnloadRoute(state).slice(1)],[scenarioId]);
  return <WorldViewContext.Provider value={view}><WorkflowFrameContext.Provider value={visualState}><group name="concrete-logistics-workflow-world" userData={{ modelVersion: '5.0', units: 'metres', dataSource: 'simulated-business-workflow' }} dispose={null}>
    <group visible={!isolatedVehicle}><StaticRoadNetwork />
    <group visible={['supplier','regional','region'].includes(view)}><StaticSupplierYard {...common} materialKind={materialKind} /></group>
    <group visible={['site','regional','region'].includes(view)}><StaticConstructionSite {...common} delivered={state.delivered} />
    <StaticPumpTruck {...common} active={isDelivery && state.unloading} />
    <StaticPumpBoom /></group>
    <group name="station-return-truck-wash-bay" position={[37,0,14.3]}>
      <Box at={[0,0.06,0]} size={[10.5,0.08,5.2]} mat="road"/>
      {[-3.7,3.7].flatMap(x=>[-2.4,2.4].map(z=><Cylinder key={`${x}:${z}`} at={[x,2.08,z]} top={0.08} height={4.1} mat="blue"/>))}
      <Beam from={[-3.7,4.15,-2.4]} to={[3.7,4.15,-2.4]} radius={0.09} mat="blue"/>
      <Beam from={[-3.7,4.15,2.4]} to={[3.7,4.15,2.4]} radius={0.09} mat="blue"/>
      {[-2,0,2].map(x=><Beam key={x} from={[x,4.15,-2.4]} to={[x,4.15,2.4]} radius={0.05} mat="steel"/>)}
      {state.stageName==='wash'&&<Label at={[0,4.9,0]} active>返站洗车区</Label>}
    </group>
    {showRoutes && <><RouteTrace points={plannedRoute} concrete={isDelivery} planned/><LiveRouteTrace concrete={isDelivery}/></>}</group>
    <Entity id={vehicleId} at={position} yaw={state.vehicleYaw || 0} radius={5.2} motion="vehicle" {...common}>
      {isDelivery ? <MixerTruck paused={paused} fill={visualClock?1:state.vehicleFill??1} unloading={Boolean(state.unloading)} {...{visualClock,visualState}} /> : isPowder ? <PowderTruck fill={visualClock?1:state.vehicleFill??1} visualState={visualState} /> : <DumpTruck tip={visualClock?0:state.tip||0} fill={visualClock?1:state.vehicleFill??1} materialKind={materialKind} visualState={visualState} />}
      <Label at={[0, 4.35, 0]} selected={selectedId === vehicleId} active priority={45}>{state.vehicleCode || vehicleId.split('-').at(-1).toUpperCase()}</Label>
    </Entity>
    <group visible={!isolatedVehicle}>{state.loaderPosition && <Entity id="loader-l01" at={state.loaderPosition} yaw={state.loaderYaw || 0} radius={3.8} motion="loader" {...common}>
      <Loader bucket={visualClock?0:state.loaderBucket||0} fill={visualClock?1:state.loaderFill||0} {...{materialKind,visualState}} />
      {(loaderActive||selectedId==='loader-l01')&&<Label at={[0, 3.9, 0]} selected={selectedId === 'loader-l01'} active={loaderActive} priority={35}>{loaderActive?(state.stageName==='loading'?'L01 · 取料':'L01 · 上料'):'L01 · 装载机'}</Label>}
    </Entity>}
    <TaskMaterialFlow state={state} time={time} materialKind={materialKind} scenarioId={scenarioId} /></group>
  </group></WorkflowFrameContext.Provider></WorldViewContext.Provider>;
}
