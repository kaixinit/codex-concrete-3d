import {useEffect,useMemo,useRef} from 'react';
import {useFrame,useThree} from '@react-three/fiber';
import * as THREE from 'three';
import {useSceneQuality} from './SceneQuality.jsx';
import {initialQualityState,advanceQualityState,summarizeFrameSamples} from './sceneQuality.js';
import {entityAncestor,hierarchyVisible,uiHelper} from './sceneVisualRules.js';
import {visibleLocalBounds,geometryScratch} from './sceneGeometry.js';

// Consolidate repeated fixed parts without rebuilding their shared geometry.
export function StaticInstances({children,name='fixed-batched-assets',exclude=[]}){
  const root=useRef();
  useEffect(()=>{
    const group=root.current;if(!group)return;
    group.updateWorldMatrix(true,true);
    const inverse=group.matrixWorld.clone().invert(),buckets=new Map(),created=[];
    group.traverse(object=>{if(!object.isMesh||object.isInstancedMesh||Array.isArray(object.material)||!object.visible)return;for(let parent=object;parent&&parent!==group;parent=parent.parent)if(!parent.visible||exclude.includes(parent.name))return;const key=object.geometry.uuid+'/'+object.material.uuid;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(object);});
    for(const meshes of buckets.values()){
      if(meshes.length<3)continue;
      const batch=new THREE.InstancedMesh(meshes[0].geometry,meshes[0].material,meshes.length);
      batch.name=name+'-instances';batch.castShadow=false;batch.receiveShadow=true;batch.userData.staticBatch=true;
      meshes.forEach((mesh,index)=>{batch.setMatrixAt(index,new THREE.Matrix4().multiplyMatrices(inverse,mesh.matrixWorld));mesh.visible=false;});
      batch.instanceMatrix.needsUpdate=true;batch.computeBoundingBox();batch.computeBoundingSphere();group.add(batch);created.push({batch,meshes});
    }
    return()=>{for(const {batch,meshes} of created){batch.removeFromParent();batch.dispose();meshes.forEach(mesh=>{mesh.visible=true;});}};
  },[]);
  return <group ref={root} name={name}>{children}</group>;
}

function cloneForPreview(object){
  object.updateWorldMatrix(true,true);
  const copy=object.clone(true),remove=[];
  copy.matrix.copy(object.matrixWorld);copy.matrixAutoUpdate=false;copy.visible=true;
  copy.traverse(child=>{if(child.userData?.uiOnly||child.name.includes('selection')||child.isLight||child.isCamera)remove.push(child);if(child.isMesh){child.castShadow=false;child.receiveShadow=false;}});
  remove.forEach(child=>child.removeFromParent());return copy;
}
export function RegionPreviewCapture({onThumbnails}){
  const {scene,gl}=useThree(),callbacks=useRef(onThumbnails);callbacks.current=onThumbnails;
  useEffect(()=>{
    let cancelled=false;
    const frame=requestAnimationFrame(()=>{
      if(cancelled)return;
      scene.updateMatrixWorld(true);
      const regions={supplier:['supplier-yard'],plant:['station-industrial-process-assets','control-room'],site:['construction-site','pump-p01','articulated-pump-boom-and-delivery-hose']},result={},temporaryScenes=[];
      const width=420,height=280,target=new THREE.WebGLRenderTarget(width,height,{depthBuffer:true});target.texture.colorSpace=THREE.SRGBColorSpace;
      const oldTarget=gl.getRenderTarget(),oldShadow=gl.shadowMap.enabled,oldColor=gl.getClearColor(new THREE.Color()),oldAlpha=gl.getClearAlpha();
      try{
        gl.shadowMap.enabled=false;gl.setClearColor('#edf3f7',0);
        for(const [id,names] of Object.entries(regions)){
          const preview=new THREE.Scene();preview.background=null;temporaryScenes.push(preview);
          const objects=new THREE.Group();names.forEach(name=>{const object=scene.getObjectByName(name);if(object)objects.add(cloneForPreview(object));});
          if(!objects.children.length)continue;
          preview.add(objects,new THREE.AmbientLight('#ffffff',1.3));
          const sun=new THREE.DirectionalLight('#fff7ed',2.1);sun.position.set(-40,70,50);preview.add(sun);
          const box=new THREE.Box3().setFromObject(objects),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
          const camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,1500);
          camera.position.copy(center).add(new THREE.Vector3(1.15,.95,1.15).normalize().multiplyScalar(Math.max(size.length()*2,80)));camera.lookAt(center);camera.updateMatrixWorld();
          const inverse=camera.matrixWorld.clone().invert();let left=Infinity,right=-Infinity,top=-Infinity,bottom=Infinity;
          for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){const point=new THREE.Vector3(x,y,z).applyMatrix4(inverse);left=Math.min(left,point.x);right=Math.max(right,point.x);bottom=Math.min(bottom,point.y);top=Math.max(top,point.y);}
          const fit=Math.max((right-left)/(width/height),top-bottom)*1.08,midX=(left+right)/2,midY=(top+bottom)/2;
          camera.left=midX-fit*(width/height)/2;camera.right=midX+fit*(width/height)/2;camera.top=midY+fit/2;camera.bottom=midY-fit/2;camera.updateProjectionMatrix();
          gl.setRenderTarget(target);gl.render(preview,camera);
          const pixels=new Uint8Array(width*height*4);gl.readRenderTargetPixels(target,0,0,width,height,pixels);
          const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d'),bitmap=context.createImageData(width,height);
          for(let y=0;y<height;y++)bitmap.data.set(pixels.subarray((height-1-y)*width*4,(height-y)*width*4),y*width*4);
          context.putImageData(bitmap,0,0);result[id]=canvas.toDataURL('image/png');
        }
        if(!cancelled)callbacks.current?.(result);
      }catch(error){console.warn('Region previews use schematic fallback:',error.message);}
      finally{gl.setRenderTarget(oldTarget);gl.shadowMap.enabled=oldShadow;gl.setClearColor(oldColor,oldAlpha);temporaryScenes.forEach(preview=>preview.traverse(object=>{if(object.isInstancedMesh)object.dispose();}));target.dispose();}
    });
    return()=>{cancelled=true;cancelAnimationFrame(frame);};
  },[scene,gl]);return null;
}

