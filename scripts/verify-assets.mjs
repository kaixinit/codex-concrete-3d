import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';

// Run from any working directory. --runtime points to a separate package
// directory with its own node_modules; otherwise use this project's install.
const args=process.argv.slice(2);
if(args.includes('--help')){
  console.log('Usage: node scripts/verify-assets.mjs [--runtime <package-directory>]');
  process.exit(0);
}
let runtime;
for(let i=0;i<args.length;i++){
  if(args[i]==='--runtime'){
    runtime=args[++i];
    if(!runtime||runtime.startsWith('--'))throw new Error('--runtime requires a package directory.');
  }else if(args[i].startsWith('--runtime=')){
    runtime=args[i].slice('--runtime='.length);
    if(!runtime)throw new Error('--runtime requires a package directory.');
  }else throw new Error('Unknown argument: '+args[i]);
}
const project=fileURLToPath(new URL('../',import.meta.url));
const runtimeRoot=runtime?path.resolve(runtime):project;
const require=createRequire(path.join(runtimeRoot,'package.json'));
let esbuild,threeEntry;
try{
  const viteRequire=createRequire(require.resolve('vite/package.json'));
  esbuild=viteRequire('esbuild');
  threeEntry=require.resolve('three');
}catch(error){
  throw new Error('Verification dependencies unavailable. Install the project dependencies or pass --runtime <package-directory>. '+error.message);
}

// Resolve the JSX component tree into real Three objects without starting a
// browser. Commit the real StaticInstances effects in child-first order.
globalThis.assetEffects=[];
const mock={name:'asset-tree',setup(build){
  build.onResolve({filter:/^(react|@react-three\/fiber|asset-jsx\/jsx-runtime)$/},args=>({path:args.path,namespace:'mock'}));
  build.onLoad({filter:/.*/,namespace:'mock'},({path})=>({contents:path==='react'?`export const useRef=x=>({current:x}),useMemo=f=>f(),useEffect=f=>globalThis.assetEffects.push(f),createContext=value=>({value}),useContext=context=>context.value;export default {memo:f=>f};`:path==='@react-three/fiber'?`export const useFrame=()=>{},useThree=()=>({});`:`export const Fragment='group';export const jsx=(type,props,key)=>({type,props,key}),jsxs=jsx;`,loader:'js'}));
}};
const source=fileURLToPath(new URL('../src/IndustrialAssets.jsx',import.meta.url));
const result=await esbuild.build({entryPoints:[source],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',jsxImportSource:'asset-jsx',alias:{three:threeEntry},plugins:[mock],logLevel:'silent'});
const assets=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const THREE=require('three');
function tree(element){
  if(!element||typeof element!=='object')return null;
  if(Array.isArray(element)){const g=new THREE.Group();element.forEach(e=>{const child=tree(e);if(child)g.add(child);});return g;}
  const {type,props={}}=element;
  if(typeof type==='function')return tree(type(props));
  const node=type==='mesh'?new THREE.Mesh(props.geometry,props.material):type==='instancedMesh'?new THREE.InstancedMesh(...props.args):new THREE.Group();
  if(props.position)node.position.set(...(Array.isArray(props.position)?props.position:props.position.toArray()));
  if(props.scale)node.scale.set(...props.scale);
  if(props.rotation)node.rotation.set(...props.rotation);
  if(props.quaternion)node.quaternion.copy(props.quaternion);
  node.name=props.name||'';node.userData=props.userData||{};node.visible=props.visible??true;
  node.castShadow=props.castShadow??false;node.receiveShadow=props.receiveShadow??false;
  if(props.ref){if(typeof props.ref==='function')props.ref(node);else props.ref.current=node;}
  const children=Array.isArray(props.children)?props.children:[props.children];
  children.forEach(child=>{const next=tree(child);if(next)node.add(next);});return node;
}
function visibleMeshes(root){let count=0;root.traverse(o=>{if(!o.isMesh)return;for(let p=o;p;p=p.parent)if(!p.visible)return;count++;});return count;}
for(const [name,component,props] of [['Silo',assets.Silo,{}],['Silo cutaway',assets.Silo,{cutaway:true}],['Hopper',assets.Hopper,{visualState:{current:{}}}],['AggregateBins',assets.AggregateBins,{visualState:{current:{}}}],['AggregateShed',assets.AggregateShed,{}],['MixerTower',assets.MixerTower,{}],['MixerTower cutaway',assets.MixerTower,{cutaway:true}],['MixerTruck',assets.MixerTruck,{}]]){
  globalThis.assetEffects=[];const root=tree({type:component,props});root.updateMatrixWorld(true);
  const before=visibleMeshes(root),boxBefore=new THREE.Box3().setFromObject(root);
  const protectedNames=['silo-powder-section','pneumatic-unloading-riser','stored-aggregate-in-open-bin','metering-slide-gate-and-actuation','aggregate-weighing-volume-and-gate','powder-weighing-volume-and-gate','mixer-discharge-m01'],protectedVisibility=new Map();
  for(const protectedName of protectedNames)root.getObjectByName(protectedName)?.traverse(mesh=>{if(mesh.isMesh)protectedVisibility.set(mesh,mesh.visible);});
  [...globalThis.assetEffects].reverse().forEach(effect=>effect());root.updateMatrixWorld(true);
  const after=visibleMeshes(root),boxAfter=new THREE.Box3().setFromObject(root);
  assert(boxBefore.min.distanceTo(boxAfter.min)<1e-6&&boxBefore.max.distanceTo(boxAfter.max)<1e-6,name+' bounds changed');
  for(const protectedName of protectedNames){
    const group=root.getObjectByName(protectedName);if(!group)continue;
    group.traverse(mesh=>{if(mesh.isMesh&&!mesh.isInstancedMesh)assert.equal(mesh.visible,protectedVisibility.get(mesh),name+' batched a dynamic mesh '+protectedName);});
  }
  root.traverse(mesh=>{if(mesh.isMesh){assert([...mesh.geometry.attributes.position.array].every(Number.isFinite),name+' invalid merged position');if(mesh.geometry.attributes.normal)assert([...mesh.geometry.attributes.normal.array].every(Number.isFinite),name+' invalid merged normal');}});
  if(name.startsWith('MixerTower'))assert(before-after>150,name+' expected substantial fixed-part batching');
  if(name==='MixerTruck')assert(before-after>60,name+' expected substantial cab/detail batching');
  let newBatchSavings=0;
  root.traverse(mesh=>{if(mesh.userData.staticBatch&&/^(mixer-fixed-platforms-and-braces|mixer-fixed-roof-rails-and-access-grating|shaft-fixed-paddles-and-blades|mixer-cab-fixed-surfaces|chassis-fixed-suspension-details)/.test(mesh.name))newBatchSavings+=(mesh.isInstancedMesh?mesh.count:mesh.userData.sourceMeshCount)-1;});
  console.log(JSON.stringify({asset:name,beforeVisibleMeshes:before,afterVisibleMeshes:after,saved:before-after,newBatchSavings,boundsUnchanged:true,dynamicMeshesUnbatched:true}));
}
