import {useEffect,useMemo,useRef} from 'react';
import {useFrame} from '@react-three/fiber';
import * as THREE from 'three';
import {useSceneQuality} from './SceneQuality.jsx';

export function AssetDetail({children,distance=80,name='near-asset-details'}){
  const group=useRef(),last=useRef({time:-Infinity,level:-1}),scratch=useMemo(()=>new THREE.Vector3(),[]),{detailLevel=1}=useSceneQuality();
  useFrame(({camera,clock})=>{
    if(!group.current)return;
    if(detailLevel===0){group.current.visible=false;return;}
    const now=clock?.elapsedTime??performance.now()/1000;
    if(detailLevel===last.current.level&&now-last.current.time<.1)return;
    last.current={time:now,level:detailLevel};
    group.current.getWorldPosition(scratch);
    const threshold=distance*(detailLevel===2?1.5:1),range=camera.position.distanceTo(scratch);
    group.current.visible=range<threshold+(group.current.visible?9:-9);
  },-1);
  return <group ref={group} name={name} visible={detailLevel!==0} userData={{assetDetail:true,distanceDetail:true}}>{children}</group>;
}

// Merge fixed opaque parts inside one mechanical frame. Dynamic/LOD/semantic
// child groups stay intact; only their own fixed subassemblies may opt in.
export function StaticGeometryParts({children,name='merged-fixed-asset-parts'}){
  const root=useRef();
  useEffect(()=>{
    const group=root.current;if(!group)return;
    group.updateWorldMatrix(true,true);
    const inverse=group.matrixWorld.clone().invert(),buckets=new Map(),created=[];
    group.traverse(mesh=>{
      if(!mesh.isMesh||mesh.isInstancedMesh||!mesh.visible||Array.isArray(mesh.material)||mesh.material.transparent)return;
      for(let parent=mesh.parent;parent&&parent!==group;parent=parent.parent)if(!parent.visible||parent.userData.assetDetail||parent.userData.entityId)return;
      const key=mesh.material.uuid+'/'+Boolean(mesh.castShadow);
      if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(mesh);
    });
    for(const meshes of buckets.values()){
      if(meshes.length<3)continue;
      const positions=[],normals=[],uvs=[],indices=[];
      for(const mesh of meshes){
        const geometry=mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,mesh.matrixWorld));
        if(!geometry.attributes.normal)geometry.computeVertexNormals();
        const position=geometry.attributes.position,normal=geometry.attributes.normal,uv=geometry.attributes.uv,base=positions.length/3;
        for(let i=0;i<position.count;i++){positions.push(position.getX(i),position.getY(i),position.getZ(i));normals.push(normal.getX(i),normal.getY(i),normal.getZ(i));uvs.push(uv?.getX(i)||0,uv?.getY(i)||0);}
        if(geometry.index)for(let i=0;i<geometry.index.count;i++)indices.push(base+geometry.index.getX(i));else for(let i=0;i<position.count;i++)indices.push(base+i);
        geometry.dispose();
      }
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeBoundingBox();geometry.computeBoundingSphere();
      const batch=new THREE.Mesh(geometry,meshes[0].material);batch.name=name+'-merged';batch.castShadow=meshes.some(mesh=>mesh.castShadow);batch.receiveShadow=meshes.some(mesh=>mesh.receiveShadow);batch.userData.staticBatch=true;batch.userData.sourceMeshCount=meshes.length;
      meshes.forEach(mesh=>{mesh.visible=false;});group.add(batch);created.push({batch,meshes});
    }
    return()=>{for(const {batch,meshes} of created){batch.removeFromParent();batch.geometry.dispose();meshes.forEach(mesh=>{mesh.visible=true;});}};
  },[]);
  return <group ref={root} name={name}>{children}</group>;
}
