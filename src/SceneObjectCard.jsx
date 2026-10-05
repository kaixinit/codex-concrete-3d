import {useEffect,useState} from 'react';

const TASK_FIELDS=new Set(['关联任务','当前任务','本趟任务','示例任务']);
const SOURCE_FIELDS=new Set(['数据来源','结果来源','计量来源','签收来源','位置来源','库存来源']);
const PRIORITY=['当前车载','本车核算净重','净重','当前库存','示例库存','本次入库','本次供料','当前供料','本趟签收','取料仓位','目的仓位 / 工地','物料 / 产品','毛重','皮重','示例配方','配方确认','异常确认'];

// This card reads the same selected-object detail as the business panel. Opening,
// folding or locating it never performs a receipt, approval or delivery action.
export function objectCardData(detail={},workflow={}){
  const fields=Array.isArray(detail.fields)?detail.fields:[],snapshot=detail.source==='snapshot';
  const explicitTask=fields.find(([key])=>key===(snapshot?'示例任务':'关联任务'))||(!snapshot&&fields.find(([key])=>TASK_FIELDS.has(key)));
  const task=snapshot?(explicitTask?.[1]||'未关联当前模拟任务'):(explicitTask?.[1]||detail.task||workflow.task||'当前模拟任务');
  const candidates=fields.filter(([key])=>!TASK_FIELDS.has(key)&&!SOURCE_FIELDS.has(key)&&key!=='当前车辆状态'&&key!=='当前流程');
  const ranked=candidates.map((field,index)=>({field,index,rank:PRIORITY.includes(field[0])?PRIORITY.indexOf(field[0]):PRIORITY.length+index}));
  ranked.sort((a,b)=>a.rank-b.rank);
  return {snapshot,task,fields:ranked.slice(0,3).map(item=>item.field),sourceLabel:snapshot?'静态示例快照':'模拟任务联动'};
}

export default function SceneObjectCard({detail,workflow,selectedId,onClose,onFocus,onAction}){
  const [collapsed,setCollapsed]=useState(false);
  useEffect(()=>setCollapsed(false),[selectedId]);
  const data=objectCardData(detail,workflow),action=detail?.nextAction;
  return <section className={'v6-object-card'+(collapsed?' is-collapsed':'')} aria-label="现场对象信息" data-scene-context-card data-source={data.snapshot?'snapshot':'workflow'}>
    <div className="v6-object-card-heading">
      <button type="button" className="v6-object-card-toggle" aria-expanded={!collapsed} aria-controls="v6-object-card-content" onClick={()=>setCollapsed(value=>!value)}>
        <span>{detail?.type||'选中对象'}</span><strong>{detail?.title||selectedId}</strong><i aria-hidden="true">{collapsed?'＋':'−'}</i>
      </button>
      <button type="button" className="v6-object-card-close" aria-label="关闭现场对象卡" onClick={onClose}>×</button>
    </div>
    {!collapsed&&<div id="v6-object-card-content" className="v6-object-card-content">
      <div className="v6-object-card-state"><strong>{detail?.status||'流程示意'}</strong><span className={data.snapshot?'is-snapshot':''}>{data.sourceLabel}</span></div>
      <p className="v6-object-card-task"><span>{data.snapshot?'示例任务':'当前任务'}</span><strong>{data.task}</strong></p>
      <dl>{data.fields.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <div className="v6-object-card-actions">
        <button type="button" disabled={data.snapshot||selectedId?.startsWith('location-')} onClick={()=>onFocus?.(selectedId)}>定位对象</button>
        {action&&<button type="button" onClick={()=>onAction?.(action)}>{action.label}</button>}
      </div>
      <small className="v6-object-card-source">{data.snapshot?'快照不代表当前位置或现场读数':'流程模拟 · 尚未接入现场传感器'}</small>
    </div>}
  </section>;
}
