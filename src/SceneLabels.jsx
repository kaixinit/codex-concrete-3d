import React, {createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {useFrame, useThree} from '@react-three/fiber';
import {Html} from '@react-three/drei/web/Html.js';
import * as THREE from 'three';
import {estimateLabelWidth, layoutLabels} from './labelLayout.js';
import {advanceLabelOffset, labelScreenPose} from './labelMotion.js';
import {createOcclusionProbe} from './sceneGeometry.js';
import {advanceOcclusion,labelOcclusionMode,dockLabelPose} from './sceneVisualRules.js';
import {advanceOcclusionWork} from './labelOcclusionWork.js';

const LabelsContext = createContext(null);
const fullscreenPosition = (_object, _camera, size) => [size.width / 2, size.height / 2];
function labelText(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(labelText).join('');
  if (React.isValidElement(node)) return labelText(node.props.children);
  return '';
}
function hierarchyVisible(object) {
  for (let current=object.parent; current; current=current.parent) if (!current.visible) return false;
  return true;
}

export function SceneLabelProvider({children, view='overview', visible=true, cutaway=false, reservedRects=[]}) {
  const registry=useRef(new Map()),overlayAnchor=useRef(null);
  const placementRef=useRef([]),domLabels=useRef(new Map()),domLeaders=useRef(new Map()),offsets=useRef(new Map());
  const lastUpdate=useRef(-Infinity),presentationSignature=useRef(''),inputSignature=useRef(''),layoutKey=useRef('');
  const occlusion=useRef(new Map()),dockPositions=useRef(new Map()),domStatus=useRef(new Map()),uiRects=useRef([]),uiKey=useRef(''),probeKey=useRef('');
  const occlusionWork=useRef(null),probeCursor=useRef(0),settleTimer=useRef(null);
  const [placements,setPlacements]=useState([]);
  const {size,invalidate,scene,gl,frameloop}=useThree();
  const probe=useMemo(()=>createOcclusionProbe(scene,{maxRays:3,maxMillis:3}),[scene]);
  // Mounting/changing HTML needs a follow-up paint even in paused demand mode.
  // React owns content/style only; it never resets the frame-owned position.
  useLayoutEffect(()=>{if(visible)invalidate();},[placements,visible,invalidate]);
  useEffect(()=>{
    lastUpdate.current=-Infinity;
    if(visible)invalidate();
    return()=>{if(settleTimer.current!==null){clearTimeout(settleTimer.current);settleTimer.current=null;}};
  },[visible,view,cutaway,frameloop,invalidate]);
  const scratch=useMemo(()=>({world:new THREE.Vector3(),projected:new THREE.Vector3(),forward:new THREE.Vector3()}),[]);
  const register=useCallback((id,item)=>{registry.current.set(id,item);lastUpdate.current=-Infinity;invalidate();return()=>{registry.current.delete(id);lastUpdate.current=-Infinity;invalidate();};},[invalidate]);
  const context=useMemo(()=>({register}),[register]);

  useFrame(({camera,clock,size:viewport},dt)=>{
    if(!visible)return;
    // Vehicle transforms (-2), camera rig (-1.5), and orbit orientation (-1)
    // have finished before this default-priority screen projection.
    camera.updateWorldMatrix(true,false);
    if(overlayAnchor.current){
      camera.getWorldDirection(scratch.forward);
      camera.getWorldPosition(overlayAnchor.current.position);
      overlayAnchor.current.position.addScaledVector(scratch.forward,1);
      overlayAnchor.current.updateWorldMatrix(true,false);
    }
    const now=clock.elapsedTime,key=view+'|'+viewport.width+'x'+viewport.height,visibilityKey=key+'|'+cutaway;
    if(key!==layoutKey.current||visibilityKey!==probeKey.current||now-lastUpdate.current>=.1){
      lastUpdate.current=now;
      if(visibilityKey!==probeKey.current){occlusion.current.clear();dockPositions.current.clear();}
      probe.begin(now,visibilityKey!==probeKey.current);probeKey.current=visibilityKey;
      const canvasRect=gl.domElement.getBoundingClientRect();
      const dynamicRects=[];
      const contextCard=gl.domElement.closest('.scene-viewport')?.querySelector('[data-scene-context-card]');
      if(contextCard){const rect=contextCard.getBoundingClientRect();if(rect.width&&rect.height)dynamicRects.push({x:rect.left-canvasRect.left,y:rect.top-canvasRect.top,width:rect.width,height:rect.height});}
      uiRects.current=[{x:0,y:0,width:Math.min(360,viewport.width-16),height:96},{x:0,y:viewport.height-45,width:220,height:45},{x:Math.max(0,viewport.width-190),y:viewport.height-50,width:190,height:50},...reservedRects,...dynamicRects];
      const nextUiKey=uiRects.current.map(rect=>[rect.x,rect.y,rect.width,rect.height].map(value=>Math.round(value)).join(',')).join(';');
      if(nextUiKey!==uiKey.current){dockPositions.current.clear();uiKey.current=nextUiKey;}
      const items=[];
      registry.current.forEach((entry,id)=>{
        const role=entry.role;
        if(role==='detail'&&view!=='control')return;
        if(role==='entity'&&!entry.selected&&!entry.active&&!entry.fault)return;
        if(view==='vehicle'&&!entry.selected&&!entry.active)return;
        if(view!=='control'&&!entry.selected&&role==='area'&&entry.text.includes('中控'))return;
        if(view==='control'&&role!=='detail'&&!entry.selected&&!entry.active&&!entry.fault)return;
        const object=entry.ref.current;
        if(!object||!hierarchyVisible(object))return;
        object.getWorldPosition(scratch.world);
        const w=scratch.world;
        if(!entry.selected){
          if(['overview','materials','detail','delivery','control'].includes(view)&&(w.x < -36||w.x > 48||w.z > 35))return;
          if(view==='supplier'&&(w.x > -50||w.z < 35||w.z > 85))return;
          if(view==='site'&&(w.x < 75||w.z < 85))return;
        }
        scratch.projected.copy(w).project(camera);
        const p=scratch.projected;
        if(![p.x,p.y,p.z].every(Number.isFinite)||p.z < -1||p.z > 1||p.x < -1||p.x > 1||p.y < -1||p.y > 1)return;
        items.push({...entry,id,x:(p.x+1)*viewport.width/2,y:(1-p.y)*viewport.height/2,
          occlusionAnchor:w.x.toFixed(3)+','+w.y.toFixed(3)+','+w.z.toFixed(3),
          width:estimateLabelWidth(entry.text,entry.small)+(role==='area'||entry.fault?10:0),height:entry.small?24:27});
      });
      // Prioritize selected/critical labels in a bounded, rotating ray budget.
      items.sort((a,b)=>Number(Boolean(b.selected||b.fault))-Number(Boolean(a.selected||a.fault)));
      const workKey=visibilityKey+'|'+camera.matrixWorld.elements.map(value=>value.toFixed(3)).join(',')+'|'+camera.projectionMatrix.elements.map(value=>value.toFixed(3)).join(',')+'|'+items.map(item=>item.id+':'+item.occlusionAnchor).join(';')+(frameloop==='always'?'|'+Math.floor(now*10):'');
      const workInput={key:workKey,ids:items.map(item=>item.id),states:occlusion.current,now:now*1000};
      occlusionWork.current=advanceOcclusionWork(occlusionWork.current,workInput);
      const pendingIds=new Set(occlusionWork.current.pending),tasks=items.filter(item=>pendingIds.has(item.id)),checkedIds=[];
      const offset=probeCursor.current%Math.max(1,tasks.length);
      for(let index=0;index<tasks.length;index++){
        const item=tasks[(index+offset)%tasks.length],entry=registry.current.get(item.id);
        entry.ref.current.getWorldPosition(scratch.world);
        const blocked=probe.check(scratch.world,camera);
        if(blocked==null)break;
        checkedIds.push(item.id);
        occlusion.current.set(item.id,advanceOcclusion(occlusion.current.get(item.id),blocked,now*1000));
      }
      probeCursor.current+=checkedIds.length;
      occlusionWork.current=advanceOcclusionWork(occlusionWork.current,{...workInput,checkedIds});
      const visibleItems=items.filter(item=>labelOcclusionMode(occlusion.current.get(item.id)?.blocked,item)!=='hidden');
      const inputs=key+'|'+uiKey.current+'|'+visibleItems.map(item=>item.id+':'+item.x.toFixed(2)+','+item.y.toFixed(2)+':'+item.text+':'+Number(item.selected)+':'+Number(item.active)+':'+Number(item.fault)).join('|');
      if(inputs!==inputSignature.current||key!==layoutKey.current){
        const reset=key!==layoutKey.current;
        const next=layoutLabels(visibleItems,viewport.width,viewport.height,{
          maxLabels:view==='control'?(viewport.width<550?5:8):(viewport.width<550?3:4),
          previousPlacements:reset?[]:placementRef.current,
          reservedRects:uiRects.current,
        });
        layoutKey.current=key;inputSignature.current=inputs;placementRef.current=next;
        if(reset)offsets.current.clear();
        const ids=new Set(next.map(item=>item.id));
        for(const id of offsets.current.keys())if(!ids.has(id))offsets.current.delete(id);
        for(const [id,node] of domLabels.current)if(!ids.has(id)){
          node.style.visibility='hidden';const line=domLeaders.current.get(id);if(line)line.style.visibility='hidden';
        }
        // Anchor coordinates deliberately stay out of the React signature.
        // Moving a car must not trigger a competing HTML left/top rewrite.
        const signature=key+'|'+next.map(item=>item.id+':'+item.text+':'+item.width+','+item.height+':'+Number(item.selected)+':'+Number(item.active)+':'+Number(item.fault)+':'+Number(item.small)+':'+item.role).join('|');
        if(signature!==presentationSignature.current){presentationSignature.current=signature;setPlacements(next);}
      }
    }
    let easing=false;
    const ratio=typeof window==='undefined'?1:window.devicePixelRatio||1;
    for(const item of placementRef.current){
      const node=domLabels.current.get(item.id),entry=registry.current.get(item.id),line=domLeaders.current.get(item.id);
      if(!node||!entry?.ref.current)continue;
      entry.ref.current.getWorldPosition(scratch.world);scratch.projected.copy(scratch.world).project(camera);
      const p=scratch.projected;
      if(!hierarchyVisible(entry.ref.current)||![p.x,p.y,p.z].every(Number.isFinite)||p.z < -1||p.z > 1||p.x < -1||p.x > 1||p.y < -1||p.y > 1){
        node.style.visibility='hidden';if(line)line.style.visibility='hidden';continue;
      }
      const anchor={x:(p.x+1)*viewport.width/2,y:(1-p.y)*viewport.height/2};
      const mode=labelOcclusionMode(occlusion.current.get(item.id)?.blocked,item);
      if(mode==='hidden'){node.style.visibility='hidden';if(line)line.style.visibility='hidden';continue;}
      const offset=advanceLabelOffset(offsets.current.get(item.id),item,dt);offsets.current.set(item.id,offset);
      easing=easing||offset.moving;
      let pose=labelScreenPose(anchor,offset,item,viewport,ratio);
      if(mode==='dock'){
        let dock=dockPositions.current.get(item.id);
        if(!dock){dock=dockLabelPose(anchor,item,viewport,uiRects.current);if(dock)dockPositions.current.set(item.id,dock);}
        if(dock){const nearX=Math.max(dock.x,Math.min(dock.x+item.width,anchor.x)),nearY=Math.max(dock.y,Math.min(dock.y+item.height,anchor.y));pose={x:dock.x,y:dock.y,nearX,nearY,leaderDistance:Math.hypot(anchor.x-nearX,anchor.y-nearY)};}
      }else dockPositions.current.delete(item.id);
      node.style.transform='translate3d('+pose.x+'px,'+pose.y+'px,0)';node.style.visibility='visible';
      node.dataset.labelMode=mode;node.dataset.labelOccluded=mode==='dock'?'true':'false';
      const status=domStatus.current.get(item.id);if(status)status.style.display=mode==='dock'?'block':'none';
      node.dataset.labelAnchorX=anchor.x.toFixed(3);node.dataset.labelAnchorY=anchor.y.toFixed(3);
      node.dataset.labelOffsetX=offset.x.toFixed(3);node.dataset.labelOffsetY=offset.y.toFixed(3);
      if(line){
        const visible=pose.leaderDistance>(line.style.visibility==='visible'?16:20);
        line.style.visibility=visible?'visible':'hidden';
        line.setAttribute('stroke-dasharray',mode==='dock'?'3 3':'');
        line.setAttribute('x1',anchor.x);line.setAttribute('y1',anchor.y);
        line.setAttribute('x2',pose.nearX);line.setAttribute('y2',pose.nearY);
      }
    }
    if(frameloop==='demand'&&occlusionWork.current?.needsMore&&now*1000<occlusionWork.current.deadline){
      if(settleTimer.current===null)settleTimer.current=setTimeout(()=>{settleTimer.current=null;invalidate();},occlusionWork.current.delay);
    }else if(settleTimer.current!==null){clearTimeout(settleTimer.current);settleTimer.current=null;}
    if(easing)invalidate();
  });

  return <LabelsContext.Provider value={context}>
    {children}
    <group ref={overlayAnchor} name="screen-label-overlay-anchor" userData={{uiOnly:true}}>
      <Html fullscreen calculatePosition={fullscreenPosition} zIndexRange={[25,25]}
        style={{pointerEvents:'none',overflow:'hidden',userSelect:'none'}} pointerEvents="none">
        <div data-scene-label-overlay style={{display:visible?'block':'none',position:'relative',width:size.width,height:size.height,pointerEvents:'none',overflow:'hidden'}}>
          <svg width={size.width} height={size.height} style={{position:'absolute',inset:0,pointerEvents:'none',overflow:'hidden'}} aria-hidden="true">
            {placements.filter(item=>item.selected||item.fault).map(item=><line key={item.id} ref={node=>{if(node)domLeaders.current.set(item.id,node);else domLeaders.current.delete(item.id);}}
              x1="0" y1="0" x2="0" y2="0" style={{visibility:'hidden'}}
              stroke={item.selected?'#6799d2':'#a6b6c6'} strokeWidth="1" opacity=".7"/>)}
          </svg>
          {placements.map(item=><div key={item.id} ref={node=>{if(node)domLabels.current.set(item.id,node);else domLabels.current.delete(item.id);}} data-scene-label={item.text} data-label-role={item.role}
            style={{position:'absolute',left:0,top:0,width:item.width,height:item.height,visibility:'hidden',willChange:'transform',
              boxSizing:'border-box',display:'flex',alignItems:'center',padding:item.small?'3px 7px':'4px 9px',
              border:'1px solid '+(item.fault?'#e4a496':item.selected?'#287be0':item.active?'#cfdae1':'transparent'),borderRadius:7,
              background:item.fault?'#fff0e9':item.selected?'#287be0':item.active?'rgba(255,255,255,.93)':'transparent',
              color:item.fault?'#aa4b36':item.selected?'#fff':'#49626d',
              fontFamily:'"Microsoft YaHei",sans-serif',fontSize:11,fontWeight:item.selected||item.active?650:550,
              textShadow:!item.selected&&!item.active&&!item.fault?'0 1px 3px #ffffff,0 0 5px #ffffff':undefined,
              boxShadow:item.selected||item.active||item.fault?'0 2px 7px #284d7310':'none',lineHeight:'17px',pointerEvents:'none',overflow:'visible'}}>
            {(item.role==='area'||item.fault)&&<span style={{width:5,height:5,flex:'0 0 5px',borderRadius:5,marginRight:5,background:item.fault?'#c55b3f':'#8c9fa6'}}/>}
            <span style={{whiteSpace:'nowrap',flex:'0 0 auto'}}>{item.children}</span>
            <span data-label-occlusion-status ref={node=>{if(node)domStatus.current.set(item.id,node);else domStatus.current.delete(item.id);}}
              style={{display:'none',position:'absolute',top:'100%',left:0,width:'100%',fontSize:9,lineHeight:'14px',textAlign:'center',color:'#547081',background:'#f8fcfeee',borderRadius:3}}>对象被遮挡</span>
          </div>)}
        </div>
      </Html>
    </group>
  </LabelsContext.Provider>;
}

export function SceneLabel({children,at=[0,0,0],selected=false,small=false,priority=0,role,active=false,fault=false}) {
  const ref=useRef(null),id=useId(),context=useContext(LabelsContext);
  const text=labelText(children);
  const labelRole=role||(priority<0?'detail':priority>=2?'area':'entity');
  useEffect(()=>{
    if(!context)return;
    return context.register(id,{ref,children,text,selected,small,priority,role:labelRole,active,fault});
  },[context,id,children,text,selected,small,priority,labelRole,active,fault]);
  return <group ref={ref} position={at} visible={false} name="screen-label-anchor" userData={{uiOnly:true,label:text}}/>;
}
