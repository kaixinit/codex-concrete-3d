// Deterministic presentation poses, sampled from the same absolute business clock.
// These are visual mechanisms, rather than a physics or batching-control simulator.
const clamp=value=>Math.max(0,Math.min(1,Number(value)||0));
const ease=value=>{const t=clamp(value);return t*t*(3-2*t);};
export function getMixerChutePose(state={},fallback=false){
  const queue=state.stages?.find(stage=>stage.key==='queue'),signature=state.stages?.find(stage=>stage.key==='signature');
  let deployment=state.unloading||fallback?1:0;
  if(queue&&signature&&Number.isFinite(state.time)){
    const opening=ease((state.time-queue.start-.5)/3.5);
    const closing=ease((state.time-signature.start-1)/4.5);
    deployment=opening*(1-closing);
  }
  return {deployment,yaw:.24*(1-deployment),pitch:-1.06*(1-deployment)};
}
function chutePoint(point,pose){
  const [x,y,z]=point,cz=Math.cos(pose.pitch),sz=Math.sin(pose.pitch),cy=Math.cos(pose.yaw),sy=Math.sin(pose.yaw);
  const rx=x*cz-y*sz,ry=x*sz+y*cz;
  return[-3.9+rx*cy+z*sy,2.42+ry,-rx*sy+z*cy];
}
export function chuteDischargeLipLocal(state={},fallback=false){return chutePoint([-1.835,-.798,0],getMixerChutePose(state,fallback));}
export function getChuteActuatorPose(state={},fallback=false){
  const pose=getMixerChutePose(state,fallback),mount=[-4.03,1.52,.34],end=chutePoint([-.83,-.39,.34],pose);
  return {mount,end,barrelEnd:mount.map((value,i)=>value+(end[i]-value)*.61)};
}
export function getProductionAssetState(state={}){
  const concrete=state.flowKind==='concrete',phase=state.stageName||state.phase?.key,p=clamp(state.phaseProgress??state.stageProgress);
  if(!concrete)return {aggregateFill:0,powderFill:0,aggregateGate:0,powderGate:0,mixerFill:0,dischargeGate:0};
  if(phase==='production'){
    const aggregateGate=ease((p-.3)/.055)*(1-ease((p-.445)/.045));
    const powderGate=ease((p-.385)/.04)*(1-ease((p-.47)/.04));
    return {aggregateFill:ease((p-.075)/.145)*(1-ease((p-.3)/.145)),powderFill:ease((p-.22)/.155)*(1-ease((p-.385)/.085)),aggregateGate,powderGate,mixerFill:ease((p-.31)/.32),dischargeGate:0};
  }
  if(phase==='loading')return {aggregateFill:0,powderFill:0,aggregateGate:0,powderGate:0,mixerFill:1-clamp(state.vehicleFill??p),dischargeGate:ease(p/.07)*(1-ease((p-.94)/.06))};
  const production=state.stages?.find(stage=>stage.key==='production');
  return {aggregateFill:0,powderFill:0,aggregateGate:0,powderGate:0,mixerFill:production&&state.time>=production.end&&state.time<=production.end+.001?1:0,dischargeGate:0};
}
export function pileScoopDepth(x,z,progress){
  // A shallow local cut on the front face; the stock calculation remains in workflow.
  const dx=x/1.2,dz=(z-1.65)/1.15;
  return .54*ease(progress)*Math.exp(-(dx*dx+dz*dz)*1.35);
}
