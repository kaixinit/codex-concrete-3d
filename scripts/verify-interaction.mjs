import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

// node scripts/verify-interaction.mjs [--runtime DIR]
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),args=process.argv.slice(2);
if(args.length&&(args.length!==2||args[0]!=='--runtime'))throw new Error('Usage: node scripts/verify-interaction.mjs [--runtime DIR]');
const runtime=createRequire(path.join(args.length?path.resolve(args[1]):root,'package.json'));
const React=runtime('react'),{renderToStaticMarkup}=runtime('react-dom/server');
let esbuild;try{esbuild=runtime('esbuild');}catch{esbuild=createRequire(runtime.resolve('vite/package.json'))('esbuild');}
function loader(overrides={}){
  const cache=new Map();
  const load=file=>{
    const absolute=path.isAbsolute(file)?file:path.join(root,'src',file);
    if(cache.has(absolute))return cache.get(absolute).exports;
    const module={exports:{}};cache.set(absolute,module);
    const localRequire=name=>{if(Object.hasOwn(overrides,name))return overrides[name];if(name.endsWith('.css'))return{};if(!name.startsWith('.'))return runtime(name);let target=path.resolve(path.dirname(absolute),name);if(!path.extname(target))target=['.jsx','.js'].map(ext=>target+ext).find(fs.existsSync);return load(target);};
    const code=esbuild.transformSync(fs.readFileSync(absolute,'utf8'),{loader:absolute.endsWith('.jsx')?'jsx':'js',jsx:'automatic',format:'cjs'}).code;
    new Function('require','module','exports',code)(localRequire,module,module.exports);return module.exports;
  };return load;
}
const load=loader(),{SCENARIOS,getWorkflowState}=load('workflow.js'),{entityDetail,getOperations}=load('operations.js');
const {VEHICLE_ROAD_Y}=load('stationLayout.js');
const {default:SceneObjectCard,objectCardData}=load('SceneObjectCard.jsx'),{default:ProcessFlow,getMaterialFlowState,getProductionSteps}=load('ProcessFlow.jsx');
let passed=0,failed=0;
const check=(name,test)=>{try{test();passed++;console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name+': '+error.message);}};
const at=(id,key,fraction=.5)=>{const phase=SCENARIOS[id].stages.find(stage=>stage.key===key);return getWorkflowState(id,phase.start+phase.duration*fraction);};
const html=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));

check('production branches show only their own material activity',()=>{
  const early=getMaterialFlowState(at('delivery','production',.18));assert.equal(early.aggregate,true);assert.equal(early.powder,false);assert.equal(early.water,false);
  const together=getMaterialFlowState(at('delivery','production',.3));assert.equal(together.aggregate,true);assert.equal(together.powder,true);
  const liquids=getMaterialFlowState(at('delivery','production',.5));assert.equal(liquids.aggregate,false);assert.equal(liquids.powder,false);assert.equal(liquids.water,true);assert.equal(liquids.admixture,true);
  for(const value of Object.values(getMaterialFlowState(at('delivery','production',.3),true)))assert.equal(Boolean(value),false,'interlock freezes material indications');
  const powder=at('cement','supply',.5);assert.equal(getMaterialFlowState(powder).powder,true);assert.equal(Boolean(getMaterialFlowState(powder).aggregate),false);
  const rendered=html(ProcessFlow,{workflow:at('delivery','production',.18)});
  assert.ok(/data-material="powder" data-flowing="false"/.test(rendered));assert.ok(/data-material="aggregate" data-flowing="true"/.test(rendered));
});
check('production substeps distinguish charging, mixing and actual loading gate phase',()=>{
  const current=state=>getProductionSteps(state).find(step=>step.status==='active')?.key;
  assert.equal(current(at('delivery','production',.15)),'metering');assert.equal(current(at('delivery','production',.4)),'charging');assert.equal(current(at('delivery','production',.8)),'mixing');
  assert.equal(current(at('delivery','loading',.02)),'opening');assert.equal(current(at('delivery','loading',.5)),'loading');
  assert.ok(getProductionSteps(at('delivery','release',.5)).every(step=>step.status==='done'));
  assert.equal(getProductionSteps(at('delivery','production',.5),true).find(step=>step.status==='blocked')?.key,'charging');
});
check('现场卡 preserves pre-receipt stock and identifies static snapshots',()=>{
  const before=at('cement','unloading',.99),received=at('cement','tare',.9);
  const initial=html(SceneObjectCard,{selectedId:'cement-c01',detail:entityDetail('cement-c01',before),workflow:before});
  const final=html(SceneObjectCard,{selectedId:'cement-c01',detail:entityDetail('cement-c01',received),workflow:received});
  assert.ok(initial.includes('145.0 t'));assert.ok(final.includes((SCENARIOS.cement.initialStock+SCENARIOS.cement.net).toFixed(1)+' t'));
  for(const id of ['cement-c02','snapshot-mc008']){const detail=entityDetail(id,before),data=objectCardData(detail,before);assert.equal(data.snapshot,true);assert.notEqual(data.task,before.task);assert.ok(html(SceneObjectCard,{selectedId:id,detail,workflow:before}).includes('静态示例快照'));}
});
check('现场卡 follows delivery signature and never invents a live sensor source',()=>{
  for(const key of ['queue','unloading']){const state=at('delivery',key,.99),rendered=html(SceneObjectCard,{selectedId:'construction-site',detail:entityDetail('construction-site',state),workflow:state});assert.ok(rendered.includes('0.0 m³'));assert.ok(rendered.includes('尚未接入现场传感器'));}
  const state=at('delivery','signature',.9);assert.ok(html(SceneObjectCard,{selectedId:'construction-site',detail:entityDetail('construction-site',state),workflow:state}).includes('12.0 m³'));
});
check('all 65 workflow stages and their current vehicle cards render accessible finite content',()=>{
  let count=0;for(const [id,scenario] of Object.entries(SCENARIOS))for(const phase of scenario.stages){const state=at(id,phase.key),rendered=html(ProcessFlow,{workflow:state})+html(SceneObjectCard,{selectedId:state.vehicleId,detail:entityDetail(state.vehicleId,state),workflow:state});assert.ok(!/NaN|undefined/.test(rendered),id+' '+phase.key);assert.equal((rendered.match(/aria-current=/g)||[]).length,1);assert.ok(rendered.includes('aria-label="关闭现场对象卡"'));count++;}assert.equal(count,65);
});