export function RenderPerformance({enabled,visible,adaptive=false,onPerformance,onQualitySample}){
  const values=useRef([]),last=useRef(0),reported=useRef(0),callback=useRef(onPerformance);callback.current=onPerformance;
  const callSamples=useRef([]);
  const qualityCallback=useRef(onQualitySample);qualityCallback.current=onQualitySample;
  const profile=useSceneQuality();
  useEffect(()=>{values.current=[];callSamples.current=[];last.current=0;reported.current=0;},[enabled,visible,adaptive,profile.quality]);
  useFrame(({gl})=>{
    if((!enabled&&!adaptive)||!visible||document.visibilityState==='hidden'){last.current=0;return;}
    const now=performance.now();if(last.current){values.current.push(now-last.current);callSamples.current.push(gl.info.render.calls);if(values.current.length>300){values.current.shift();callSamples.current.shift();}}last.current=now;
    if(values.current.length<20||now-reported.current<1000)return;reported.current=now;
    const result={...summarizeFrameSamples(values.current),calls:gl.info.render.calls,triangles:gl.info.render.triangles,
      meanCalls:Math.round(callSamples.current.reduce((sum,count)=>sum+count,0)/Math.max(1,callSamples.current.length)),
      minCalls:Math.min(...callSamples.current),maxCalls:Math.max(...callSamples.current),
      geometries:gl.info.memory.geometries,textures:gl.info.memory.textures,quality:profile.quality,dpr:gl.getPixelRatio(),shadows:profile.shadows};
    if(enabled)callback.current?.(result);if(adaptive)qualityCallback.current?.(result,now);
  },-5);return null;
}

