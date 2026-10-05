export function segmentIntersectsBounds(from,to,box,clearance=0) {
  let enter=0,exit=1;
  for(let axis=0;axis<3;axis++) {
    const min=box.min[axis]-clearance,max=box.max[axis]+clearance,delta=to[axis]-from[axis];
    if(Math.abs(delta)<1e-9){if(from[axis]<min||from[axis]>max)return false;continue;}
    let a=(min-from[axis])/delta,b=(max-from[axis])/delta;if(a>b)[a,b]=[b,a];
    enter=Math.max(enter,a);exit=Math.min(exit,b);if(enter>exit)return false;
  }
  return true;
}
export function planCameraFlight(from,to,boxes,clearance=2) {
  const obstacles=boxes.filter(box=>box.min.concat(box.max).every(Number.isFinite));
  if(!obstacles.some(box=>segmentIntersectsBounds(from,to,box,clearance)))return [to.slice()];
  const roof=Math.max(from[1],to[1],...obstacles.map(box=>box.max[1]+clearance+5));
  return [[from[0],roof,from[2]],[to[0],roof,to[2]],to.slice()];
}
