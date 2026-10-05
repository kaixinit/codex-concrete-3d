import {smooth,roundedPath,linePath,cubicPath,joinPaths,samplePath,sampleJourney,journeyLength,pathPoints,loaderMotion,dumpMotion,powderMotion} from './workflowMotion.js';
import {WEIGHBRIDGE_LAYOUT,ENTRY_BARRIER_Z,ENTRY_QUEUE_Z,VEHICLE_ROAD_Y,WEST_LANE_X,AGGREGATE_BIN_X} from './stationLayout.js';
const clamp=(v,min=0,max=1)=>Math.min(max,Math.max(min,v));
const lerp=(a,b,t)=>a+(b-a)*t;
export const STATION_GATE=[-25,0,24];
export const SCALE=WEIGHBRIDGE_LAYOUT.center;
export const SITE_STOP=[100,0,98];
export const OUTBOUND_ROUTE=[[10.3,0,3],[24,0,3],[24,0,14.3],[-25,0,14.3],STATION_GATE,[-25,0,60],[100,0,60],SITE_STOP];
export const INBOUND_ROUTE=[[-82,0,60],[-25,0,60],[-25,0,ENTRY_QUEUE_Z],[-25,0,ENTRY_BARRIER_Z],SCALE];

const rawStages=[
  ['supplier_loading','厂家装车',8,'在原料厂家装载砂石或灌装粉料，装满后同一车辆运输到站。'],
  ['arrival','原料运输到站',10,'同一辆原料车从供应端驶向搅拌站入口。'],
  ['registration','进场登记',4,'登记物料、运输任务与车牌，入口道闸放行。'],
  ['gross','重车过磅',6,'满载车辆停上地磅，记录毛重；此时尚无本车净重。'],
  ['acceptance','验收与仓位确认',5,'模拟验收合格，核对物料并指定砂仓、石仓或粉料筒仓。'],
  ['to_unload','驶向指定卸料位',14,'车辆按圆角路线行驶，砂石车倒车对位；停车朝向连续。'],
  ['unloading','卸料入仓',12,'砂石车举升车厢卸料；粉料车连接指定筒仓气力卸料。'],
  ['return_scale','空车返回地磅',10,'卸料完成后回到地磅，账面库存尚未确认增加。'],
  ['tare','空车复磅与入库',6,'记录皮重，以毛重减皮重核算本车净重，生成一次入库记录。'],
  ['exit','原料车离站',9,'同一车辆离开站区，入库记录与仓位库存同步。'],
  ['loading','装载机取料',14,'装载机接近料堆、铲取、收斗并倒车退出；每个机械动作由同一演示时钟驱动。'],
  ['supply','装载与生产供料',24,'装载机转向运输、举臂卸斗、空斗退让并返回；卸斗量同步扣减库存和增加配料仓。'],
  ['complete','本次流程完成',3,'展示入库、库存和供料结果，演示结束后停止播放。'],
];
const deliveryStages=[
  ['mix_design','控制室配合比设定',8,'操作员选择 DEMO-C30 示例配方，并核对本次生产任务。'],
  ['trial','试配预演',9,'操作员进行模拟试配与读数核对，完成后可确认生产。'],
  ['approval','配方确认',5,'确认本次模拟配方与设备就绪状态，允许自动生产。'],
  ['production','自动配料与搅拌',10,'仓底自动下料、皮带输送、粉料螺旋计量与主楼双轴搅拌联动。'],
  ['loading','搅拌车装料',9,'MC012 在主楼装车口接料，车载方量从 0 增加至 12 m³。'],
  ['release','发运校验与出站',8,'核对工地、配合比和装载方量，车辆驶出站门。'],
  ['outbound','站外运输',18,'同一辆 MC012 沿站外模拟道路驶向南城建设工地。'],
  ['queue','工地到达与待泵送',6,'车辆进入指定泵送停车位，到达事件不会直接生成签收。'],
  ['unloading','泵送与浇筑',12,'搅拌车溜槽对接泵车接料斗，泵管向施工楼层输送混凝土。'],
  ['signature','卸料完成与签收',6,'卸料完成后确认模拟签收 12 m³，生成交付记录。'],
  ['return','空车返站',18,'同一辆 MC012 沿返程道路回到搅拌站，交付量保留。'],
  ['wash','返站洗车与待命',7,'空车进入洗车区，完成本趟任务并等待下次调度。'],
  ['complete','配送闭环完成',3,'生产、装车、站外运输、工地卸料、签收和返站形成一趟闭环。'],
];
const powderStages=rawStages.map(stage=>stage[0]==='loading'?['loading','筒仓供料就绪',6,'复磅入库后确认指定筒仓可用，粉料车已经离站。']:stage[0]==='supply'?['supply','螺旋计量供料',9,'输送准备、螺旋计量供料、停止清空；供料进度同步扣减库存。']:stage);

