import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

// Usage from this project: node scripts/verify-integration.mjs [--runtime DIR]
const projectRoot=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceRoot=path.join(projectRoot,'src');
const args=process.argv.slice(2);
if(args.length && (args.length!==2 || args[0]!=='--runtime' || !args[1])){
  throw new Error('Usage: node scripts/verify-integration.mjs [--runtime DIR]');
}
const runtimeRoot=args.length?path.resolve(args[1]):projectRoot;
const runtimeRequire=createRequire(path.join(runtimeRoot,'package.json'));
function dependency(name){
  try{return runtimeRequire(name);}catch(error){
    // Vite owns esbuild when a package manager keeps transitive dependencies nested.
    if(name==='esbuild'){
      try{return createRequire(runtimeRequire.resolve('vite/package.json'))('esbuild');}catch{}
    }
    throw new Error('Cannot resolve '+name+' from '+runtimeRoot+'. Run npm install in the project, or pass --runtime DIR.',{cause:error});
  }
}
const esbuild=dependency('esbuild'),React=dependency('react');
const {renderToStaticMarkup}=dependency('react-dom/server');
function loader(overrides={}){
  const cache=new Map();
  const load=file=>{
    const absolute=path.isAbsolute(file)?file:path.join(sourceRoot,file);
    if(cache.has(absolute))return cache.get(absolute).exports;
    const module={exports:{}};cache.set(absolute,module);
    const code=esbuild.transformSync(fs.readFileSync(absolute,'utf8'),{loader:absolute.endsWith('.jsx')?'jsx':'js',jsx:'automatic',format:'cjs'}).code;
    const localRequire=name=>{
      if(Object.hasOwn(overrides,name))return overrides[name];
      if(name.endsWith('.css'))return {};
      if(name.startsWith('.')){
        let target=path.resolve(path.dirname(absolute),name);
        if(!path.extname(target))target=['.js','.jsx'].map(ext=>target+ext).find(candidate=>fs.existsSync(candidate));
        return load(target);
      }
      return runtimeRequire(name);
    };
    new Function('require','module','exports',code)(localRequire,module,module.exports);
    return module.exports;
  };
  return load;
}
const load=loader(),{SCENARIOS,getWorkflowState}=load('workflow.js'),{getOperations}=load('operations.js');
const map=load('RegionMap.jsx'),ProcessFlow=load('ProcessFlow.jsx').default;
let passed=0,failed=0;
const check=(name,test)=>{try{test();passed++;console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name+': '+error.message);}};
const stageState=(id,key,fraction)=>{const phase=SCENARIOS[id].stages.find(stage=>stage.key===key);return getWorkflowState(id,phase.start+phase.duration*fraction);};
const near=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<1e-7,message+': '+actual+' vs '+expected);