function appHost(id,time){
  const states=[],refs=[],effects=[];states[1]=id;states[2]=time;states[3]=true;let si=0,ri=0,first=true,dependentEffects=[];
  const hooks={...React,useState:initial=>{const index=si++;if(!(index in states))states[index]=typeof initial==='function'?initial():initial;return[states[index],value=>{states[index]=typeof value==='function'?value(states[index]):value;}];},useRef:initial=>{const index=ri++;if(!refs[index])refs[index]={current:initial};return refs[index];},useMemo:fn=>fn(),useEffect:(effect,deps)=>{if(first&&deps?.length===0)effects.push(effect);else if(deps?.length)dependentEffects.push(effect);}};
  function PlantStub(){}function MapStub(){}function FlowStub(){}function CardStub(){}
  const App=loader({'react':hooks,'./PlantScene':PlantStub,'./RegionMap':MapStub,'./ProcessFlow':FlowStub,'./SceneObjectCard':CardStub,'./exportPlantModel':{downloadPlantGLB(){}}})('App.jsx').default;
  const render=()=>{si=0;ri=0;dependentEffects=[];const tree=App();first=false;return tree;};
  // Execute the App's dependency-bearing effects, including automatic phase
  // camera selection, without starting its browser RAF/keyboard lifecycle.
  const flushStateEffects=()=>{const pending=dependentEffects.slice();dependentEffects=[];for(const effect of pending)effect();return render();};
  const elements=tree=>{const out=[];const visit=node=>{if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(visit);return;}if(node.props){out.push(node);visit(node.props.children);}};visit(tree);return out;};
  const text=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node?.props?text(node.props.children):'';
  const initial=render();refs[2].current.time=time;
  return{states,refs,effects,render,flushStateEffects,elements,text,initial,PlantStub,MapStub,FlowStub,CardStub};
}
check('model selection opens on-site card and closing cannot alter receipt or task clock',()=>{
  const initial=at('cement','unloading',.99),host=appHost('cement',initial.time);
  assert.ok(!host.elements(host.initial).some(node=>node.type===host.CardStub),'quiet default');
  let scene=host.elements(host.initial).find(node=>node.type===host.PlantStub);scene.props.onSelect('cement-c01');
  let tree=host.render(),card=host.elements(tree).find(node=>node.type===host.CardStub);assert.ok(card);assert.equal(card.props.selectedId,'cement-c01');assert.equal(card.props.workflow.stockAdded,0);assert.equal(card.props.workflow.time,initial.time);assert.equal(host.refs[2].current.time,initial.time);
  card.props.onClose();tree=host.render();assert.ok(!host.elements(tree).some(node=>node.type===host.CardStub));scene=host.elements(tree).find(node=>node.type===host.PlantStub);assert.equal(scene.props.selectedId,'cement-c01');assert.equal(scene.props.workflow.stock,initial.stock);assert.equal(scene.props.workflow.receipted,false);
});
check('process focus opens card; paused seeking refreshes fields without creating receipt twice',()=>{
  const initial=at('sand','unloading',.99),host=appHost('sand',initial.time);
  host.elements(host.initial).find(node=>node.type===host.FlowStub).props.onFocus('aggregate-sand');
  let tree=host.render();assert.ok(host.elements(tree).some(node=>node.type===host.CardStub));
  const target=at('sand','tare',.9);host.elements(tree).find(node=>node.type==='input'&&node.props.type==='range').props.onChange({target:{value:String(target.time)}});
  tree=host.render();const card=host.elements(tree).find(node=>node.type===host.CardStub);assert.equal(card.props.workflow.time,target.time);assert.equal(card.props.workflow.stockAdded,SCENARIOS.sand.net);assert.equal(getOperations(card.props.workflow).stocks.find(stock=>stock.id==='sand').added,SCENARIOS.sand.net);assert.equal(host.refs[2].current.time,target.time);
});
check('manual camera control exposes explicit restore without pausing business playback',()=>{
  const state=at('delivery','loading',.5),host=appHost('delivery',state.time);host.states[3]=false;
  let tree=host.render(),scene=host.elements(tree).find(node=>node.type===host.PlantStub);scene.props.onManualControl();tree=host.render();
  const restore=host.elements(tree).find(node=>node.type==='button'&&host.text(node)==='恢复流程跟随');assert.ok(restore);assert.equal(restore.props['aria-pressed'],false);assert.equal(host.states[3],false);assert.equal(host.refs[2].current.time,state.time);
  const previousRequest=host.elements(tree).find(node=>node.type===host.PlantStub).props.followRequest;
  restore.props.onClick();tree=host.render();const following=host.elements(tree).find(node=>node.type==='button'&&host.text(node)==='跟随流程');assert.equal(following.props['aria-pressed'],true);assert.ok(host.elements(tree).find(node=>node.type===host.PlantStub).props.followRequest>previousRequest,'same-view restoration requests a fresh camera preset');
});
check('Escape dismisses on-site card; quality changes leave task state intact',()=>{
  const saved={window:globalThis.window,raf:globalThis.requestAnimationFrame,cancel:globalThis.cancelAnimationFrame},handlers=new Map(),cleanups=[];
  globalThis.window={addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:name=>handlers.delete(name)};globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
  try{const state=at('delivery','outbound',.5),host=appHost('delivery',state.time);for(const effect of host.effects){const cleanup=effect();if(typeof cleanup==='function')cleanups.push(cleanup);}host.elements(host.initial).find(node=>node.type===host.PlantStub).props.onSelect(state.vehicleId);let tree=host.render();assert.ok(host.elements(tree).some(node=>node.type===host.CardStub));handlers.get('keydown')({key:'Escape'});tree=host.render();assert.ok(!host.elements(tree).some(node=>node.type===host.CardStub));const settings=host.elements(tree).find(node=>node.type==='button'&&node.props['aria-label']==='演示与导出设置');settings.props.onClick();tree=host.render();host.elements(tree).find(node=>node.type==='select'&&node.props['aria-label']==='画面质量').props.onChange({target:{value:'low'}});tree=host.render();const scene=host.elements(tree).find(node=>node.type===host.PlantStub);assert.equal(scene.props.quality,'low');assert.equal(scene.props.workflow.time,state.time);assert.equal(scene.props.workflow.scenarioId,'delivery');assert.equal(host.refs[2].current.time,state.time);}finally{cleanups.forEach(fn=>fn());for(const[key,value]of Object.entries({window:saved.window,requestAnimationFrame:saved.raf,cancelAnimationFrame:saved.cancel})){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});
check('internal production targets reveal cutaway and keep the current batch time',()=>{
  const state=at('delivery','production',.41);
  for(const id of ['mixer-m01','aggregate-scale-m01','powder-scale-m01','water-scale-m01','mixer-discharge-m01']){
    const host=appHost('delivery',state.time);
    host.elements(host.initial).find(node=>node.type===host.FlowStub).props.onFocus(id);
    const tree=host.render(),scene=host.elements(tree).find(node=>node.type===host.PlantStub);
    assert.equal(scene.props.view,'detail',id+' must reveal internal mechanisms');
    assert.equal(scene.props.cutaway,true,id+' must not close the shell on focus');
    assert.equal(scene.props.workflow.time,state.time);
    assert.equal(scene.props.selectedId,id);
    assert.ok(host.elements(tree).some(node=>node.type===host.CardStub));
    const detail=entityDetail(id,state);
    assert.notEqual(detail.title,id,'selected child must have a readable title');
    assert.equal(detail.source,'workflow');
  }
});
check('automatic delivery switches return map to wash scene and retains it through completion',()=>{
  const host=appHost('delivery',108.999);
  let tree=host.flushStateEffects(),nodes=host.elements(tree),scene=nodes.find(node=>node.type===host.PlantStub);
  assert.equal(scene.props.workflow.stageName,'return');assert.equal(scene.props.view,'vehicle');assert.equal(scene.props.visible,false);
  assert.ok(nodes.some(node=>node.type===host.MapStub),'return is shown on the transport map');
  for(const [time,phase] of [[109,'wash'],[112.5,'wash'],[116,'complete'],[119,'complete']]){
    nodes.find(node=>node.type==='input'&&node.props.type==='range').props.onChange({target:{value:String(time)}});
    host.render();tree=host.flushStateEffects();nodes=host.elements(tree);scene=nodes.find(node=>node.type===host.PlantStub);
    assert.equal(scene.props.workflow.stageName,phase,'phase boundary at '+time);
    assert.equal(scene.props.view,'wash','wash bay remains in frame at '+time);
    assert.equal(scene.props.visible,true,'3D surface visible at '+time);
    assert.equal(scene.props.cutaway,false);assert.equal(scene.props.focusId,null);
    assert.ok(!nodes.some(node=>node.type===host.MapStub),'transport map leaves screen at '+time);
    assert.equal(scene.props.workflow.time,time);assert.equal(host.refs[2].current.time,time);
    assert.equal(scene.props.workflow.onboardVolume,0);assert.equal(scene.props.workflow.deliveredVolume,12);
    if(time>=112.5)assert.deepEqual(scene.props.workflow.vehiclePosition,[37,VEHICLE_ROAD_Y,14.3],'truck is under the wash gantry');
  }
});
check('manual wash browsing survives phase change and explicit restore requests the live wash view',()=>{
  const host=appHost('delivery',109);
  let tree=host.flushStateEffects(),nodes=host.elements(tree),scene=nodes.find(node=>node.type===host.PlantStub);
  scene.props.onManualControl();tree=host.render();nodes=host.elements(tree);
  nodes.find(node=>node.type==='select'&&node.props['aria-label']==='查看场景').props.onChange({target:{value:'materials'}});
  tree=host.render();nodes=host.elements(tree);
  nodes.find(node=>node.type==='input'&&node.props.type==='range').props.onChange({target:{value:'116'}});
  host.render();tree=host.flushStateEffects();nodes=host.elements(tree);scene=nodes.find(node=>node.type===host.PlantStub);
  assert.equal(scene.props.view,'materials','completion cannot undo manual view');assert.equal(scene.props.workflow.time,116);
  const nonce=scene.props.followRequest;
  nodes.find(node=>node.type==='button'&&host.text(node)==='恢复流程跟随').props.onClick();host.render();
  tree=host.flushStateEffects();nodes=host.elements(tree);scene=nodes.find(node=>node.type===host.PlantStub);
  assert.equal(scene.props.view,'wash');assert.equal(scene.props.visible,true);assert.ok(scene.props.followRequest>nonce);
  assert.equal(scene.props.workflow.time,116);assert.equal(host.refs[2].current.time,116);assert.equal(scene.props.workflow.deliveredVolume,12);
});
check('wash process node focuses the vehicle with wash equipment kept visible',()=>{
  for(const time of [109,112.5,116,119]){
    const host=appHost('delivery',time);
    let tree=host.flushStateEffects(),nodes=host.elements(tree),scene=nodes.find(node=>node.type===host.PlantStub);
    const nonce=scene.props.followRequest,vehicle=scene.props.workflow.vehicleId;
    const flowTree=ProcessFlow({workflow:scene.props.workflow,onFocus:nodes.find(node=>node.type===host.FlowStub).props.onFocus});
    const button=host.elements(flowTree).find(node=>node.type==='button'&&node.props['aria-label']?.startsWith('返站与洗车，'));
    assert.ok(button,'return and wash node is available');button.props.onClick();
    tree=host.render();nodes=host.elements(tree);scene=nodes.find(node=>node.type===host.PlantStub);
    assert.equal(scene.props.view,'wash');assert.equal(scene.props.selectedId,vehicle);assert.equal(scene.props.focusId,null,'whole vehicle framing must not isolate the wash equipment');
    assert.ok(scene.props.followRequest>nonce,'repeating the node must restore current wash framing');
    assert.equal(scene.props.visible,true);assert.ok(nodes.some(node=>node.type===host.CardStub));
    assert.equal(scene.props.workflow.time,time);assert.equal(host.refs[2].current.time,time);
  }
});
console.log(`V6 interaction: ${passed} passed, ${failed} failed`);process.exitCode=failed?1:0;
