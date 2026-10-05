import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {SCENARIOS,getWorkflowState} from '../src/workflow.js';
import {getMixerChutePose,chuteDischargeLipLocal,getChuteActuatorPose,getProductionAssetState,pileScoopDepth} from '../src/assetMotion.js';

const args=process.argv.slice(2),project=fileURLToPath(new URL('../',import.meta.url));
if(args.length&&(args.length!==2||args[0]!=='--runtime'))throw new Error('Usage: node scripts/verify-asset-motion.mjs [--runtime DIR]');
const require=createRequire(path.join(args.length?path.resolve(args[1]):project,'package.json'));
const viteRequire=createRequire(require.resolve('vite/package.json')),esbuild=viteRequire('esbuild'),THREE=require('three');
globalThis.assetMotionFrames=[];globalThis.assetMotionEffects=[];
const mock={name:'real-asset-animation',setup(build){
  build.onResolve({filter:/^(react|@react-three\/fiber|asset-motion-jsx\/jsx-runtime)$/},args=>({path:args.path,namespace:'mock'}));
  build.onLoad({filter:/.*/,namespace:'mock'},({path})=>({contents:path==='react'?`export const useRef=x=>({current:x}),useMemo=f=>f(),useEffect=f=>globalThis.assetMotionEffects.push(f),createContext=value=>({value}),useContext=context=>context.value;export default {memo:f=>f};`:path==='@react-three/fiber'?`export const useFrame=(fn,priority=0)=>globalThis.assetMotionFrames.push({fn,priority}),useThree=()=>({});`:`export const Fragment='group';export const jsx=(type,props,key)=>({type,props,key}),jsxs=jsx;`,loader:'js'}));
}};
const build=await esbuild.build({entryPoints:[path.join(project,'src','IndustrialAssets.jsx')],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',jsxImportSource:'asset-motion-jsx',alias:{three:require.resolve('three')},plugins:[mock],logLevel:'silent'});
const assets=await import('data:text/javascript;base64,'+Buffer.from(build.outputFiles[0].text).toString('base64'));
function tree(element){
  if(!element||typeof element!=='object')return null;
  if(Array.isArray(element)){const group=new THREE.Group();element.forEach(child=>{const node=tree(child);if(node)group.add(node);});return group;}
  const {type,props={}}=element;
  if(typeof type==='function')return tree(type(props));
  const node=type==='mesh'?new THREE.Mesh(props.geometry,props.material):type==='instancedMesh'?new THREE.InstancedMesh(...props.args):new THREE.Group();
  if(props.position)node.position.set(...(Array.isArray(props.position)?props.position:props.position.toArray()));
  if(props.scale)node.scale.set(...props.scale);if(props.rotation)node.rotation.set(...props.rotation);if(props.quaternion)node.quaternion.copy(props.quaternion);
  node.name=props.name||'';node.visible=props.visible??true;node.userData=props.userData||{};node.userData.testOnClick=props.onClick;
  if(props.ref){if(typeof props.ref==='function')props.ref(node);else props.ref.current=node;}
  const children=Array.isArray(props.children)?props.children:[props.children];children.forEach(child=>{const next=tree(child);if(next)node.add(next);});return node;
}
function host(component,props){
  globalThis.assetMotionFrames=[];globalThis.assetMotionEffects=[];
  const root=tree({type:component,props}),frames=[...globalThis.assetMotionFrames].sort((a,b)=>a.priority-b.priority),camera=new THREE.PerspectiveCamera();camera.position.set(10,12,15);
  root.updateMatrixWorld(true);[...globalThis.assetMotionEffects].reverse().forEach(effect=>effect());
  return {root,paint(dt=1/60){frames.forEach(({fn})=>fn({camera},dt));root.updateMatrixWorld(true);}};
}
const delivery=SCENARIOS.delivery,queue=delivery.stages.find(stage=>stage.key==='queue'),unload=delivery.stages.find(stage=>stage.key==='unloading'),signature=delivery.stages.find(stage=>stage.key==='signature'),loading=delivery.stages.find(stage=>stage.key==='loading'),production=delivery.stages.find(stage=>stage.key==='production');
const visualState={current:getWorkflowState('delivery',0)},visualClock={current:{time:0}},truck=host(assets.MixerTruck,{visualState,visualClock});
const chute=truck.root.getObjectByName('curved-u-section-folding-chute');
const hiddenCabSources=[];truck.root.getObjectByName('mixer-cab-fixed-surfaces').traverse(mesh=>{if(mesh.isMesh&&!mesh.visible)hiddenCabSources.push(mesh);});
assert.ok(hiddenCabSources.length>20,'cab batching hides original fixed meshes');
const samples=[0,queue.start+.5,queue.start+1.3,queue.end,unload.start+4,signature.start+1,signature.start+3,signature.end,unload.start+2,queue.start+2,0];
for(const time of samples){
  visualState.current=getWorkflowState('delivery',time);visualClock.current.time=time;
  truck.paint();const expected=getMixerChutePose(visualState.current),lip=new THREE.Vector3(-1.835,-.798,0).applyMatrix4(chute.matrixWorld);
  assert.ok(hiddenCabSources.every(mesh=>mesh.visible===false),'LOD and animation frames do not restore batched originals');
  assert.ok(lip.distanceTo(new THREE.Vector3(...chuteDischargeLipLocal(visualState.current)))<1e-6,'moving chute lip matches transfer endpoint');
  assert.ok(Math.abs(chute.rotation.y-expected.yaw)<1e-10&&Math.abs(chute.rotation.z-expected.pitch)<1e-10,'chute uses absolute-time pose');
  const snapshot=chute.matrixWorld.elements.slice();truck.paint(2/60);truck.paint(4/60);assert.deepEqual(chute.matrixWorld.elements,snapshot,'pause and 2x/4x frame timestep keep identical pose');
  const actuator=getChuteActuatorPose(visualState.current),hydraulic=truck.root.getObjectByName('chute-hydraulic-cylinder-and-pivot-links').getObjectByName('live-pivot-coupled-hydraulic-cylinder'),rod=hydraulic.children[1];
  const end=new THREE.Vector3(0,.5,0).applyMatrix4(rod.matrixWorld);assert.ok(end.distanceTo(new THREE.Vector3(...actuator.end))<1e-6,'hydraulic rod stays attached to chute pivot');
}
let last=getMixerChutePose(getWorkflowState('delivery',0)),continuity=0;
for(let time=.02;time<=delivery.stages.at(-1).end;time+=.02){const pose=getMixerChutePose(getWorkflowState('delivery',time));assert.ok(pose.deployment>=0&&pose.deployment<=1);assert.ok(Math.abs(pose.pitch-last.pitch)<.012,'no chute orientation jump');last=pose;continuity++;}
assert.equal(getMixerChutePose(getWorkflowState('delivery',unload.start)).deployment,1,'chute is deployed before concrete unload');
assert.equal(getMixerChutePose(getWorkflowState('delivery',signature.end)).deployment,0,'chute stows before road return');

let selected;
const tower=host(assets.MixerTower,{cutaway:true,active:true,visualState,visualClock,onSelect:id=>{selected=id;}});
for(const id of ['aggregate-scale-m01','powder-scale-m01','mixer-discharge-m01','water-scale-m01']){let stopped=false;const object=tower.root.getObjectByName(id);assert.equal(object.userData.entityId,id);object.userData.testOnClick({stopPropagation(){stopped=true;}});assert.equal(selected,id);assert.ok(stopped,'mechanism click selects independently');}
for(const [phase,fractions] of [[production,[.15,.28,.37,.42,.5,.75,1]],[loading,[0,.03,.5,.97,1]]])for(const fraction of fractions){
  const time=phase.start+phase.duration*fraction;visualState.current=getWorkflowState('delivery',time);visualClock.current.time=time;tower.paint();const pose=getProductionAssetState(visualState.current);
  for(const value of Object.values(pose))assert.ok(Number.isFinite(value)&&value>=0&&value<=1,'bounded production mechanism pose');
  const discharge=tower.root.getObjectByName('mixer-discharge-m01');assert.ok(Math.abs(discharge.children[0].rotation.z+pose.dischargeGate*.96)<1e-8,'gate follows shared process');
  const chamber=tower.root.getObjectByName('live-mixer-batch-volume');assert.equal(chamber.visible,pose.mixerFill>.001,'batch volume drains with truck loading');
}
assert.ok(getProductionAssetState(getWorkflowState('delivery',production.start+production.duration*.17)).aggregateFill>.5,'aggregate scale fills');
assert.ok(getProductionAssetState(getWorkflowState('delivery',production.start+production.duration*.33)).aggregateGate>.5,'weighed aggregate releases');
assert.ok(getProductionAssetState(getWorkflowState('delivery',production.start+production.duration*.39)).powderFill>.5,'powder scale fills');

const sand=SCENARIOS.sand,scoop=sand.stages.find(stage=>stage.key==='loading');
const entry=getWorkflowState('sand',scoop.start+7),exit=getWorkflowState('sand',scoop.start+10);
assert.ok(new THREE.Vector3(...entry.loaderPosition).distanceTo(new THREE.Vector3(...exit.loaderPosition))>.55,'loader advances into pile while scooping');
assert.equal(entry.loaderFill,0);assert.equal(exit.loaderFill,1);
assert.ok(pileScoopDepth(0,1.65,1)>.5&&pileScoopDepth(0,-2,1)<.001,'scoop makes a local front-face cut');
const pileState={current:{loaderPickupProgress:0}},pile=host(assets.MaterialPile,{type:'sand',visualState:pileState,getCut:s=>s.loaderPickupProgress});pile.paint();const mesh=pile.root.getObjectByName('sand-material-pile').children[0],base=mesh.geometry.attributes.position.array.slice();pileState.current.loaderPickupProgress=1;pile.paint();assert.ok(base.some((value,index)=>index%3===1&&value-mesh.geometry.attributes.position.array[index]>.12),'real pile vertices deform at pickup');pileState.current.loaderPickupProgress=0;pile.paint();assert.deepEqual(mesh.geometry.attributes.position.array,base,'seeking restores undeformed pile');

for(const geometry of [assets.tyreGeometry(.54),assets.tyreGeometry(.73),assets.screwFlightGeometry(14)]){
  assert.ok([...geometry.attributes.position.array].every(Number.isFinite));assert.ok([...geometry.attributes.normal.array].every(Number.isFinite));geometry.computeBoundingBox();assert.ok(!geometry.boundingBox.isEmpty());
}
assert.equal(assets.tyreGeometry(.54),assets.tyreGeometry(.54),'same-size tyre shares geometry');
assert.ok(assets.MAT.white.isMeshPhysicalMaterial&&assets.MAT.glass.isMeshPhysicalMaterial,'paint and glass have independent PBR response');
assert.equal(assets.MAT.sand.bumpMap.image.width,64,'surface microdetail uses small shared procedural texture');
console.log('Asset motion: '+continuity+' continuous chute samples; seek/pause/2x/4x poses, hydraulic endpoints, 4 selectable production mechanisms, batch/gate phases, scoop/deformation restore, shared finite tyre/screw geometry and PBR surfaces passed.');
