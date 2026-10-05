import {GLTFExporter} from 'three/examples/jsm/exporters/GLTFExporter.js';
import {InstancedBufferAttribute,Matrix4} from 'three';

function compactExportInstances(root) {
  const matrix=new Matrix4();
  let skippedInstances=0;
  root.traverse(object=>{
    if(!object.isInstancedMesh)return;
    const valid=[];
    for(let i=0;i<object.count;i++){
      object.getMatrixAt(i,matrix);
      // Hidden particles and duplicate route points can have a zero scale.
      // GLTFExporter's instance TRS decomposition divides by that scale.
      const determinant=matrix.determinant();
      if(matrix.elements.every(Number.isFinite)&&Number.isFinite(determinant)&&Math.abs(determinant)>1e-12)valid.push(i);
      else skippedInstances++;
    }
    if(!valid.length){object.visible=false;return;}
    const compact=attribute=>{
      const array=new attribute.array.constructor(valid.length*attribute.itemSize);
      valid.forEach((source,target)=>{for(let j=0;j<attribute.itemSize;j++)array[target*attribute.itemSize+j]=attribute.array[source*attribute.itemSize+j];});
      const result=new InstancedBufferAttribute(array,attribute.itemSize,attribute.normalized,attribute.meshPerAttribute);
      result.setUsage(attribute.usage);return result;
    };
    // These are clone-owned buffers. Geometry and materials remain shared;
    // no live scene resources are disposed or mutated during the export.
    object.instanceMatrix=compact(object.instanceMatrix);
    if(object.instanceColor)object.instanceColor=compact(object.instanceColor);
    object.count=valid.length;
    object.boundingBox=null;object.boundingSphere=null;
    object.computeBoundingBox();object.computeBoundingSphere();
  });
  return skippedInstances;
}

export async function downloadPlantGLB(scene) {
  if (!scene) throw new Error('请等待 3D 模型加载完成');
  const plant=scene.getObjectByName('concrete-batching-plant');
  if (!plant) throw new Error('未找到搅拌站模型');
  const root=plant.clone(true);
  root.name='ReadyMixPlant_Operations_V6';
  const helpers=[];
  root.traverse(object=>{
    if(object.userData?.distanceDetail||object.userData?.assetDetail)object.visible=true;
    if(object.userData?.uiOnly||object.name.endsWith('-selection')||object.isCamera||object.isLight||object.type.endsWith('Helper')||object.material?.isShaderMaterial)helpers.push(object);
  });
  helpers.forEach(object=>object.removeFromParent());
  const skippedInstances=compactExportInstances(root);
  root.updateMatrixWorld(true);
  const data=await new GLTFExporter().parseAsync(root,{binary:true,onlyVisible:true,trs:false});
  const url=await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(new Error('模型文件生成失败'));
    reader.readAsDataURL(new Blob([data],{type:'model/gltf-binary'}));
  });
  const link=document.createElement('a');
  link.href=url;
  link.download='ready-mix-plant-v6.glb';
  document.body.appendChild(link);
  link.click();
  link.remove();
  return {bytes:data.byteLength,url,skippedInstances};
}
