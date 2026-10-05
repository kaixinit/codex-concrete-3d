import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {WEIGHBRIDGE_LAYOUT,ENTRY_BARRIER_Z,ENTRY_CANOPY_Z,ENTRY_QUEUE_Z,VEHICLE_ROAD_Y,AGGREGATE_BIN_X,AGGREGATE_BIN_Z,AGGREGATE_COLLECTION_BELT} from '../src/stationLayout.js';
import {SCENARIOS,getWorkflowState} from '../src/workflow.js';

const args=process.argv.slice(2),project=fileURLToPath(new URL('../',import.meta.url));
let runtime=project;
for(let i=0;i<args.length;i++){
  if(args[i]==='--runtime')runtime=path.resolve(args[++i]);
  else if(args[i]==='--help'){console.log('Usage: node scripts/verify-weighbridge-layout.mjs [--runtime <package-directory>]');process.exit(0);}
  else throw new Error('Unknown argument: '+args[i]);
}
const require=createRequire(path.join(runtime,'package.json')),THREE=require('three');
const esbuild=createRequire(require.resolve('vite/package.json'))('esbuild');
globalThis.weighbridgeEffects=[];
globalThis.weighbridgeFrames=[];
const mock={name:'weighbridge-geometry',setup(build){
  build.onResolve({filter:/^(react|@react-three\/fiber|asset-jsx\/jsx-runtime)$/},args=>({path:args.path,namespace:'mock'}));
  build.onLoad({filter:/.*/,namespace:'mock'},({path})=>({contents:path==='react'?`export const useRef=x=>({current:x}),useMemo=f=>f(),useEffect=f=>globalThis.weighbridgeEffects.push(f),createContext=value=>({value}),useContext=context=>context.value;export default {memo:f=>f};`:path==='@react-three/fiber'?`export const useFrame=f=>globalThis.weighbridgeFrames.push(f),useThree=()=>({});`:`export const Fragment='group';export const jsx=(type,props,key)=>({type,props,key}),jsxs=jsx;`,loader:'js'}));
}};
const result=await esbuild.build({entryPoints:[path.join(project,'src/IndustrialAssets.jsx')],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',jsxImportSource:'asset-jsx',alias:{three:require.resolve('three')},plugins:[mock],logLevel:'silent'});
const assets=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
function tree(element){
  if(!element||typeof element!=='object')return null;
  if(Array.isArray(element)){const group=new THREE.Group();element.forEach(child=>{const node=tree(child);if(node)group.add(node);});return group;}
  const {type,props={}}=element;
  if(typeof type==='function')return tree(type(props));
  const node=type==='mesh'?new THREE.Mesh(props.geometry,props.material):type==='instancedMesh'?new THREE.InstancedMesh(...props.args):new THREE.Group();
  if(props.position)node.position.set(...(Array.isArray(props.position)?props.position:props.position.toArray()));
  if(props.rotation)node.rotation.set(...props.rotation);
  if(props.scale)node.scale.set(...props.scale);
  if(props.quaternion)node.quaternion.copy(props.quaternion);
  node.name=props.name||'';node.userData=props.userData||{};node.visible=props.visible??true;
  if(props.ref){if(typeof props.ref==='function')props.ref(node);else props.ref.current=node;}
  const children=Array.isArray(props.children)?props.children:[props.children];
  children.forEach(element=>{const child=tree(element);if(child)node.add(child);});
  return node;
}
function committedTree(component,props={}){
  globalThis.weighbridgeEffects=[];globalThis.weighbridgeFrames=[];
  const root=tree({type:component,props});root.updateMatrixWorld(true);
  [...globalThis.weighbridgeEffects].reverse().forEach(effect=>effect());
  const camera=new THREE.PerspectiveCamera();camera.position.set(20,20,20);
  globalThis.weighbridgeFrames.forEach(frame=>frame({camera,clock:{elapsedTime:0}},0));root.updateMatrixWorld(true);
  return root;
}
const {center,length,width,surfaceY}=WEIGHBRIDGE_LAYOUT;
const bridge=committedTree(assets.Weighbridge);bridge.position.set(...center);bridge.updateMatrixWorld(true);
const deck=new THREE.Box3().setFromObject(bridge.getObjectByName('weighbridge-flush-driving-deck'));
assert(Math.abs(deck.max.y-surfaceY)<1e-9,'deck is not flush with the driveway');
assert(Math.abs(deck.getSize(new THREE.Vector3()).z-length)<1e-9,'bridge longitudinal deck length differs');
assert(Math.abs(deck.getSize(new THREE.Vector3()).x-width)<1e-9,'bridge width differs');
assert(ENTRY_BARRIER_Z>deck.max.z+3,'barrier is too close to the bridge exit');
assert(ENTRY_CANOPY_Z>ENTRY_BARRIER_Z,'entry canopy should precede the inward barrier');
assert(ENTRY_QUEUE_Z-ENTRY_BARRIER_Z>6,'queue stop cab is not clear of the closed barrier');
const display=new THREE.Box3().setFromObject(bridge.getObjectByName('weighbridge-off-lane-display'));
const models=[['dump',assets.DumpTruck],['powder',assets.PowderTruck],['mixer',assets.MixerTruck]];
let geometryChecks=0;
for(const [name,component] of models){
  const queued=committedTree(component,{fill:1});
  const localBounds=new THREE.Box3().setFromObject(queued);
  console.log(`${name} full local bounds: ${JSON.stringify({min:localBounds.min.toArray(),max:localBounds.max.toArray()})}`);
  queued.position.set(center[0],VEHICLE_ROAD_Y,ENTRY_QUEUE_Z);queued.rotation.y=Math.PI/2;queued.updateMatrixWorld(true);
  const queuedBody=new THREE.Box3().setFromObject(queued);
  assert(queuedBody.min.z>ENTRY_BARRIER_Z+.5,`${name} cab enters the closed entry barrier while waiting`);
  assert(queuedBody.max.y<5.9,`${name} body clips the entry canopy`);
  for(const yaw of [-Math.PI/2,Math.PI/2]){
    const truck=committedTree(component,{fill:1});truck.position.set(center[0],VEHICLE_ROAD_Y,center[2]);truck.rotation.y=yaw;truck.updateMatrixWorld(true);
    const body=new THREE.Box3().setFromObject(truck);
    assert(body.min.x>deck.min.x+.1&&body.max.x<deck.max.x-.1,`${name} mirrors/body leave the bridge width`);
    assert(body.min.z>deck.min.z+.75&&body.max.z<deck.max.z-.75,`${name} complete chassis is not on the weighing deck`);
    assert(!body.intersectsBox(display),`${name} hits the weighbridge display`);
    assert(body.max.z<ENTRY_BARRIER_Z-.5,`${name} on the bridge reaches the entry barrier`);
    const wheelBounds=new THREE.Box3();let tyres=0;
    truck.getObjectByName('tyres-hubs-and-treads').traverse(mesh=>{
      if(mesh.isMesh&&mesh.material===assets.MAT.rubber&&mesh.geometry.type==='LatheGeometry'){wheelBounds.union(new THREE.Box3().setFromObject(mesh));tyres++;}
    });
    assert(tyres>=6,`${name} tyre geometry was not resolved`);
    assert(Math.abs(wheelBounds.min.y-surfaceY)<.002,`${name} tyre contact Y=${wheelBounds.min.y} differs from flush deck Y=${surfaceY}`);
    const chassis=new THREE.Box3().setFromObject(truck.getObjectByName('ladder-chassis-and-running-gear'));
    assert(chassis.min.y>surfaceY+.35,`${name} chassis penetrates the weighing plate`);
    geometryChecks++;
  }
}
const bins=committedTree(assets.AggregateBins);
const binRoots=[];bins.traverse(node=>{if(node.name==='automatic-aggregate-storage-weighing-and-slide-gate')binRoots.push(node);});
assert.equal(binRoots.length,3,'three independent automatic bins must remain');
for(const [index,bin] of binRoots.entries()){
  const at=new THREE.Vector3();bin.getWorldPosition(at);
  assert(Math.abs(at.x-AGGREGATE_BIN_X[index])<1e-8&&Math.abs(at.z-AGGREGATE_BIN_Z)<1e-8,'automatic bin is not on its shared global center');
  const bounds=new THREE.Box3().setFromObject(bin);
  console.log(`bin ${index} actual bounds: ${JSON.stringify({min:bounds.min.toArray(),max:bounds.max.toArray()})}`);
}
const cover=new THREE.Box3().setFromObject(bins.getObjectByName('collection-trench-load-bearing-road-cover'));
assert(Math.abs(cover.max.y-surfaceY)<1e-8,'collection crossing cover is not flush with the vehicle running surface');
const horizontalBelt=new THREE.Box3().setFromObject(bins.getObjectByName('collection-trench-horizontal-belt'));
assert(Math.abs(horizontalBelt.max.y-AGGREGATE_COLLECTION_BELT.start[1])<1e-8,'collection belt must cross below road grade');
assert(horizontalBelt.max.x>=AGGREGATE_COLLECTION_BELT.slopeStart[0]-1e-8,'horizontal collection belt is disconnected from the rising section');
const outlet=bins.getObjectByName('collection-trench-rising-outlet-to-b01');
const slopeStart=new THREE.Vector3(-outlet.children[0].scale.x/2,0,0).applyMatrix4(outlet.matrixWorld);
const slopeEnd=new THREE.Vector3(outlet.children[0].scale.x/2,0,0).applyMatrix4(outlet.matrixWorld);
assert(slopeStart.distanceTo(new THREE.Vector3(...AGGREGATE_COLLECTION_BELT.slopeStart))<1e-8,'rising collector start is disconnected');
assert(slopeEnd.distanceTo(new THREE.Vector3(...AGGREGATE_COLLECTION_BELT.outlet))<1e-8,'collector does not join the B01 inlet');
const mainConveyor=committedTree(assets.Conveyor,{active:false,paused:true});
const conveyorAxis=mainConveyor.children[0],conveyorLength=conveyorAxis.children[0].children[0].scale.x;
const conveyorSurfaceInlet=new THREE.Vector3(-conveyorLength/2,0,0).applyMatrix4(conveyorAxis.matrixWorld);
assert(slopeEnd.distanceTo(conveyorSurfaceInlet)<1e-8,'actual B01 geometry is disconnected from the collection outlet');
const stoneTruck=committedTree(assets.DumpTruck,{fill:1});
stoneTruck.position.set(SCENARIOS.stone.unload[0],VEHICLE_ROAD_Y,SCENARIOS.stone.unload[2]);stoneTruck.rotation.y=-Math.PI/2;stoneTruck.updateMatrixWorld(true);
const stoneBody=new THREE.Box3().setFromObject(stoneTruck);
assert(cover.min.x<stoneBody.min.x&&cover.max.x>stoneBody.max.x,'stone truck does not fit the reinforced collection trench crossing');
for(const bin of binRoots)assert(!new THREE.Box3().setFromObject(bin).intersectsBox(stoneBody),'stone unloading truck intersects an automatic bin');
let stops=0;
for(const scenario of Object.values(SCENARIOS).filter(s=>s.flowKind!=='concrete')){
  for(const key of ['gross','tare']){
    const phase=scenario.stages.find(stage=>stage.key===key),state=getWorkflowState(scenario.id,phase.start+phase.duration*.8);
    assert(Math.hypot(state.vehiclePosition[0]-center[0],state.vehiclePosition[2]-center[2])<1e-8,`${scenario.id} ${key} stops away from the modeled bridge`);
    assert(Math.abs(state.vehiclePosition[1]-VEHICLE_ROAD_Y)<1e-8,`${scenario.id} ${key} has wrong tyre contact height`);
    assert(Math.abs(Math.cos(state.vehicleYaw))<.001,`${scenario.id} ${key} is not aligned with the longitudinal bridge`);
    stops++;
  }
}
for(const key of ['release','return','wash','complete']){
  const phase=SCENARIOS.delivery.stages.find(stage=>stage.key===key),state=getWorkflowState('delivery',phase.start+phase.duration*.8);
  assert(Math.abs(state.vehiclePosition[1]-VEHICLE_ROAD_Y)<1e-8,`mixer ${key} does not share the flush road/bridge contact height`);
}
console.log(`PASS: ${geometryChecks} real full-vehicle bridge fits; flush tyre contact and clear chassis/display; ${stops} workflow weighing stops; entrance barrier and queue clearances; three bin centers, a clear stone-truck crossing and continuous buried collection belt to B01.`);
