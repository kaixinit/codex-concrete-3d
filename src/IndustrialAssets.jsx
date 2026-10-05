import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {advanceVisualTime, activityTime, loaderKinematics} from './visualTime.js';
import {StaticInstances} from './SceneRuntime.jsx';
import {AssetDetail,StaticGeometryParts} from './AssetDetail.jsx';
import {refineAssetSurfaces} from './AssetSurfaces.js';
import {getMixerChutePose,getChuteActuatorPose,getProductionAssetState,pileScoopDepth} from './assetMotion.js';
import {WEIGHBRIDGE_LAYOUT,AGGREGATE_BIN_X,AGGREGATE_BIN_Z,AGGREGATE_COLLECTION_BELT} from './stationLayout.js';

export const MAT = Object.fromEntries(Object.entries({
  white: ['#eef0ed', .08, .62], blue: ['#397493', .18, .58], cobalt: ['#2d607b', .24, .58],
  paleBlue: ['#aac2ce', .1, .65], steel: ['#9eacb2', .44, .49], darkSteel: ['#4b5e66', .35, .59],
  concrete: ['#cbd2d4', 0, .93], ground: ['#dde5e7', 0, .94], asphalt: ['#a4afb6', 0, .92],
  markings: ['#f6f8f4', 0, .9], rubber: ['#30383d', 0, .94], glass: ['#335969', .2, .26],
  yellow: ['#d3ae46', .12, .66], yellowDark: ['#a88a37', .14, .69], orange: ['#bd8848', .1, .65],
  grass: ['#b8cba9', 0, 1], leaf: ['#7ca785', 0, 1], leafLight: ['#a0bb98', 0, 1],
  trunk: ['#998776', 0, 1], sand: ['#cab893', 0, 1], gravel: ['#a4afb0', 0, 1],
  stone: ['#89989d', 0, 1], powder: ['#dedacb', 0, 1], wetConcrete: ['#8f9693', 0, .89],
  black: ['#1f3445', .15, .6], red: ['#d56159', .1, .55], green: ['#53ae87', .1, .5],
}).map(([key, [color, metalness, roughness]]) => [key, new THREE.MeshStandardMaterial({color, metalness, roughness})]));
refineAssetSurfaces(MAT);
MAT.pipeSection=new THREE.MeshStandardMaterial({color:'#96b1c1',metalness:.25,roughness:.5,transparent:true,opacity:.32,depthWrite:false});
MAT.cabGlass=new THREE.MeshPhysicalMaterial({color:'#355d72',metalness:.07,roughness:.13,clearcoat:.7,clearcoatRoughness:.1,transparent:true,opacity:.9,side:THREE.DoubleSide});
MAT.chuteSteel=new THREE.MeshStandardMaterial({color:'#adb9bd',metalness:.48,roughness:.49,side:THREE.DoubleSide});
MAT.headlamp=new THREE.MeshStandardMaterial({color:'#edf8ff',emissive:'#c1dff2',emissiveIntensity:.23,metalness:.08,roughness:.16});
MAT.tailLamp=new THREE.MeshStandardMaterial({color:'#db5145',emissive:'#a21e13',emissiveIntensity:.16,roughness:.3});
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const sphereGeometry = new THREE.SphereGeometry(1, 18, 12);
const pebbleGeometry = new THREE.DodecahedronGeometry(1);
const unitCylinderGeometry = new THREE.CylinderGeometry(1,1,1,24);
const geoCache = new Map();
function RoundedBlock({at=[0,0,0],size=[1,1,1],radius=.1,mat='white',rotation,...props}){
  const [w,h,d]=size,r=Math.min(radius,w*.45,h*.45),key=`rounded:${w}:${h}:${d}:${r}`;
  if(!geoCache.has(key)){
    const s=new THREE.Shape(),x=-w/2,y=-h/2;
    s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);
    const g=new THREE.ExtrudeGeometry(s,{depth:d,bevelEnabled:true,bevelSize:Math.min(.018,r*.2),bevelThickness:Math.min(.018,d*.15),bevelSegments:2,curveSegments:6,steps:1});g.translate(0,0,-d/2);geoCache.set(key,g);
  }
  return <mesh geometry={geoCache.get(key)} material={MAT[mat]} position={at} rotation={rotation} castShadow receiveShadow {...props}/>;
}
function CurveTube({points,radius=.035,mat='steel'}){
  const geometry=useMemo(()=>new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),40,radius,8,false),[JSON.stringify(points),radius]);
  return <mesh geometry={geometry} material={MAT[mat]} castShadow/>;
}
const DRUM_PROFILE=[[.08,-2.55],[.45,-2.53],[.62,-2.36],[.91,-1.98],[1.15,-1.47],[1.24,-.94],[1.265,-.24],[1.23,.43],[1.13,1.07],[.88,1.72],[.58,2.35],[.435,2.7],[.435,2.81]];
const drumProfileCurve=new THREE.CatmullRomCurve3(DRUM_PROFILE.map(([r,y])=>new THREE.Vector3(r,y,0)),false,'centripetal');
const drumProfile=drumProfileCurve.getPoints(72).map(p=>new THREE.Vector2(Math.max(.04,p.x),p.y));
const smoothDrumGeometry=new THREE.LatheGeometry(drumProfile,72);
const mixerFeedGeometry=new THREE.LatheGeometry([new THREE.Vector2(.24,0),new THREE.Vector2(.26,.04),new THREE.Vector2(.55,.7),new THREE.Vector2(.582,.7),new THREE.Vector2(.29,.015),new THREE.Vector2(.24,0)],48);
const rearCollectorGeometry=new THREE.LatheGeometry([new THREE.Vector2(.14,0),new THREE.Vector2(.19,.12),new THREE.Vector2(.345,.45),new THREE.Vector2(.367,.45),new THREE.Vector2(.214,.12),new THREE.Vector2(.162,0),new THREE.Vector2(.14,0)],32);
function drumRadius(y){let i=1;while(i<drumProfile.length-1&&drumProfile[i].y<y)i++;const a=drumProfile[i-1],b=drumProfile[i];return THREE.MathUtils.lerp(a.x,b.x,THREE.MathUtils.clamp((y-a.y)/(b.y-a.y||1),0,1));}
const drumCradleStations=[-1.42,1.05].map(s=>{
  const axis=new THREE.Vector3(-Math.cos(.17),Math.sin(.17),0),up=new THREE.Vector3(Math.sin(.17),Math.cos(.17),0),center=new THREE.Vector3(-.77,2.55,0).addScaledVector(axis,s),radius=drumRadius(s)+.033,rollerRadius=.16;
  const radialHeight=-Math.sqrt(radius*radius-.56*.56);
  return {s,center,radius,rollerRadius,rollers:[-1,1].map(side=>{const radial=up.clone().multiplyScalar(radialHeight).add(new THREE.Vector3(0,0,side*.56)).normalize();return center.clone().addScaledVector(radial,radius+rollerRadius);})};
});
function mixerDrumAngle(state,time,unloading){return state?.stages?time*.24-activityTime(state,time,['unloading'])*.69:time*(unloading?-.45:.24);}
function DrumCradle({station,paused,unloading,visualClock,visualState}){
  const rollers=useRef([]),clock=useRef(0);
  useFrame((_,dt)=>{const time=advanceVisualTime(clock,visualClock,dt,paused);for(const roller of rollers.current)if(roller)roller.rotation.y=-mixerDrumAngle(visualState?.current,time,unloading)*station.radius/station.rollerRadius;});
  return <group name={`drum-track-contact-cradle-${station.s}`}>
    <IBeam from={[station.rollers[0].x,.98,-.87]} to={[station.rollers[0].x,.98,.87]} width={.21} depth={.19} mat="blue"/>
    {station.rollers.map((p,i)=><group key={i} name="aligned-bearing-and-steel-roller">
      {[-1,1].map(sign=><group key={sign}><Beam from={[p.x+sign*.18,.98,p.z]} to={[p.x+sign*.14,p.y-.09,p.z]} radius={.055} mat="blue"/><RoundedBlock at={[p.x+sign*.17,p.y,p.z]} size={[.13,.3,.29]} radius={.07} mat="darkSteel"/></group>)}
      <group position={p} rotation={[0,0,Math.PI/2-.17]}>
        <group ref={node=>{rollers.current[i]=node;}}><Cylinder top={station.rollerRadius} height={.29} mat="steel" segments={22}/><Cylinder at={[0,.16,0]} top={.072} height={.055} mat="darkSteel"/><Cylinder at={[0,-.16,0]} top={.072} height={.055} mat="darkSteel"/></group>
      </group>
      <Bolts at={[p.x,.96,p.z]} spacing={.16}/>
    </group>)}
  </group>;
}

