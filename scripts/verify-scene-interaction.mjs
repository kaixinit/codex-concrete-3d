import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {QUALITY_PROFILES,initialQualityState,advanceQualityState,summarizeFrameSamples} from '../src/sceneQuality.js';
import * as visualRules from '../src/sceneVisualRules.js';
import {segmentIntersectsBounds,planCameraFlight} from '../src/cameraSafety.js';

const project=path.dirname(path.dirname(fileURLToPath(import.meta.url))),args=process.argv.slice(2);
if(args.length&&(args.length!==2||args[0]!=='--runtime'))throw Error('Usage: node scripts/verify-scene-interaction.mjs [--runtime DIR]');
const runtimeRequire=createRequire(path.join(args.length?path.resolve(args[1]):project,'package.json'));
const THREE=runtimeRequire('three');let esbuild;
try{esbuild=runtimeRequire('esbuild');}catch{esbuild=createRequire(runtimeRequire.resolve('vite/package.json'))('esbuild');}
const module={exports:{}};
const code=esbuild.transformSync(fs.readFileSync(path.join(project,'src/sceneGeometry.js'),'utf8'),{format:'cjs'}).code;
new Function('require','module','exports',code)(name=>name==='three'?THREE:visualRules,module,module.exports);
const {createOcclusionProbe,visibleLocalBounds,geometryScratch}=module.exports;
let checks=0;function check(name,test){test();checks++;console.log('PASS '+name);}

check('quality changes require sustained measurements and respect manual selection',()=>{
  const slow={samples:300,mean:35,p95:'48.1',longFrames:0},fast={samples:300,mean:16,p95:'18.0',longFrames:0};
  let state=initialQualityState();
  for(const now of [1000,2000]){state=advanceQualityState(state,slow,now);assert.equal(state.effective,'balanced');}
  state=advanceQualityState(state,slow,3000);assert.equal(state.effective,'low');
  for(let now=4000;now<15000;now+=1000){state=advanceQualityState(state,fast,now);assert.equal(state.effective,'low','no rapid upgrade');}
  state=advanceQualityState(state,fast,15000);assert.equal(state.effective,'balanced');
  state=advanceQualityState(state,slow,15100,'high');assert.equal(state.effective,'high','explicit quality overrides adaptation');
  assert.equal(QUALITY_PROFILES.low.shadows,false);assert.ok(QUALITY_PROFILES.low.dprMax<1);
  assert.ok(QUALITY_PROFILES.high.detailLevel>QUALITY_PROFILES.balanced.detailLevel);
});
check('visible long stalls remain in frame statistics instead of being discarded',()=>{
  const sample=summarizeFrameSamples([...Array(299).fill(16),650]);
  assert.equal(sample.samples,300);assert.equal(sample.worst,'650.0');assert.equal(sample.longFrames,1);assert.equal(sample.stalls,1);
  assert.equal(sample.fps,Math.round(300000/(299*16+650)));assert.equal(summarizeFrameSamples([]),null);
});
check('automatic camera paths clear building volumes and direct clear paths stay direct',()=>{
  const boxes=[{min:[-2,0,-2],max:[2,12,2]}],from=[10,5,10],to=[-10,5,-10];
  assert.equal(segmentIntersectsBounds(from,to,boxes[0],2),true);
  const flight=planCameraFlight(from,to,boxes);assert.equal(flight.length,3);
  let current=from;for(const point of flight){assert.equal(segmentIntersectsBounds(current,point,boxes[0],2),false);current=point;}
  assert.deepEqual(flight.at(-1),to);
  assert.deepEqual(planCameraFlight([10,25,10],[-10,25,-10],boxes),[[-10,25,-10]]);
});
check('visibility debounces obstruction and docking is reserved for selected or critical labels',()=>{
  let state=visualRules.advanceOcclusion(null,true,0);assert.equal(state.blocked,false);
  state=visualRules.advanceOcclusion(state,true,120);assert.equal(state.blocked,true);
  state=visualRules.advanceOcclusion(state,false,130);assert.equal(state.blocked,true);
  state=visualRules.advanceOcclusion(state,false,300);assert.equal(state.blocked,false);
  assert.equal(visualRules.labelOcclusionMode(true,{selected:true}),'dock');
  assert.equal(visualRules.labelOcclusionMode(true,{fault:true}),'dock');
  assert.equal(visualRules.labelOcclusionMode(true,{role:'area'}),'hidden');
  assert.equal(visualRules.labelOcclusionMode(false,{}),'normal');
});
check('docked hints stay on screen and avoid the local context card',()=>{
  const viewport={width:1265,height:520},item={width:82,height:27},card={x:957,y:210,width:292,height:250};
  for(const anchor of [{x:1050,y:330},{x:20,y:400},{x:640,y:45}]){
    const pose=visualRules.dockLabelPose(anchor,item,viewport,[card]);assert.ok(pose);
    assert.ok(pose.x>=12&&pose.y>=12&&pose.x+pose.width<=viewport.width-12&&pose.y+pose.height<=viewport.height-12);
    assert.ok(pose.x+pose.width+6<=card.x||pose.x>=card.x+card.width+6||pose.y+pose.height+6<=card.y||pose.y>=card.y+card.height+6);
  }
});