export function QualityRuntime({requested='auto',paused,visible,sampling,onPerformance,onEffectiveChange,onQualityChange,view,cutaway}) {
  const {gl,scene,invalidate}=useThree(),profile=useSceneQuality();
  const state=useRef(initialQualityState(requested)),lastShadow=useRef(-Infinity),originalCast=useRef(new WeakMap());
  const callbacks=useRef({onEffectiveChange,onQualityChange});callbacks.current={onEffectiveChange,onQualityChange};
  useEffect(()=>{state.current=initialQualityState(requested);},[requested]);
  useEffect(()=>{
    gl.shadowMap.enabled=profile.shadows;gl.shadowMap.autoUpdate=profile.quality==='high';lastShadow.current=-Infinity;
    const size=new THREE.Vector3();
    scene.traverse(object=>{
      if(object.isLight&&object.shadow){object.shadow.map?.dispose();object.shadow.map=null;object.shadow.mapPass?.dispose();object.shadow.mapPass=null;}
      if(!object.isMesh||uiHelper(object))return;
      if(!originalCast.current.has(object))originalCast.current.set(object,object.castShadow);
      if(!object.geometry.boundingBox)object.geometry.computeBoundingBox();
      object.geometry.boundingBox.getSize(size).multiply(object.scale);
      const max=Math.max(Math.abs(size.x),Math.abs(size.y),Math.abs(size.z));
      const min=Math.min(Math.abs(size.x),Math.abs(size.y),Math.abs(size.z));
      object.castShadow=originalCast.current.get(object)&&profile.shadows&&(profile.quality==='high'||max>=.6&&!(min<.035&&max<2));
    });
    gl.shadowMap.needsUpdate=true;invalidate();
    callbacks.current.onQualityChange?.({requested,effective:profile.quality,dpr:gl.getPixelRatio(),
      shadowMapSize:profile.shadowMapSize,detailLevel:profile.detailLevel,shadows:profile.shadows});
    return()=>{gl.shadowMap.autoUpdate=true;};
  },[profile,requested,gl,scene,invalidate]);
  useEffect(()=>{lastShadow.current=-Infinity;invalidate();},[visible,view,cutaway,invalidate]);
  useFrame(({clock})=>{
    if(profile.shadows&&visible&&(lastShadow.current===-Infinity||clock.elapsedTime-lastShadow.current>=1/15)){
      gl.shadowMap.needsUpdate=true;lastShadow.current=clock.elapsedTime;
    }
  },-4.8);
  return <RenderPerformance enabled={sampling} visible={visible} adaptive={requested==='auto'&&!paused}
    onPerformance={onPerformance} onQualitySample={(sample,now)=>{
      state.current=advanceQualityState(state.current,sample,now,requested);
      if(state.current.effective!==profile.quality)callbacks.current.onEffectiveChange?.(state.current.effective);
    }}/>;
}

function cornerGeometry() {
  const positions=[];
  for(const x of [-.5,.5])for(const y of [-.5,.5])for(const z of [-.5,.5])for(let axis=0;axis<3;axis++){
    const from=[x,y,z],to=from.slice();to[axis]*=.64;positions.push(...from,...to);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));return geometry;
}
const feedbackGeometry=cornerGeometry();
const feedbackMaterials={selected:new THREE.LineBasicMaterial({color:'#2779b3',transparent:true,opacity:.93,depthWrite:false}),
  hover:new THREE.LineBasicMaterial({color:'#668997',transparent:true,opacity:.68,depthWrite:false})};