const mouldedCabRoofGeometry=(()=>{
  const vertices=[-.2,3.45,0],indices=[],n=36,rings=6;
  const point=(r,a,y)=>[-.2+.8*r*Math.sign(Math.cos(a))*Math.pow(Math.abs(Math.cos(a)),.66),y,1.13*r*Math.sign(Math.sin(a))*Math.pow(Math.abs(Math.sin(a)),.66)];
  for(let ring=1;ring<=rings;ring++)for(let i=0;i<n;i++){const r=ring/rings;vertices.push(...point(r,i/n*Math.PI*2,3.39+.06*(1-r*r)));}
  for(let i=0;i<n;i++)indices.push(0,1+(i+1)%n,1+i);
  for(let ring=0;ring<rings-1;ring++)for(let i=0;i<n;i++){const a=1+ring*n+i,b=1+ring*n+(i+1)%n,c=a+n,d=b+n;indices.push(a,b,c,b,d,c);}
  const lower=vertices.length/3;for(let i=0;i<n;i++)vertices.push(...point(1,i/n*Math.PI*2,3.29));
  const top=1+(rings-1)*n;for(let i=0;i<n;i++){const ni=(i+1)%n;indices.push(top+i,top+ni,lower+i,top+ni,lower+ni,lower+i);}
  const center=vertices.length/3;vertices.push(-.2,3.29,0);for(let i=0;i<n;i++)indices.push(center,lower+i,lower+(i+1)%n);
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();return g;
})();
const sweptFrontBumperGeometry=(()=>{
  const v=[],index=[],section=[[-.075,-.11],[.035,-.13],[.075,-.08],[.075,.08],[.035,.13],[-.075,.105],[-.10,0]],n=20,m=section.length;
  for(let i=0;i<=n;i++){const u=i/n*2-1,z=u*1.13,cx=1.105+.07*(1-u*u);for(const [x,y] of section)v.push(cx+x,.9+y,z);}
  for(let i=0;i<n;i++)for(let j=0;j<m;j++){const a=i*m+j,b=i*m+(j+1)%m,c=a+m,d=b+m;index.push(a,b,c,b,d,c);}
  for(let j=1;j<m-1;j++){index.push(0,j+1,j);const base=n*m;index.push(base,base+j,base+j+1);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(index);g.computeVertexNormals();return g;
})();
function DrumRibbon({phase=0}){
  const geometry=useMemo(()=>{
    const vertices=[],indices=[],n=110;
    for(let i=0;i<=n;i++){const t=i/n,y=-1.92+t*4.31,a=t*Math.PI*2*1.13+phase,r=drumRadius(y)+.013;for(const offset of [-.12,.12])vertices.push(Math.cos(a+offset)*r,y,Math.sin(a+offset)*r);}
    for(let i=0;i<n;i++){const a=i*2;indices.push(a,a+2,a+1,a+1,a+2,a+3);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();return g;
  },[phase]);
  return <mesh geometry={geometry} material={MAT.blue} castShadow/>;
}

function mixerCabScreenPoint(t,z,offset=.105){
  const y=2.23+t*.815;
  return [1.04+(.63-1.04)*(y-2.1)/(3.12-2.1)+offset,y,z];
}
function sharedCabScreenPoint(t,z,offset=.065){
  const u=1-t;
  return [u*u*.93+2*u*t*.8+t*t*.63+offset,u*u*2.05+2*u*t*2.58+t*t*3,z];
}
function MixerCab(){
  const shell=useMemo(()=>{
    const s=new THREE.Shape();s.moveTo(-1.02,.94);s.lineTo(.98,.94);s.quadraticCurveTo(1.09,.94,1.09,1.08);s.lineTo(1.04,2.1);s.lineTo(.63,3.12);s.quadraticCurveTo(.57,3.29,.31,3.3);s.lineTo(-.78,3.3);s.quadraticCurveTo(-1.08,3.24,-1.08,2.98);s.lineTo(-1.02,.94);
    const g=new THREE.ExtrudeGeometry(s,{depth:2.07,bevelEnabled:true,bevelThickness:.09,bevelSize:.065,bevelSegments:4,curveSegments:12,steps:1});g.translate(0,0,-1.035);
    const position=g.attributes.position;
    for(let i=0;i<position.count;i++){const x=position.getX(i),y=position.getY(i),z=position.getZ(i),waist=1-.055*Math.pow(Math.max(0,(y-2.0)/1.4),2)-.035*Math.pow(Math.max(0,(1.6-y)/.7),2);position.setZ(i,z*waist);if(x>.58)position.setX(i,x+.027*(1-Math.min(1,z*z/1.25)));}
    g.computeVertexNormals();return g;
  },[]);
  const windscreen=useMemo(()=>{
    const v=[],index=[],cols=12,rows=18;
    for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){const u=i/cols*2-1,p=mixerCabScreenPoint(j/rows,u*.9);p[0]+=.008*(1-u*u);v.push(...p);}
    for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){const a=j*(cols+1)+i,b=a+1,c=a+cols+1,d=c+1;index.push(a,c,b,b,c,d);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(index);g.computeVertexNormals();return g;
  },[]);
  const sideWindow=useMemo(()=>{const s=new THREE.Shape();s.moveTo(-.82,2.16);s.lineTo(.75,2.16);s.lineTo(.46,3.05);s.lineTo(-.74,3.05);s.quadraticCurveTo(-.83,3.02,-.83,2.91);s.lineTo(-.82,2.16);return new THREE.ShapeGeometry(s,12);},[]);
  return <group name="sculpted-cab-curved-windscreen-and-mirror-arms" position={[3.23,0,0]}>
    <StaticGeometryParts name="mixer-cab-fixed-surfaces">
    <mesh geometry={shell} material={MAT.white} castShadow receiveShadow/>
    <mesh geometry={windscreen} material={MAT.cabGlass}/>
    <RoundedBlock at={[.045,1.26,0]} size={[2.13,.38,2.34]} radius={.11} mat="blue"/>
    <mesh name="formed-curved-roof-cap" geometry={mouldedCabRoofGeometry} material={MAT.white} castShadow receiveShadow/>
    <mesh name="swept-integrated-front-bumper" geometry={sweptFrontBumperGeometry} material={MAT.white} castShadow receiveShadow/>
    <RoundedBlock at={[1.135,1.69,0]} size={[.047,.51,1.31]} radius={.08} mat="black"/>
    {Array.from({length:6},(_,i)=><Beam key={i} from={[1.169,1.48+i*.072,-.59]} to={[1.169,1.48+i*.072,.59]} radius={.012} mat="steel"/>)}
    <Cylinder at={[1.174,1.9,0]} top={.065} height={.013} rotation={[0,0,Math.PI/2]} mat="steel"/>
    {[-1,1].map(side=><group key={side}>
      <mesh geometry={sideWindow} position={[0,0,side*1.152]} material={MAT.cabGlass}/>
      <CurveTube points={[[-.84,2.16,side*1.158],[.75,2.16,side*1.158],[.46,3.07,side*1.158],[-.74,3.07,side*1.158],[-.84,2.9,side*1.158],[-.84,2.16,side*1.158]]} radius={.019} mat="black"/>
      <Beam from={[.36,2.16,side*1.17]} to={[.15,3.06,side*1.17]} radius={.021} mat="white"/>
      <RoundedBlock at={[-.15,1.97,side*1.156]} size={[.32,.048,.027]} radius={.023} mat="darkSteel"/>
      <CurveTube points={[[.68,2.22,side*1.16],[.82,2.37,side*1.3],[.75,2.85,side*1.37],[.56,2.94,side*1.34]]} radius={.03} mat="darkSteel"/>
      <RoundedBlock at={[.68,2.81,side*1.4]} size={[.28,.43,.14]} radius={.09} mat="black"/>
      <RoundedBlock at={[.68,2.8,side*1.48]} size={[.2,.32,.014]} radius={.06} mat="cabGlass"/>
      <RoundedBlock at={[.12,.82,side*1.185]} size={[.8,.12,.28]} radius={.045} mat="steel"/>
      <Box at={[-.54,1.53,side*1.155]} size={[.018,.66,.018]} mat="steel"/>
      <RoundedBlock at={[1.217,1.09,side*.88]} size={[.032,.23,.37]} radius={.047} mat="black"/>
      <RoundedBlock at={[1.242,1.12,side*.88]} size={[.018,.095,.29]} radius={.024} mat="headlamp"/>
      <RoundedBlock at={[1.242,1.016,side*.88]} size={[.018,.043,.29]} radius={.012} mat="headlamp"/>
      <RoundedBlock at={[.46,1.29,side*1.19]} size={[.15,.052,.027]} radius={.022} mat="orange"/>
    </group>)}
    {[-.48,.48].map(z=><CurveTube key={z} points={[mixerCabScreenPoint(.1,z-.16,.125),mixerCabScreenPoint(.3,z,.125),mixerCabScreenPoint(.48,z+.13,.125)]} radius={.013} mat="black"/>)}
    <RoundedBlock at={[1.268,.91,0]} size={[.024,.13,.43]} radius={.025} mat="black"/>
    </StaticGeometryParts>
  </group>;
}

function MixerChute({unloading,visualState}){
  const chute=useRef(),fallback=getMixerChutePose({},unloading);
  useFrame(()=>{const pose=getMixerChutePose(visualState?.current,unloading);if(chute.current)chute.current.rotation.set(0,pose.yaw,pose.pitch);});
  const geometry=useMemo(()=>{
    const a=new THREE.Vector3(-3.9,2.42,0),b=new THREE.Vector3(-5.735,1.622,0),d=b.clone().sub(a),up=new THREE.Vector3(d.y,-d.x,0).normalize(),v=[],index=[],segments=22;
    for(let row=0;row<2;row++)for(let i=0;i<=segments;i++){const angle=-Math.PI/2+i/segments*Math.PI,p=d.clone().multiplyScalar(row).addScaledVector(up,.29*(1-Math.cos(angle)));p.z+=Math.sin(angle)*.29;v.push(p.x,p.y,p.z);}
    for(let i=0;i<segments;i++){const a=i,b=i+1,c=i+segments+1,d=c+1;index.push(a,c,b,b,c,d);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(index);g.computeVertexNormals();return g;
  },[]);
  return <group ref={chute} name="curved-u-section-folding-chute" position={[-3.9,2.42,0]} rotation={[0,fallback.yaw,fallback.pitch]}>
    <mesh geometry={geometry} material={MAT.chuteSteel} castShadow receiveShadow/>
    {[-.29,.29].map(z=><Beam key={z} from={[-.115,.266,z]} to={[-1.95,-.532,z]} radius={.022} mat="steel"/>)}
    <Beam from={[-.28,-.07,0]} to={[-1.48,-.54,0]} radius={.041} mat="blue"/>
    <Cylinder at={[0,0,0]} top={.13} height={.72} rotation={[Math.PI/2,0,0]} mat="steel"/>
  </group>;
}
function ChuteHydraulic({unloading,visualState}){
  const endPin=useRef(),data=getChuteActuatorPose(visualState?.current,unloading);
  useFrame(()=>{if(endPin.current)endPin.current.position.set(...getChuteActuatorPose(visualState?.current,unloading).end);});
  return <group name="chute-hydraulic-cylinder-and-pivot-links">
    <LiveHydraulic from={data.mount} getTo={state=>getChuteActuatorPose(state,unloading).end} visualState={visualState} bodyRadius={.083} rodRadius={.04}/>
    {[data.mount,data.end].map((p,i)=><group ref={i?endPin:undefined} position={p} key={i}><Cylinder top={.095} height={.22} rotation={[Math.PI/2,0,0]} mat="darkSteel"/><Cylinder at={[0,0,.13]} top={.044} height={.035} rotation={[Math.PI/2,0,0]} mat="steel"/></group>)}
    <CurveTube points={[[data.mount[0],data.mount[1]-.08,.39],[-3.79,1.27,.48],[-3.49,1.18,.63]]} radius={.02} mat="black"/>
  </group>;
}
const loaderBucketShellGeometry=(()=>{
  const s=new THREE.Shape();
  s.moveTo(-.49,.64);s.lineTo(-.49,-.2);s.quadraticCurveTo(-.44,-.355,.16,-.355);s.lineTo(1.15,-.355);s.lineTo(1.18,-.27);s.lineTo(.2,-.25);s.quadraticCurveTo(-.23,-.23,-.35,.56);s.lineTo(-.49,.64);
  const g=new THREE.ExtrudeGeometry(s,{depth:2.4,bevelEnabled:false,curveSegments:12,steps:1});g.translate(0,0,-1.2);return g;
})();
export function Box({at = [0,0,0], size = [1,1,1], mat = 'white', rotation, ...props}) {
  return <mesh position={at} scale={size} rotation={rotation} geometry={boxGeometry} material={MAT[mat]} castShadow receiveShadow {...props}/>;
}
export function Cylinder({at = [0,0,0], top = 1, bottom = top, height = 1, mat = 'white', rotation, segments = 28, arc = Math.PI * 2, start = 0, ...props}) {
  const radius=Math.max(.0001,top,bottom),key = `c:${top/radius}:${bottom/radius}:${segments}:${arc}:${start}`;
  if (!geoCache.has(key)) geoCache.set(key, new THREE.CylinderGeometry(top/radius, bottom/radius, 1, segments, 1, false, start, arc));
  return <mesh position={at} rotation={rotation} scale={[radius,height,radius]} geometry={geoCache.get(key)} material={MAT[mat]} castShadow receiveShadow {...props}/>;
}
export function Ball({at = [0,0,0], size = [1,1,1], mat = 'white', ...props}) {
  return <mesh position={at} scale={size} geometry={sphereGeometry} material={MAT[mat]} castShadow receiveShadow {...props}/>;
}
export function Ring({at, radius = 1, thickness = .045, mat = 'steel', rotation = [Math.PI/2,0,0]}) {
  const key = `t:${radius}:${thickness}`;
  if (!geoCache.has(key)) geoCache.set(key, new THREE.TorusGeometry(radius, thickness, 8, 40));
  return <mesh position={at} rotation={rotation} geometry={geoCache.get(key)} material={MAT[mat]} castShadow/>;
}
export function Beam({from, to, radius = .06, mat = 'steel', segments = 10}) {
  const data = useMemo(() => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), delta = b.clone().sub(a);
    return {length: delta.length(), center: a.add(b).multiplyScalar(.5), q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), delta.normalize())};
  }, [from.join(','), to.join(',')]);
  return <Cylinder at={data.center} top={radius} height={data.length} mat={mat} segments={segments} quaternion={data.q}/>;
}
export function IBeam({from, to, width = .25, depth = .28, mat = 'cobalt'}) {
  const data = useMemo(() => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), d = b.clone().sub(a);
    return {center: a.add(b).multiplyScalar(.5), length: d.length(), q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), d.normalize())};
  }, [from.join(','), to.join(',')]);
  return <group position={data.center} quaternion={data.q}>
    <Box size={[.045,data.length,depth]} mat={mat}/>
    {[-1,1].map(s => <Box key={s} at={[0,0,s * depth/2]} size={[width,data.length,.045]} mat={mat}/>)}
  </group>;
}
export function Bolts({at = [0,0,0], count = 4, spacing = .16, rotation,batch=true}) {
  const Wrapper=batch?StaticInstances:'group';
  return <group position={at} rotation={rotation} name="bolted-connection">
    <Wrapper name="fixed-bolt-instances">
    {Array.from({length:count}, (_, i) => <Cylinder key={i} at={[(i % 2 -.5) * spacing,0,(Math.floor(i/2) -.5) * spacing]} top={.035} height={.05} mat="steel" segments={6} castShadow={false}/>)}
    </Wrapper>
  </group>;
}
export function Handrail({from, to, y, mat = 'yellow'}) {
  const count = Math.max(1, Math.ceil(Math.hypot(to[0]-from[0],to[1]-from[1])/1.35));
  return <group name="safety-handrail">
    {[.15,.57,1.03].map(h => <Beam key={h} from={[from[0],y+h,from[1]]} to={[to[0],y+h,to[1]]} radius={h > 1 ? .04 : .023} mat={mat}/>)}
    {Array.from({length:count+1}, (_,i) => <Beam key={i} from={[THREE.MathUtils.lerp(from[0],to[0],i/count),y,THREE.MathUtils.lerp(from[1],to[1],i/count)]} to={[THREE.MathUtils.lerp(from[0],to[0],i/count),y+1.08,THREE.MathUtils.lerp(from[1],to[1],i/count)]} radius={.03} mat={mat}/>)}
  </group>;
}
export function Grating({at, width, depth}) {
  return <group position={at} name="open-maintenance-platform-grating">
    {Array.from({length:Math.ceil(width/.18)}, (_,i) => <Box key={`a${i}`} at={[-width/2+i*.18,0,0]} size={[.035,.1,depth]} mat="steel"/>)}
    {Array.from({length:Math.ceil(depth/.62)}, (_,i) => <Box key={`b${i}`} at={[0,-.055,-depth/2+i*.62]} size={[width,.08,.035]} mat="darkSteel"/>)}
  </group>;
}
export function Sensor({at, rotation}) {
  return <group position={at} rotation={rotation} name="instrumentation-mount">
    <Box size={[.24,.17,.16]} mat="blue"/>
    <Cylinder at={[0,.13,0]} top={.065} height={.1} mat="steel"/>
    <Ball at={[0,.2,0]} size={[.045,.035,.045]} mat="green"/>
    <Beam from={[.1,-.02,0]} to={[.4,-.1,0]} radius={.017} mat="black"/>
  </group>;
}

