import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {SCENARIOS,getWorkflowState} from '../src/workflow.js';
import {WEIGHBRIDGE_LAYOUT,LOADER_PARK,VEHICLE_ROAD_Y} from '../src/stationLayout.js';

// node scripts/verify-vehicle-clearance.mjs [--runtime DIR]
const project=fileURLToPath(new URL('../',import.meta.url)),args=process.argv.slice(2);
if(args.length&&(args.length!==2||args[0]!=='--runtime'))throw new Error('Usage: node scripts/verify-vehicle-clearance.mjs [--runtime DIR]');
const require=createRequire(path.join(args.length?path.resolve(args[1]):project,'package.json')),THREE=require('three');
const {OBB}=await import(pathToFileURL(require.resolve('three/addons/math/OBB.js')).href);
const esbuild=createRequire(require.resolve('vite/package.json'))('esbuild');
globalThis.clearanceEffects=[];globalThis.clearanceFrames=[];
const mock={name:'real-asset-clearance',setup(build){
  build.onLoad({filter:/PlantScene\.jsx$/},({path})=>({contents:fs.readFileSync(path,'utf8')+'\nexport {SiteGround};',loader:'jsx'}));
  build.onResolve({filter:/SceneLabels(?:\.jsx)?$/},()=>({path:'labels',namespace:'clearance'}));
  // Keep the exact source geometry while omitting draw-call consolidation.
  // Combining many source meshes into one AABB would erase real open spaces.
  build.onResolve({filter:/SceneRuntime(?:\.jsx)?$/},()=>({path:'instances',namespace:'clearance'}));
  build.onResolve({filter:/AssetDetail(?:\.jsx)?$/},()=>({path:'detail',namespace:'clearance'}));
  build.onResolve({filter:/OrbitControls\.js$/},()=>({path:'controls',namespace:'clearance'}));
  build.onResolve({filter:/^(react|@react-three\/fiber|asset-jsx\/jsx-runtime)$/},({path})=>({path,namespace:'clearance'}));
  build.onLoad({filter:/.*/,namespace:'clearance'},({path})=>({loader:'js',contents:
    path==='labels'?'export const SceneLabel=()=>null,SceneLabelProvider=({children})=>children;':
    path==='instances'?'export const StaticInstances=({children})=>children,RegionPreviewCapture=()=>null,QualityRuntime=()=>null,ObjectFeedback=()=>null,VehicleContactGround=()=>null;':
    path==='detail'?'export const AssetDetail=({children})=>children,StaticGeometryParts=({children})=>children;':
    path==='controls'?'export const OrbitControls=()=>null;':
    path==='react'?`export const memo=f=>f,useRef=x=>({current:x}),useMemo=f=>f(),useEffect=f=>globalThis.clearanceEffects.push(f),useState=x=>[typeof x==='function'?x():x,()=>{}],createContext=value=>({value}),useContext=context=>context.value;export default {memo};`:
    path==='@react-three/fiber'?`export const Canvas=()=>null,useFrame=f=>globalThis.clearanceFrames.push(f),useThree=()=>({});`:
    `export const Fragment='group';export const jsx=(type,props,key)=>({type,props,key}),jsxs=jsx;`
  }));
}};
const result=await esbuild.build({stdin:{contents:`export * from './src/IndustrialAssets.jsx';export {default as ControlRoom} from './src/ControlRoom.jsx';export {SiteGround} from './src/PlantScene.jsx';`,resolveDir:project,sourcefile:'clearance-assets.js'},bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',jsxImportSource:'asset-jsx',alias:{three:require.resolve('three')},plugins:[mock],logLevel:'silent'});
const assets=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
function tree(element){
  if(!element||typeof element!=='object')return null;
  if(Array.isArray(element)){const group=new THREE.Group();for(const child of element){const node=tree(child);if(node)group.add(node);}return group;}
  const {type,props={}}=element;if(typeof type==='function')return tree(type(props));
  const node=type==='mesh'?new THREE.Mesh(props.geometry,props.material):type==='instancedMesh'?new THREE.InstancedMesh(...props.args):new THREE.Group();
  if(props.position)node.position.set(...(Array.isArray(props.position)?props.position:props.position.toArray()));
  if(props.rotation)node.rotation.set(...props.rotation);if(props.scale!=null){if(typeof props.scale==='number')node.scale.setScalar(props.scale);else node.scale.set(...props.scale);}if(props.quaternion)node.quaternion.copy(props.quaternion);
  node.name=props.name||'';node.userData=props.userData||{};node.visible=props.visible??true;
  if(props.ref){if(typeof props.ref==='function')props.ref(node);else props.ref.current=node;}
  for(const child of(Array.isArray(props.children)?props.children:[props.children])){const object=tree(child);if(object)node.add(object);}return node;
}
function committedTree(component,props={},at=[0,0,0]){
  globalThis.clearanceEffects=[];globalThis.clearanceFrames=[];
  const object=tree({type:component,props});object.position.add(new THREE.Vector3(...at));object.updateMatrixWorld(true);
  [...globalThis.clearanceEffects].reverse().forEach(effect=>effect());
  const camera=new THREE.PerspectiveCamera();camera.position.set(20,20,20);
  for(const frame of globalThis.clearanceFrames)frame({camera,clock:{elapsedTime:0}},0);
  object.updateMatrixWorld(true);return object;
}
function visible(object){for(let node=object;node;node=node.parent)if(!node.visible||node.userData.uiOnly)return false;return true;}
function meshBoxes(object){
  const boxes=[],instance=new THREE.Matrix4(),world=new THREE.Matrix4();
  object.traverse(mesh=>{
    if(!mesh.isMesh||!visible(mesh)||!mesh.geometry)return;
    if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();
    const local=mesh.geometry.boundingBox;if(!local||local.isEmpty())return;
    let ancestry='';for(let parent=mesh;parent;parent=parent.parent)ancestry+='/'+parent.name;
    const add=matrix=>boxes.push({name:mesh.name,ancestry,bounds:local.clone().applyMatrix4(matrix),obb:new OBB().fromBox3(local).applyMatrix4(matrix)});
    if(mesh.isInstancedMesh){for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,instance);world.multiplyMatrices(mesh.matrixWorld,instance);if(Math.abs(world.determinant())>1e-12)add(world);}}
    else add(mesh.matrixWorld);
  });return boxes;
}
const profiles={},dumpProfiles=new Map();
for(const[name,component]of[['aggregate',assets.DumpTruck],['powder',assets.PowderTruck]]){
  const envelope=new THREE.Box3();
  for(const tip of name==='aggregate'?[0,.95]:[0]){
    const visualState={current:{vehicleFill:1,tip,dumpGateOpen:tip?1:0}};
    const pose=new THREE.Box3();for(const{bounds}of meshBoxes(committedTree(component,{fill:1,tip,visualState})))pose.union(bounds);
    if(name==='aggregate')dumpProfiles.set(Math.round(tip*100),pose);envelope.union(pose);
  }
  assert(envelope.min.x< -4.3&&envelope.max.x>4,'vehicle rear overhang or front cab missing');
  assert(envelope.min.z< -1.50&&envelope.max.z>1.50,'rear-view mirrors missing from envelope');
  profiles[name]=envelope;
  console.log(`${name} full vehicle envelope ${JSON.stringify({min:envelope.min.toArray(),max:envelope.max.toArray()})}`);
}
function vehicleEnvelope(state){
  if(state.flowKind==='powder')return profiles.powder;
  const value=(state.tip||0)*100,low=Math.floor(value),high=Math.ceil(value);
  for(const key of new Set([low,high]))if(!dumpProfiles.has(key)){
    const tip=key/100,visualState={current:{vehicleFill:1,tip,dumpGateOpen:tip?1:0}},bounds=new THREE.Box3();
    for(const box of meshBoxes(committedTree(assets.DumpTruck,{fill:1,tip,visualState})))bounds.union(box.bounds);
    dumpProfiles.set(key,bounds);
  }
  return dumpProfiles.get(low).clone().union(dumpProfiles.get(high)).expandByScalar(.002);
}
const loaderProfiles=new Map();
function loaderBodyEnvelope(state){
  const value=(state.loaderSteer||0)*100,low=Math.floor(value),high=Math.ceil(value);
  for(const key of new Set([low,high]))if(!loaderProfiles.has(key)){
    const visualState={current:{...state,loaderSteer:key/100}},bounds=new THREE.Box3();
    const boxes=meshBoxes(committedTree(assets.Loader,{visualState})).filter(box=>!box.ancestry.includes('pivoting-loader-lift-arm')&&!box.ancestry.includes('live-pivot-coupled-hydraulic-cylinder'));
    for(const box of boxes)bounds.union(box.bounds);
    loaderProfiles.set(key,{bounds,boxes});
  }
  return {bounds:loaderProfiles.get(low).bounds.clone().union(loaderProfiles.get(high).bounds).expandByScalar(.002),boxes:[...loaderProfiles.get(low).boxes,...loaderProfiles.get(high).boxes]};
}
const obstacles=[];
function add(label,component,props,at){for(const box of meshBoxes(committedTree(component,props,at))){
  // Flush running surfaces and buried collector components are driveable.
  // Raised walls, columns, hopper bodies and equipment remain obstacles.
  if(box.bounds.max.y<=.34)continue;
  obstacles.push({...box,label});
}}
add('aggregate shed',assets.AggregateShed,{materialKind:'sand',delivered:0},[-16.6,0,-8.8]);
add('automatic bins and sealed collector',assets.AggregateBins,{});
add('mixer tower',assets.MixerTower,{cutaway:false},[10.3,0,3]);
add('control room',assets.ControlRoom,{cutaway:false});
add('weighbridge display',assets.Weighbridge,{},WEIGHBRIDGE_LAYOUT.center);
add('inclined conveyor',assets.Conveyor,{active:false});
for(const[x,kind,code]of[[1.15,'cement','C01'],[5.15,'cement','C02'],[9.15,'flyash','F01'],[13.15,'flyash','F02']])add(code,assets.Silo,{kind,code},[x,0,-8.9]);
const siteOpen=committedTree(assets.SiteGround,{gateOpen:true}),siteClosed=committedTree(assets.SiteGround,{gateOpen:false});
for(const box of meshBoxes(siteOpen))if(box.bounds.max.y>.34&&!box.ancestry.includes('operable-entry-barrier'))obstacles.push({...box,label:'site fence/tree/entrance'});
const gateBoxes={open:meshBoxes(siteOpen.getObjectByName('operable-entry-barrier')),closed:meshBoxes(siteClosed.getObjectByName('operable-entry-barrier'))};
const parkedLoader=committedTree(assets.Loader,{bucket:0,fill:0},[LOADER_PARK[0],VEHICLE_ROAD_Y,LOADER_PARK[2]]);
const parkedLoaderBoxes=meshBoxes(parkedLoader).filter(box=>box.bounds.max.y>.34).map(box=>({...box,label:'parked loader'}));

