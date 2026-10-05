import {SCENARIOS} from './workflow.js';
import {getProductionAssetState} from './assetMotion.js';

// These values are deliberate demo snapshots, not PLC measurements or a live
// plant-wide inventory. Only the currently playing task is dynamic.
export const OPERATIONS_SNAPSHOT = Object.freeze({
  dailyPlan:1500, produced:1080, delivered:960,
  cementC02:42, flyashF02:48,
  source:'snapshot', sourceLabel:'演示快照 · 非实时',
});
const STOCK_CONFIG = [
  {id:'sand',name:'砂',entityId:'aggregate-sand',capacity:400},
  {id:'stone',name:'碎石',entityId:'aggregate-stone',capacity:600},
  {id:'cement',name:'水泥',entityId:'cement-c01',capacity:220},
  {id:'flyash',name:'粉煤灰',entityId:'flyash-f01',capacity:120},
];
const SNAPSHOT_FLEET = Object.freeze([
  {id:'snapshot-mc008',entityId:'snapshot-mc008',vehicleCode:'MC008',task:'DEMO-OUT-008',
    type:'搅拌车',material:'C30 · 示例',target:'东湖住宅工地 · 示例',status:'待调度 · 示例快照',
    quantity:10,unit:'m³',position:null,progress:null,source:'snapshot',sourceLabel:'演示快照 · 非实时'},
  {id:'snapshot-rc025',entityId:'snapshot-rc025',vehicleCode:'RC025',task:'DEMO-IN-025',
    type:'原料车',material:'砂 · 示例',target:'A02-01 砂仓 · 示例',status:'预约到货 · 示例快照',
    quantity:26,unit:'t',position:null,progress:null,source:'snapshot',sourceLabel:'演示快照 · 非实时'},
]);
const NAMES = {
  'mixer-m01':'M01 搅拌主楼','conveyor-b01':'B01 骨料输送带','weighbridge-w01':'W01 进出站地磅',
  'loader-l01':'L01 装载机','cement-c01':'C01 水泥筒仓','cement-c02':'C02 水泥筒仓',
  'flyash-f01':'F01 粉煤灰筒仓','flyash-f02':'F02 粉煤灰筒仓',
  'aggregate-sand':'A02-01 砂仓','aggregate-stone':'A02-03 碎石仓',
  'control-room':'中控操作楼','supplier-yard':'原料厂家','construction-site':'施工工地','pump-p01':'P01 混凝土泵车',
  'automatic-bins':'骨料自动配料仓','aggregate-a02':'砂石储料仓',
  'aggregate-scale-m01':'M01 骨料称量斗','powder-scale-m01':'M01 粉料称量斗',
  'water-scale-m01':'M01 水计量装置','mixer-discharge-m01':'M01 搅拌卸料门',
};
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const amount = value => number(value).toFixed(1);
const select = (targetId,label='查看对象') => ({type:'select',kind:'select',label,targetId});
const isConcrete = state => state.flowKind === 'concrete';
const stageKey = state => state.stageName || state.phase?.key || '';
const phaseLabel = state => state.phase?.label || state.phaseLabel || '等待任务';
const workflowLabel = '当前流程模拟 · 非现场测量';
const taskProgress = state => Math.max(0,Math.min(1,number(state.time)/(number(state.total)||1)));

