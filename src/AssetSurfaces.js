import * as THREE from 'three';

function microTexture(seed,spread,size=64){
  const data=new Uint8Array(size*size*4);let random=seed;
  for(let i=0;i<size*size;i++){random=(random*1664525+1013904223)>>>0;const value=128+(random%spread)-spread/2;data[i*4]=value;data[i*4+1]=value;data[i*4+2]=value;data[i*4+3]=255;}
  const texture=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);texture.name='shared-procedural-surface-'+seed;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;return texture;
}
const paintNoise=microTexture(71,20),steelNoise=microTexture(113,55),grainNoise=microTexture(191,100),rubberNoise=microTexture(239,42);
export function refineAssetSurfaces(materials){
  for(const key of ['white','blue','cobalt','yellow','yellowDark','paleBlue']){
    const old=materials[key];materials[key]=new THREE.MeshPhysicalMaterial({color:old.color,metalness:old.metalness,roughness:key==='white'?.43:.46,clearcoat:.28,clearcoatRoughness:.35,bumpMap:paintNoise,bumpScale:.0022});
  }
  for(const key of ['steel','darkSteel']){materials[key].bumpMap=steelNoise;materials[key].bumpScale=key==='steel'?.004:.003;materials[key].roughness=key==='steel'?.42:.57;}
  for(const key of ['sand','gravel','stone','powder']){materials[key].bumpMap=grainNoise;materials[key].bumpScale=key==='sand'?.035:key==='powder'?.012:.055;}
  materials.concrete.bumpMap=grainNoise;materials.concrete.bumpScale=.019;
  materials.rubber.bumpMap=rubberNoise;materials.rubber.bumpScale=.009;materials.rubber.roughness=.91;
  materials.glass=new THREE.MeshPhysicalMaterial({color:'#52778b',metalness:.07,roughness:.13,clearcoat:.68,clearcoatRoughness:.11,transparent:true,opacity:.88,side:THREE.DoubleSide});
  return materials;
}