function PileStones({seed,type}){
  const mesh=useRef(),dummy=useMemo(()=>new THREE.Object3D(),[]);
  useEffect(()=>{if(!mesh.current)return;for(let i=0;i<20;i++){const a=i*2.399+seed,r=1.1+(i%5)*.33;dummy.position.set(Math.cos(a)*r,.13+(2.8-r)*.32,Math.sin(a)*r*.8);dummy.scale.set(.18,.13,.16);dummy.rotation.set(i*.6,i*.3,i*.4);dummy.updateMatrix();mesh.current.setMatrixAt(i,dummy.matrix);}mesh.current.instanceMatrix.needsUpdate=true;},[dummy,seed]);
  return <instancedMesh ref={mesh} args={[pebbleGeometry,MAT[type]||MAT.gravel,20]} castShadow={false} receiveShadow={false}/>;
}
export function MaterialPile({at=[0,0,0], type='sand', seed=1, fill=1, scale=[1,1,1], visualState, fillField,getFill,getCut}) {
  const pile=useRef(),lastCut=useRef(-1),baseVertices=useRef();
  useFrame(()=>{if(!pile.current||!visualState||(!fillField&&!getFill))return;const level=THREE.MathUtils.clamp(getFill?getFill(visualState.current):visualState.current?.[fillField]??fill,0,1);pile.current.visible=level>.001;pile.current.scale.set(scale[0],scale[1]*Math.max(.04,level),scale[2]);});
  const g = useMemo(() => {
    const n=24, vertices=[], indices=[], levels=[[2.75,.06],[2.25,.5],[1.5,1.25],[.65,1.82],[.06,2.0]];
    levels.forEach(([r,y],level) => {for(let i=0;i<n;i++){const a=i/n*Math.PI*2, d=1+Math.sin(i*4.2+seed*7+level)*.08;vertices.push(Math.cos(a)*r*d,y+(level?Math.sin(i*2.7+seed)*.06:0),Math.sin(a)*r*d*.85);}});
    for(let l=0;l<levels.length-1;l++) for(let i=0;i<n;i++){const a=l*n+i,b=l*n+(i+1)%n,c=(l+1)*n+i,d=(l+1)*n+(i+1)%n;indices.push(a,c,b,b,c,d);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
  },[seed]);
  useFrame(()=>{if(!visualState||!getCut)return;const cut=Math.round(THREE.MathUtils.clamp(getCut(visualState.current),0,1)*80)/80;if(cut===lastCut.current)return;lastCut.current=cut;const position=g.attributes.position;if(!baseVertices.current)baseVertices.current=position.array.slice();for(let i=0;i<position.count;i++){const x=baseVertices.current[i*3],y=baseVertices.current[i*3+1],z=baseVertices.current[i*3+2];position.setY(i,Math.max(.06,y-pileScoopDepth(x,z,cut)));}position.needsUpdate=true;g.computeVertexNormals();g.computeBoundingSphere();});
  if(fill<=.001&&!visualState)return null;
  return <group ref={pile} position={at} scale={[scale[0],scale[1]*Math.max(.1,fill),scale[2]]} name={`${type}-material-pile`}>
    <mesh geometry={g} material={MAT[type] || MAT.sand} castShadow receiveShadow/>
    {type!=='sand' && <PileStones seed={seed} type={type}/>}
  </group>;
}

function Cab({x=2.95, color='white'}) {
  const body = useMemo(()=>{
    const s=new THREE.Shape();s.moveTo(-.93,.95);s.lineTo(.93,.95);s.lineTo(.93,2.05);s.quadraticCurveTo(.8,2.58,.63,3);s.quadraticCurveTo(.54,3.15,.35,3.17);s.lineTo(-.7,3.17);s.quadraticCurveTo(-.96,3.1,-.96,2.87);s.lineTo(-.93,.95);
    const g=new THREE.ExtrudeGeometry(s,{depth:2.08,bevelEnabled:true,bevelThickness:.045,bevelSize:.055,bevelSegments:3,steps:1,curveSegments:10});g.translate(0,0,-1.04);return g;
  },[]);
  const windscreen=useMemo(()=>{const vertices=[],indices=[],rows=18;for(let row=0;row<=rows;row++){const t=.16+.78*row/rows;vertices.push(...sharedCabScreenPoint(t,-.86),...sharedCabScreenPoint(t,.86));}for(let row=0;row<rows;row++){const a=row*2;indices.push(a,a+2,a+1,a+1,a+2,a+3);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();return g;},[]);
  return <group position={[x,0,0]} name="formed-steel-cab-with-sloped-windscreen">
    <mesh geometry={body} material={MAT[color]} castShadow receiveShadow/>
    <mesh geometry={windscreen} material={MAT.glass}/>
    <Box at={[0,1.29,0]} size={[1.93,.43,2.18]} mat="blue"/>
    <Box at={[0,3.2,0]} size={[1.86,.12,2.19]} mat="white"/>
    {[-1.09,1.09].map(z=><group key={z}>
      <Box at={[-.12,2.56,z]} size={[1.29,.77,.032]} mat="glass"/>
      <Box at={[.35,2.56,z*1.014]} size={[.058,.83,.045]} mat="white"/>
      <Box at={[-.19,1.94,z]} size={[.38,.047,.035]} mat="steel"/>
      <Box at={[-.72,1.9,z]} size={[.025,1.9,.025]} mat="steel"/>
      <Box at={[.25,.85,z*1.09]} size={[.78,.15,.32]} mat="steel"/>
      <Beam from={[.56,2.25,z]} to={[.56,2.74,z*1.3]} radius={.031} mat="darkSteel"/>
      <Box at={[.56,2.74,z*1.33]} size={[.24,.39,.12]} mat="darkSteel"/>
      <Box at={[.25,1.31,z*1.021]} size={[.19,.06,.022]} mat="orange"/>
    </group>)}
    <Box at={[1.03,.89,0]} size={[.2,.29,2.19]} mat="white"/>
    <Box at={[.99,1.65,0]} size={[.06,.56,1.12]} mat="darkSteel"/>
    {Array.from({length:6},(_,i)=><Box key={i} at={[1.024,1.44+i*.085,0]} size={[.03,.025,1.03]} mat="steel"/>)}
    {[-.8,.8].map(z=><group key={z}><Box at={[1.03,1.05,z]} size={[.03,.21,.32]} mat="markings"/><Box at={[1.052,1.09,z]} size={[.025,.06,.27]} mat="paleBlue"/></group>)}
    {[-.5,.5].map(z=><CurveTube key={z} points={[sharedCabScreenPoint(.2,z-.16,.083),sharedCabScreenPoint(.36,z,.083),sharedCabScreenPoint(.57,z+.1,.083)]} radius={.012} mat="black"/>)}
    <Box at={[1.06,.9,0]} size={[.035,.17,.4]} mat="black"/>
  </group>;
}

export function tyreGeometry(radius=.54,width=.36){
  const key=`rounded-tyre:${radius}:${width}`;
  if(!geoCache.has(key)){const profile=[[.58,-.5],[.78,-.55],[.93,-.49],[.985,-.31],[1,0],[.985,.31],[.93,.49],[.78,.55],[.58,.5],[.58,-.5]].map(([r,y])=>new THREE.Vector2(r*radius,y*width));geoCache.set(key,new THREE.LatheGeometry(profile,32));}
  return geoCache.get(key);
}
function recessedRimGeometry(radius){
  const key=`recessed-rim:${radius}`;
  if(!geoCache.has(key)){const profile=[[.22,-.045],[.34,-.045],[.49,-.095],[.56,-.015],[.575,.015],[.54,.035],[.48,-.058],[.33,-.075],[.22,-.045]].map(([r,y])=>new THREE.Vector2(r*radius,y));geoCache.set(key,new THREE.LatheGeometry(profile,28));}
  return geoCache.get(key);
}
export function Wheels({axles, width=2.22, radius=.54, dual=true,visualState,distanceField='vehicleDistance'}) {
  const wheels=useRef([]);
  const frontAxle=Math.max(...axles);
  useFrame(()=>{const s=visualState?.current,travel=s?.[distanceField==='loaderDistance'?'loaderWheelTravel':'vehicleWheelTravel']??s?.[distanceField];if(!Number.isFinite(travel))return;wheels.current.forEach((wheel,i)=>{if(!wheel)return;wheel.rotation.z=-travel/radius;wheel.rotation.y=distanceField==='vehicleDistance'&&axles[Math.floor(i/2)]===frontAxle?s.vehicleSteer||0:0;});});
  return <group name="tyres-hubs-and-treads">
    {axles.flatMap((x,axle)=>[-1,1].map((side,n)=><group ref={node=>{wheels.current[axle*2+n]=node;}} key={`${x}/${side}`} position={[x,radius+.03,side*width/2]}>
      <mesh geometry={tyreGeometry(radius)} material={MAT.rubber} rotation={[Math.PI/2,0,0]} castShadow receiveShadow/>
      <mesh name="dished-steel-wheel-rim" geometry={recessedRimGeometry(radius)} material={MAT.steel} position={[0,0,side*.145]} rotation={[side*Math.PI/2,0,0]} castShadow/>
      <Cylinder at={[0,0,side*.14]} top={radius*.23} height={.09} mat="darkSteel" rotation={[Math.PI/2,0,0]}/>
      <AssetDetail name="near-wheel-tread-and-hub-fasteners" distance={72}><TireTread radius={radius}/>
      <StaticInstances name="wheel-bolt-instances">{Array.from({length:6},(_,i)=>{const a=i*Math.PI/3;return <Cylinder key={`b${i}`} at={[Math.sin(a)*radius*.34,Math.cos(a)*radius*.34,side*.157]} top={.027} height={.025} rotation={[Math.PI/2,0,0]} mat="darkSteel" segments={6} castShadow={false}/>;})}</StaticInstances></AssetDetail>
      {dual && axle<axles.length-1 && <group position={[0,0,-side*.34]} name="inner-dual-tyre"><mesh geometry={tyreGeometry(radius,.3)} material={MAT.rubber} rotation={[Math.PI/2,0,0]} castShadow receiveShadow/><AssetDetail name="near-inner-dual-tyre-tread" distance={55}><TireTread radius={radius}/></AssetDetail></group>}
    </group>))}
    {axles.map(x=><Beam key={x} from={[x,radius,-width/2]} to={[x,radius,width/2]} radius={.085} mat="darkSteel"/>)}
  </group>;
}
function TireTread({radius}){
  const key=`herringbone-tread:${radius}`;
  if(!geoCache.has(key)){
    const positions=[],normals=[],indices=[],v=new THREE.Vector3(),normal=new THREE.Vector3(),baseIndex=boxGeometry.index;
    for(let i=0;i<24;i++)for(const side of [-1,1]){
      const a=i/24*Math.PI*2,base=positions.length/3,q=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,0,-a));q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0,side*.38,0)));
      const matrix=new THREE.Matrix4().compose(new THREE.Vector3(Math.sin(a)*radius,Math.cos(a)*radius,side*.075),q,new THREE.Vector3(.077,.029,.145));
      for(let n=0;n<boxGeometry.attributes.position.count;n++){v.fromBufferAttribute(boxGeometry.attributes.position,n).applyMatrix4(matrix);normal.fromBufferAttribute(boxGeometry.attributes.normal,n).applyQuaternion(q).normalize();positions.push(v.x,v.y,v.z);normals.push(normal.x,normal.y,normal.z);}
      for(let n=0;n<baseIndex.count;n++)indices.push(base+baseIndex.getX(n));
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));g.setIndex(indices);geoCache.set(key,g);
  }
  return <mesh name="merged-herringbone-tread-blocks" geometry={geoCache.get(key)} material={MAT.rubber} castShadow/>;
}
function Chassis({length=8.2, center=-.35}) {
  return <group name="ladder-chassis-and-running-gear">
    {[-.7,.7].map(z=><Box key={z} at={[center,.87,z]} size={[length,.27,.13]} mat="darkSteel"/>)}
    {[-3,-1.5,0,1.5,3].map(x=><Box key={x} at={[x,.86,0]} size={[.12,.19,1.55]} mat="steel"/>)}
    <Box at={[.56,.72,-1.05]} size={[1.35,.43,.42]} mat="steel"/>
    <Box at={[.2,.7,1.02]} size={[1.04,.4,.32]} mat="darkSteel"/>
    <Cylinder at={[.56,1.2,-1.05]} top={.045} height={.4} mat="steel"/>
    <AssetDetail name="near-chassis-suspension-and-mounts" distance={65}><StaticGeometryParts name="chassis-fixed-suspension-details">{[-2.85,-1.55,2.75].flatMap(x=>[-.72,.72].map(z=><group key={`${x}/${z}`}><RoundedBlock at={[x,.75,z]} size={[.75,.075,.12]} radius={.018} mat="darkSteel"/><Beam from={[x-.22,.63,z]} to={[x+.11,.98,z]} radius={.036} mat="steel"/><RoundedBlock at={[x+.11,.98,z]} size={[.14,.13,.2]} radius={.035} mat="blue"/></group>))}</StaticGeometryParts></AssetDetail>
  </group>;
}

function Fender({at,radius=.66,span=0,width=.44}){
  const key=`formed-fender:${radius}:${span}:${width}`;
  if(!geoCache.has(key)){
    const v=[],index=[],n=28;
    for(let layer=0;layer<2;layer++)for(let i=0;i<=n;i++){const a=.04+i/n*(Math.PI-.08),r=radius+layer*.035,x=Math.cos(a)*r+(Math.cos(a)>=0?span/2:-span/2),y=Math.sin(a)*r;v.push(x,y,-width/2,x,y,width/2);}
    for(let layer=0;layer<2;layer++)for(let i=0;i<n;i++){const a=layer*(n+1)*2+i*2;index.push(...(layer?[a,a+2,a+1,a+1,a+2,a+3]:[a,a+1,a+2,a+1,a+3,a+2]));}
    for(let i=0;i<n;i++)for(const side of [0,1]){const a=i*2+side,b=a+2,c=a+(n+1)*2,d=b+(n+1)*2;index.push(a,b,c,b,d,c);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.setIndex(index);g.computeVertexNormals();geoCache.set(key,g);
  }
  return <group position={at} name="pressed-curved-wheel-wing"><mesh geometry={geoCache.get(key)} material={MAT.blue} castShadow receiveShadow/><AssetDetail name="near-wing-inner-lip-and-mounts" distance={65}><Beam from={[-span/2-.48,.2,0]} to={[-span/2-.48,.39,-.19]} radius={.026} mat="darkSteel"/><Beam from={[span/2+.48,.2,0]} to={[span/2+.48,.39,-.19]} radius={.026} mat="darkSteel"/></AssetDetail></group>;
}

function Helix({radius=1.2,length=3.05,turns=1.1,phase=0,mat='blue',thickness=.036}) {
  const geometry=useMemo(()=>{
    const points=Array.from({length:81},(_,i)=>{const t=i/80,a=t*Math.PI*2*turns+phase;return new THREE.Vector3(Math.cos(a)*radius,(t-.5)*length,Math.sin(a)*radius);});
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),80,thickness,6,false);
  },[radius,length,turns,phase,thickness]);
  return <mesh geometry={geometry} material={MAT[mat]} castShadow/>;
}

