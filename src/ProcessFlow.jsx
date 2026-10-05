import React from 'react';
import {getProductionAssetState} from './assetMotion';

const RAW_KEYS=['supplier_loading','arrival','registration','gross','acceptance','to_unload','unloading','return_scale','tare','exit','loading','supply','complete'];
const DELIVERY_KEYS=['mix_design','trial','approval','production','loading','release','outbound','queue','unloading','signature','return','wash','complete'];
const clamp=n=>Math.max(0,Math.min(1,Number(n)||0));
function makeNode(key,label,sub,id,stages){return {key,label,sub,id,stages};}
function ProcessIcon({kind}){
  const common={fill:'none',stroke:'currentColor',strokeWidth:1.4,strokeLinecap:'round',strokeLinejoin:'round'};
  const drawings={source:<><path d="m3 17 6-8 6 8m-7-9h11v9H8"/><path d="M3 19h18m-8-9v5m4-5v5"/></>,truck:<><path d="M3 6h11v11H3Zm11 4h4l3 4v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></>,scale:<><path d="M3 18h18M5 7h14v8H5Z"/><path d="M8 10h8m-8 2h5M5 18v2m14-2v2"/></>,bin:<><path d="M4 5h16v7l-6 5v3h-4v-3l-6-5Z"/><path d="M4 9h16m-8 8v-5"/></>,feed:<><path d="m3 16 16-9 2 3-16 9Z"/><path d="M8 15v5m9-10v10M3 21h19"/></>,silo:<><path d="M6 5Q6 2 12 2t6 3v11l-6 4-6-4Z"/><path d="M6 5q6 3 12 0M8 18v4m8-4v4"/></>,mix:<><path d="M4 5h16v12H4Z"/><path d="M8 9v5m8-5v5M6 11h12m-7 6v4h3v-4"/></>,control:<><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4M6 12l3-3 4 4 5-6"/></>,pump:<><path d="M3 16h12v4H3Zm12 1h6v3h-6M8 16V9l4-5 5 5 4-4"/><circle cx="6" cy="21" r="1.3"/><circle cx="18" cy="21" r="1.3"/></>,wash:<><path d="M4 21V5h16v16M7 13h10v5H7Z"/><path d="M7 7v2m5-2v3m5-3v2M9 18v2m6-2v2"/></>};
  return <svg width="23" height="23" viewBox="0 0 24 24" aria-hidden="true" {...common}>{drawings[kind]||drawings.mix}</svg>;
}
function getNodes(w){
  const concrete=w.flowKind==='concrete',powder=w.flowKind==='powder',target=w.targetId||(w.materialKind==='flyash'?'flyash-f01':powder?'cement-c01':w.materialKind==='stone'?'aggregate-stone':'aggregate-sand');
  if(concrete)return [makeNode('control','配方与试配','中控确认','control-room',['mix_design','trial','approval']),makeNode('mix','配料与搅拌','计量 → 双轴搅拌','mixer-m01',['production']),makeNode('truck','装车与放行','装料 → 发运校验',w.vehicleId||'truck-mc012',['loading','release']),makeNode('transport','站外运输','送达指定工地',w.vehicleId||'truck-mc012',['outbound']),makeNode('pump','泵送与签收','待泵 → 卸料 → 签收','pump-p01',['queue','unloading','signature']),makeNode('wash','返站与洗车','空车回站待命',w.vehicleId||'truck-mc012',['return','wash','complete'])];
  return [makeNode('source','厂家装料',powder?'粉料灌装':'砂石装载','supplier-yard',['supplier_loading']),makeNode('transport','运输与登记','到站 → 进场',w.vehicleId||'raw-rc020',['arrival','registration']),makeNode('scale','过磅与验收','毛重 · 仓位确认','weighbridge-w01',['gross','acceptance','to_unload']),makeNode(powder?'silo':'bin',powder?'气力入仓':'分仓卸料',w.warehouse||'指定仓位',target,['unloading']),makeNode('receipt','复磅与入库','皮重 → 净重 → 入库','weighbridge-w01',['return_scale','tare','exit']),makeNode('feed',powder?'螺旋计量供料':'装载与自动供料',powder?'筒仓 → 螺旋 → 称量':'料仓 → 配料仓 → 皮带',powder?(w.screwEntityId||target):'loader-l01',['loading','supply']),makeNode('mix','生产端就绪',powder?'粉料称量完成':'骨料进入主楼','mixer-m01',['complete'])];
}
export function getMaterialFlowState(workflow={},blocked=false){
  const concrete=workflow.flowKind==='concrete',production=concrete&&workflow.stageName==='production',p=clamp(workflow.phaseProgress??workflow.stageProgress);
  const supplied=workflow.materialFlow||{};
  return {
    aggregate:!blocked&&(supplied.aggregate??(production?p>.12&&p<.44:workflow.flowKind==='aggregate'&&workflow.binGateOpen?.some(gate=>gate>.001))),
    powder:!blocked&&(supplied.powder??(production?p>=.22&&p<.44:workflow.flowKind==='powder'&&workflow.powderSupplyActive)),
    water:!blocked&&(supplied.water??(production&&p>=.44&&p<.63)),
    admixture:!blocked&&(supplied.admixture??(production&&p>=.44&&p<.63)),
  };
}
function MaterialBranch({workflow,onFocus,blocked}){
  const concrete=workflow.flowKind==='concrete',powder=workflow.flowKind==='powder',flows=getMaterialFlowState(workflow,blocked),active=Object.values(flows).some(Boolean),sandTarget=workflow.materialKind==='stone'?'aggregate-stone':'aggregate-sand',powderTarget=workflow.materialKind==='flyash'?'flyash-f01':'cement-c01';
  const chip=(label,id,live=false)=><button type="button" data-entity-id={id} className={'v5-material-chip'+(live?' is-flowing':'')} onClick={()=>onFocus?.(id)}>{label}</button>;
  const arrow=<span className="v5-flow-arrow">→</span>;
  const path=(kind,label,children)=><div data-material={kind} data-flowing={Boolean(flows[kind])} className={'v5-material-path v6-material-path'+(flows[kind]?' is-flowing':'')}><span className={'v5-material-kind '+(kind==='aggregate'?'aggregate':kind==='powder'?'powder':'v6-material-kind-'+kind)}>{label}</span>{children}</div>;
  return <div className={'v5-material-branches'+(active?' is-active':'')} data-branch-count={concrete?4:1} aria-label="生产物料输送关系">
    {(!powder||concrete)&&path('aggregate','骨料',<>{concrete?<>{chip('砂仓','aggregate-sand',flows.aggregate)}<span>/</span>{chip('石仓','aggregate-stone',flows.aggregate)}</>:chip('砂石仓',sandTarget,flows.aggregate)}{arrow}{chip('自动配料仓','automatic-bins',flows.aggregate)}{arrow}{chip('皮带','conveyor-b01',flows.aggregate)}{arrow}{chip('骨料称量',workflow.aggregateWeighingEntityId||workflow.weighingEntityId||'aggregate-scale-m01',flows.aggregate)}</>)}
    {(powder||concrete)&&path('powder','粉料',<>{concrete?<>{chip('水泥仓','cement-c01',flows.powder)}<span>/</span>{chip('粉煤灰仓','flyash-f01',flows.powder)}</>:chip((workflow.short||'粉料')+'筒仓',powderTarget,flows.powder)}{arrow}{chip('螺旋输送',workflow.screwEntityId||powderTarget,flows.powder)}{arrow}{chip('粉料称量',workflow.powderWeighingEntityId||workflow.weighingEntityId||'powder-scale-m01',flows.powder)}</>)}
    {concrete&&path('water','水',<>{chip('用水系统',workflow.waterEntityId||'water-scale-m01',flows.water)}{arrow}{chip('水计量 · 模拟',workflow.waterWeighingEntityId||'water-scale-m01',flows.water)}</>)}
    {concrete&&path('admixture','外加剂',<>{chip('外加剂系统',workflow.admixtureEntityId||'mixer-m01',flows.admixture)}{arrow}{chip('外加剂计量 · 模拟',workflow.admixtureWeighingEntityId||'mixer-m01',flows.admixture)}</>)}
    <button type="button" className={'v5-material-merge'+(active?' is-flowing':'')} onClick={()=>onFocus?.('mixer-m01')}><ProcessIcon kind="mix"/><span>汇入主楼<strong>双轴搅拌</strong></span><span>›</span></button>
  </div>;
}