function stagesWithTimes(definition){let start=0;return definition.map(([key,label,duration,description],index)=>{const stage={key,label,duration,description,index,start,end:start+duration};start+=duration;return stage;});}
export const SCENARIOS={
  sand:{id:'sand',label:'砂 · 运输入库与供料',short:'砂',flowKind:'aggregate',materialKind:'sand',vehicleId:'raw-rc020',vehicleCode:'RC020',task:'IN-SAND-020',warehouse:'A02-01 砂仓',targetId:'aggregate-sand',supplier:'砂石供应场 · 模拟',net:28.4,tare:14.2,initialStock:238,feed:6,unload:[-23.4,0,1],stages:stagesWithTimes(rawStages)},
  stone:{id:'stone',label:'石 · 运输入库与供料',short:'碎石',flowKind:'aggregate',materialKind:'stone',vehicleId:'raw-rc022',vehicleCode:'RC022',task:'IN-STONE-022',warehouse:'A02-03 碎石仓',targetId:'aggregate-stone',supplier:'砂石供应场 · 模拟',net:30.2,tare:14.8,initialStock:360,feed:7,unload:[-9.8,0,1],stages:stagesWithTimes(rawStages)},
  cement:{id:'cement',label:'水泥 · 气力卸料入库',short:'水泥',flowKind:'powder',materialKind:'cement',vehicleId:'raw-rc018',vehicleCode:'RC018',task:'IN-CEMENT-018',warehouse:'C01 水泥筒仓',targetId:'cement-c01',supplier:'粉料供应场 · 模拟',net:32.6,tare:14.2,initialStock:145,feed:2.4,unload:[3.1,0,-15.4],stages:stagesWithTimes(powderStages)},
  flyash:{id:'flyash',label:'粉煤灰 · 气力卸料入库',short:'粉煤灰',flowKind:'powder',materialKind:'flyash',vehicleId:'raw-rc021',vehicleCode:'RC021',task:'IN-ASH-021',warehouse:'F01 粉煤灰筒仓',targetId:'flyash-f01',supplier:'粉料供应场 · 模拟',net:30,tare:13.8,initialStock:86.4,feed:1.2,unload:[11.1,0,-15.4],stages:stagesWithTimes(powderStages)},
  delivery:{id:'delivery',label:'混凝土 · 配送到工地',short:'C30 混凝土',flowKind:'concrete',materialKind:'concrete',vehicleId:'truck-mc012',vehicleCode:'MC012',task:'OUT-CONCRETE-012',warehouse:'南城建设工地',targetId:'construction-site',supplier:'一号搅拌站',plannedVolume:12,stages:stagesWithTimes(deliveryStages)},
};
export function getScenario(id){return SCENARIOS[id]||SCENARIOS.sand;}
export function totalTime(id){return getScenario(id).stages.at(-1).end;}
export function getRawUnloadRoute(scenario){
  // The displayed trace uses the same paths as the full vehicle journey.
  // Keep enough curve samples to show its forecourt turn without drawing all
  // 120 geometry samples for every static route segment.
  return journeysFor(scenario).to_unload.flatMap((part,index)=>{
    const points=pathPoints(part.path);
    return points.filter((_,i)=>i===points.length-1||i%12===0).slice(index?1:0);
  });
}