function MixerTruck({paused=false,fill=1,unloading=false,visualClock,visualState}) {
  const drum=useRef(),loadMark=useRef(),clock=useRef(0);
  useFrame((_,dt)=>{
    const time=advanceVisualTime(clock,visualClock,dt,paused);
    if(drum.current)drum.current.rotation.y=mixerDrumAngle(visualState?.current,time,unloading);
    if(loadMark.current)loadMark.current.visible=(visualState?.current?.vehicleFill??fill)>.001;
  });
  return <group name="precision-blue-white-transit-mixer" userData={{drumAxis:'local tilted Y, rear toward -X',drumInclinationRadians:.17,feedOpening:[-3.56,3.95,0],dischargeLip:[-5.735,1.622,0]}}>
    <Chassis length={8.65} center={-.35}/><MixerCab/><Wheels axles={[-2.85,-1.55,2.75]} width={2.18} visualState={visualState}/>
    {drumCradleStations.map(station=><DrumCradle key={station.s} {...{station,paused,unloading,visualClock,visualState}}/>)}
    <group name="correct-inclined-rotational-axis" position={[-.77,2.55,0]} rotation={[0,0,Math.PI/2-.17]}>
      <group ref={drum} name="continuous-smooth-lathe-drum">
        <mesh geometry={smoothDrumGeometry} material={MAT.white} castShadow receiveShadow/>
        <DrumRibbon/><DrumRibbon phase={Math.PI}/>
        {[-1.42,1.05].map(y=><Ring key={y} at={[0,y,0]} radius={drumRadius(y)+.008} thickness={.025} mat="steel"/>)}
        <Ring at={[0,2.81,0]} radius={.436} thickness={.029} mat="steel"/>
        <Cylinder at={[0,2.52,0]} top={.36} height={.014} mat="black"/>
        <mesh ref={loadMark} position={[0,2.538,0]} scale={[.305,.008,.305]} geometry={unitCylinderGeometry} material={MAT.wetConcrete}/>
        <group position={[0,2.48,0]}><Helix radius={.345} length={.42} turns={.8} mat="steel" thickness={.027}/></group>
      </group>
    </group>
    <group name="front-hydraulic-drum-drive" position={[1.72,2.13,0]}>
      <Cylinder top={.47} height={.17} rotation={[0,0,Math.PI/2-.17]} mat="steel"/>
      <Cylinder at={[.17,-.03,0]} top={.3} height={.32} rotation={[0,0,Math.PI/2-.17]} mat="blue"/>
      <RoundedBlock at={[.22,-.26,0]} size={[.34,.45,.49]} radius={.08} mat="darkSteel"/>
    </group>
    <CurveTube points={[[1.92,1.92,-.26],[1.65,1.42,-.44],[.5,1.02,-.7],[-.05,1.18,-.93]]} radius={.029} mat="black"/>
    <CurveTube points={[[1.94,1.88,.25],[1.63,1.42,.46],[.54,1.03,.74]]} radius={.027} mat="black"/>
    {[-1,1].map(side=><group key={side} name="wheel-arch-suspension-and-side-guard">
      <Fender at={[2.75,.57,side*1.045]} radius={.655} width={.47}/>
      <Fender at={[-2.2,.57,side*1.08]} radius={.655} span={1.3} width={.5}/>
      <Box at={[-2.2,.78,side*1.03]} size={[2,.11,.11]} mat="darkSteel"/>
      <Beam from={[-.58,1.1,side*1.07]} to={[.87,1.1,side*1.07]} radius={.046} mat="steel"/>
      <Beam from={[-.58,.79,side*1.07]} to={[.87,.79,side*1.07]} radius={.037} mat="steel"/>
    </group>)}
    <group name="wash-water-tank-valves-and-pipes">
      <Cylinder at={[-.72,1.55,1.035]} top={.24} height={1.48} rotation={[0,0,Math.PI/2]} mat="paleBlue"/><Ball at={[-1.47,1.55,1.035]} size={[.16,.24,.24]} mat="paleBlue"/><Ball at={[.03,1.55,1.035]} size={[.16,.24,.24]} mat="paleBlue"/>
      <Cylinder at={[-.42,1.85,1.035]} top={.07} height={.12} mat="steel"/><Ring at={[-1.23,1.55,1.035]} radius={.246} thickness={.025} rotation={[0,Math.PI/2,0]} mat="steel"/>
      <CurveTube points={[[-1.47,1.4,1.04],[-2,1.36,1.03],[-3.44,2.25,.76],[-3.5,3.68,.52]]} radius={.024} mat="black"/>
      <Cylinder at={[-1.6,1.34,1.02]} top={.065} height={.14} mat="steel"/><Beam from={[-1.7,1.4,1.02]} to={[-1.5,1.4,1.02]} radius={.022} mat="blue"/>
    </group>
    <group name="rear-access-ladder-and-guarded-grating-platform">
      <Grating at={[-3.7,3.08,0]} width={.92} depth={1.89}/>
      {[-4.14,-3.57].map(x=><Beam key={x} from={[x,.95,-1.04]} to={[x+.48,3.1,-1.04]} radius={.029} mat="steel"/>)}
      {Array.from({length:7},(_,i)=>{const t=i/6;return <Beam key={i} from={[-4.14+t*.48,1.08+t*1.9,-1.04]} to={[-3.57+t*.48,1.08+t*1.9,-1.04]} radius={.025} mat="steel"/>;})}
      {[-.92,.92].map(z=><group key={z}><Beam from={[-4.07,3.05,z]} to={[-4.07,3.78,z]} radius={.025} mat="steel"/><Beam from={[-4.07,3.76,z]} to={[-3.37,3.76,z]} radius={.025} mat="steel"/></group>)}
    </group>
    <group name="open-rear-loading-funnel" position={[-3.56,3.25,0]}>
      <mesh geometry={mixerFeedGeometry} material={MAT.chuteSteel} castShadow receiveShadow/>
      <Ring at={[0,.7,0]} radius={.567} thickness={.026} mat="steel"/>
      <Beam from={[0,.02,0]} to={[.02,-.22,0]} radius={.19} mat="darkSteel"/>
    </group>
    <group name="open-collector-and-transition-throat">
      <mesh geometry={rearCollectorGeometry} position={[-3.73,2.5,0]} material={MAT.chuteSteel} castShadow receiveShadow/>
      <Ring at={[-3.73,2.95,0]} radius={.356} thickness={.017} mat="steel"/>
      <Beam from={[-3.73,2.51,0]} to={[-3.9,2.42,0]} radius={.138} mat="chuteSteel"/>
      {[-.34,.34].map(z=><Beam key={z} from={[-3.71,2.63,z]} to={[-3.51,1.07,z]} radius={.033} mat="blue"/>)}
    </group>
    <MixerChute unloading={unloading} visualState={visualState}/>
    <ChuteHydraulic unloading={unloading} visualState={visualState}/>
    <RoundedBlock at={[-4.29,.95,0]} size={[.2,.2,2.13]} radius={.06} mat="steel"/>
    {[-.81,.81].map(z=><group key={z}><RoundedBlock at={[-4.42,1.15,z]} size={[.05,.18,.36]} radius={.035} mat="black"/><RoundedBlock at={[-4.455,1.15,z-.08]} size={[.025,.115,.14]} radius={.026} mat="tailLamp"/><RoundedBlock at={[-4.455,1.15,z+.08]} size={[.025,.115,.11]} radius={.025} mat="orange"/></group>)}
    <RoundedBlock at={[-4.43,1.06,0]} size={[.027,.13,.41]} radius={.025} mat="markings"/>
  </group>;
}

function PowderTruck({fill=1,visualState}) {
  const gauge=useRef();useFrame(()=>{if(!gauge.current)return;const level=visualState?.current?.vehicleFill??fill;gauge.current.position.y=1.65+level*.57;gauge.current.scale.y=Math.max(.04,level*1.14);});
  return <group name="high-detail-pneumatic-bulk-tanker">
    <Chassis length={9.7} center={-.4}/><Cab x={3.8}/><Wheels axles={[-3.95,-2.58,3.55]} visualState={visualState}/>
    <Cylinder at={[-1.05,2.2,0]} top={1.02} height={5.8} rotation={[0,0,Math.PI/2]} mat="white" segments={48}/>
    <Ball at={[-3.96,2.2,0]} size={[.49,1.02,1.02]} mat="white"/><Ball at={[1.86,2.2,0]} size={[.49,1.02,1.02]} mat="white"/>
    {[-3.05,-1.1,.85].map(x=><group key={x}>
      <Ring at={[x,2.2,0]} radius={1.034} thickness={.055} rotation={[0,Math.PI/2,0]} mat="blue"/>
      <Cylinder at={[x,3.27,0]} top={.26} height={.12} mat="steel"/><Ring at={[x,3.34,0]} radius={.23} thickness={.024} mat="darkSteel"/>
      <Cylinder at={[x,1.18,0]} top={.51} bottom={.14} height={.72} mat="white"/>
      <Beam from={[x,.83,0]} to={[x,.83,1.15]} radius={.065} mat="steel"/>
      <Cylinder at={[x,.83,.94]} top={.12} height={.08} mat="blue" rotation={[Math.PI/2,0,0]}/>
    </group>)}
    <Beam from={[-3.8,3.45,-.62]} to={[1.8,3.45,-.62]} radius={.035}/><Beam from={[-3.8,3.45,.62]} to={[1.8,3.45,.62]} radius={.035}/>
    <Beam from={[-3.7,.83,1.14]} to={[1,.83,1.14]} radius={.08}/>
    <Box at={[-3.7,1.3,1.05]} size={[.8,.68,.43]} mat="blue"/>
    <Cylinder at={[-3.67,1.32,1.3]} top={.16} height={.17} rotation={[Math.PI/2,0,0]} mat="steel"/>
    <Cylinder at={[1.6,1.48,-.62]} top={.16} height={.7} mat="darkSteel"/>
    <Beam from={[1.6,1.48,-.62]} to={[-3.7,1.26,.95]} radius={.04} mat="black"/>
    <Box at={[-.2,2.28,1.034]} size={[.12,1.3,.035]} mat="darkSteel"/>
    <mesh ref={gauge} position={[-.2,1.65+fill*.57,1.06]} scale={[.065,Math.max(.04,fill*1.14),.022]} geometry={boxGeometry} material={MAT.paleBlue}/>
    <Beam from={[-4.14,1.04,-.73]} to={[-4.14,3.3,-.73]} radius={.03}/>
    {[1.28,1.7,2.12,2.54,2.96].map(y=><Beam key={y} from={[-4.15,y,-.73]} to={[-4.15,y,-.25]} radius={.022}/>)}
  </group>;
}

function LiveHydraulic({from,getTo,visualState,bodyRadius=.10,rodRadius=.055}){
  const barrel=useRef(),rod=useRef();
  const scratch=useMemo(()=>({a:new THREE.Vector3(),b:new THREE.Vector3(),d:new THREE.Vector3(),direction:new THREE.Vector3(),up:new THREE.Vector3(0,1,0),q:new THREE.Quaternion()}),[]);
  useFrame(()=>{if(!barrel.current||!rod.current)return;scratch.a.set(...from);scratch.b.set(...getTo(visualState?.current||{}));scratch.d.subVectors(scratch.b,scratch.a);const length=Math.max(.001,scratch.d.length());scratch.q.setFromUnitVectors(scratch.up,scratch.direction.copy(scratch.d).normalize());barrel.current.position.copy(scratch.a).addScaledVector(scratch.d,.32);barrel.current.quaternion.copy(scratch.q);barrel.current.scale.set(bodyRadius,length*.64,bodyRadius);rod.current.position.copy(scratch.a).addScaledVector(scratch.d,.5);rod.current.quaternion.copy(scratch.q);rod.current.scale.set(rodRadius,length,rodRadius);});
  return <group name="live-pivot-coupled-hydraulic-cylinder"><mesh ref={barrel} geometry={unitCylinderGeometry} material={MAT.blue} castShadow/><mesh ref={rod} geometry={unitCylinderGeometry} material={MAT.steel} castShadow/></group>;
}
function DumpTruck({tip=0,fill=1,materialKind='sand',visualState}) {
  const body=useRef(),gate=useRef();
  const angle=THREE.MathUtils.clamp(tip,0,1)*.66;
  const getTop=s=>{const a=THREE.MathUtils.clamp(s.tip??tip,0,1)*.66;return[-3.75+Math.cos(a)*3.1,1.37+Math.sin(a)*3.1,0];};
  useFrame(()=>{const value=THREE.MathUtils.clamp(visualState?.current?.tip??tip,0,1);if(body.current)body.current.rotation.z=value*.66;if(gate.current)gate.current.rotation.z=-value*.55;});
  return <group name="high-detail-tipping-aggregate-truck">
    <Chassis length={8.1}/><Cab x={2.95}/><Wheels axles={[-2.65,-1.4,2.8]} visualState={visualState}/>
    <group ref={body} position={[-3.75,1.42,0]} rotation={[0,0,angle]} name="pivoting-dump-body">
      <Box at={[2.38,.12,0]} size={[4.85,.24,2.48]} mat="darkSteel"/>
      {[-1.23,1.23].map(z=><group key={z}>
        <Box at={[2.38,.81,z]} size={[4.85,1.24,.12]} mat="blue"/>
        <Box at={[2.38,1.46,z]} size={[4.93,.1,.16]} mat="paleBlue"/>
        {[.45,1.4,2.35,3.3,4.25].map(x=><Box key={x} at={[x,.81,z*1.06]} size={[.08,1.23,.075]} mat="paleBlue"/>)}
      </group>)}
      <Box at={[4.77,.85,0]} size={[.12,1.4,2.48]} mat="blue"/>
      <group ref={gate} position={[0,1.4,0]} rotation={[0,0,-tip*.55]}>
        <Box at={[0,-.6,0]} size={[.14,1.27,2.48]} mat="blue"/>
        <Box at={[-.09,-.7,0]} size={[.08,.07,2.38]} mat="paleBlue"/>
      </group>
      <MaterialPile at={[2.36,.3,0]} fill={fill} type={materialKind==='sand'?'sand':'stone'} seed={12} scale={[.82,.43,.48]} visualState={visualState} fillField="vehicleFill"/>
    </group>
    <LiveHydraulic from={[-.6,.76,0]} getTo={getTop} visualState={visualState} bodyRadius={.13} rodRadius={.07}/>
    <Box at={[-3.89,.89,0]} size={[.14,.2,2.18]} mat="white"/>
    {[-.77,.77].map(z=><Box key={z} at={[-3.99,1.02,z]} size={[.03,.16,.23]} mat="red"/>)}
  </group>;
}

