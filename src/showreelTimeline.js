// Sample the real business clock. Export FPS is independent of live rendering speed.
export const FILM_FPS=30;
export const SHOT_SECONDS=4;
export const FILM_SHOTS=[
  {title:'厂家 → 搅拌站',caption:'原材料运输到站 · 同一辆自卸车沿站外道路进场',scenario:'sand',from:8,to:18,view:'regional',rail:0,camera:[22,112,155],target:[-23,0,38]},
  {title:'砂石卸料入仓',caption:'自卸车倒车对位 · 举升车厢 · 砂料进入指定堆料仓',scenario:'sand',from:47,to:58.8,view:'materials',rail:0,camera:[-42,14,27],target:[-23.4,2,-1]},
  {title:'装载机铲取砂料',caption:'接近料堆 · 铲取 · 收斗 · 倒车退出',scenario:'sand',from:89,to:98,view:'materials',rail:1,camera:[-39,12,14],target:[-23.4,2,-3]},
  {title:'装载机上料',caption:'携料转运 · 举臂卸斗 · 自动配料仓接料',scenario:'sand',from:98,to:113,view:'materials',rail:1,camera:[-29,13,23],target:[-16.6,2.4,1.4]},
  {title:'水泥气力入罐',caption:'散装罐车接管 · 气力输送 · 水泥进入 C01 筒仓',scenario:'cement',from:47.2,to:57,view:'materials',rail:0,camera:[-21,19,-35],target:[2,7,-11]},
  {title:'粉煤灰气力入罐',caption:'指定仓位 · 气力卸料 · 粉煤灰进入 F01 筒仓',scenario:'flyash',from:47.2,to:57,view:'materials',rail:0,camera:[-13,19,-35],target:[10,7,-11]},
  {title:'中控试配与确认',caption:'操作员配合比设定 · 模拟试配 · 配方确认',scenario:'delivery',from:0,to:21.8,view:'control',cutaway:true,rail:2,camera:[19,8.2,32],target:[9,4.3,19.65]},
  {title:'自动配料与搅拌',caption:'仓底下料 → 皮带输送 → 粉料计量 → 双轴搅拌',scenario:'delivery',from:22,to:31.8,view:'detail',cutaway:true,rail:2,camera:[26,19,25],target:[7,7,1.5]},
  {title:'搅拌车装料',caption:'主楼装车口接料 · MC012 车载方量逐步增加',scenario:'delivery',from:32,to:40.9,view:'delivery',rail:2,camera:[25,10,24],target:[10.3,3,3]},
  {title:'站外配送到工地',caption:'MC012 沿站外运输路线行驶 · 镜头跟随同一辆搅拌车',scenario:'delivery',from:49,to:66.8,view:'regional',rail:3,follow:'vehicle',camera:[18,14,23],target:[0,2,0]},
  {title:'泵送浇筑与交付',caption:'搅拌车溜槽对接 · 泵车输送 · 工地浇筑后确认交付',scenario:'delivery',from:73,to:90.8,view:'site',rail:4,camera:[77,28,67],target:[110,7,106]},
  {title:'空车返站',caption:'完成工地交付 · MC012 沿返程道路回到搅拌站',scenario:'delivery',from:91,to:108.8,view:'regional',rail:5,follow:'vehicle',camera:[18,14,23],target:[0,2,0]},
  {title:'返站洗车 · 配送闭环',caption:'空车返站 · 进入洗车区 · 喷淋清洗后待命',scenario:'delivery',from:109,to:115.9,view:'wash',rail:5,follow:'vehicle',camera:[16,11,19],target:[0,2.2,0]},
];
export const FILM_FRAMES=FILM_SHOTS.length*SHOT_SECONDS*FILM_FPS;
export const FILM_SECONDS=FILM_FRAMES/FILM_FPS;
export function filmSample(frame){
  const bounded=Math.max(0,Math.min(FILM_FRAMES-1,Math.floor(frame)));
  const framesPerShot=SHOT_SECONDS*FILM_FPS,index=Math.floor(bounded/framesPerShot),local=bounded%framesPerShot;
  const shot=FILM_SHOTS[index],progress=local/(framesPerShot-1);
  return{shot,index,progress,time:shot.from+(shot.to-shot.from)*progress};
}
export function makeIvfHeader(width,height,frameCount,fps=FILM_FPS){
  const bytes=new Uint8Array(32),v=new DataView(bytes.buffer);
  bytes.set([68,75,73,70]);v.setUint16(6,32,true);bytes.set([86,80,56,48],8);
  v.setUint16(12,width,true);v.setUint16(14,height,true);v.setUint32(16,fps,true);v.setUint32(20,1,true);v.setUint32(24,frameCount,true);
  return bytes;
}
