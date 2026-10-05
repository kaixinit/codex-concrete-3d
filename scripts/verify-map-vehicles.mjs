import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const projectRoot=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args=process.argv.slice(2);
if(args.length&&(args.length!==2||args[0]!=='--runtime'))throw new Error('Usage: node scripts/verify-map-vehicles.mjs [--runtime DIR]');
const runtimeRequire=createRequire(path.join(args.length?path.resolve(args[1]):projectRoot,'package.json'));
const React=runtimeRequire('react'),{renderToStaticMarkup}=runtimeRequire('react-dom/server');
let esbuild;
try{esbuild=runtimeRequire('esbuild');}catch{esbuild=createRequire(runtimeRequire.resolve('vite/package.json'))('esbuild');}
const cache=new Map();
function load(file){
  const absolute=path.isAbsolute(file)?file:path.join(projectRoot,'src',file);
  if(cache.has(absolute))return cache.get(absolute).exports;
  const module={exports:{}};cache.set(absolute,module);
  const code=esbuild.transformSync(fs.readFileSync(absolute,'utf8'),{loader:absolute.endsWith('.jsx')?'jsx':'js',jsx:'automatic',format:'cjs'}).code;
  const localRequire=name=>name.startsWith('.')?load(path.resolve(path.dirname(absolute),name)):runtimeRequire(name);
  new Function('require','module','exports',code)(localRequire,module,module.exports);
  return module.exports;
}
const map=load('RegionMap.jsx'),{SCENARIOS,getWorkflowState}=load('workflow.js');
const expected={sand:['dump-truck','砂石自卸车'],stone:['dump-truck','砂石自卸车'],cement:['powder-tanker','散装粉料罐车'],flyash:['powder-tanker','散装粉料罐车'],delivery:['mixer','混凝土搅拌车']};
let renders=0;
for(const [id,scenario] of Object.entries(SCENARIOS))for(const phase of scenario.stages){
  const state=getWorkflowState(id,phase.start+phase.duration*.5),[kind,name]=expected[id];
  assert.equal(map.getMapVehicleKind(state),kind,id+' '+phase.key+' type');
  const html=renderToStaticMarkup(React.createElement(map.default,{workflow:state}));
  assert.ok(html.includes('data-vehicle-kind="'+kind+'"'),id+' '+phase.key+' shape');
  assert.ok(html.includes('<title>'+name+'</title>'),id+' '+phase.key+' accessible vehicle type');
  const label=html.match(/<g class="v5-map-vehicle-label">(.*?)<\/g>/)?.[1];
  assert.ok(label?.includes(state.vehicleCode),id+' '+phase.key+' vehicle label');
  assert.ok(!label.includes('transform='),'vehicle label is independent of rotating body');
  assert.ok(!/NaN|undefined/.test(html),id+' '+phase.key+' finite geometry');
  renders++;
}
// The cab points along local +X. The four compass directions must rotate correctly.
for(const [yaw,expectedAngle] of [[0,0],[Math.PI/2,-90],[Math.PI,-180],[-Math.PI/2,90]]){
  const pose=map.getMapVehiclePose({vehiclePosition:[0,0,60],vehicleYaw:yaw});
  assert.ok(Math.abs(pose.angle-expectedAngle)<1e-7,'cab follows world travel heading '+yaw);
}
const mixer=renderToStaticMarkup(React.createElement(map.MapVehicleShape,{kind:'mixer'}));
assert.ok(mixer.includes('v5-map-mixer-drum'),'delivery truck includes mixer drum');
assert.ok(mixer.includes('v5-map-truck-cab'),'delivery truck includes driver cab');
assert.ok(mixer.includes('v5-map-truck-wheels'),'delivery truck includes visible axles');
console.log('Map vehicles: '+renders+' stage renders, 3 vehicle types, 4 travel headings passed');