export function getOperations(state,{faultActive=false,acknowledged=false}={}) {
  const concrete=isConcrete(state),phase=stageKey(state);
  const blocked=Boolean(faultActive&&((concrete&&phase==='production')||(state.flowKind==='aggregate'&&phase==='supply')));
  const productionAdded=concrete&&number(state.productionProgress)>=1?number(state.plannedVolume):0;
  const deliveredAdded=concrete?number(state.deliveredVolume):0;
  const receiptAdded=!concrete&&state.tareMeasured?number(state.stockAdded):0;
  const stocks=STOCK_CONFIG.map(config=>{
    const scenario=SCENARIOS[config.id];
    const dynamic=!concrete&&state.materialKind===config.id;
    const current=dynamic?number(state.stock):number(scenario.initialStock);
    const threshold=config.capacity*.25;
    return {...config,material:config.name,warehouse:scenario.warehouse,unit:'t',current,
      initial:scenario.initialStock,added:dynamic?receiptAdded:0,
      consumed:dynamic?number(state.materialConsumed):0,threshold,
      ratio:Math.max(0,Math.min(1,current/config.capacity)),
      percent:current/config.capacity*100,low:current<threshold,
      source:dynamic?'workflow':'snapshot',sourceLabel:dynamic?workflowLabel:'演示基准快照 · 非实时',
      capacitySource:'演示仓容',thresholdSource:'演示补料阈值 · 仓容的25%',
      action:select(config.entityId,'查看库存')};
  });
  const currentVehicle={
    id:state.vehicleId,entityId:state.vehicleId,vehicleCode:state.vehicleCode,task:state.task,
    type:concrete?'搅拌车':state.flowKind==='powder'?'粉料运输车':'砂石运输车',
    material:state.short,target:state.warehouse,
    status:state.vehicleStatus||phaseLabel(state),workflowStatus:phaseLabel(state),
    quantity:concrete?number(state.onboardVolume):state.netMeasured==null?null:number(state.netMeasured),
    plannedQuantity:concrete?number(state.plannedVolume):number(state.net),unit:concrete?'m³':'t',
    quantityLabel:concrete?'当前车载':state.netMeasured==null?'预计数量 · 未核算':'本车核算净重',
    onboardVolume:concrete?number(state.onboardVolume):null,
    deliveredVolume:concrete?deliveredAdded:null,
    position:Array.isArray(state.vehiclePosition)?[...state.vehiclePosition]:null,
    progress:taskProgress(state),phaseProgress:number(state.stageProgress),
    phase:phaseLabel(state),completed:Boolean(state.completed),source:'workflow',
    sourceLabel:workflowLabel,action:select(state.vehicleId,'查看当前车辆'),
  };
  const fleet=[currentVehicle,...SNAPSHOT_FLEET.map(row=>({...row,action:{type:'snapshot',kind:'snapshot',label:'查看示例任务',targetId:row.id}}))];
  const alerts=[];
  if(faultActive) {
    const confirmed=acknowledged===true||Boolean(acknowledged?.['fault-b01']);
    alerts.push({id:'fault-b01',title:'B01 输送带异常 · 模拟',
      description:blocked?'当前骨料供料或生产已阻断，清除模拟故障后恢复。':'故障保持有效；骨料供料与成品生产将阻断。',
      severity:'high',tone:'red',status:confirmed?'已确认 · 待处理':'待确认',
      acknowledged:confirmed,blocking:blocked,entityId:'conveyor-b01',objectId:'conveyor-b01',
      source:'workflow',sourceLabel:workflowLabel,
      action:confirmed?select('conveyor-b01','查看故障设备'):{type:'acknowledge',kind:'acknowledge',label:'确认模拟异常',targetId:'conveyor-b01',alertId:'fault-b01'},
      nextAction:{type:'clear_fault',kind:'clear_fault',label:'清除模拟故障',targetId:'conveyor-b01'}});
  }
  stocks.filter(stock=>stock.low).forEach(stock=>{
    alerts.push({id:'low-'+stock.id,title:stock.warehouse+'补料提醒',
      description:'当前 '+amount(stock.current)+' t，低于演示阈值 '+amount(stock.threshold)+' t。',
      severity:'medium',tone:'amber',status:'待安排',entityId:stock.entityId,objectId:stock.entityId,
      source:stock.source,sourceLabel:stock.sourceLabel,action:select(stock.entityId,'查看仓位')});
  });
  alerts.push({id:'snapshot-low-c02',title:'C02 补料计划 · 示例快照',
    description:'演示快照 42.0 t，低于示例阈值 55.0 t；不是实时料位告警。',
    severity:'medium',tone:'amber',status:'示例待办',entityId:'cement-c02',objectId:'cement-c02',
    source:'snapshot',sourceLabel:'演示快照 · 非实时',blocking:false,
    action:select('cement-c02','查看示例筒仓')});
  const kpis=[
    {id:'production',label:'今日生产方量',value:OPERATIONS_SNAPSHOT.produced+productionAdded,unit:'m³',
      snapshotValue:OPERATIONS_SNAPSHOT.produced,currentTaskAdded:productionAdded,plan:OPERATIONS_SNAPSHOT.dailyPlan,
      ratio:(OPERATIONS_SNAPSHOT.produced+productionAdded)/OPERATIONS_SNAPSHOT.dailyPlan,
      caption:'演示快照 1,080 + 当前已完成生产任务',source:productionAdded?'snapshot+workflow':'snapshot',sourceLabel:'演示快照 + 当前模拟任务',tone:'blue'},
    {id:'delivery',label:'今日签收方量',value:OPERATIONS_SNAPSHOT.delivered+deliveredAdded,unit:'m³',
      snapshotValue:OPERATIONS_SNAPSHOT.delivered,currentTaskAdded:deliveredAdded,
      caption:'演示快照 960 + 本趟已签收方量',source:deliveredAdded?'snapshot+workflow':'snapshot',sourceLabel:'演示快照 + 当前模拟签收',tone:'green'},
    {id:'current-task',label:'当前流程进度',value:Math.round(taskProgress(state)*100),unit:'%',
      caption:state.vehicleCode+' · '+phaseLabel(state),source:'workflow',sourceLabel:workflowLabel,tone:'blue'},
    {id:'alerts',label:'异常与示例待办',value:alerts.length,unit:'项',
      caption:(faultActive?'1 项模拟设备异常 · ':'')+'含 '+alerts.filter(item=>item.source==='snapshot').length+' 项快照提醒',
      source:'snapshot+workflow',sourceLabel:'模拟异常 / 示例快照',tone:faultActive?'red':'amber'},
  ];
  return {kpis,stocks,fleet,alerts,summary:{
    task:state.task,sourceLabel:workflowLabel,blocked,currentVehicleId:state.vehicleId,
    productionAdded,deliveredAdded,receiptAdded,
    stockScope:'当前任务对应仓位动态，其他仓位为演示快照',
    inventoryConsumptionNote:concrete?'该流程未提供准确原料消耗量，因此未扣减库存。':'本次供料消耗直接来自工作流。',
    plan:OPERATIONS_SNAPSHOT.dailyPlan,
    recipeCode:state.recipeCode||null,recipeApproved:Boolean(state.recipeApproved),
    trialPassed:Boolean(state.trialPassed),trialSource:'方案与试配均为演示，非实际质量检验',
  }};
}