export function ObjectFeedback({selectedId,visible,view,cutaway}) {
  const {scene,gl,get,invalidate}=useThree(),selectedLine=useRef(),hoverLine=useRef();
  const selectedObject=useRef(null);
  const cache=useRef(new Map()),scratch=useMemo(()=>({...geometryScratch(),center:new THREE.Vector3(),size:new THREE.Vector3(),matrix:new THREE.Matrix4(),rotation:new THREE.Quaternion()}),[]);
  useEffect(()=>{cache.current.clear();selectedObject.current=scene.getObjectByName(selectedId);invalidate();},[view,cutaway,selectedId,scene,invalidate]);
  useEffect(()=>{
    const move=()=>{if(visible)invalidate();},leave=()=>{gl.domElement.style.cursor='';invalidate();};
    gl.domElement.addEventListener('pointermove',move);gl.domElement.addEventListener('pointerleave',leave);
    if(!visible)gl.domElement.style.cursor='';
    return()=>{gl.domElement.removeEventListener('pointermove',move);gl.domElement.removeEventListener('pointerleave',leave);gl.domElement.style.cursor='';};
  },[gl,visible,invalidate]);
  useFrame(({clock})=>{
    let hovered=null,actionEnabled=null;
    // Reuse the pinned R3F event manager's existing intersections: no second pick ray.
    for(const hit of get().internal.hovered.values()){
      for(let object=hit.eventObject||hit.object;object;object=object.parent)if(object.userData?.uiAction){actionEnabled=object.userData.interactiveEnabled;break;}
      const entity=entityAncestor(hit.eventObject||hit.object);
      if(entity&&hierarchyVisible(entity)&&!uiHelper(entity)){hovered=entity;break;}
    }
    gl.domElement.style.cursor=visible?(actionEnabled===false?'default':hovered?'pointer':'grab'):'';
    const update=(line,object)=>{
      if(!line)return;line.visible=Boolean(visible&&object&&hierarchyVisible(object));if(!line.visible)return;
      let cached=cache.current.get(object.uuid);
      if(!cached||clock.elapsedTime-cached.time>.6){const box=new THREE.Box3();visibleLocalBounds(object,box,scratch);cached={box,time:clock.elapsedTime};cache.current.set(object.uuid,cached);}
      if(cached.box.isEmpty()){line.visible=false;return;}
      cached.box.getCenter(scratch.center);cached.box.getSize(scratch.size).addScalar(.14);
      object.updateWorldMatrix(true,false);scratch.matrix.compose(scratch.center,scratch.rotation,scratch.size);
      line.matrix.multiplyMatrices(object.matrixWorld,scratch.matrix);line.matrixWorldNeedsUpdate=true;
    };
    update(selectedLine.current,selectedObject.current);update(hoverLine.current,actionEnabled===false||hovered?.name===selectedId?null:hovered);
  },-.05);
  return <group name="scene-object-feedback" userData={{uiOnly:true}}>
    <lineSegments ref={selectedLine} name="selected-asset-corners" geometry={feedbackGeometry} material={feedbackMaterials.selected} matrixAutoUpdate={false} visible={false} raycast={()=>null}/>
    <lineSegments ref={hoverLine} name="hovered-asset-corners" geometry={feedbackGeometry} material={feedbackMaterials.hover} matrixAutoUpdate={false} visible={false} raycast={()=>null}/>
  </group>;
}

const vehiclePlaneGeometry=new THREE.PlaneGeometry(1,1);
const vehicleFloorMaterial=new THREE.MeshStandardMaterial({color:'#e0e6e7',roughness:1,metalness:0});
const contactMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,
  vertexShader:'varying vec2 contactUv; void main(){contactUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader:'varying vec2 contactUv;void main(){vec2 p=abs(contactUv-.5)*2.;float a=exp(-pow(p.x,8.)*5.-pow(p.y,4.)*8.);gl_FragColor=vec4(.11,.16,.17,a*.21);}' });
export function VehicleContactGround({visualState,workflow}) {
  const {scene}=useThree(),floor=useRef(),shadow=useRef(),ground=useRef({id:null,y:.1});
  const scratch=useMemo(geometryScratch,[]),bounds=useMemo(()=>new THREE.Box3(),[]);
  useFrame(()=>{const state=visualState?.current||workflow,position=state?.vehiclePosition;if(!position||!floor.current||!shadow.current)return;
    if(ground.current.id!==state.vehicleId){const vehicle=scene.getObjectByName(state.vehicleId);if(vehicle){visibleLocalBounds(vehicle,bounds,scratch);ground.current={id:state.vehicleId,y:Number.isFinite(bounds.min.y)?bounds.min.y-.008:.1};}}
    const y=(position[1]||0)+ground.current.y;
    floor.current.position.set(position[0],y,position[2]);shadow.current.position.set(position[0]-.7,y+.014,position[2]);shadow.current.rotation.y=state.vehicleYaw||0;
  },-1.8);
  return <group name="vehicle-inspection-contact-ground" userData={{uiOnly:true}}>
    <mesh ref={floor} name="vehicle-inspection-floor" geometry={vehiclePlaneGeometry} material={vehicleFloorMaterial} rotation={[-Math.PI/2,0,0]} scale={[34,28,1]} receiveShadow castShadow={false} raycast={()=>null}/>
    <group ref={shadow}><mesh name="vehicle-contact-shadow" geometry={vehiclePlaneGeometry} material={contactMaterial} rotation={[-Math.PI/2,0,0]} scale={[13.6,4.2,1]} raycast={()=>null}/></group>
  </group>;
}