const routeCache=new Map(),journeyCache=new Map();
const TURN_RADIUS=6,FORECOURT_CLEAR_Z=10.8,FORECOURT_NORTH_Z=FORECOURT_CLEAR_Z-TURN_RADIUS;
const lastPoint=path=>path.table.at(-1).position;
// Clockwise road turns are positive; the rendered Three.js yaw has the
// opposite sign. Cubic arcs preserve the endpoint tangent at each junction.
function roadTurn(start,yaw,turn,radius=TURN_RADIUS){
  const paths=[],count=Math.ceil(Math.abs(turn)/(Math.PI/2)),step=turn/count;
  let point=start,heading=-yaw;
  for(let i=0;i<count;i++){
    const side=Math.sign(step),center=[point[0]-Math.sin(heading)*radius*side,0,point[2]+Math.cos(heading)*radius*side];
    const dx=point[0]-center[0],dz=point[2]-center[2],end=[center[0]+dx*Math.cos(step)-dz*Math.sin(step),0,center[2]+dx*Math.sin(step)+dz*Math.cos(step)];
    const handle=radius*4/3*Math.tan(Math.abs(step)/4),next=heading+step;
    paths.push(cubicPath(point,[point[0]+Math.cos(heading)*handle,0,point[2]+Math.sin(heading)*handle],[end[0]-Math.cos(next)*handle,0,end[2]-Math.sin(next)*handle],end));
    point=end;heading=next;
  }
  return joinPaths(...paths);
}
function roadShift(start,yaw,lateral,radius=TURN_RADIUS){
  // Two opposing arcs shift lanes without a heading discontinuity.
  const angle=Math.acos(1-Math.abs(lateral)/(2*radius)),turn=Math.sign(lateral)*angle;
  const first=roadTurn(start,yaw,turn,radius),second=roadTurn(lastPoint(first),yaw-turn,-turn,radius);
  return joinPaths(first,second);
}
export function positionAlongRoute(points,progress){
  if(points.length===1)return{position:[...points[0]],yaw:0,steer:0,distance:0};
  const key=JSON.stringify(points);
  if(!routeCache.has(key))routeCache.set(key,roundedPath(points));
  return samplePath(routeCache.get(key),progress);
}

