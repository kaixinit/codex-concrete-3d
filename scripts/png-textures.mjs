import {inflateSync} from 'node:zlib';

const SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
const CRC_TABLE=Uint32Array.from({length:256},(_,value)=>{for(let i=0;i<8;i++)value=(value&1)?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
export function pngCrc32(bytes){let value=0xffffffff;for(const byte of bytes)value=CRC_TABLE[(value^byte)&255]^(value>>>8);return(value^0xffffffff)>>>0;}
const paeth=(a,b,c)=>{const p=a+b-c,da=Math.abs(p-a),db=Math.abs(p-b),dc=Math.abs(p-c);return da<=db&&da<=dc?a:db<=dc?b:c;};

// Decode actual PNG pixels, including all five row filters. Packed grayscale /
// palette samples and 16-bit channels are converted to RGBA8, as for a canvas.
// Adam7 is deliberately rejected rather than returning invented image data.
export function decodePng(bytes,{maxPixels=16777216,allowBufferViewPadding=false}={}){
  const buffer=Buffer.from(bytes);if(buffer.length<33||!buffer.subarray(0,8).equals(SIGNATURE))throw Error('Invalid PNG signature');
  let offset=8,header,palette,transparency,ended=false;const idat=[];
  while(offset+12<=buffer.length){
    const length=buffer.readUInt32BE(offset),end=offset+12+length;if(end>buffer.length)throw Error('Truncated PNG chunk');
    const type=buffer.toString('ascii',offset+4,offset+8),data=buffer.subarray(offset+8,offset+8+length);
    if(pngCrc32(buffer.subarray(offset+4,offset+8+length))!==buffer.readUInt32BE(offset+8+length))throw Error('PNG CRC mismatch: '+type);
    if(!header&&type!=='IHDR')throw Error('PNG IHDR must be first');
    if(type==='IHDR'){
      if(header||length!==13)throw Error('Invalid PNG IHDR');
      const width=data.readUInt32BE(0),height=data.readUInt32BE(4),bitDepth=data[8],colorType=data[9],channels={0:1,2:3,3:1,4:2,6:4}[colorType];
      if(!width||!height||width*height>maxPixels)throw Error('PNG dimensions exceed decode limit');
      const depths=colorType===3?[1,2,4,8]:colorType===0?[1,2,4,8,16]:[8,16];
      if(!channels||!depths.includes(bitDepth)||data[10]!==0||data[11]!==0)throw Error('Unsupported PNG format');
      if(data[12]!==0)throw Error('Adam7 PNG is not supported by the Node verification decoder');
      header={width,height,bitDepth,colorType,channels};
    }else if(type==='PLTE'){if(!length||length%3||length>768)throw Error('Invalid PNG palette');palette=Buffer.from(data);}
    else if(type==='tRNS')transparency=Buffer.from(data);
    else if(type==='IDAT')idat.push(data);
    else if(type==='IEND'){if(length)throw Error('Invalid PNG IEND');ended=true;offset=end;break;}
    else if(type.charCodeAt(0)>=65&&type.charCodeAt(0)<=90)throw Error('Unsupported critical PNG chunk: '+type);
    offset=end;
  }
  if(!ended||!idat.length)throw Error('Incomplete PNG');
  // GLTFExporter aligns embedded image bufferViews to four bytes. Accept only
  // that container padding; ordinary PNG inputs retain strict IEND validation.
  const padding=buffer.subarray(offset);
  if(padding.length&&(!allowBufferViewPadding||padding.length>3||padding.some(value=>value!==0)||buffer.length%4!==0))throw Error('Unexpected data after PNG IEND');
  const{width,height,bitDepth,colorType,channels}=header;
  if(colorType===3&&!palette)throw Error('Indexed PNG has no palette');
  if(transparency&&((colorType===0&&transparency.length!==2)||(colorType===2&&transparency.length!==6)||(colorType===3&&transparency.length>palette.length/3)||colorType===4||colorType===6))throw Error('Invalid PNG transparency');
  const stride=Math.ceil(width*channels*bitDepth/8),bpp=Math.max(1,Math.ceil(channels*bitDepth/8)),expected=height*(stride+1);
  const filtered=inflateSync(Buffer.concat(idat),{maxOutputLength:expected});if(filtered.length!==expected)throw Error('PNG scanline size mismatch');
  const raw=Buffer.alloc(height*stride),filters=new Set();
  for(let y=0;y<height;y++){
    const input=y*(stride+1),base=y*stride,filter=filtered[input];if(filter>4)throw Error('Invalid PNG row filter');filters.add(filter);
    for(let x=0;x<stride;x++){
      const left=x>=bpp?raw[base+x-bpp]:0,up=y?raw[base-stride+x]:0,upperLeft=y&&x>=bpp?raw[base-stride+x-bpp]:0;
      const predictor=filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):paeth(left,up,upperLeft);
      raw[base+x]=(filtered[input+1+x]+predictor)&255;
    }
  }
  const data=new Uint8Array(width*height*4),maximum=2**bitDepth-1,toByte=value=>Math.round(value*255/maximum);
  const sample=(row,index)=>{const bit=index*bitDepth,byte=row+Math.floor(bit/8);return bitDepth===16?raw.readUInt16BE(byte):bitDepth===8?raw[byte]:(raw[byte]>>>(8-bitDepth-bit%8))&maximum;};
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const row=y*stride,i=x*channels,p=(y*width+x)*4,first=sample(row,i);
    if(colorType===3){if(first*3+2>=palette.length)throw Error('PNG palette index out of range');data[p]=palette[first*3];data[p+1]=palette[first*3+1];data[p+2]=palette[first*3+2];data[p+3]=transparency?.[first]??255;}
    else if(colorType===0||colorType===4){data[p]=data[p+1]=data[p+2]=toByte(first);data[p+3]=colorType===4?toByte(sample(row,i+1)):transparency&&first===transparency.readUInt16BE(0)?0:255;}
    else{const green=sample(row,i+1),blue=sample(row,i+2);data[p]=toByte(first);data[p+1]=toByte(green);data[p+2]=toByte(blue);data[p+3]=colorType===6?toByte(sample(row,i+3)):transparency&&first===transparency.readUInt16BE(0)&&green===transparency.readUInt16BE(2)&&blue===transparency.readUInt16BE(4)?0:255;}
  }
  return{width,height,data,bitDepth,colorType,filters:[...filters],paddingBytes:padding.length};
}