function footprint(state,box){
  const c=Math.cos(state.vehicleYaw),s=Math.sin(state.vehicleYaw);
  return[[box.min.x,box.min.z],[box.max.x,box.min.z],[box.max.x,box.max.z],[box.min.x,box.max.z]].map(([x,z])=>[state.vehiclePosition[0]+x*c+z*s,state.vehiclePosition[2]-x*s+z*c]);
}
function intersects(p,box){
  const q=[[box.min.x,box.min.z],[box.max.x,box.min.z],[box.max.x,box.max.z],[box.min.x,box.max.z]];
  for(const poly of[p,q])for(let i=0;i<4;i++){
    const next=poly[(i+1)%4],a=[next[1]-poly[i][1],poly[i][0]-next[0]],vp=p.map(t=>t[0]*a[0]+t[1]*a[1]),vq=q.map(t=>t[0]*a[0]+t[1]*a[1]);
    if(Math.max(...vp)<Math.min(...vq)-1e-7||Math.max(...vq)<Math.min(...vp)-1e-7)return false;
  }return true;
}
const failures=new Map();let samples=0,checks=0,loaderSamples=0,loaderChecks=0;
const vehicleMatrix=new THREE.Matrix4(),vehicleQuaternion=new THREE.Quaternion(),yawAxis=new THREE.Vector3(0,1,0),vehiclePosition=new THREE.Vector3(),unitScale=new THREE.Vector3(1,1,1);
for(const scenario of Object.values(SCENARIOS).filter(s=>s.flowKind!=='concrete')){
  const total=scenario.stages.at(-1).end;
  for(let step=0;step<=Math.ceil(total/.02);step++){
    const time=Math.min(total,step*.02),state=getWorkflowState(scenario.id,time),envelope=vehicleEnvelope(state),p=footprint(state,envelope),lower=state.vehiclePosition[1]+envelope.min.y,upper=state.vehiclePosition[1]+envelope.max.y;
    vehicleMatrix.compose(vehiclePosition.set(...state.vehiclePosition),vehicleQuaternion.setFromAxisAngle(yawAxis,state.vehicleYaw),unitScale);
    const vehicleOBB=new OBB().fromBox3(envelope).applyMatrix4(vehicleMatrix);
    samples++;
    const gateOpen=!['supplier_loading','arrival','complete'].includes(state.stageName)&&(state.stageName!=='registration'||state.phaseProgress>.4);
    const activeObstacles=[...obstacles,...gateBoxes[gateOpen?'open':'closed'].map(box=>({...box,label:'entry barrier'})),...parkedLoaderBoxes];
    for(const obstacle of activeObstacles){
      const b=obstacle.bounds;if(b.max.y<lower+.005||b.min.y>upper-.005)continue;
      checks++;
      // The inclined conveyor's world AABB includes large empty wedges. Its
      // real oriented mesh boxes preserve slope and height during the check.
      if(intersects(p,b)&&vehicleOBB.intersectsOBB(obstacle.obb,1e-7)){
        const key=scenario.id+' '+obstacle.label+' '+state.stageName;
        if(!failures.has(key))failures.set(key,`${key} at ${time.toFixed(2)}s, centre ${state.vehiclePosition.map(n=>n.toFixed(3)).join('/')}, mesh ${obstacle.name||'(unnamed)'}`);
      }
    }
  }
}
for(const id of ['sand','stone']){
  const scenario=SCENARIOS[id],start=scenario.stages.find(phase=>phase.key==='loading').start,total=scenario.stages.at(-1).end;
  for(let step=0;step<=Math.ceil((total-start)/.02);step++){
    const time=Math.min(total,start+step*.02),state=getWorkflowState(id,time),profile=loaderBodyEnvelope(state),envelope=profile.bounds,pose={vehiclePosition:state.loaderPosition,vehicleYaw:state.loaderYaw},p=footprint(pose,envelope),lower=pose.vehiclePosition[1]+envelope.min.y,upper=pose.vehiclePosition[1]+envelope.max.y;
    vehicleMatrix.compose(vehiclePosition.set(...pose.vehiclePosition),vehicleQuaternion.setFromAxisAngle(yawAxis,pose.vehicleYaw),unitScale);
    const bodyOBB=new OBB().fromBox3(envelope).applyMatrix4(vehicleMatrix);loaderSamples++;
    for(const obstacle of obstacles){
      const b=obstacle.bounds;if(b.max.y<lower+.005||b.min.y>upper-.005)continue;loaderChecks++;
      // A tall loader cab sits behind its low front axle. Keep its complete
      // envelope for broad phase, then resolve each actual body/wheel/cab mesh
      // so that empty air above the axle is not mistaken for a collision.
      if(intersects(p,b)&&bodyOBB.intersectsOBB(obstacle.obb,1e-7)&&profile.boxes.some(box=>{const local=box.obb.clone();local.halfSize.addScalar(.002);return local.applyMatrix4(vehicleMatrix).intersectsOBB(obstacle.obb,1e-7);})){
        const key=id+' loader '+obstacle.label+' '+state.loaderAction;
        if(!failures.has(key))failures.set(key,`${key} at ${time.toFixed(2)}s, centre ${pose.vehiclePosition.map(n=>n.toFixed(3)).join('/')}, mesh ${obstacle.name||'(unnamed)'}`);
      }
    }
  }
}
if(failures.size){for(const failure of failures.values())console.error('FAIL '+failure);process.exitCode=1;}
else console.log(`PASS: ${samples} complete truck workflow poses and ${checks} real-mesh clearance checks; ${loaderSamples} moving loader body poses and ${loaderChecks} additional checks. Full cab/mirrors/rear overhang envelopes clear shed, bins/collector, tower, control building, bridge display, conveyor/silos, parked loader, real entrance barrier/canopy/guardhouse, fences and trees; intentional working bucket contact is checked separately.`);