function journeysFor(scenario){
  if(journeyCache.has(scenario.id))return journeyCache.get(scenario.id);
  const forward=path=>({path}),backward=path=>({path,reverse:true});
  let journeys;
  if(scenario.flowKind==='concrete'){
    const outside=joinPaths(roundedPath([STATION_GATE,[-25,0,60],[100,0,60],[100,0,82]],4),cubicPath([100,0,82],[100,0,93],[108,0,98],SITE_STOP));
    const returning=joinPaths(cubicPath(SITE_STOP,[91,0,98],[110,0,60],[100,0,60]),roundedPath([[100,0,60],[-25,0,60],STATION_GATE],4));
    journeys={release:[forward(roundedPath(OUTBOUND_ROUTE.slice(0,5),3))],outbound:[forward(outside)],return:[forward(returning)],wash:[forward(roundedPath([STATION_GATE,[-25,0,14.3],[24,0,14.3],[37,0,14.3]],3))]};
  }else{
    const bayX=scenario.unload[0],powder=scenario.flowKind==='powder';
    const registration=[SCALE[0],0,ENTRY_QUEUE_Z],clear=[SCALE[0],0,FORECOURT_CLEAR_Z],bayClear=[bayX,0,FORECOURT_CLEAR_Z];
    const arrivalTurn=roadTurn([-31,0,60],0,-Math.PI/2),arrival=joinPaths(linePath([-82,0,60],[-31,0,60]),arrivalTurn,linePath(lastPoint(arrivalTurn),registration));
    const northExit=linePath(SCALE,clear),eastTurn=roadTurn(clear,Math.PI/2,Math.PI/2);
    let toUnload,returnScale;
    if(powder){
      // A western bypass goes around the aggregate building. The former X=-25
      // side road ran through that building's footprint.
      const westernShift=roadShift(clear,Math.PI/2,-(SCALE[0]-WEST_LANE_X));
      const northWest=[WEST_LANE_X,0,-11.5],northTurn=roadTurn(northWest,Math.PI/2,Math.PI/2);
      const northShiftStartX=bayX-2*TURN_RADIUS*Math.sin(Math.acos(1-2.1/(2*TURN_RADIUS)));
      const parkingShift=roadShift([northShiftStartX,0,-17.5],0,2.1);
      toUnload=joinPaths(northExit,westernShift,linePath(lastPoint(westernShift),northWest),northTurn,linePath(lastPoint(northTurn),[northShiftStartX,0,-17.5]),parkingShift);
      const leaveParking=roadShift(scenario.unload,0,-2.1),northEast=[18,0,-17.5],eastDown=roadTurn(northEast,0,Math.PI/2);
      const eastSouth=[24,0,8.3],frontTurn=roadTurn(eastSouth,-Math.PI/2,Math.PI/2);
      // The long tanker's rear corners need extra room during the return
      // S turn. Using the outbound forecourt row here sweeps its tail through
      // the first automatic bin even though its centreline is clear.
      const returnNorthZ=6.6,crossShiftWidth=2*TURN_RADIUS*Math.sin(Math.acos(1-(14.3-returnNorthZ)/(2*TURN_RADIUS)));
      const frontShiftStart=[lastPoint(eastTurn)[0]+crossShiftWidth,0,14.3],frontShift=roadShift(frontShiftStart,Math.PI,14.3-returnNorthZ);
      const bridgeApproach=roadTurn(lastPoint(frontShift),Math.PI,-Math.PI/2);
      returnScale=joinPaths(leaveParking,linePath(lastPoint(leaveParking),northEast),eastDown,linePath(lastPoint(eastDown),eastSouth),frontTurn,linePath(lastPoint(frontTurn),frontShiftStart),frontShift,bridgeApproach,linePath(lastPoint(bridgeApproach),SCALE));
    }else{
      let dock;
      if(scenario.materialKind==='sand'){
        // Drive into the open staging forecourt, then reverse through one
        // broad quarter turn to the bay instead of circulating 450 degrees.
        const stagingShift=roadShift(lastPoint(eastTurn),0,16-FORECOURT_NORTH_Z),staging=lastPoint(stagingShift);
        dock=joinPaths(northExit,eastTurn,stagingShift);
        const reverseTurnStart=[bayX+TURN_RADIUS,0,staging[2]],reverseTurn=roadTurn(reverseTurnStart,Math.PI,Math.PI/2);
        toUnload=[forward(dock),backward(joinPaths(linePath(staging,reverseTurnStart),reverseTurn,linePath(lastPoint(reverseTurn),scenario.unload)))];
        const departure=[bayX,0,FORECOURT_NORTH_Z],bridgeShift=roadShift(departure,-Math.PI/2,bayX-SCALE[0]);
        returnScale=joinPaths(linePath(scenario.unload,departure),bridgeShift,linePath(lastPoint(bridgeShift),SCALE));
      }else{
        const dockStart=[bayX-TURN_RADIUS,0,FORECOURT_NORTH_Z],dockTurn=roadTurn(dockStart,0,Math.PI/2);
        dock=joinPaths(northExit,eastTurn,linePath(lastPoint(eastTurn),dockStart),dockTurn);
        const departure=[bayX,0,FORECOURT_NORTH_Z],frontTurn=roadTurn(departure,-Math.PI/2,Math.PI/2),bridgeTurnStart=[lastPoint(eastTurn)[0],0,lastPoint(frontTurn)[2]],bridgeTurn=roadTurn(bridgeTurnStart,Math.PI,-Math.PI/2);
        returnScale=joinPaths(linePath(scenario.unload,departure),frontTurn,linePath(lastPoint(frontTurn),bridgeTurnStart),bridgeTurn,linePath(lastPoint(bridgeTurn),SCALE));
      }
      // Only this final manoeuvre is reversed: tail first into the assigned
      // stock bay. Arrival, both weighing passes and exit stay forward.
      if(!toUnload)toUnload=[forward(dock),backward(linePath(bayClear,scenario.unload))];
    }
    const exitTurn=roadTurn([SCALE[0],0,54],-Math.PI/2,Math.PI/2),exit=joinPaths(linePath(SCALE,[SCALE[0],0,54]),exitTurn,linePath(lastPoint(exitTurn),[-82,0,60]));
    journeys={
      arrival:[forward(arrival)],
      gross:[forward(linePath(registration,SCALE))],
      to_unload:powder?[forward(toUnload)]:toUnload,
      return_scale:[forward(returnScale)],
      exit:[forward(exit)],
    };
  }
  journeyCache.set(scenario.id,journeys);return journeys;
}

