// Paused demand scenes need several bounded samples to confirm obstruction.
// A completed or expired batch must not keep the renderer awake.
export function advanceOcclusionWork(previous,{key,ids,checkedIds=[],states,now,maxSettleMs=1800,retryMs=110}) {
  const reset=!previous||previous.key!==key;
  const startedAt=reset?now:previous.startedAt;
  const currentIds=new Set(ids),pending=new Set(reset?ids:previous.pending);
  for(const id of pending)if(!currentIds.has(id))pending.delete(id);
  for(const id of checkedIds)pending.delete(id);
  for(const id of ids){
    const state=states.get(id);
    if(!state||state.candidate!==state.blocked)pending.add(id);
  }
  const deadline=startedAt+maxSettleMs,remaining=deadline-now,needsMore=pending.size>0&&remaining>0;
  return {key,startedAt,deadline,pending:[...pending],needsMore,delay:needsMore?Math.min(retryMs,remaining):0};
}
