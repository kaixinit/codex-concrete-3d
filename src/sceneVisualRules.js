export function entityAncestor(object) {
  for (let current=object; current; current=current.parent) if (current.userData?.entityId) return current;
  return null;
}
export function hierarchyVisible(object) {
  for (let current=object; current; current=current.parent) if (!current.visible) return false;
  return true;
}
export function uiHelper(object) {
  for (let current=object; current; current=current.parent) {
    if (current.userData?.uiOnly || current.name?.endsWith('-selection')) return true;
  }
  return false;
}
export function labelOcclusionMode(blocked, item) {
  return !blocked?'normal':item.selected||item.fault?'dock':'hidden';
}
export function advanceOcclusion(previous, blocked, now) {
  if (blocked == null) return previous || {blocked:false, candidate:false, since:now};
  const state = previous || {blocked:false, candidate:false, since:now};
  const next = state.candidate===blocked?state:{...state,candidate:blocked,since:now};
  return now-next.since >= (blocked?100:160)?{...next,blocked}:next;
}
const overlap = (a,b) => a.x<b.x+b.width+6 && a.x+a.width+6>b.x && a.y<b.y+b.height+6 && a.y+a.height+6>b.y;
export function dockLabelPose(anchor,item,viewport,reservedRects=[]) {
  const width=item.width,height=item.height+14,margin=12;
  const right=viewport.width-margin-width,bottom=viewport.height-margin-height;
  const clampY=value=>Math.max(margin,Math.min(bottom,value));
  const clampX=value=>Math.max(margin,Math.min(right,value));
  let best=null,score=Infinity;
  for(const y of [clampY(anchor.y-height/2),margin,clampY(viewport.height/2-height/2),bottom]) {
    for(const x of [margin,right]) {
      const candidate={x,y,width,height};
      if(x<margin||y<margin||x+width>viewport.width-margin||y+height>viewport.height-margin||reservedRects.some(rect=>overlap(candidate,rect)))continue;
      const distance=(x+width/2-anchor.x)**2+(y+height/2-anchor.y)**2;
      if(distance<score){best=candidate;score=distance;}
    }
  }
  for(const x of [clampX(anchor.x-width/2),margin,right])for(const y of [margin,bottom]) {
    const candidate={x,y,width,height};
    if(x<margin||y<margin||x+width>viewport.width-margin||y+height>viewport.height-margin||reservedRects.some(rect=>overlap(candidate,rect)))continue;
    const distance=(x+width/2-anchor.x)**2+(y+height/2-anchor.y)**2;
    if(distance<score){best=candidate;score=distance;}
  }
  return best;
}