function vehicleMotion(scenario,phase,progress){
  const journeys=journeysFor(scenario);
  let pose={position:scenario.flowKind==='concrete'?OUTBOUND_ROUTE[0]:[-82,0,60],yaw:0,steer:0,distance:0,wheelTravel:0,trace:[]};
  let distance=0,wheelTravel=0,completed=[],stagePoints=[];
  for(const stage of scenario.stages){
    const parts=journeys[stage.key];
    if(!parts)continue;
    if(stage.index>phase.index)break;
    const fraction=stage.index===phase.index?(stage.key==='gross'?clamp(progress/.45):stage.key==='wash'?clamp(progress/.5):progress):1;
    const next=sampleJourney(parts,fraction,pose.yaw);
    pose=next;stagePoints=parts.flatMap(part=>pathPoints(part.path));
    if(stage.index===phase.index){completed.push(...next.trace);distance+=next.distance;wheelTravel+=next.wheelTravel;break;}
    completed.push(...next.trace);distance+=journeyLength(parts);wheelTravel+=parts.reduce((sum,part)=>sum+(part.reverse?-1:1)*part.path.length,0);
  }
  if(!completed.length)completed=[pose.position];
  const raise=point=>[point[0],VEHICLE_ROAD_Y,point[2]];
  return{vehiclePosition:raise(pose.position),vehicleYaw:pose.yaw,vehicleSteer:pose.steer,vehicleDistance:distance,vehicleWheelTravel:wheelTravel,completedRoutePoints:completed.map(raise),stageRoutePoints:stagePoints.map(raise),stageRouteProgress:progress};
}

