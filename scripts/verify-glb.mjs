import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {registerNodePngTextures} from './png-textures.mjs';
import {WEIGHBRIDGE_LAYOUT,AGGREGATE_BIN_X,AGGREGATE_BIN_Z} from '../src/stationLayout.js';

const project=fileURLToPath(new URL('../',import.meta.url));
const option=name=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:null;};
const runtime=option('--runtime')?path.resolve(option('--runtime')):project;
const require=createRequire(path.join(runtime,'package.json'));
const {GLTFLoader}=await import(pathToFileURL(require.resolve('three/examples/jsm/loaders/GLTFLoader.js')));
const THREE=await import(pathToFileURL(require.resolve('three')));
const {Box3}=THREE;
const file=option('--asset')?path.resolve(option('--asset')):fileURLToPath(new URL('../models/ready-mix-plant-v6.glb',import.meta.url));
const buffer=fs.readFileSync(file);
if(buffer.toString('ascii',0,4)!=='glTF'||buffer.readUInt32LE(4)!==2||buffer.readUInt32LE(8)!==buffer.length)throw Error('Invalid GLB header');
const json=JSON.parse(buffer.toString('utf8',20,20+buffer.readUInt32LE(12)));
const entityIds=[...new Set(json.nodes.map(n=>n.extras?.entityId).filter(Boolean))].sort();
const expected=['control-room','automatic-bins','loader-l01','cement-c01','cement-c02','flyash-f01','flyash-f02','aggregate-a02','aggregate-sand','aggregate-stone','mixer-m01','weighbridge-w01','conveyor-b01','supplier-yard','construction-site','pump-p01','truck-mc012','aggregate-scale-m01','powder-scale-m01','water-scale-m01','mixer-discharge-m01'];
for(const id of expected)if(!entityIds.includes(id))throw Error('Missing entity: '+id);
if(json.nodes.some(n=>n.extras?.uiOnly||n.name?.endsWith('-selection')))throw Error('Screen selection helpers exported into asset');
const loader=new GLTFLoader(),decoded=registerNodePngTextures(loader,THREE);
const imported=await loader.parseAsync(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength),'');
// Validate every declared texture, including images not used by visible meshes.
const textureResults=[];
for(let index=0;index<(json.textures?.length||0);index++){
  const texture=await imported.parser.getDependency('texture',index),image=texture?.image;
  if(!texture?.isDataTexture||!image?.width||!image?.height||image.data?.length!==image.width*image.height*4)throw Error('Texture '+index+' was not decoded into real RGBA pixels');
  for(const value of image.data)if(!Number.isFinite(value)||value<0||value>255)throw Error('Invalid decoded texture pixel');
  const unique=new Set(image.data);textureResults.push({index,name:texture.name,source:json.textures[index].source,width:image.width,height:image.height,rgbaBytes:image.data.length,uniqueChannelValues:unique.size});
}
const bumpDeclared=(json.extensionsUsed||[]).includes('EXT_materials_bump');
const bumpSupported=Boolean(imported.parser.plugins?.EXT_materials_bump?.extendMaterialParams);
let bumpMaterials=0;
if(bumpDeclared&&bumpSupported)for(let index=0;index<json.materials.length;index++){
  const extension=json.materials[index].extensions?.EXT_materials_bump;if(!extension)continue;
  const material=await imported.parser.getDependency('material',index);
  if(extension.bumpTexture){
    const expectedTexture=decoded.textures.get(extension.bumpTexture.index);
    if(!material.bumpMap?.isDataTexture||material.bumpMap.image.data!==expectedTexture?.image.data)throw Error('Material '+index+' lost its decoded bump texture');
  }
  if(Math.abs(material.bumpScale-(extension.bumpFactor??1))>1e-9)throw Error('Material '+index+' lost its bump scale');
  bumpMaterials++;
}
imported.scene.updateMatrixWorld(true);
const bridge=imported.scene.getObjectByName('weighbridge-w01');
const bridgeAt=new THREE.Vector3();bridge?.getWorldPosition(bridgeAt);
if(!bridge||bridgeAt.distanceTo(new THREE.Vector3(...WEIGHBRIDGE_LAYOUT.center))>1e-5)throw Error('Exported weighbridge is not in the current entrance lane');
const deckObject=bridge.getObjectByName('weighbridge-flush-driving-deck');
if(!deckObject)throw Error('Exported flush weighing deck is missing');
const deck=new Box3().setFromObject(deckObject),deckSize=deck.getSize(new THREE.Vector3());
if(Math.abs(deckSize.z-WEIGHBRIDGE_LAYOUT.length)>1e-4||Math.abs(deckSize.x-WEIGHBRIDGE_LAYOUT.width)>1e-4||Math.abs(deck.max.y-WEIGHBRIDGE_LAYOUT.surfaceY)>1e-5)throw Error('Exported bridge deck dimensions or contact height are outdated');
const binPositions=[];imported.scene.traverse(object=>{if(object.name.startsWith('automatic-aggregate-storage-weighing-and-slide-gate')){const at=new THREE.Vector3();object.getWorldPosition(at);binPositions.push(at.toArray());}});
binPositions.sort((a,b)=>a[0]-b[0]);
if(binPositions.length!==3||binPositions.some((at,index)=>Math.abs(at[0]-AGGREGATE_BIN_X[index])>1e-5||Math.abs(at[2]-AGGREGATE_BIN_Z)>1e-5))throw Error('Exported automatic bins do not preserve the stone unloading lane');
const coverObject=imported.scene.getObjectByName('collection-trench-load-bearing-road-cover');
if(!coverObject||Math.abs(new Box3().setFromObject(coverObject).max.y-WEIGHBRIDGE_LAYOUT.surfaceY)>1e-5)throw Error('Exported collection crossing cover is missing or not flush');
let meshes=0,instances=0;const geometries=new Set();
imported.scene.traverse(o=>{if(o.isMesh){meshes++;geometries.add(o.geometry);if(o.isInstancedMesh)instances+=o.count;}});
for(const geometry of geometries){if(!geometry.attributes.position?.count)throw Error('Empty geometry');for(const value of geometry.attributes.position.array)if(!Number.isFinite(value))throw Error('Nonfinite geometry');}
const bounds=new Box3().setFromObject(imported.scene);
if(!bounds.min.toArray().concat(bounds.max.toArray()).every(Number.isFinite)||bounds.max.z<140||bounds.min.x>-100||bounds.max.x<130||bounds.max.y<20)throw Error('Incomplete regional logistics model: '+JSON.stringify({min:bounds.min.toArray(),max:bounds.max.toArray()}));
const results={file,bytes:buffer.length,format:'GLB 2.0',nodes:json.nodes.length,meshes,instances,geometries:geometries.size,materials:json.materials.length,extensions:json.extensionsUsed||[],textures:textureResults,
  bumpExtension:{declared:bumpDeclared,supported:bumpSupported,verifiedMaterials:bumpMaterials,status:!bumpDeclared?'not declared':bumpSupported?'decoded bump textures and scale verified':'runtime does not support EXT_materials_bump; images decoded but bump appearance not validated'},
  entityIds,entranceLayout:{bridgeCenter:bridgeAt.toArray(),deckSize:deckSize.toArray(),surfaceY:deck.max.y,binPositions,flushCollectionCover:true},bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},import:'Three.js GLTFLoader with real Node PNG decoding passed'};
console.log(JSON.stringify(results,null,2));