function Loader({bucket=0,fill=0,arm,tilt,steer=0,action,materialKind='sand',visualState}) {
  const front=useRef(),armGroup=useRef(),bucketGroup=useRef();
  const fallback={bucket,fill,arm,tilt,steer},pose=loaderKinematics({},fallback),lift=pose.arm;
  useFrame(()=>{const p=loaderKinematics(visualState?.current,fallback);if(front.current)front.current.rotation.y=p.steer;if(armGroup.current)armGroup.current.rotation.z=p.arm;if(bucketGroup.current)bucketGroup.current.rotation.z=p.tilt;});
  return <group name="articulated-wheel-loader-with-lift-arm">
    <RoundedBlock at={[-1.06,1.12,0]} size={[3.05,.58,1.84]} radius={.21} mat="yellow"/>
    <RoundedBlock at={[-1.74,1.84,0]} size={[1.88,1.13,1.84]} radius={.24} mat="yellow"/>
    <RoundedBlock at={[-2.65,1.79,0]} size={[.09,.8,1.54]} radius={.12} mat="darkSteel"/>
    {Array.from({length:8},(_,i)=><Box key={i} at={[-2.71,1.46+i*.087,0]} size={[.03,.025,1.45]} mat="steel"/>)}
    <RoundedBlock at={[-.1,2.35,0]} size={[1.5,1.9,1.48]} radius={.13} mat="glass"/>
    <RoundedBlock at={[-.1,3.37,0]} size={[1.77,.18,1.71]} radius={.08} mat="yellow"/>
    {[-.7,.7].flatMap(x=>[-.74,.74].map(z=><Box key={`${x}/${z}`} at={[-.1+x,2.35,z]} size={[.075,1.9,.075]} mat="yellow"/>))}
    <Wheels axles={[-1.78]} width={2.08} radius={.73} dual={false} visualState={visualState} distanceField="loaderDistance"/>
    <Cylinder at={[.55,1.3,0]} top={.26} height={.74} mat="darkSteel"/>
    <group ref={front} position={[.4,0,0]} rotation={[0,steer,0]} name="articulated-front-frame-steering-joint">
    <RoundedBlock at={[.4,1.12,0]} size={[1.6,.38,1.52]} radius={.12} mat="yellow"/>
    <Wheels axles={[.77]} width={2.08} radius={.73} dual={false} visualState={visualState} distanceField="loaderDistance"/>
    <group ref={armGroup} position={[.23,1.47,0]} rotation={[0,0,lift]} name="pivoting-loader-lift-arm">
      {[-.64,.64].map(z=><group key={z}>
        <RoundedBlock at={[1.26,.09,z]} size={[2.56,.22,.19]} radius={.075} mat="yellow"/>
        <Cylinder at={[0,0,z]} top={.16} height={.22} rotation={[Math.PI/2,0,0]} mat="steel"/>
        <LiveHydraulic from={[1.02,.38,z]} getTo={s=>{const p=loaderKinematics(s,fallback);return[2.6-.36*Math.cos(p.tilt)-.25*Math.sin(p.tilt),-.36*Math.sin(p.tilt)+.25*Math.cos(p.tilt),z];}} visualState={visualState} bodyRadius={.09} rodRadius={.047}/>
      </group>)}
      <group ref={bucketGroup} position={[2.6,0,0]} rotation={[0,0,pose.tilt]} name="pivoting-loader-bucket">
        <mesh name="formed-curved-steel-bucket-shell" geometry={loaderBucketShellGeometry} material={MAT.yellowDark} castShadow receiveShadow/>
        {[-1.22,1.22].map(z=><Box key={z} at={[.3,.06,z]} size={[1.57,.67,.1]} mat="yellow"/>)}
        {[-.81,.81].map(z=><Cylinder key={z} at={[-.36,.25,z]} top={.11} height={.16} rotation={[Math.PI/2,0,0]} mat="steel"/>)}
        {Array.from({length:7},(_,i)=><Box key={i} at={[1.29,-.29,-1.03+i*.34]} size={[.27,.09,.14]} mat="steel"/>)}
        <MaterialPile at={[.26,-.16,0]} type={materialKind==='stone'?'stone':'sand'} fill={fill} seed={9} scale={[.22,.2,.49]} visualState={visualState} fillField="loaderFill"/>
      </group>
    </group>
    {[-.64,.64].map(z=><LiveHydraulic key={z} from={[-.25,1.72,z]} getTo={s=>{const p=loaderKinematics(s,fallback);return[.23+Math.cos(p.arm)*1.3,1.47+Math.sin(p.arm)*1.3,z];}} visualState={visualState} bodyRadius={.095} rodRadius={.055}/>)}
    </group>
    <Cylinder at={[-1.85,2.95,-.56]} top={.06} height={1.45} mat="darkSteel"/>
    <Cylinder at={[-.1,3.55,0]} top={.11} height={.18} mat="orange"/>
    <Beam from={[-.9,.82,1.05]} to={[-.9,1.9,1.05]} radius={.035}/>
    <Box at={[-.9,1.07,1.06]} size={[.6,.06,.27]} mat="steel"/>
  </group>;
}

export function Silo({kind='cement',code='C01',cutaway=false,fill=.65,transferActive=false,visualState,materialKind=kind,capacity=kind==='cement'?220:120}) {
  const fillVolume=useRef(),riser=useRef(),id=`${kind}-${code.toLowerCase()}`;
  useFrame(()=>{const s=visualState?.current,current=s?.flowKind==='powder'&&s.materialKind===materialKind&&s.targetId===id;
    if(fillVolume.current&&current){const level=THREE.MathUtils.clamp((s.initialStock+s.net*(s.unloadProgress||0)-(s.materialConsumed||0))/capacity,0,1);fillVolume.current.position.y=6.45+level*4.5;fillVolume.current.scale.y=Math.max(.1,level*9);}
    if(riser.current){const active=visualState?current&&s.powderFlowActive:transferActive;riser.current.traverse(mesh=>{if(mesh.isMesh){mesh.material=active?MAT.pipeSection:MAT.steel;mesh.castShadow=!active;}});}
  });
  return <group name={`${code}-silo-pressure-system`}>
    <StaticInstances name={`${code}-fixed-supports`}>
    <Box at={[0,.15,0]} size={[3.8,.3,3.8]} mat="concrete"/>
    {[-1,1].flatMap(x=>[-1,1].map(z=><group key={`${x}/${z}`}>
      <IBeam from={[x*1.08,.25,z*1.08]} to={[x*1.08,5,z*1.08]} width={.21} depth={.22}/>
      <Box at={[x*1.08,.38,z*1.08]} size={[.48,.12,.48]} mat="steel"/><Bolts at={[x*1.08,.47,z*1.08]} batch={false}/>
      <Sensor at={[x*1.08,.58,z*1.08]}/>
    </group>))}
    <Beam from={[-1.08,.8,1.08]} to={[1.08,4.6,1.08]} radius={.045} mat="cobalt"/><Beam from={[1.08,.8,1.08]} to={[-1.08,4.6,1.08]} radius={.045} mat="cobalt"/>
    </StaticInstances>
    <Cylinder at={[0,5.35,0]} top={1.48} bottom={.25} height={2.1} mat="white" arc={cutaway?Math.PI:Math.PI*2} start={cutaway?-Math.PI/2:0}/>
    <Cylinder at={[0,11.1,0]} top={1.48} height={9.4} mat="white" segments={48} arc={cutaway?Math.PI:Math.PI*2} start={cutaway?-Math.PI/2:0}/>
    <Cylinder at={[0,7.1,0]} top={1.49} height={.8} mat={kind==='cement'?'blue':'paleBlue'} segments={48} arc={cutaway?Math.PI:Math.PI*2} start={cutaway?-Math.PI/2:0}/>
    {cutaway && <group name="silo-powder-section"><mesh ref={fillVolume} position={[0,6.45+fill*4.5,0]} scale={[1.35,Math.max(.1,fill*9),1.35]} geometry={unitCylinderGeometry} material={MAT.powder}/><Cylinder at={[0,5.35,0]} top={1.35} bottom={.23} height={2.04} mat="powder"/></group>}
    <StaticInstances name={`${code}-fixed-roof-ladder-and-rings`}>
    {[6.45,8.6,10.9,13.2,15.8].map(y=><Ring key={y} at={[0,y,0]} radius={1.493} thickness={.022}/>) }
    <Cylinder at={[0,16.02,0]} top={.85} bottom={1.48} height={.48} mat="white"/>
    <Cylinder at={[.35,16.71,-.35]} top={.42} height={.85} mat="steel"/>
    <Cylinder at={[.35,17.15,-.35]} top={.48} height={.1} mat="white"/>
    {Array.from({length:8},(_,i)=>{const a=i*Math.PI/4;return <Beam key={i} from={[.35+Math.cos(a)*.43,16.37,-.35+Math.sin(a)*.43]} to={[.35+Math.cos(a)*.43,17.1,-.35+Math.sin(a)*.43]} radius={.023}/>;})}
    <Sensor at={[-.63,16.35,.42]}/><Cylinder at={[-.8,16.36,-.38]} top={.14} height={.32} mat="red"/>
    <Ring at={[0,16.88,0]} radius={1.59} thickness={.035}/><Ring at={[0,16.55,0]} radius={1.59} thickness={.024}/>
    {Array.from({length:12},(_,i)=>{const a=i*Math.PI/6;return <Beam key={i} from={[Math.cos(a)*1.59,16.2,Math.sin(a)*1.59]} to={[Math.cos(a)*1.59,16.91,Math.sin(a)*1.59]} radius={.025}/>;})}
    {[-.28,.28].map(x=><Beam key={x} from={[x,4.7,1.65]} to={[x,16.9,1.65]} radius={.028}/>)}
    {Array.from({length:32},(_,i)=><Beam key={i} from={[-.28,4.95+i*.38,1.65]} to={[.28,4.95+i*.38,1.65]} radius={.02}/>)}
    {[7,9,11,13,15].map(y=><Ring key={y} at={[0,y,1.83]} radius={.43} thickness={.022}/>)}
    <Beam from={[.42,6.65,1.83]} to={[.42,16.2,1.83]} radius={.018}/><Beam from={[-.42,6.65,1.83]} to={[-.42,16.2,1.83]} radius={.018}/>
    {[1.1,3,5.6,8.3,11,13.7].map(y=><Ring key={y} at={[-1.57,y,-.5]} radius={.1} thickness={.02} rotation={[Math.PI/2,0,0]}/>)}
    <Ring at={[0,4.9,0]} radius={.7} thickness={.035} mat="blue"/>
    {Array.from({length:4},(_,i)=>{const a=i*Math.PI/2;return <group key={i}><Beam from={[Math.cos(a)*.7,4.9,Math.sin(a)*.7]} to={[Math.cos(a)*.96,4.9,Math.sin(a)*.96]} radius={.033} mat="blue"/><Ball at={[Math.cos(a)*.98,4.9,Math.sin(a)*.98]} size={[.1,.06,.1]} mat="steel"/></group>;})}
    <Cylinder at={[0,4.12,0]} top={.21} height={.39} mat="cobalt"/><Box at={[.36,4.13,0]} size={[.6,.19,.22]} mat="blue"/><Sensor at={[.35,4.45,.32]}/>
    </StaticInstances>
    <group ref={riser} name="pneumatic-unloading-riser"><Beam from={[-1.57,.6,-.5]} to={[-1.57,15.68,-.5]} radius={.065} mat={transferActive?'pipeSection':'steel'}/><Beam from={[-1.57,15.68,-.5]} to={[-.6,16.28,-.5]} radius={.065} mat={transferActive?'pipeSection':'steel'}/></group>
  </group>;
}