export function getWorkflowState(scenarioId,time){
  const scenario=getScenario(scenarioId),total=totalTime(scenarioId),t=clamp(time,0,total);
  const phase=scenario.stages.find(stage=>t<stage.end)||scenario.stages.at(-1);
  const index=phase.index-(scenario.flowKind==='concrete'?3:1),p=clamp((t-phase.start)/phase.duration),elapsed=t-phase.start;
  const motion=vehicleMotion(scenario,phase,p);
  const base={...scenario,scenarioId:scenario.id,time:t,total,phase,phaseLabel:phase.label,stageName:phase.key,stageIndex:phase.index,stageProgress:p,phaseProgress:p,completed:t>=total,...motion,vehicleFill:1,tip:0,...loaderMotion(0,0,'idle',0,0),unloading:phase.key==='unloading',receipted:false,delivered:false,routePoints:INBOUND_ROUTE,powderStage:'idle',powderConnectionProgress:0,powderFlowProgress:0,powderFlowActive:false,powderSupplyProgress:0,powderSupplyActive:false,dumpStage:'idle',dumpFlowActive:false,dumpFlowProgress:0};
  if(scenario.flowKind==='concrete'){
    const fill=index<=0?0:index===1?smooth(p):index<5?1:index===5?1-smooth(p):0;
    const delivered=index>6||(index===6&&p>=.6);
    const vehicleStatus=index<0?'配方准备 · 空车待命':['装车待命','装料中','出站放行','站外运输','工地待泵送','泵送卸料',delivered?'已签收':'待签收','空车返站','洗车待命','配送完成'][index];
    const trialPassed=index>-2||(index===-2&&p>=.78),recipeApproved=index>=0||(index===-1&&p>=.78),productionProgress=index<0?0:index===0?p:1;
    const productionStep=index!==0?(index<0?'等待配方确认':'本批生产完成'):p<.22?'骨料自动称量':p<.44?'皮带与粉料计量':p<.63?'水与外加剂计量':'双轴搅拌';
    const gate=index===0?smooth(p/.08)*(1-smooth((p-.22)/.06)):0;
    return{...base,vehicleStatus,trialPassed,recipeApproved,recipeCode:'DEMO-C30',trialProgress:index<-2?0:index===-2?p:1,productionProgress,productionStep,vehicleFill:fill,delivered,deliveredVolume:delivered?12:0,onboardVolume:fill*12,routePoints:OUTBOUND_ROUTE,unloadProgress:index>5?1:index===5?smooth(p):0,routeProgress:index<3?0:index===3?p:1,isReturning:index===7,receipted:false,aggregateBinFill:[.55-.12*productionProgress,.55-.12*productionProgress,.55-.12*productionProgress,.55-.12*productionProgress],binGateOpen:[gate,gate,gate,gate]};
  }
  const isPowder=scenario.flowKind==='powder',bayX=scenario.unload[0],binX=AGGREGATE_BIN_X[scenario.materialKind==='stone'?2:0];
  const grossMeasured=index>2||(index===2&&p>=.55),tareMeasured=index>7||(index===7&&p>=.6);
  const dumping=dumpMotion(p,index===5,index>5),powder=powderMotion(p,index===5,index>5);
  const unloadProgress=isPowder?powder.powderFlowProgress:dumping.dumpFlowProgress;
  const loader=isPowder?loaderMotion(0,0,'idle',0,0):loaderMotion(bayX,binX,phase.key,elapsed,scenario.feed);
  const powderSupplyProgress=index<10?0:index===10?smooth((p-.15)/.7):1;
  const feedProgress=isPowder?powderSupplyProgress:loader.loaderTransferProgress;
  const materialConsumed=scenario.feed*feedProgress;
  const stock=scenario.initialStock+(tareMeasured?scenario.net:0)-materialConsumed;
  const binIndex=scenario.materialKind==='stone'?2:0,binFill=[.55,.55,.55,.55],gates=[0,0,0,0];
  const aggregateBinDischarged=isPowder?0:Math.min(loader.aggregateBinAdded,scenario.feed*(index<10?0:index===10?smooth((elapsed-10)/14):1));
  if(!isPowder){binFill[binIndex]=.55+(loader.aggregateBinAdded-aggregateBinDischarged)/20;gates[binIndex]=index===10?smooth((elapsed-10)/1)*(1-smooth((elapsed-22)/2)):0;}
  return{...base,...loader,...(isPowder?powder:dumping),vehicleStatus:index>=9?'已离站':phase.label,supplierLoading:index<0,sourceLoadProgress:index<0?smooth(p):1,supplierVehiclePosition:[-82,VEHICLE_ROAD_Y,60],vehicleFill:index<0?smooth(p):1-unloadProgress,tip:isPowder?0:dumping.tip,receipted:tareMeasured,grossMeasured,tareMeasured,gross:scenario.tare+scenario.net,netMeasured:tareMeasured?scenario.net:null,stock,warehousePhysicalStock:scenario.initialStock+scenario.net*unloadProgress-materialConsumed,unloadProgress,feedProgress,stockAdded:tareMeasured?scenario.net:0,materialConsumed,routePoints:[...INBOUND_ROUTE,...getRawUnloadRoute(scenario).slice(1)],unloading:index===5,supplyActive:index===10,powderSupplyProgress,powderSupplyActive:isPowder&&index===10&&p>.15&&p<.85,aggregateBinFill:binFill,binGateOpen:gates,aggregateBinDischarged};
}
