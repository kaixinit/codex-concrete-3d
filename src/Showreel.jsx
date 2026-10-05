import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useFrame} from '@react-three/fiber';
import * as THREE from 'three';
import PlantScene from './PlantScene.jsx';
import {getWorkflowState} from './workflow.js';
import {FILM_FPS,FILM_SHOTS,FILM_FRAMES,FILM_SECONDS,SHOT_SECONDS,filmSample,makeIvfHeader} from './showreelTimeline.js';
import './showreel.css';

const W=1280,H=720,HEADER=80,SCENE_HEIGHT=560;
const RAIL=['原料入库','装载与供料','生产装车','站外配送','工地交付','返站洗车'];
const FONT='"Microsoft YaHei","Noto Sans SC",sans-serif';
function drawComposite(canvas,source,sample,frame){
  if(!canvas)return;
  const ctx=canvas.getContext('2d'),{shot,index}=sample;
  ctx.fillStyle='#edf1f2';ctx.fillRect(0,0,W,H);
  ctx.drawImage(source,0,HEADER,W,SCENE_HEIGHT);
  ctx.fillStyle='#fff';ctx.fillRect(0,0,W,HEADER);ctx.fillRect(0,H-80,W,80);
  ctx.fillStyle='#2975e6';ctx.fillRect(24,23,4,34);
  ctx.font=`bold 26px ${FONT}`;ctx.fillStyle='#163d57';ctx.fillText(shot.title,43,49);
  ctx.font=`15px ${FONT}`;ctx.fillStyle='#617c8d';ctx.textAlign='right';ctx.fillText('CODEX  ·  CONCRETE OPERATIONS 3D',W-26,35);
  ctx.font=`13px ${FONT}`;ctx.fillText(`${String(index+1).padStart(2,'0')} / ${FILM_SHOTS.length}     ${Math.floor(frame/FILM_FPS)}s / ${FILM_FRAMES/FILM_FPS}s`,W-26,59);ctx.textAlign='left';
  ctx.font=`17px ${FONT}`;ctx.fillStyle='#274e68';ctx.fillText(shot.caption,26,H-51);
  RAIL.forEach((label,i)=>{const x=26+i*149;ctx.fillStyle=i===shot.rail?'#2975e6':'#93a5af';ctx.font=`${i===shot.rail?'bold ':''}14px ${FONT}`;ctx.fillText(label,x,H-20);if(i<RAIL.length-1){ctx.fillStyle='#b4c1c8';ctx.fillText('→',x+107,H-20);}});
  ctx.font=`12px ${FONT}`;ctx.fillStyle='#7e939f';ctx.textAlign='right';ctx.fillText('流程模拟 · 业务时间采样',W-24,H-20);ctx.textAlign='left';
  ctx.fillStyle='#2975e6';ctx.fillRect(0,H-2,W*(frame+1)/FILM_FRAMES,2);
}

function FilmRenderer({frame,clockRef,outputRef,sessionRef,onNext,onFinished,onError}){
  const sample=filmSample(frame),state=getWorkflowState(sample.shot.scenario,sample.time);
  const vectors=useMemo(()=>({position:new THREE.Vector3(),target:new THREE.Vector3(),offset:new THREE.Vector3()}),[]);
  const last=useRef(-1),settle=useRef(0),lastShot=useRef(-1),lastSession=useRef(null);
  useFrame(()=>{clockRef.current={time:sample.time,scenarioId:sample.shot.scenario,paused:false,speed:1};},-5);
  useFrame(({camera,controls})=>{
    const shot=sample.shot,anchor=shot.follow==='vehicle'?state.vehiclePosition:[0,0,0];
    vectors.position.set(...shot.camera).add(vectors.offset.set(...anchor));
    vectors.target.set(...shot.target).add(vectors.offset.set(...anchor));
    // A gentle, deterministic dolly. Cuts use the next shot's own composition.
    vectors.position.sub(vectors.target).multiplyScalar(1-.045*sample.progress).add(vectors.target);
    camera.position.copy(vectors.position);camera.fov=37;camera.lookAt(vectors.target);camera.updateProjectionMatrix();camera.updateMatrixWorld();
    if(controls){controls.target.copy(vectors.target);controls.enabled=false;}
  },-.1);
  useFrame(({gl,scene,camera})=>{
    gl.render(scene,camera);
    drawComposite(outputRef.current,gl.domElement,sample,frame);
    const session=sessionRef.current;
    if(lastSession.current!==session){lastSession.current=session;last.current=-1;lastShot.current=-1;}
    if(!session||session.finishing||last.current===frame)return;
    if(lastShot.current!==sample.index){lastShot.current=sample.index;settle.current=4;}
    if(settle.current-->0||session.encoder.encodeQueueSize>4)return;
    try{
      const videoFrame=new VideoFrame(outputRef.current,{timestamp:Math.round(frame*1e6/FILM_FPS),duration:Math.round(1e6/FILM_FPS)});
      session.encoder.encode(videoFrame,{keyFrame:frame%(SHOT_SECONDS*FILM_FPS)===0});videoFrame.close();last.current=frame;
      if(frame+1<FILM_FRAMES)onNext(frame+1);else{session.finishing=true;onFinished(session);}
    }catch(error){session.finishing=true;onError(error);}
  },1);
  return null;
}

