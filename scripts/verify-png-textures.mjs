import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {deflateSync} from 'node:zlib';
import {decodePng,pngCrc32,registerNodePngTextures} from './png-textures.mjs';

const results=[];
function test(name,check){check();results.push(name);}
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
function chunk(type,data){const name=Buffer.from(type),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(pngCrc32(Buffer.concat([name,data])));return Buffer.concat([length,name,data,crc]);}
function png({width,height=1,depth=8,type=6,rows,palette,transparency,interlace=0}){
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=depth;header[9]=type;header[12]=interlace;
  return Buffer.concat([signature,chunk('IHDR',header),...(palette?[chunk('PLTE',palette)]:[]),...(transparency?[chunk('tRNS',transparency)]:[]),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
// A known PNG with independently supplied CRC / compressed data checks the
// decoder separately from the fixture writer used for the edge cases below.
const known=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
test('known 1px PNG retains black and opaque alpha',()=>{
  const image=decodePng(known);assert.equal(image.width,1);assert.equal(image.height,1);assert.deepEqual([...image.data],[0,0,0,255]);
});
const rgba=Buffer.from([
  14,37,62,255, 96,11,240,128, 217,188,91,0,
  30,10,70,220, 71,192,203,101, 120,217,101,8,
  82,59,209,192, 49,67,80,235, 206,92,34,68,
  115,79,202,25, 149,220,188,7, 84,130,254,144,
  206,234,2,57, 198,19,145,194, 73,249,68,239,
]);
const filtered=Buffer.alloc(5*13);
for(let y=0;y<5;y++){
  filtered[y*13]=y;
  for(let x=0;x<12;x++){
    const a=x>=4?rgba[y*12+x-4]:0,b=y?rgba[(y-1)*12+x]:0,c=y&&x>=4?rgba[(y-1)*12+x-4]:0;
    const prediction=a+b-c,distances=[Math.abs(prediction-a),Math.abs(prediction-b),Math.abs(prediction-c)];
    const paethValue=[a,b,c][distances.indexOf(Math.min(...distances))];
    const predictor=[0,a,b,Math.floor((a+b)/2),paethValue][y];filtered[y*13+x+1]=(rgba[y*12+x]-predictor+256)%256;
  }
}
const rgbaPng=png({width:3,height:5,rows:filtered});
test('five PNG row filters reproduce every RGBA byte',()=>{
  const image=decodePng(rgbaPng);assert.deepEqual(image.filters,[0,1,2,3,4]);assert.deepEqual([...image.data],[...rgba]);
});
test('packed palette samples and partial tRNS keep color and alpha',()=>{
  const image=decodePng(png({width:3,depth:2,type:3,rows:Buffer.from([0,0b00011000]),palette:Buffer.from([255,0,0,0,255,0,0,0,255]),transparency:Buffer.from([0,128])}));
  assert.deepEqual([...image.data],[255,0,0,0,0,255,0,128,0,0,255,255]);
});
test('packed grayscale transparency matches original sample value',()=>{
  const image=decodePng(png({width:3,depth:4,type:0,rows:Buffer.from([0,0x08,0xf0]),transparency:Buffer.from([0,8])}));
  assert.deepEqual([...image.data],[0,0,0,255,136,136,136,0,255,255,255,255]);
});
test('16-bit RGB and transparency convert to RGBA8',()=>{
  const image=decodePng(png({width:2,depth:16,type:2,rows:Buffer.from([0,0x12,0x34,0x80,0,0xff,0xff,0xff,0xff,0,0,0,0]),transparency:Buffer.from([0x12,0x34,0x80,0,0xff,0xff])}));
  assert.deepEqual([...image.data],[18,128,255,0,255,0,0,255]);
});
test('corrupted chunk CRC is rejected',()=>{const damaged=Buffer.from(known);damaged[40]^=1;assert.throws(()=>decodePng(damaged),/CRC mismatch/);});
test('invalid scanline filter is rejected',()=>assert.throws(()=>decodePng(png({width:1,rows:Buffer.from([5,1,2,3,255])})),/Invalid PNG row filter/));
test('truncated PNG is rejected',()=>assert.throws(()=>decodePng(known.subarray(0,known.length-2)),/Truncated|Incomplete/));
test('decode allocation limit is enforced before inflation',()=>assert.throws(()=>decodePng(rgbaPng,{maxPixels:14}),/dimensions exceed/));
test('unsupported Adam7 is explicitly rejected',()=>assert.throws(()=>decodePng(png({width:1,rows:Buffer.from([0,1,2,3,255]),interlace:1})),/Adam7/));
test('GLB alignment padding is accepted only as zero container bytes',()=>{
  let input;
  for(let red=0;red<256;red++){const candidate=png({width:1,rows:Buffer.from([0,red,2,3,255])});if(candidate.length%4){input=candidate;break;}}
  assert.ok(input);const padded=Buffer.concat([input,Buffer.alloc((4-input.length%4)%4)]);
  assert.throws(()=>decodePng(padded),/after PNG IEND/);
  const image=decodePng(padded,{allowBufferViewPadding:true});assert.equal(image.paddingBytes,padded.length-input.length);assert.deepEqual(image.data,decodePng(input).data);
  const damaged=Buffer.from(padded);damaged[damaged.length-1]=1;assert.throws(()=>decodePng(damaged,{allowBufferViewPadding:true}),/after PNG IEND/);
  assert.throws(()=>decodePng(Buffer.concat([padded,Buffer.alloc(4)]),{allowBufferViewPadding:true}),/after PNG IEND/);
});

// Re-import a tiny actual GLB through the official loader, using embedded PNG
// bufferViews and two independent samplers. No image DOM / fake canvas is used.
const project=fileURLToPath(new URL('../',import.meta.url)),args=process.argv.slice(2),runtimeFlag=args.indexOf('--runtime');
const runtime=runtimeFlag>=0?path.resolve(args[runtimeFlag+1]):project,require=createRequire(path.join(runtime,'package.json'));
const THREE=await import(pathToFileURL(require.resolve('three')));
const {GLTFLoader}=await import(pathToFileURL(require.resolve('three/examples/jsm/loaders/GLTFLoader.js')));
const positions=Buffer.from(new Float32Array([0,0,0,1,0,0,0,1,0]).buffer),paddedImage=Buffer.concat([rgbaPng,Buffer.alloc((4-rgbaPng.length%4)%4)]),binary=Buffer.concat([positions,paddedImage]);
const fixture={asset:{version:'2.0'},extensionsUsed:['EXT_materials_bump'],buffers:[{byteLength:binary.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:positions.length},{buffer:0,byteOffset:positions.length,byteLength:paddedImage.length}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}],images:[{bufferView:1,mimeType:'image/png',name:'real-filter-pixels'}],samplers:[{}, {magFilter:9728,minFilter:9728,wrapS:33071,wrapT:33648}],textures:[{source:0,sampler:0},{source:0,sampler:1}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}},extensions:{EXT_materials_bump:{bumpTexture:{index:1},bumpFactor:.035}}}],meshes:[{primitives:[{attributes:{POSITION:0},material:0}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0};
const json=Buffer.from(JSON.stringify(fixture)),jsonChunk=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]),header=Buffer.alloc(12),jsonHeader=Buffer.alloc(8),binHeader=Buffer.alloc(8);
header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(28+jsonChunk.length+binary.length,8);jsonHeader.writeUInt32LE(jsonChunk.length);jsonHeader.writeUInt32LE(0x4e4f534a,4);binHeader.writeUInt32LE(binary.length);binHeader.writeUInt32LE(0x004e4942,4);
const glb=Buffer.concat([header,jsonHeader,jsonChunk,binHeader,binary]),loader=new GLTFLoader(),decoded=registerNodePngTextures(loader,THREE);
const imported=await loader.parseAsync(glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.byteLength),'');
const material=await imported.parser.getDependency('material',0),texture=await imported.parser.getDependency('texture',1);
test('official GLTFLoader imports real PNG pixels and independent samplers',()=>{
  assert.equal(decoded.images.size,1);assert.equal(decoded.textures.size,2);assert.equal(material.map.isDataTexture,true);assert.equal(texture.isDataTexture,true);
  assert.deepEqual([...texture.image.data],[...rgba]);assert.equal(texture.image.width,3);assert.equal(texture.image.height,5);assert.equal(texture.flipY,false);
  assert.equal(texture.minFilter,THREE.NearestFilter);assert.equal(texture.magFilter,THREE.NearestFilter);assert.equal(texture.wrapS,THREE.ClampToEdgeWrapping);assert.equal(texture.wrapT,THREE.MirroredRepeatWrapping);assert.equal(texture.generateMipmaps,false);
  assert.equal(material.map.wrapS,THREE.RepeatWrapping);assert.equal(material.map.minFilter,THREE.LinearMipmapLinearFilter);
  assert.deepEqual(imported.parser.json,fixture);assert.equal(typeof globalThis.document,'undefined');
});
test('supported EXT_materials_bump retains texture pixels and physical scale',()=>{
  assert.equal(Boolean(imported.parser.plugins?.EXT_materials_bump?.extendMaterialParams),true);
  assert.equal(material.bumpMap.isDataTexture,true);assert.deepEqual([...material.bumpMap.image.data],[...rgba]);assert.equal(material.bumpScale,.035);
});
console.log('Embedded PNG / GLTF import: '+results.length+' checks passed.\n'+results.map(name=>'  ✓ '+name).join('\n'));