export function getProductionSteps(workflow={},blocked=false){
  if(workflow.flowKind!=='concrete')return [];
  const phase=workflow.stageName,p=clamp(workflow.phaseProgress??workflow.stageProgress),pose=getProductionAssetState(workflow);
  const keys=['metering','charging','mixing','opening','loading'];
  let current=-1;
  if(phase==='production')current=p<.3?0:p<.63?1:2;
  if(phase==='loading')current=p<.07?3:4;
  const productionIndex=workflow.stages?.find(stage=>stage.key==='production')?.index??3,after=(workflow.stageIndex??-1)>productionIndex+1;
  const descriptions=['骨料 / 粉料独立计量','称量斗放料 · 水与外加剂计量','双轴搅拌 · 形成当前批次',pose.dischargeGate>0?'卸料门开启':'准备打开卸料门','装车量随车载方量增长'];
  return keys.map((key,index)=>({key,label:['计量','投料','搅拌','开门','装车'][index],description:descriptions[index],id:index===4?workflow.vehicleId||'truck-mc012':index===3?'mixer-discharge-m01':'mixer-m01',status:after||index<current?'done':index===current?(blocked?'blocked':'active'):'pending'}));
}
function ProductionSteps({workflow,onFocus,blocked}){
  const steps=getProductionSteps(workflow,blocked);
  if(!steps.length)return null;
  return <div className="v6-production-steps" aria-label="当前批次生产副步骤"><strong>{workflow.batchId||'本批模拟'} · 生产细节</strong>{steps.map(step=><button key={step.key} type="button" data-production-step={step.key} data-status={step.status} className={'v6-production-step '+(step.status==='active'?'is-active':step.status==='done'?'is-done':'')} title={step.description} aria-label={step.label+'，'+({active:'当前作业',done:'已完成',pending:'待执行',blocked:'故障阻断'}[step.status])+'，'+step.description} onClick={()=>onFocus?.(step.id)}><i>{step.status==='done'?'✓':'›'}</i>{step.label}</button>)}{blocked&&<span className="v6-process-blocked">B01 阻断 · 清除后继续</span>}</div>;
}
export default function ProcessFlow({workflow={},onFocus,paused=false,blocked=false}){
  const nodes=getNodes(workflow),keys=workflow.flowKind==='concrete'?DELIVERY_KEYS:RAW_KEYS,stageName=workflow.stageName||workflow.phase?.key||(typeof workflow.phase==='string'?workflow.phase:''),phaseIndex=keys.indexOf(stageName),activeIndex=nodes.findIndex(n=>n.stages.includes(stageName)),progress=clamp(workflow.phaseProgress??workflow.stageProgress),activeNode=nodes[Math.max(0,activeIndex)],done=!!workflow.completed;
  const hasProgress=Number.isFinite(Number(workflow.time));
  return <section data-paused={paused} className={'v5-process-flow '+(workflow.flowKind==='powder'?'is-powder':workflow.flowKind==='concrete'?'is-concrete':'is-aggregate')} aria-label="当前任务工艺与业务流程">
    <div className="v5-process-heading"><div><strong>{workflow.flowKind==='concrete'?'生产与交付流程':'原料入库与供料流程'}</strong><span>点击节点，查看作业位置</span></div><span className={'v5-process-stage'+(done?' is-complete':'')}><i/>{workflow.phaseLabel||activeNode?.label||'待命'}</span></div>
    <ol className="v5-process-chain" style={{'--v5-node-count':nodes.length}}>{nodes.map((node,i)=>{
      const startIndex=keys.indexOf(node.stages[0]),endIndex=Math.max(...node.stages.map(key=>keys.indexOf(key))),finished=done||(phaseIndex>endIndex&&endIndex>=0),active=i===activeIndex&&!done,status=finished?'已完成':active?'当前作业':'待执行';
      const first=workflow.stages?.find(s=>s.key===node.stages[0]),last=workflow.stages?.find(s=>s.key===node.stages.at(-1));
      const nodeProgress=first&&last&&hasProgress?clamp((workflow.time-first.start)/(last.end-first.start||1)):clamp((phaseIndex-startIndex+progress)/(endIndex-startIndex+1));
      const step=active?nodeProgress:finished?1:0,kind=node.key==='transport'?'truck':node.key==='receipt'?'scale':node.key;
      const liveSub=active&&node.key==='feed'&&workflow.flowKind==='aggregate'?workflow.loaderActionLabel:active&&node.key==='silo'&&workflow.flowKind==='powder'?workflow.powderActionLabel:active&&node.key==='mix'&&workflow.flowKind==='concrete'?workflow.productionStep:null;
      return <li key={node.key} className={'v5-process-step'+(finished?' is-done':'')+(active?' is-active':'')}><button type="button" className="v5-process-node" aria-current={active?'step':undefined} aria-label={node.label+'，'+status+'，定位作业'} onClick={()=>onFocus?.(node.id)}><span className="v5-process-symbol"><ProcessIcon kind={kind}/>{finished&&<span className="v5-process-check">✓</span>}</span><strong>{node.label}</strong><small>{liveSub||node.sub}</small><span className="v5-node-progress" aria-hidden="true"><i style={{width:step*100+'%'}}/></span></button>{i<nodes.length-1&&<span className="v5-process-connector" aria-hidden="true"><i/><b>›</b></span>}</li>;
    })}</ol>
    <ProductionSteps {...{workflow,onFocus,blocked}}/>
    <MaterialBranch {...{workflow,onFocus,blocked}}/>
    <div className="v5-process-note"><span>{workflow.task||'当前模拟任务'}</span><span>{workflow.flowKind==='concrete'?(workflow.delivered?'已生成签收记录，返站保留交付结果':'工地到达与签收分别记录'):workflow.receipted?'已复磅确认净重并入库':'卸料完成后，仍须复磅确认入库'}</span></div>
  </section>;
}