const FILTERS={9728:'NearestFilter',9729:'LinearFilter',9984:'NearestMipmapNearestFilter',9985:'LinearMipmapNearestFilter',9986:'NearestMipmapLinearFilter',9987:'LinearMipmapLinearFilter'};
const WRAPS={33071:'ClampToEdgeWrapping',33648:'MirroredRepeatWrapping',10497:'RepeatWrapping'};
export function registerNodePngTextures(loader,THREE){
  const textures=new Map(),images=new Map();
  loader.register(parser=>({name:'NODE_embedded_png_pixels',loadTexture(index){
    const definition=parser.json.textures?.[index],source=definition?.source,image=parser.json.images?.[source];
    if(!definition||!image)throw Error('Texture '+index+' has no standard PNG source');
    if(image.mimeType&&image.mimeType!=='image/png')throw Error('Unsupported embedded texture MIME: '+image.mimeType);
    if(!images.has(source))images.set(source,(async()=>{
      let bytes;if(image.bufferView!==undefined)bytes=await parser.getDependency('bufferView',image.bufferView);
      else if(/^data:image\/png;base64,/i.test(image.uri||''))bytes=Buffer.from(image.uri.slice(image.uri.indexOf(',')+1),'base64');
      else throw Error('Texture '+index+' must contain an embedded PNG');
      return decodePng(bytes,{allowBufferViewPadding:image.bufferView!==undefined});
    })());
    return images.get(source).then(decoded=>{
      const texture=new THREE.DataTexture(decoded.data,decoded.width,decoded.height,THREE.RGBAFormat,THREE.UnsignedByteType),sampler=parser.json.samplers?.[definition.sampler]||{};
      texture.name=definition.name||image.name||'embedded-png-'+source;texture.flipY=false;
      texture.magFilter=THREE[FILTERS[sampler.magFilter]||'LinearFilter'];texture.minFilter=THREE[FILTERS[sampler.minFilter]||'LinearMipmapLinearFilter'];
      texture.wrapS=THREE[WRAPS[sampler.wrapS]||'RepeatWrapping'];texture.wrapT=THREE[WRAPS[sampler.wrapT]||'RepeatWrapping'];
      texture.generateMipmaps=!['NearestFilter','LinearFilter'].includes(FILTERS[sampler.minFilter]);texture.needsUpdate=true;
      texture.userData={...definition.extras,mimeType:'image/png',sourceIndex:source};parser.associations.set(texture,{textures:index});textures.set(index,texture);return texture;
    });
  }}));
  return{textures,images};
}