export function entityDetail(selectedId,state,options={}) {
  const operations=getOperations(state,options),concrete=isConcrete(state),phase=stageKey(state);
  const base={id:selectedId,entityId:selectedId,title:NAMES[selectedId]||selectedId,type:'设备 / 区域',
    status:'流程示意',source:'workflow',sourceLabel:workflowLabel,
    task:state.task,fields:[],nextAction:select(state.vehicleId,'查看当前任务车辆')};
  const stock=operations.stocks.find(item=>item.entityId===selectedId);
  if(['aggregate-scale-m01','powder-scale-m01','water-scale-m01','mixer-discharge-m01'].includes(selectedId)){
    const pose=getProductionAssetState(state),aggregate=selectedId==='aggregate-scale-m01',powder=selectedId==='powder-scale-m01',discharge=selectedId==='mixer-discharge-m01';
    const fill=aggregate?pose.aggregateFill:powder?pose.powderFill:null;
    const gate=aggregate?pose.aggregateGate:powder?pose.powderGate:discharge?pose.dischargeGate:null;
    const active=concrete&&(discharge?phase==='loading'&&gate>.001:phase==='production'&&(gate>.001||fill>.001||selectedId==='water-scale-m01'&&state.phaseProgress>=.44&&state.phaseProgress<.63));
    const status=operations.summary.blocked?'供料阻断 · 模拟':active?(discharge?'开门装车 · 模拟':gate>.001?'投料中 · 模拟':'计量中 · 模拟'):'当前阶段待机';
    return {...base,type:discharge?'生产卸料机构':'配料计量机构',status,
      fields:[['关联任务',state.task],['物料',aggregate?'砂 / 碎石':powder?'水泥 / 粉煤灰':discharge?'本批混凝土':'拌合水'],
        [discharge?'闸门姿态':'计量方式',discharge?Math.round(gate*100)+'% · 动画示意':'按演示配方时序，未接称重传感器'],
        ['当前流程',concrete?state.productionStep||phaseLabel(state):'当前为原料供给任务']],
      nextAction:select(discharge?state.vehicleId:'mixer-m01',discharge?'查看装车车辆':'查看搅拌剖视')};
  }
  if(selectedId==='automatic-bins')return {...base,type:'自动下料与集料',status:['production','supply'].includes(phase)&&!options.faultActive?'当前流程下料中':'当前阶段待机',fields:[['下料方式','仓底滑闸 · 自动计量'],['输送去向','水平集料带 → B01 → M01'],['当前任务',state.task]],nextAction:select('conveyor-b01','查看骨料输送')};
  if(selectedId==='aggregate-a02')return {...base,type:'骨料收货与储存',status:'自卸车入仓 · 装载机上料',fields:[['砂库存',amount(operations.stocks[0].current)+' t'],['碎石库存',amount(operations.stocks[1].current)+' t'],['上料去向','骨料自动配料仓'],['库存来源',operations.summary.stockScope]],nextAction:select('loader-l01','查看装载机上料')};
  if(stock)return {...base,title:NAMES[selectedId],type:'原料库存',source:stock.source,sourceLabel:stock.sourceLabel,
    status:stock.low?'低于演示补料阈值':stock.source==='workflow'?(state.receipted?'已模拟入库':'本车尚未入库'):'基准快照',
    fields:[['当前库存',amount(stock.current)+' t'],['演示仓容',amount(stock.capacity)+' t'],
      ['本次入库','+ '+amount(stock.added)+' t'],['本次供料','− '+amount(stock.consumed)+' t'],
      ['关联任务',stock.source==='workflow'?state.task:'当前任务未使用此仓位'],['数据来源',stock.sourceLabel]],
    nextAction:stock.source==='workflow'?select(state.vehicleId,'查看关联收货车辆'):select(stock.entityId,'查看仓位')};
  if(selectedId==='cement-c02'||selectedId==='flyash-f02') {
    const cement=selectedId==='cement-c02',quantity=cement?OPERATIONS_SNAPSHOT.cementC02:OPERATIONS_SNAPSHOT.flyashF02;
    return {...base,type:'粉料库存示例',status:cement?'补料示例提醒':'库存示例快照',source:'snapshot',sourceLabel:'演示快照 · 非实时',
      fields:[['示例库存',amount(quantity)+' t'],['演示仓容',cement?'220.0 t':'120.0 t'],
        ['关联业务',cement?'C02 示例补料计划':'F02 示例储料'],['数据来源','静态演示快照，未接料位传感器']],
      nextAction:{type:'snapshot',kind:'snapshot',label:'查看示例补料计划',targetId:selectedId}};
  }
  if(selectedId===state.vehicleId) {
    const vehicle=operations.fleet[0];
    return {...base,title:vehicle.vehicleCode,type:vehicle.type,status:vehicle.status,
      fields:[['关联任务',state.task],['物料 / 产品',state.short],['目的仓位 / 工地',state.warehouse],
        [concrete?'当前车载':'本车核算净重',concrete?amount(state.onboardVolume)+' m³':state.netMeasured==null?'未复磅核算':amount(state.netMeasured)+' t'],
        ['当前车辆状态',vehicle.status],['当前流程',phaseLabel(state)]],
      nextAction:select(state.targetId,concrete?'查看交付工地':'查看指定仓位')};
  }
  const snapshotVehicle=operations.fleet.find(item=>item.id===selectedId&&item.source==='snapshot');
  if(snapshotVehicle)return {...base,title:snapshotVehicle.vehicleCode,type:'示例运输任务',status:snapshotVehicle.status,
    source:'snapshot',sourceLabel:snapshotVehicle.sourceLabel,
    fields:[['示例任务',snapshotVehicle.task],['物料',snapshotVehicle.material],['目标',snapshotVehicle.target],
      ['预计数量',amount(snapshotVehicle.quantity)+' '+snapshotVehicle.unit],['位置来源','没有实时位置，静态示例快照']],
    nextAction:{type:'snapshot',kind:'snapshot',label:'查看示例任务',targetId:snapshotVehicle.id}};
  if(selectedId==='weighbridge-w01')return {...base,type:'收货计量',status:concrete?'当前配送未使用地磅':state.tareMeasured?'已完成本车复磅':state.grossMeasured?'毛重已记录，等待复磅':'等待重车过磅',
    fields:[['毛重',!concrete&&state.grossMeasured?amount(state.gross)+' t':'尚未计量'],['皮重',!concrete&&state.tareMeasured?amount(state.tare)+' t':'尚未计量'],
      ['净重',!concrete&&state.netMeasured!=null?amount(state.netMeasured)+' t':'复磅后核算'],['计量来源','本地流程模拟，未接真实地磅']],
    nextAction:select(state.vehicleId,'查看称重车辆')};
  if(selectedId==='conveyor-b01')return {...base,type:'骨料输送设备',status:options.faultActive?(operations.summary.blocked?'模拟故障 · 当前供料阻断':'模拟故障 · 待处理'):((concrete&&phase==='production'&&state.phaseProgress>.12&&state.phaseProgress<.44)||(state.flowKind==='aggregate'&&state.binGateOpen?.some(gate=>gate>.001)))?'模拟供料中':'当前阶段待机',
    fields:[['关联主楼','M01 搅拌主楼'],['当前任务',state.task],['当前流程',phaseLabel(state)],
      ['异常确认',options.faultActive?(options.acknowledged?'已确认 · 待处理':'待确认'):'无当前模拟故障']],
    nextAction:options.faultActive?{type:'clear_fault',kind:'clear_fault',label:'清除模拟故障',targetId:selectedId}:select('mixer-m01','查看生产主楼')};
  if(selectedId==='mixer-m01')return {...base,type:'称量与搅拌设备',status:operations.summary.blocked?'模拟供料异常':concrete?(state.productionStep||phaseLabel(state)):'原料供给流程',
    fields:[['示例配方',state.recipeCode||'当前任务未设配方'],['配方确认',concrete?(state.recipeApproved?'模拟已确认':'模拟待确认'):'不适用'],
      ['试配结果',concrete?(state.trialPassed?'演示通过，非质量检验':'演示试配尚未通过'):'不适用'],['当前任务',state.task]],
    nextAction:select('control-room','查看演示配方与试配')};
  if(selectedId==='control-room')return {...base,type:'配方与生产操作',status:concrete?phaseLabel(state):'原料流程监视',
    fields:[['示例配方',state.recipeCode||'未选择生产配方'],['试配结果',concrete?(state.trialPassed?'模拟通过':'尚未模拟通过'):'当前任务不涉及'],
      ['配方确认',state.recipeApproved?'模拟已确认':'尚未模拟确认'],['结果来源','演示方案 / 演示试配，未接 PLC 或实验室']],
    nextAction:select('mixer-m01','查看自动生产设备')};
  if(selectedId==='construction-site'||selectedId==='pump-p01')return {...base,type:selectedId==='pump-p01'?'工地泵送设备':'交付工地',
    status:concrete?(state.delivered?'已模拟签收':phase==='unloading'?'泵送演示中':phase==='queue'?'车辆到达待泵送':'等待本趟交付'):'当前原料任务不涉及工地',
    fields:[['工地','南城建设工地'],['本趟签收',amount(state.deliveredVolume)+' m³'],
      ['关联车辆',concrete?state.vehicleCode:'当前任务不涉及'],['签收来源','流程模拟事件，未接电子签收系统']],
    nextAction:select(concrete?state.vehicleId:'construction-site','查看关联配送车辆')};
  if(selectedId==='loader-l01')return {...base,type:'站内骨料装载',status:state.flowKind==='aggregate'&&['loading','supply'].includes(phase)?phaseLabel(state):'当前阶段待机',
    fields:[['取料仓位',state.flowKind==='aggregate'?state.warehouse:'当前任务不使用装载机'],
      ['当前供料',state.flowKind==='aggregate'?amount(state.materialConsumed)+' t':'当前任务未供料'],['当前任务',state.task],['计量来源','流程模拟，未接车载称重']],
    nextAction:select(state.flowKind==='aggregate'?state.targetId:'aggregate-sand','查看取料仓位')};
  if(selectedId==='supplier-yard')return {...base,type:'原料供应端',status:!concrete?phase==='supplier_loading'?'厂家装车演示中':'原料运输流程':'示例原料厂家',
    fields:[['当前物料',!concrete?state.short:'当前为成品配送'],['供应来源',state.supplier],
      ['关联任务',state.task],['装车记录',!concrete&&state.supplierLoading?'本车装载中 · 模拟':'按当前流程查看']],
    nextAction:select(state.vehicleId,'查看当前运输车辆')};
  return {...base,fields:[['当前任务',state.task],['当前流程',phaseLabel(state)],['数据来源',workflowLabel]]};
}