export function AggregateShed({materialKind='sand',delivered=0,selectedId,onSelect,visualState}) {
  const pileLevel=(s,kind)=>(s?.flowKind==='aggregate'&&s.materialKind===kind) ? .85+.15*THREE.MathUtils.clamp(((s.net||1)*(s.unloadProgress||0)-(s.materialConsumed||0)-(s.loaderMaterialAmount||0))/(s.net||1),0,1) : .85;
  return <group name="separated-aggregate-unloading-and-storage">
    <StaticInstances name="aggregate-shed-fixed-roof-and-bay-structure">
    <Box at={[0,.14,0]} size={[20.8,.28,9.5]} mat="concrete"/><Box at={[0,1,-4.45]} size={[20.8,1.7,.2]} mat="concrete"/>
    {[-10.2,-3.4,3.4,10.2].map(x=><group key={x}>
      <Box at={[x,.94,0]} size={[.16,1.6,9]} mat="concrete"/>
      {[-4.4,4.4].map(z=><IBeam key={z} from={[x,.26,z]} to={[x,4.95,z]} width={.2} depth={.22} mat="steel"/>)}
      <IBeam from={[x,4.55,-4.5]} to={[x,5.04,4.5]} width={.18} depth={.2} mat="steel"/>
      <Beam from={[x,2.8,-4.5]} to={[x,4.7,-2.7]} radius={.035}/>
    </group>)}
    <Box at={[0,5.03,0]} size={[21.4,.14,9.8]} rotation={[.054,0,0]} mat="paleBlue"/>
    {Array.from({length:21},(_,i)=><Box key={i} at={[-10.1+i*1.02,5.14,0]} size={[.025,.025,9.8]} rotation={[.054,0,0]} mat="white"/>)}
    <Box at={[0,5.18,4.9]} size={[21.4,.23,.14]} mat="cobalt"/>
    </StaticInstances>
    <group name="aggregate-sand" userData={{entityId:'aggregate-sand',warehouse:'A02-01'}} onClick={event=>{event.stopPropagation();onSelect?.('aggregate-sand');}}>
      <MaterialPile at={[-6.8,.3,0]} seed={2} fill={.85+(materialKind==='sand'?delivered*.15:0)} visualState={visualState} getFill={s=>pileLevel(s,'sand')}/>
      {selectedId==='aggregate-sand'&&<Ring at={[-6.8,.34,0]} radius={2.7} thickness={.055} mat="green" rotation={[Math.PI/2,0,0]}/>}
    </group>
    <MaterialPile at={[0,.3,0]} type="gravel" seed={7} fill={.85}/>
    <group name="aggregate-stone" userData={{entityId:'aggregate-stone',warehouse:'A02-03'}} onClick={event=>{event.stopPropagation();onSelect?.('aggregate-stone');}}>
      <MaterialPile at={[6.8,.3,0]} type="stone" seed={3} fill={.85+(materialKind==='stone'?delivered*.15:0)} visualState={visualState} getFill={s=>pileLevel(s,'stone')}/>
      {selectedId==='aggregate-stone'&&<Ring at={[6.8,.34,0]} radius={2.7} thickness={.055} mat="green" rotation={[Math.PI/2,0,0]}/>}
    </group>
    <StaticInstances name="aggregate-shed-fixed-terminal-rails">{[-6.8,0,6.8].map(x=><group key={x}><Beam from={[x,2.85,4.55]} to={[x,3.3,4.55]} radius={.023}/><Box at={[x,3.36,4.55]} size={[1.12,.46,.045]} mat="blue"/></group>)}
    <Beam from={[-9.8,4.24,4.44]} to={[9.8,4.24,4.44]} radius={.036} mat="blue"/>
    {[-7,-3.5,0,3.5,7].map(x=><Cylinder key={x} at={[x,4.2,4.49]} top={.055} height={.1} mat="steel"/>)}</StaticInstances>
  </group>;
}

export function Hopper({at=[0,0,0],fill=.75,active=false,gateOpen=active,materialKind='stone',visualState,binIndex=0}) {
  const opening=THREE.MathUtils.clamp(Number(gateOpen)||0,0,1),level=THREE.MathUtils.clamp(fill,0,1);
  const storedMaterial=materialKind==='sand'?'sand':'stone',material=useRef(),gates=useRef([]),outlet=useRef(),indicator=useRef();
  const particlePose=useMemo(()=>new THREE.Object3D(),[]);
  const getFill=s=>s?.aggregateBinFill?.[binIndex]??level;
  useFrame(()=>{const s=visualState?.current;if(!s)return;const value=getFill(s),gate=s.binGateOpen?.[binIndex]??opening;if(material.current){material.current.position.y=1.88+value*.42;material.current.visible=value>.001;}gates.current.forEach((node,i)=>{if(node)node.position.x=(i===0?-1:1)*(.265+gate*.66);});if(indicator.current)indicator.current.material=gate>.001?MAT.green:MAT.steel;if(!outlet.current)return;outlet.current.visible=gate>.001&&value>.001;if(!outlet.current.visible)return;for(let i=0;i<8;i++){const p=((s.time||0)*1.7+i/8)%1;particlePose.position.set(Math.sin(i*2.1)*.26,.91-p*.17,Math.cos(i*2.1)*.3);particlePose.scale.setScalar((storedMaterial==='sand'?.032:.047)*Math.min(1,gate*2));particlePose.rotation.set(i*.3,i*.8,0);particlePose.updateMatrix();outlet.current.setMatrixAt(i,particlePose.matrix);}outlet.current.instanceMatrix.needsUpdate=true;});
  const geometry=useMemo(()=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([-1.85,1.9,-1.55,1.85,1.9,-1.55,1.85,1.9,1.55,-1.85,1.9,1.55,-.52,1,-.52,.52,1,-.52,.52,1,.52,-.52,1,.52],3));g.setIndex([0,1,4,1,5,4,1,2,5,2,6,5,2,3,6,3,7,6,3,0,7,0,4,7]);g.computeVertexNormals();return g;},[]);
  return <group position={at} name="automatic-aggregate-storage-weighing-and-slide-gate" userData={{topOpeningHeight:2.5,outlet:[0,.92,0],gateType:'paired pneumatic slide plates'}}>
    <StaticInstances name={`aggregate-bin-${binIndex}-fixed-rim-and-shell`}>
    <mesh geometry={geometry} material={MAT.cobalt} castShadow receiveShadow/>
    {[-1.82,1.82].map(x=><Box key={x} at={[x,2.2,0]} size={[.075,.6,3.1]} mat="blue"/>)}
    {[-1.52,1.52].map(z=><Box key={z} at={[0,2.2,z]} size={[3.7,.6,.075]} mat="blue"/>)}
    {[-1.52,1.52].map(z=><Box key={z} at={[0,2.51,z]} size={[3.82,.085,.1]} mat="steel"/>)}
    {[-1.82,1.82].map(x=><Box key={x} at={[x,2.51,0]} size={[.1,.085,3.13]} mat="steel"/>)}
    </StaticInstances>
    {(level>0||visualState)&&<group ref={material} position={[0,1.88+level*.42,0]} name="stored-aggregate-in-open-bin"><Box at={[0,-.07,0]} size={[3.3,.12,2.72]} mat={storedMaterial}/><MaterialPile at={[0,0,0]} type={storedMaterial} seed={31} fill={level} scale={[.57,.065,.57]} visualState={visualState} getFill={getFill}/></group>}
    <StaticInstances name={`aggregate-bin-${binIndex}-fixed-supports`}>
    {[-1.75,1.75].flatMap(x=>[-1.45,1.45].map(z=><group key={`${x}/${z}`}>
      <IBeam from={[x,.2,z]} to={[x,2.54,z]} width={.14} depth={.15} mat="steel"/>
      <Box at={[x,1.77,z]} size={[.33,.08,.3]} mat="steel"/><RoundedBlock at={[x,1.86,z]} size={[.29,.095,.22]} radius={.02} mat="yellow"/>
      <Cylinder at={[x,1.96,z]} top={.045} height={.08} mat="steel"/><Bolts at={[x,1.79,z]} spacing={.18} batch={false}/>
    </group>))}
    {[-1.7,1.7].map(x=><Box key={x} at={[x,2.7,0]} size={[.06,.3,3.4]} mat="paleBlue"/>)}
    </StaticInstances>
    <group name="metering-slide-gate-and-actuation" position={[0,0,0]}>
      <Box at={[0,.995,-.58]} size={[1.36,.105,.11]} mat="steel"/><Box at={[0,.995,.58]} size={[1.36,.105,.11]} mat="steel"/>
      {[-1,1].map((side,i)=><group key={side}>
        <group ref={node=>{gates.current[i]=node;}} position={[side*(.265+opening*.66),.935,0]}><RoundedBlock size={[.565,.065,1.07]} radius={.035} mat="steel"/></group>
        <Beam from={[side*.55,.965,.72]} to={[side*1.57,.965,.72]} radius={.037} mat="steel"/>
        <Cylinder at={[side*1.28,.965,.72]} top={.095} height={.62} rotation={[0,0,Math.PI/2]} mat="blue"/>
        <Cylinder at={[side*.64,.965,.72]} top={.052} height={.47} rotation={[0,0,Math.PI/2]} mat="steel"/>
        <RoundedBlock at={[side*1.57,.965,.72]} size={[.18,.26,.27]} radius={.045} mat="darkSteel"/>
        <Sensor at={[side*.68,1.12,.55]}/>
      </group>)}
      <Box at={[-.6,.78,0]} size={[.055,.24,1.18]} mat="darkSteel"/><Box at={[.6,.78,0]} size={[.055,.24,1.18]} mat="darkSteel"/>
      <instancedMesh ref={outlet} args={[storedMaterial==='sand'?sphereGeometry:pebbleGeometry,MAT[storedMaterial],8]} frustumCulled={false} castShadow={false} receiveShadow={false} visible={false} name="target-bin-gate-material-discharge"/>
    </group>
    <group name="under-bin-collection-belt">
      <RoundedBlock at={[0,.65,0]} size={[3.6,.2,1.1]} radius={.055} mat="darkSteel"/><Box at={[0,.765,0]} size={[3.45,.035,.94]} mat="rubber"/>
      {[-1.58,1.58].map(x=><Cylinder key={x} at={[x,.64,0]} top={.13} height={1.14} rotation={[Math.PI/2,0,0]} mat="steel" segments={18}/>)}
      <RoundedBlock at={[1.57,.66,-.76]} size={[.45,.36,.42]} radius={.06} mat="blue"/>
    </group>
    <group name="automatic-bin-control-and-sensor-terminal">
      <RoundedBlock at={[1.93,1.45,1.32]} size={[.34,.49,.14]} radius={.035} mat="blue"/>
      <Box at={[1.93,1.54,1.404]} size={[.23,.12,.018]} mat="black"/><mesh ref={indicator} position={[1.93,1.31,1.417]} scale={[.035,.035,.018]} geometry={sphereGeometry} material={MAT[active?'green':'steel']}/>
      <Sensor at={[1.8,2.21,1.49]}/>
      <CurveTube points={[[1.91,2.15,1.51],[1.99,1.88,1.49],[1.99,1.64,1.38]]} radius={.017} mat="black"/>
      <CurveTube points={[[1.77,1.85,1.49],[1.83,1.58,1.45],[1.9,1.28,1.37],[1.52,.98,.74]]} radius={.02} mat="black"/>
    </group>
  </group>;
}

export function AggregateBins({visualState,workflow,materialKind='sand',active=false}) {
  const {start,slopeStart,outlet,crossing}=AGGREGATE_COLLECTION_BELT;
  const beltLength=slopeStart[0]-start[0],beltCenter=(start[0]+slopeStart[0])/2;
  const slope=useMemo(()=>{const a=new THREE.Vector3(...slopeStart),b=new THREE.Vector3(...outlet),delta=b.clone().sub(a);return{length:delta.length(),center:a.add(b).multiplyScalar(.5),q:new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1,0,0),delta.normalize())};},[]);
  const selectedBin=materialKind==='stone'?2:0;
  return <group name="aggregate-bins-with-sealed-underground-collection" userData={{binCenters:AGGREGATE_BIN_X,collectionOutlet:outlet}}>
    {AGGREGATE_BIN_X.map((x,index)=><Hopper key={x} at={[x,0,AGGREGATE_BIN_Z]} visualState={visualState} binIndex={index} materialKind={index===2?'stone':'sand'} active={active} gateOpen={active&&(workflow?.flowKind!=='aggregate'||index===selectedBin)?.8:0} fill={workflow?.flowKind==='aggregate'&&index===selectedBin?Math.min(.92,.35+(workflow.aggregateBinAdded||0)/18):.55}/>)}
    <StaticInstances name="sealed-collection-trench-fixed-surfaces">
      <Box name="collection-trench-floor" at={[beltCenter,-.83,AGGREGATE_BIN_Z]} size={[beltLength+.3,.14,1.85]} mat="concrete"/>
      {[-.89,.89].map(offset=><Box key={offset} at={[beltCenter,-.405,AGGREGATE_BIN_Z+offset]} size={[beltLength+.3,.7,.12]} mat="concrete"/>)}
      <Box name="collection-trench-buried-enclosure" at={[beltCenter,-.0375,AGGREGATE_BIN_Z]} size={[beltLength+.3,.055,1.85]} mat="darkSteel"/>
      <Box name="collection-trench-conveyor-frame" at={[beltCenter,-.49,AGGREGATE_BIN_Z]} size={[beltLength,.24,1.2]} mat="blue"/>
      <Box name="collection-trench-horizontal-belt" at={[beltCenter,-.3225,AGGREGATE_BIN_Z]} size={[beltLength,.045,1.08]} mat="rubber"/>
      {Array.from({length:18},(_,index)=><Cylinder key={index} at={[start[0]+.3+index*(beltLength-.6)/17,-.45,AGGREGATE_BIN_Z]} top={.1} height={1.15} rotation={[Math.PI/2,0,0]} mat="steel"/>)}
      {AGGREGATE_BIN_X.map(x=>{const beltY=x<=slopeStart[0]?start[1]:THREE.MathUtils.lerp(slopeStart[1],outlet[1],(x-slopeStart[0])/(outlet[0]-slopeStart[0])),height=.765-beltY;return <group key={x} name="bin-sealed-drop-into-collection-trench"><Box at={[x,beltY+height/2,AGGREGATE_BIN_Z]} size={[.78,height,.88]} mat="cobalt"/>{[beltY+.04,.72].map(y=><Box key={y} at={[x,y,AGGREGATE_BIN_Z]} size={[.87,.06,.97]} mat="steel"/>)}</group>;})}
    </StaticInstances>
    <group name="collection-trench-flush-vehicle-crossing-cover" userData={{surfaceY:crossing.surfaceY,loadBearing:true}}>
      <Box name="collection-trench-load-bearing-road-cover" at={[(crossing.minX+crossing.maxX)/2,crossing.surfaceY-.05,AGGREGATE_BIN_Z]} size={[crossing.maxX-crossing.minX,.1,1.85]} mat="concrete"/>
      {[crossing.minX+.025,crossing.maxX-.025].map(x=><Box key={x} at={[x,crossing.surfaceY+.0007,AGGREGATE_BIN_Z]} size={[.03,.0014,1.7]} mat="steel"/>)}
    </group>
    <group name="collection-trench-rising-outlet-to-b01" position={slope.center} quaternion={slope.q} userData={{surfaceStart:slopeStart,surfaceEnd:outlet}}>
      <Box at={[0,-.18,0]} size={[slope.length,.22,1.2]} mat="blue"/><Box name="collection-outlet-rising-belt" at={[0,-.0225,0]} size={[slope.length,.045,1.08]} mat="rubber"/>
      <StaticInstances name="collection-rising-outlet-rollers">{Array.from({length:6},(_,index)=><Cylinder key={index} at={[-slope.length/2+.2+index*(slope.length-.4)/5,-.15,0]} top={.1} height={1.15} rotation={[Math.PI/2,0,0]} mat="steel"/>)}</StaticInstances>
    </group>
    <Box at={[outlet[0]-.25,.43,AGGREGATE_BIN_Z-.88]} size={[.51,.49,.43]} mat="blue"/><Sensor at={[outlet[0]-.25,.91,AGGREGATE_BIN_Z-.72]}/>
  </group>;
}