export default function Showreel(){
  const [frame,setFrame]=useState(0),[running,setRunning]=useState(false),[status,setStatus]=useState(`选择分镜预览，或导出完整 ${FILM_SECONDS} 秒动画。`),[download,setDownload]=useState('');
  const clockRef=useRef({time:8,scenarioId:'sand',paused:false,speed:1}),outputRef=useRef(),sessionRef=useRef(),busyRef=useRef(false);
  const sample=filmSample(frame),workflow=getWorkflowState(sample.shot.scenario,sample.time);
  const failed=useCallback(error=>{const encoder=sessionRef.current?.encoder;if(encoder&&encoder.state!=='closed')encoder.close();sessionRef.current=null;busyRef.current=false;setRunning(false);setStatus(`导出失败：${error.message}`);},[]);
  const finish=useCallback(async session=>{
    try{
      await session.encoder.flush();session.encoder.close();
      if(session.parts.length!==FILM_FRAMES*2)throw new Error('编码帧数不完整，请重新导出。');
      const blob=new Blob([makeIvfHeader(W,H,FILM_FRAMES),...session.parts],{type:'video/x-ivf'});
      const reader=new FileReader();reader.onload=()=>{setDownload(String(reader.result));setStatus(`完成：${FILM_FRAMES} 帧 · 1280 × 720 · ${FILM_SECONDS} 秒 · ${(blob.size/1048576).toFixed(1)} MB`);};reader.onerror=()=>failed(new Error('动画文件读取失败。'));reader.readAsDataURL(blob);
      sessionRef.current=null;busyRef.current=false;setRunning(false);
    }catch(error){failed(error);}
  },[failed]);
  const start=async()=>{
    if(busyRef.current)return;
    busyRef.current=true;setRunning(true);
    try{
      if(!window.VideoEncoder||!window.VideoFrame)throw new Error('此浏览器未提供 WebCodecs；请使用新版 Chrome / Edge，并通过 localhost 打开。');
      const config={codec:'vp8',width:W,height:H,bitrate:3500000,framerate:FILM_FPS,latencyMode:'quality'};
      if(!(await VideoEncoder.isConfigSupported(config)).supported)throw new Error('浏览器不支持 VP8 编码。');
      const parts=[];
      const encoder=new VideoEncoder({output:chunk=>{const header=new Uint8Array(12),dv=new DataView(header.buffer);dv.setUint32(0,chunk.byteLength,true);dv.setBigUint64(4,BigInt(Math.round(chunk.timestamp*FILM_FPS/1e6)),true);const data=new Uint8Array(chunk.byteLength);chunk.copyTo(data);parts.push(header,data);},error:failed});
      encoder.configure(config);sessionRef.current={encoder,parts,finishing:false};setFrame(0);setDownload('');setRunning(true);setStatus('正在逐帧导出真实 3D 场景，请保持本页开启。');
    }catch(error){failed(error);}
  };
  useEffect(()=>()=>{const encoder=sessionRef.current?.encoder;if(encoder&&encoder.state!=='closed')encoder.close();},[]);
  const stop=()=>{const encoder=sessionRef.current?.encoder;if(encoder&&encoder.state!=='closed')encoder.close();sessionRef.current=null;busyRef.current=false;setRunning(false);setStatus('已停止导出。');};
  return <main className="film-tool">
    <div className="film-stage">
      <div className="film-source"><PlantScene workflow={workflow} view={sample.shot.view} cutaway={!!sample.shot.cutaway} quality="high" selectedId="film-no-selection" showRoutes={sample.shot.view==='regional'} visualClock={clockRef} captureDpr={1} renderController={<FilmRenderer {...{frame,clockRef,outputRef,sessionRef,onNext:setFrame,onFinished:finish,onError:failed}}/>}/></div>
      <canvas ref={outputRef} width={W} height={H} className="film-composite" aria-label="全流程3D动画画面"/>
    </div>
    <div className="film-controls">
      <label>分镜 <select aria-label="分镜预览" disabled={running} value={sample.index} onChange={event=>{setFrame(Number(event.target.value)*SHOT_SECONDS*FILM_FPS+60);}}>{FILM_SHOTS.map((shot,i)=><option value={i} key={shot.title}>{String(i+1).padStart(2,'0')} · {shot.title}</option>)}</select></label>
      <button disabled={running} onClick={start}>导出 {FILM_SECONDS} 秒动画</button>{running&&<button onClick={stop}>停止导出</button>}
      {download&&<a href={download} download="concrete-3d-showreel.ivf">下载动画母版 IVF</a>}
      <a href="?">返回交互作品</a><span role="status">{running?`${status} ${Math.floor((frame+1)/FILM_FRAMES*100)}%`:status}</span>
    </div>
    <p className="film-note">复用本项目 3D 模型与业务状态机，按固定时间采样导出。30 fps 为视频输出规格，现场数据和流程均为模拟；导出速度不代表应用实时帧率。母版可用 FFmpeg 转为 MP4 / GIF。</p>
  </main>;
}