for(const id of ['sand','stone','cement','flyash']){
  check(id+' physical unload and accounted receipt stay distinct',()=>{
    const unloading=stageState(id,'unloading',.99),beforeReceipt=stageState(id,'tare',.1),receipted=stageState(id,'tare',.9);
    assert.equal(unloading.stockAdded,0);assert.equal(unloading.receipted,false);
    near(unloading.stock,SCENARIOS[id].initialStock,'account stock before tare');
    assert.ok(unloading.warehousePhysicalStock>unloading.stock,'physical stock increases while receipt remains pending');
    assert.equal(beforeReceipt.stockAdded,0);assert.equal(beforeReceipt.netMeasured,null);
    assert.equal(receipted.receipted,true);near(receipted.netMeasured,receipted.gross-SCENARIOS[id].tare,'net weight from weighing');
    near(receipted.stockAdded,SCENARIOS[id].net,'one receipt');
    const repeated=stageState(id,'tare',.9);near(repeated.stock,receipted.stock,'re-reading or seeking does not duplicate receipt');
  });
  check(id+' supply conserves accounted material through completion',()=>{
    const final=getWorkflowState(id,SCENARIOS[id].stages.at(-1).end);
    assert.ok(final.materialConsumed>=0&&final.materialConsumed<=SCENARIOS[id].feed+1e-7);
    near(final.stock,SCENARIOS[id].initialStock+SCENARIOS[id].net-final.materialConsumed,'stock conservation');
    const operation=getOperations(final),stock=operation.stocks.find(item=>item.entityId===final.targetId);
    near(stock.current,final.stock,'visible stock matches task');near(stock.added,SCENARIOS[id].net,'receipt remains single');
  });
}
check('arrival and pump unload do not count as delivery signature',()=>{
  for(const key of ['queue','unloading']){
    const state=stageState('delivery',key,.99);assert.equal(state.delivered,false);assert.equal(state.deliveredVolume,0);
    assert.equal(getOperations(state).summary.deliveredAdded,0);
  }
  assert.equal(stageState('delivery','signature',.1).deliveredVolume,0);
  const signed=stageState('delivery','signature',.9),returned=stageState('delivery','return',.75),washed=stageState('delivery','wash',.9);
  for(const state of [signed,returned,washed])near(state.deliveredVolume,state.plannedVolume,'signed volume retained');
  near(washed.onboardVolume,0,'empty truck after delivery');
});
check('B01 acknowledgement does not release aggregate or production interlock',()=>{
  for(const [id,key] of [['sand','supply'],['stone','supply'],['delivery','production']]){
    const state=stageState(id,key,.5);
    assert.equal(getOperations(state,{faultActive:true,acknowledged:false}).summary.blocked,true);
    assert.equal(getOperations(state,{faultActive:true,acknowledged:true}).summary.blocked,true);
    assert.equal(getOperations(state,{faultActive:false,acknowledged:true}).summary.blocked,false);
  }
});
check('B01 does not block an independent powder screw transfer',()=>{
  for(const id of ['cement','flyash'])assert.equal(getOperations(stageState(id,'supply',.5),{faultActive:true}).summary.blocked,false,id+' supply does not use B01');
});
check('all workflow stages expose three accessible entrances and one current process node',()=>{
  let states=0;
  for(const [id,scenario] of Object.entries(SCENARIOS))for(const phase of scenario.stages){
    const state=stageState(id,phase.key,.5),mapHtml=renderToStaticMarkup(React.createElement(map.default,{workflow:state})),flowHtml=renderToStaticMarkup(React.createElement(ProcessFlow,{workflow:state}));
    assert.equal((mapHtml.match(/tabindex=/g)||[]).length,3,id+' '+phase.key+' entrances');
    assert.equal((flowHtml.match(/aria-current=/g)||[]).length,1,id+' '+phase.key+' current process');
    assert.ok(!/NaN|undefined/.test(mapHtml+flowHtml),id+' '+phase.key+' finite text');states++;
  }
  console.log('  '+states+' complete stage renders');
});
check('continuous map follows live time even while the UI snapshot is old',()=>{
  const stale=stageState('delivery','outbound',.1),phase=SCENARIOS.delivery.stages.find(stage=>stage.key==='outbound');
  let movedFromSnapshot=false;
  for(let i=0;i<=120;i++){
    const time=phase.start+phase.duration*i/120,live=getWorkflowState('delivery',time),pose=map.getMapVehiclePose(stale,{scenarioId:'delivery',time}),expected=map.getMapVehiclePose(live),old=map.getMapVehiclePose(stale);
    near(pose.position[0],expected.position[0],'live map X');near(pose.position[1],expected.position[1],'live map Z');
    if(Math.hypot(pose.position[0]-old.position[0],pose.position[1]-old.position[1])>5)movedFromSnapshot=true;
    assert.ok(Number.isFinite(pose.angle));
  }
  assert.ok(movedFromSnapshot,'live clock advances beyond stale UI position');
});