export function Conveyor({paused=false,faultActive=false,active=true,visualClock,workflow,visualState,materialKind}) {
  const particles=useRef(),clock=useRef(0),dummy=useMemo(()=>new THREE.Object3D(),[]);
  const {start,end,length,center,q}=useMemo(()=>{const start=new THREE.Vector3(...AGGREGATE_COLLECTION_BELT.outlet),end=new THREE.Vector3(8.6,11.55,3),delta=end.clone().sub(start),length=delta.length();return{start,end,length,center:start.clone().add(end).multiplyScalar(.5),q:new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1,0,0),delta.normalize())};},[]);
  useFrame((_,dt)=>{const time=advanceVisualTime(clock,visualClock,dt,paused,active&&!faultActive);if(!particles.current)return;const state=visualState?.current||workflow,feeding=state?.flowKind==='concrete'?state.stageName==='production'&&state.phaseProgress>.12&&state.phaseProgress<.44:state?.flowKind!=='aggregate'||!state.binGateOpen||state.binGateOpen.some(gate=>gate>.001);particles.current.visible=active&&!faultActive&&feeding;if(!particles.current.visible)return;const elapsed=activityTime(state,time,['production','loading','supply']);for(let i=0;i<32;i++){const x=-length/2+.4+((elapsed*1.5+i*(length-.8)/31)%(length-.8));dummy.position.set(x,.3,Math.sin(i*2.1)*.37);dummy.rotation.set(i*.34,i*.21,0);dummy.scale.set(.14,.1,.13);dummy.updateMatrix();particles.current.setMatrixAt(i,dummy.matrix);}particles.current.instanceMatrix.needsUpdate=true;});
  return <group name="inclined-belt-tension-drive-and-trough-rollers">
    <group position={center} quaternion={q}>
      {/* Route endpoints denote the belt surface, with the frame below it. */}
      <group position={[0,-.2275,0]}>
      <Box size={[length,.27,1.51]} mat="darkSteel"/><Box at={[0,.19,0]} size={[length,.075,1.3]} mat="rubber"/>
      {[-.81,.81].map(z=><Box key={z} at={[0,.05,z]} size={[length,.4,.07]} mat="blue"/>)}
      <StaticInstances name="conveyor-fixed-roller-and-support-instances">{Array.from({length:16},(_,i)=>{const x=-length/2+.4+i*(length-.8)/15;return <group key={i}>
        <Cylinder at={[x,-.04,0]} top={.14} height={.84} rotation={[Math.PI/2,0,0]} mat="steel" segments={16}/>
        {[-1,1].map(s=><Cylinder key={s} at={[x,.04,s*.54]} top={.1} height={.4} rotation={[Math.PI/2+s*.22,0,0]} mat="steel" segments={14}/>)}
        <Box at={[x,-.25,0]} size={[.065,.075,1.7]} mat="steel"/>
      </group>;})}</StaticInstances>
      <instancedMesh ref={particles} args={[materialKind==='sand'?sphereGeometry:pebbleGeometry,MAT[materialKind==='sand'?'sand':materialKind==='stone'?'stone':'gravel'],32]} frustumCulled={false} castShadow={false} receiveShadow={false}/>
      <Box at={[-length/2+.25,-.12,1.1]} size={[.75,.63,.62]} mat={faultActive?'red':'blue'}/><Cylinder at={[-length/2+.24,-.12,1.52]} top={.19} height={.3} rotation={[Math.PI/2,0,0]} mat="darkSteel"/>
      <Box at={[length/2-.4,.4,0]} size={[1.2,.7,1.6]} mat="paleBlue"/>
      <Box at={[0,-.15,-1.04]} size={[length,.13,.48]} mat="steel"/><Handrail from={[-length/2,-1.3]} to={[length/2,-1.3]} y={0}/>
      <Sensor at={[-length/2+1.2,.34,.86]}/><Sensor at={[length/2-1.3,.34,.86]}/>
      <Beam from={[-length/2,.34,1]} to={[length/2,.34,1]} radius={.018} mat="orange"/>
      </group>
    </group>
    {[.12,.4,.72].map(t=>{const p=start.clone().lerp(end,t);return <group key={t}>{[-.76,.76].map(z=><IBeam key={z} from={[p.x,.17,p.z+z]} to={[p.x,p.y-.3,p.z+z]} width={.19} depth={.21}/>)}<Beam from={[p.x,.5,p.z-.76]} to={[p.x,p.y-.4,p.z+.76]} radius={.045}/></group>;})}
  </group>;
}

function MixingMechanism({paused,active,cutaway,visualClock,workflow,visualState,onSelect}) {
  const shaftA=useRef(),shaftB=useRef(),clock=useRef(0),chamber=useRef(),doors=useRef([]);
  useFrame((_,dt)=>{const time=advanceVisualTime(clock,visualClock,dt,paused,active),state=visualState?.current||workflow,angle=activityTime(state,time,['production','loading'])*.8,pose=getProductionAssetState(state);if(shaftA.current)shaftA.current.rotation.x=angle;if(shaftB.current)shaftB.current.rotation.x=-angle;if(chamber.current){const height=Math.max(.03,pose.mixerFill*.82);chamber.current.visible=cutaway&&pose.mixerFill>.001;chamber.current.scale.y=height;chamber.current.position.y=6.67+height/2;}doors.current.forEach((door,index)=>{if(door)door.rotation.z=(index?1:-1)*pose.dischargeGate*.96;});});
  return <group name="twin-shaft-mixer-drive-and-discharge-gate">
    <Box at={[0,6.55,0]} size={[6,.16,3.45]} mat="steel"/>
    <Box at={[0,7.26,-1.64]} size={[6.1,1.45,.16]} mat="steel"/>
    {!cutaway && <Box at={[0,7.26,1.64]} size={[6.1,1.45,.16]} mat="paleBlue"/>}
    {[-3,3].map(x=><Box key={x} at={[x,7.23,0]} size={[.14,1.45,3.44]} mat="steel"/>)}
    {[-.73,.73].map((z,index)=><group key={z}>
      <group position={[0,7.25,z]} ref={index?shaftB:shaftA}>
        <StaticGeometryParts name="shaft-fixed-paddles-and-blades">
        <Beam from={[-3.2,0,0]} to={[3.2,0,0]} radius={.14} mat="darkSteel"/>
        {Array.from({length:8},(_,i)=><group key={i} position={[-2.45+i*.7,0,0]} rotation={[i*.7,0,0]}>
          <Box size={[.1,1.23,.13]} mat="darkSteel"/><Box at={[0,.58,0]} size={[.32,.16,.5]} mat="steel"/><Box at={[0,-.58,0]} size={[.32,.16,.5]} mat="steel"/>
        </group>)}
        </StaticGeometryParts>
      </group>
      <Box at={[3.53,7.25,z]} size={[.65,.67,.65]} mat="blue"/><Cylinder at={[4.03,7.25,z]} top={.27} height={.54} rotation={[0,0,Math.PI/2]} mat="darkSteel"/>
      <Sensor at={[-3.25,7.47,z]}/>
    </group>)}
    <mesh ref={chamber} name="live-mixer-batch-volume" position={[0,6.7,0]} scale={[5.65,.03,2.86]} geometry={boxGeometry} material={MAT.wetConcrete} visible={false} receiveShadow/>
    <group name="mixer-discharge-m01" userData={{entityId:'mixer-discharge-m01'}} onClick={event=>{event.stopPropagation();onSelect?.('mixer-discharge-m01');}}>{[-1,1].map((side,index)=><group key={side} ref={node=>{doors.current[index]=node;}} position={[side*1.325,6.41,0]}><RoundedBlock at={[-side*.66,0,0]} size={[1.34,.11,1.15]} radius={.025} mat="darkSteel"/><Cylinder at={[0,0,.66]} top={.065} height={1.36} rotation={[Math.PI/2,0,0]} mat="steel"/></group>)}</group>
    <Cylinder at={[1.83,6.31,.86]} top={.11} height={1.4} rotation={[0,0,Math.PI/2]} mat="blue"/>
    <Beam from={[.25,6.31,.86]} to={[2.5,6.31,.86]} radius={.045}/>
    <Cylinder at={[-3.56,5.32,0]} top={.73} bottom={.25} height={1.2} mat="steel"/>
    <Beam from={[-.6,6.36,0]} to={[-3.56,5.86,0]} radius={.35} mat="steel"/>
    <Cylinder at={[-3.56,4.47,0]} top={.25} height={.5} mat="steel"/>
    <Sensor at={[-3.14,4.72,.15]}/>
  </group>;
}

function WeighScaleVisual({kind,cutaway,workflow,visualState}){
  const powder=kind==='powder',volume=useRef(),plates=useRef([]),stream=useRef(),dummy=useMemo(()=>new THREE.Object3D(),[]),volumeGeometry=useMemo(()=>new THREE.CylinderGeometry(1,.27,1,powder?24:4),[powder]),base=powder?9.86:9.83,maxHeight=powder?2.25:1.5;
  useFrame(()=>{const state=visualState?.current||workflow,pose=getProductionAssetState(state),fill=powder?pose.powderFill:pose.aggregateFill,gate=powder?pose.powderGate:pose.aggregateGate;if(volume.current){const height=Math.max(.035,maxHeight*fill),radius=(powder?.26:.35)+(powder?.69:1.01)*fill;volume.current.visible=cutaway&&fill>.001;volume.current.position.y=base+height/2;volume.current.scale.set(radius,height,radius);}plates.current.forEach((plate,index)=>{if(plate)plate.position.x=(index?1:-1)*(.16+gate*.42);});if(!stream.current)return;stream.current.visible=cutaway&&gate>.01&&fill>.001;if(!stream.current.visible)return;for(let i=0;i<12;i++){const t=((state?.time||0)*1.7+i/12)%1;dummy.position.set(Math.sin(i*2.1)*.16,9.18-t*t*1.13,Math.cos(i*2.7)*.14);dummy.scale.setScalar((powder?.042:.073)*Math.min(1,gate*2));dummy.rotation.set(i*.4,i*.3,t*3);dummy.updateMatrix();stream.current.setMatrixAt(i,dummy.matrix);}stream.current.instanceMatrix.needsUpdate=true;});
  return <group name={kind+'-weighing-volume-and-gate'}>
    <mesh ref={volume} geometry={volumeGeometry} rotation={[0,powder?0:Math.PI/4,0]} material={MAT[powder?'powder':'gravel']} visible={false} receiveShadow/>
    {[-1,1].map((side,index)=><group key={side} ref={node=>{plates.current[index]=node;}} position={[side*.16,9.3,0]}><RoundedBlock size={[.34,.07,.65]} radius={.016} mat="steel"/></group>)}
    <instancedMesh ref={stream} name={kind+'-weighed-material-release'} args={[powder?sphereGeometry:pebbleGeometry,MAT[powder?'powder':'gravel'],12]} visible={false} frustumCulled={false} castShadow={false}/>
  </group>;
}

