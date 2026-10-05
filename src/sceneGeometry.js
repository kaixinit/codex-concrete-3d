import * as THREE from 'three';
import {hierarchyVisible,uiHelper} from './sceneVisualRules.js';

export function visibleLocalBounds(object,result,scratch) {
  object.updateWorldMatrix(true,true);
  result.makeEmpty();scratch.inverse.copy(object.matrixWorld).invert();
  object.traverse(mesh=>{
    if(!mesh.isMesh||!hierarchyVisible(mesh)||uiHelper(mesh)||mesh.userData?.routeType||/particle|stream|task-route/.test(mesh.name))return;
    if(mesh.isInstancedMesh){if(!mesh.count)return;if(!mesh.boundingBox)mesh.computeBoundingBox();scratch.part.copy(mesh.boundingBox);}
    else {if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();scratch.part.copy(mesh.geometry.boundingBox);}
    scratch.matrix.multiplyMatrices(scratch.inverse,mesh.matrixWorld);scratch.part.applyMatrix4(scratch.matrix);result.union(scratch.part);
  });
  return result;
}
export function geometryScratch() {
  return {inverse:new THREE.Matrix4(),matrix:new THREE.Matrix4(),part:new THREE.Box3()};
}

// Budgeted actual mesh intersection, with entity bounds as a coarse first pass.
export function createOcclusionProbe(scene,{maxRays=3,maxMillis=3}={}) {
  const raycaster=new THREE.Raycaster(),origin=new THREE.Vector3(),direction=new THREE.Vector3();
  const scratch=geometryScratch(),hits=[];
  let assets=[],lastRefresh=-Infinity,rays=0,started=0;
  const now=()=>typeof performance==='undefined'?Date.now():performance.now();
  const refresh=()=>{
    const root=scene.getObjectByName('concrete-batching-plant')||scene;assets=[];
    root.traverse(object=>{
      if(!object.userData?.entityId||uiHelper(object))return;
      for(let parent=object.parent;parent&&parent!==root;parent=parent.parent)if(parent.userData?.entityId)return;
      const meshes=[];
      object.traverse(mesh=>{if(mesh.isMesh&&!uiHelper(mesh)&&!mesh.userData?.routeType&&!/particle|stream/.test(mesh.name))meshes.push(mesh);});
      if(!meshes.length)return;
      const local=new THREE.Box3();visibleLocalBounds(object,local,scratch);
      if(!local.isEmpty())assets.push({object,meshes,local,world:new THREE.Box3()});
    });
  };
  return {
    begin(time,reset=false){rays=0;started=now();if(reset||time-lastRefresh>=1){refresh();lastRefresh=time;started=now();}},
    check(anchor,camera){
      if(rays>=maxRays||now()-started>maxMillis)return null;rays++;
      camera.getWorldPosition(origin);direction.copy(anchor).sub(origin);
      const distance=direction.length();if(distance<.2)return false;
      raycaster.set(origin,direction.multiplyScalar(1/distance));raycaster.near=.1;raycaster.far=distance-.18;
      for(const asset of assets){
        if(!hierarchyVisible(asset.object))continue;
        asset.object.updateWorldMatrix(true,true);asset.world.copy(asset.local).applyMatrix4(asset.object.matrixWorld);
        if(!raycaster.ray.intersectsBox(asset.world))continue;
        hits.length=0;raycaster.intersectObjects(asset.meshes,false,hits);
        for(const hit of hits){
          if(!hierarchyVisible(hit.object)||uiHelper(hit.object))continue;
          const material=Array.isArray(hit.object.material)?hit.object.material[hit.face?.materialIndex||0]:hit.object.material;
          if(!material||material.visible===false||material.opacity<.2||material.transparent&&material.opacity<.95)continue;
          return true;
        }
      }
      return false;
    },
  };
}