// Exercise App's public component callbacks with a small hook host, without DOM or Canvas.
function appHost(scenarioId,time,paused,{faultActive=false}={}){
  const states=[],refs=[],effects=[];states[1]=scenarioId;states[2]=time;states[3]=paused;states[9]='map';states[11]=faultActive;
  let stateIndex=0,refIndex=0,initialRender=true;
  const hooks={...React,useState:initial=>{const index=stateIndex++;if(!(index in states))states[index]=typeof initial==='function'?initial():initial;return [states[index],value=>{states[index]=typeof value==='function'?value(states[index]):value;}];},useRef:initial=>{const index=refIndex++;if(!refs[index])refs[index]={current:initial};return refs[index];},useMemo:factory=>factory(),useEffect:(effect,dependencies)=>{if(initialRender&&dependencies?.length===0)effects.push(effect);}};
  function PlantStub(){}function MapStub(){}function FlowStub(){}
  const App=loader({'react':hooks,'./PlantScene':PlantStub,'./RegionMap':MapStub,'./ProcessFlow':FlowStub,'./exportPlantModel':{downloadPlantGLB:()=>{}}})('App.jsx').default;
  const render=()=>{stateIndex=0;refIndex=0;const tree=App();initialRender=false;return tree;};
  const first=render();refs[2].current.time=time;
  const elements=tree=>{const output=[];const walk=node=>{if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(walk);return;}if(node.props){output.push(node);walk(node.props.children);}};walk(tree);return output;};
  const text=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node?.props?text(node.props.children):'';
  return {states,refs,effects,render,elements,text,first,PlantStub,MapStub,FlowStub};
}
check('entering any location and breadcrumb return preserve task, time and play state',()=>{
  const outbound=SCENARIOS.delivery.stages.find(stage=>stage.key==='outbound');
  for(const location of ['supplier','plant','site']){
    const time=outbound.start+outbound.duration*.6,host=appHost('delivery',time,false);
    const mapElement=host.elements(host.first).find(node=>node.type===host.MapStub);mapElement.props.onEnter(location);
    let tree=host.render(),scene=host.elements(tree).find(node=>node.type===host.PlantStub);
    assert.equal(scene.props.view,{supplier:'supplier',plant:'overview',site:'site'}[location]);
    assert.equal(scene.props.workflow.time,time);assert.equal(scene.props.workflow.scenarioId,'delivery');assert.equal(scene.props.paused,false);assert.equal(host.refs[2].current.time,time);
    const back=host.elements(tree).find(node=>node.type==='button'&&host.text(node)==='运输总览');back.props.onClick();
    tree=host.render();assert.ok(host.elements(tree).some(node=>node.type===host.MapStub));assert.equal(host.states[2],time);assert.equal(host.states[1],'delivery');assert.equal(host.states[3],false);
  }
});
check('paused seek updates the live clock and subsequent process focus retains the seek',()=>{
  const host=appHost('sand',0,true),slider=host.elements(host.first).find(node=>node.type==='input'&&node.props.type==='range');
  assert.ok(slider,'task seek control');const phase=SCENARIOS.sand.stages.find(stage=>stage.key==='supply'),time=phase.start+phase.duration*.5;
  slider.props.onChange({target:{value:String(time)}});let tree=host.render();assert.equal(host.refs[2].current.time,time);assert.equal(host.states[3],true);
  const flow=host.elements(tree).find(node=>node.type===host.FlowStub);flow.props.onFocus('mixer-m01');tree=host.render();
  const scene=host.elements(tree).find(node=>node.type===host.PlantStub);assert.equal(scene.props.workflow.time,time);assert.equal(scene.props.focusId,'mixer-m01');assert.ok(scene.props.focusRequest>0);assert.equal(scene.props.paused,true);
});
check('pre-existing B01 stops at production boundary; seek and restart can resume',()=>{
  const production=SCENARIOS.delivery.stages.find(stage=>stage.key==='production'),seekTime=SCENARIOS.delivery.stages.find(stage=>stage.key==='trial').start+1;
  const saved={raf:globalThis.requestAnimationFrame,cancel:globalThis.cancelAnimationFrame,window:globalThis.window},queue=[],cleanups=[];
  globalThis.requestAnimationFrame=callback=>{queue.push(callback);return queue.length;};globalThis.cancelAnimationFrame=()=>{};globalThis.window={addEventListener(){},removeEventListener(){}};
  try{
    const host=appHost('delivery',production.start-.01,false,{faultActive:true});
    for(const effect of host.effects){const cleanup=effect();if(typeof cleanup==='function')cleanups.push(cleanup);}
    let now=performance.now()+50;assert.ok(queue.length);queue.shift()(now);
    near(host.refs[2].current.time,production.start,'fault stops at the exact boundary');
    let tree=host.render(),scene=host.elements(tree).find(node=>node.type===host.PlantStub);assert.equal(scene.props.paused,true);
    const slider=host.elements(tree).find(node=>node.type==='input'&&node.props.type==='range');slider.props.onChange({target:{value:String(seekTime)}});tree=host.render();
    const play=host.elements(tree).find(node=>node.type==='button'&&node.props.className?.includes('play-button'));play.props.onClick();host.render();
    now+=30;queue.shift()(now);assert.ok(host.refs[2].current.time>seekTime,'play advances after an earlier seek');
    tree=host.render();host.elements(tree).find(node=>node.type==='input'&&node.props.type==='range').props.onChange({target:{value:String(production.start-.01)}});tree=host.render();
    host.elements(tree).find(node=>node.type==='button'&&node.props.className?.includes('play-button')).props.onClick();host.render();
    now+=30;queue.shift()(now);tree=host.render();near(host.refs[2].current.time,production.start,'second fault boundary');
    host.elements(tree).find(node=>node.type==='button'&&node.props['aria-label']==='从头演示').props.onClick();host.render();
    now+=30;queue.shift()(now);assert.ok(host.refs[2].current.time>0&&host.refs[2].current.time<1,'restart advances from the beginning');
  }finally{
    cleanups.forEach(cleanup=>cleanup());
    for(const [key,value] of Object.entries({requestAnimationFrame:saved.raf,cancelAnimationFrame:saved.cancel,window:saved.window})){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
  }
});
console.log(`V5 integration: ${passed} passed, ${failed} failed`);
process.exitCode=failed?1:0;