export function MixerTower({cutaway=false,paused=false,active=true,visualClock,workflow,visualState,onSelect}) {
  return <group name="weighing-mixing-and-truck-loading-process">
    <Box at={[0,.15,0]} size={[9.1,.3,8.2]} mat="concrete"/>
    <StaticInstances name="mixer-fixed-frame-instances">{[-3.75,3.75].flatMap(x=>[-3.35,3.35].map(z=><group key={`${x}/${z}`}>
      <IBeam from={[x,.25,z]} to={[x,11.03,z]} width={.27} depth={.3}/><Box at={[x,.43,z]} size={[.68,.16,.68]} mat="steel"/><Bolts at={[x,.53,z]} spacing={.35}/>
      {[5.55,9.65].map(y=><Box key={y} at={[x,y,z]} size={[.43,.5,.4]} mat="steel"/>)}
    </group>))}</StaticInstances>
    <StaticInstances name="mixer-fixed-platforms-and-braces">{[5.55,9.65].map(y=><group key={y}>
      <IBeam from={[-3.9,y,-3.45]} to={[3.9,y,-3.45]} width={.25} depth={.28}/><IBeam from={[-3.9,y,3.45]} to={[3.9,y,3.45]} width={.25} depth={.28}/>
      <IBeam from={[-3.9,y,-3.45]} to={[-3.9,y,3.45]} width={.23} depth={.26}/><IBeam from={[3.9,y,-3.45]} to={[3.9,y,3.45]} width={.23} depth={.26}/>
      <Grating at={[0,y,-2.82]} width={7.65} depth={1.2}/><Grating at={[0,y,2.82]} width={7.65} depth={1.2}/>
    </group>)}
    {[-3.35,3.35].map(z=><group key={z}><Beam from={[-3.75,.8,z]} to={[3.75,5.5,z]} radius={.045}/><Beam from={[3.75,.8,z]} to={[-3.75,5.5,z]} radius={.045}/></group>)}
    </StaticInstances>
    {!cutaway && <group name="removable-mixer-enclosure">
      <Box at={[0,7.68,3.12]} size={[7.5,3.75,.09]} mat="white"/><Box at={[-3.63,7.68,0]} size={[.1,3.75,6.24]} mat="white"/>
      <Box at={[0,6.35,3.18]} size={[7.58,.72,.06]} mat="blue"/>
      {[-2.5,-1.25,0,1.25,2.5].map(x=><Box key={x} at={[x,7.7,3.185]} size={[.027,3.72,.027]} mat="steel"/>)}
      <Box at={[2.23,8.55,3.18]} size={[1.83,.79,.055]} mat="glass"/>
    </group>}
    <Box at={[0,7.68,-3.12]} size={[7.5,3.75,.1]} mat="white"/>
    <MixingMechanism {...{paused,active,cutaway,visualClock,workflow,visualState,onSelect}}/>
    <group name="aggregate-scale-and-powder-scale">
      <group name="aggregate-scale-m01" userData={{entityId:'aggregate-scale-m01'}} onClick={event=>{event.stopPropagation();onSelect?.('aggregate-scale-m01');}}>
      <Cylinder at={[-1.7,10.55,0]} top={1.45} bottom={.4} height={1.65} mat="paleBlue" segments={cutaway?2:4} arc={cutaway?Math.PI:Math.PI*2} start={cutaway?Math.PI/2:0} rotation={[0,Math.PI/4,0]}/>
      {!cutaway&&<Box at={[-1.7,11.42,0]} size={[2.3,.14,2.3]} mat="steel"/>}
      <group position={[-1.7,0,0]}><WeighScaleVisual kind="aggregate" {...{cutaway,workflow,visualState}}/></group></group>
      <group name="powder-scale-m01" userData={{entityId:'powder-scale-m01'}} onClick={event=>{event.stopPropagation();onSelect?.('powder-scale-m01');}}>
      <Cylinder at={[1.65,10.61,-.83]} top={1.03} bottom={.28} height={1.57} mat="white" arc={cutaway?Math.PI:Math.PI*2} start={cutaway?Math.PI/2:0}/>
      <Cylinder at={[1.65,11.84,-.83]} top={1.03} height={.88} mat="white" arc={cutaway?Math.PI:Math.PI*2} start={cutaway?Math.PI/2:0}/>
      <Cylinder at={[1.65,9.65,-.83]} top={.26} height={.48} mat="darkSteel"/>
      <group position={[1.65,0,-.83]}><WeighScaleVisual kind="powder" {...{cutaway,workflow,visualState}}/></group></group>
      <Cylinder at={[-1.7,9.57,0]} top={.32} height={.44} mat="darkSteel"/>
      {[-2.63,-.75].flatMap(x=>[-.96,.96].map(z=><group key={`${x}/${z}`}><Box at={[x,10.76,z]} size={[.17,.22,.17]} mat="yellow"/><Beam from={[x,9.78,z]} to={[x,11.5,z]} radius={.04}/></group>))}
      <Sensor at={[-.28,10.63,1.04]}/><Sensor at={[2.56,11.2,-.12]}/>
      <group name="water-scale-m01" userData={{entityId:'water-scale-m01'}} onClick={event=>{event.stopPropagation();onSelect?.('water-scale-m01');}}><Box at={[3.24,10.62,1.7]} size={[1.12,1.3,1.0]} mat="paleBlue"/><Beam from={[3.24,10.06,1.7]} to={[1.8,7.97,1.2]} radius={.08} mat="blue"/></group>
    </group>
    <StaticInstances name="mixer-fixed-roof-rails-and-access-grating"><Handrail from={[-4,3.56]} to={[4,3.56]} y={9.75}/><Handrail from={[-4,-3.56]} to={[4,-3.56]} y={9.75}/><Handrail from={[-4,-3.56]} to={[-4,3.56]} y={9.75}/><Handrail from={[4,-3.56]} to={[4,3.56]} y={9.75}/>
    <Grating at={[-.98,9.65,-4.16]} width={1.2} depth={1.55}/>
    <Handrail from={[-1.58,-4.9]} to={[-1.58,-3.45]} y={9.75}/><Handrail from={[-.38,-4.9]} to={[-.38,-3.45]} y={9.75}/>
    </StaticInstances>
    <group name="two-flight-maintenance-staircase" position={[4.35,0,-4.8]} rotation={[0,Math.PI/2,0]}><StaticInstances name="maintenance-stair-fixed-parts">
      <Grating at={[0,4.62,0]} width={1.25} depth={3.2}/>
      {Array.from({length:20},(_,i)=><Box key={i} at={[0,.25+i*.23,5.3-i*.27]} size={[1.15,.055,.35]} mat="steel"/>)}
      {[-.63,.63].map(x=><Beam key={x} from={[x,.8,5.7]} to={[x,5.45,.2]} radius={.035} mat="yellow"/>)}
      {Array.from({length:22},(_,i)=><Box key={i} at={[0,4.72+i*.23,-.5-i*.23]} size={[1.15,.055,.32]} mat="steel"/>)}
      {[-.63,.63].map(x=><Beam key={x} from={[x,5.35,-.2]} to={[x,10.45,-5.4]} radius={.035} mat="yellow"/>)}
    </StaticInstances></group>
  </group>;
}

export function screwFlightGeometry(length,pitch=.46){
  const key=`screw-flight:${length.toFixed(4)}:${pitch}`;
  if(!geoCache.has(key)){
    const positions=[],indices=[],turns=length/pitch,steps=Math.ceil(turns*12);
    for(let i=0;i<=steps;i++){const t=i/steps,a=t*Math.PI*2*turns,y=(t-.5)*length;positions.push(Math.cos(a)*.034,y,Math.sin(a)*.034,Math.cos(a)*.124,y,Math.sin(a)*.124);}
    for(let i=0;i<steps;i++){const a=i*2;indices.push(a,a+2,a+1,a+1,a+2,a+3);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();geoCache.set(key,geometry);
  }
  return geoCache.get(key);
}
function ScrewFlight({from,to,paused,visualClock,workflow,visualState}){
  const rotating=useRef(),clock=useRef(0),data=useMemo(()=>{const a=new THREE.Vector3(...from),b=new THREE.Vector3(...to),delta=b.clone().sub(a);return {length:delta.length(),center:a.add(b).multiplyScalar(.5),q:new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize())};},[from.join(','),to.join(',')]);
  useFrame((_,dt)=>{const time=advanceVisualTime(clock,visualClock,dt,paused),state=visualState?.current||workflow;if(rotating.current)rotating.current.rotation.y=activityTime(state,time,['production','supply'])*4.1;});
  return <AssetDetail name="near-cutaway-screw-flight" distance={62}><group position={data.center} quaternion={data.q}><group ref={rotating} name="rotating-helical-screw-and-core"><Cylinder top={.034} height={data.length} mat="darkSteel"/><mesh geometry={screwFlightGeometry(data.length)} material={MAT.chuteSteel} castShadow={false}/></group></group></AssetDetail>;
}

export function ScrewConveyors({active=false,paused=false,materialKind='cement',visualClock,workflow,visualState,cutaway=false}){
  const flow=useRef(),pipes=useRef([]),clock=useRef(0),dummy=useMemo(()=>new THREE.Object3D(),[]);
  const activeIndices=materialKind==='concrete'?[0,2]:[materialKind==='flyash'?2:0];
  useFrame((_,dt)=>{
    const time=advanceVisualTime(clock,visualClock,dt,paused,active);if(!flow.current)return;const state=visualState?.current||workflow,flowing=active&&(state?.flowKind==='concrete'?state.stageName==='production'&&state.phaseProgress>=.22&&state.phaseProgress<.44:state?.flowKind!=='powder'||(state.powderSupplyActive??true));flow.current.visible=flowing;
    pipes.current.forEach((group,i)=>{group?.traverse(mesh=>{if(mesh.isMesh)mesh.material=flowing&&activeIndices.includes(i)?MAT.pipeSection:MAT.steel;});});if(!flowing)return;
    const elapsed=activityTime(state,time,['production','supply']);
    activeIndices.forEach((index,n)=>{for(let j=0;j<9;j++){const p=(elapsed*.11+j/9)%1,x=[1.15,5.15,9.15,13.15][index];dummy.position.set(THREE.MathUtils.lerp(x,11.48+index*.31,p),THREE.MathUtils.lerp(4.17,12.1,p),THREE.MathUtils.lerp(-8.9,2.17,p));dummy.scale.set(.09,.09,.09);dummy.updateMatrix();flow.current.setMatrixAt(n*9+j,dummy.matrix);}});flow.current.instanceMatrix.needsUpdate=true;
  });
  return <group name="four-independent-powder-screw-and-gearmotor-lines">
    {[1.15,5.15,9.15,13.15].map((x,i)=>{
      const a=[x,4.17,-8.9],b=[11.48+i*.31,12.1,2.17];
      return <group key={x} name={`powder-screw-${i+1}`}><group ref={node=>{pipes.current[i]=node;}}><Beam from={a} to={b} radius={.15} segments={20} mat={active&&activeIndices.includes(i)?'pipeSection':'steel'}/></group>
        <group visible={cutaway&&activeIndices.includes(i)}><ScrewFlight from={a} to={b} {...{paused,visualClock,workflow,visualState}}/></group>
        <Box at={[x,4.06,-8.71]} size={[.55,.51,.65]} mat="blue"/><Cylinder at={[x,4.08,-9.25]} top={.18} height={.5} rotation={[Math.PI/2,0,0]} mat="darkSteel"/>
        {[.05,.32,.62,.94].map(t=><Ball key={t} at={a.map((v,j)=>THREE.MathUtils.lerp(v,b[j],t))} size={[.2,.2,.2]} mat="steel"/>)}<Sensor at={[x+.36,4.3,-8.71]}/>
      </group>;
    })}
    <instancedMesh key={activeIndices.join('-')} ref={flow} name="powder-metering-flow" args={[sphereGeometry,MAT.powder,activeIndices.length*9]} frustumCulled={false} castShadow={false} receiveShadow={false}/>
  </group>;
}

export function Weighbridge(){
  const {length,width,surfaceY}=WEIGHBRIDGE_LAYOUT;
  return <group name="load-cell-weighbridge-without-parked-vehicle" rotation={[0,Math.PI/2,0]} userData={{bridgeLength:length,bridgeWidth:width,deckSurfaceY:surfaceY,layout:'flush-through-lane'}}>
    <Box name="weighbridge-below-grade-structure" at={[0,surfaceY-.22,0]} size={[length,.3,width]} mat="darkSteel"/>
    <Box name="weighbridge-flush-driving-deck" at={[0,surfaceY-.05,0]} size={[length,.1,width]} mat="steel"/>
    {Array.from({length:22},(_,i)=><Box key={i} at={[-6.68+i*.636,surfaceY+.0007,0]} size={[.026,.0014,width-.1]} mat="paleBlue"/>)}
    {[-width/2-.13,width/2+.13].map(z=><Box key={z} at={[0,surfaceY-.055,z]} size={[length+.3,.11,.18]} mat="concrete"/>)}
    {[-1,1].map(side=><Box key={side} name={`weighbridge-flush-apron-${side}`} at={[side*(length/2+.75),surfaceY-.0575,0]} size={[1.5,.1,width]} mat="asphalt"/>)}
    {[-5.4,0,5.4].flatMap(x=>[-1.5,1.5].map(z=><Sensor key={`${x}/${z}`} at={[x,surfaceY-.16,z]}/>))}
    <group name="weighbridge-off-lane-display" position={[2.3,0,2.8]}>
      <Box at={[0,1.2,0]} size={[.12,2.2,.12]} mat="darkSteel"/><Box at={[0,2.34,0]} size={[1.3,.62,.16]} mat="black"/><Box at={[0,2.34,.094]} size={[.86,.22,.014]} mat="green"/>
    </group>
  </group>;
}

// The UI samples business time sparsely; live refs move the memoized assets.
const MemoMixerTruck=React.memo(MixerTruck), MemoPowderTruck=React.memo(PowderTruck);
const MemoDumpTruck=React.memo(DumpTruck), MemoLoader=React.memo(Loader);
export {MemoMixerTruck as MixerTruck, MemoPowderTruck as PowderTruck, MemoDumpTruck as DumpTruck, MemoLoader as Loader};