const scene=new THREE.Scene(),root=new THREE.Group();root.name='concrete-batching-plant';scene.add(root);
const wall=new THREE.Group();wall.name='wall';wall.userData.entityId='wall';root.add(wall);
const mesh=new THREE.Mesh(new THREE.BoxGeometry(4,10,1),new THREE.MeshStandardMaterial());mesh.position.set(0,5,5);wall.add(mesh);
const camera=new THREE.PerspectiveCamera(37,1,.1,100);camera.position.set(0,5,10);camera.lookAt(0,5,0);camera.updateMatrixWorld();
const anchor=new THREE.Vector3(0,5,0);
check('real wall triangles obstruct labels; hidden/cutaway/glass/helper geometry does not',()=>{
  const probe=createOcclusionProbe(scene,{maxRays:8,maxMillis:Infinity});probe.begin(0,true);
  assert.equal(probe.check(anchor,camera),true,'opaque wall is hit');
  mesh.visible=false;probe.begin(.2);assert.equal(probe.check(anchor,camera),false,'removed cutaway wall is not hit');
  mesh.visible=true;mesh.material.transparent=true;mesh.material.opacity=.4;probe.begin(.3);assert.equal(probe.check(anchor,camera),false,'transparent glass remains inspectable');
  mesh.material.transparent=false;mesh.material.opacity=1;mesh.userData.uiOnly=true;probe.begin(.4);assert.equal(probe.check(anchor,camera),false,'UI helper does not occlude');
  delete mesh.userData.uiOnly;mesh.position.z=-5;probe.begin(1.5,true);assert.equal(probe.check(anchor,camera),false,'a wall beyond the anchor does not occlude it');
  mesh.position.z=5;
});
check('occlusion work has an explicit per-tick ray budget',()=>{
  const probe=createOcclusionProbe(scene,{maxRays:1,maxMillis:Infinity});probe.begin(2,true);
  assert.equal(probe.check(anchor,camera),true);assert.equal(probe.check(anchor,camera),null,'budget exhaustion preserves prior visibility');
  probe.begin(2.1);assert.equal(probe.check(anchor,camera),true,'budget renews next tick');
});
check('selection bounds ignore hidden geometry and exported UI helpers',()=>{
  const object=new THREE.Group(),body=new THREE.Mesh(new THREE.BoxGeometry(2,3,4),new THREE.MeshBasicMaterial());object.add(body);
  const hidden=new THREE.Mesh(new THREE.BoxGeometry(100,100,100),new THREE.MeshBasicMaterial());hidden.visible=false;object.add(hidden);
  const helper=new THREE.Mesh(new THREE.BoxGeometry(500,500,500),new THREE.MeshBasicMaterial());helper.userData.uiOnly=true;object.add(helper);
  const bounds=new THREE.Box3();visibleLocalBounds(object,bounds,geometryScratch());assert.deepEqual(bounds.getSize(new THREE.Vector3()).toArray(),[2,3,4]);
  const child=new THREE.Group();child.userData.entityId='aggregate-scale-m01';body.add(child);
  assert.equal(visualRules.entityAncestor(child),child,'nested scale takes selection precedence');
});
console.log(`Scene interaction: ${checks} checks passed. FPS requires a browser playback benchmark.`);
