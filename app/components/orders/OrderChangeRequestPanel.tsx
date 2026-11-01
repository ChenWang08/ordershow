"use client";

import { formatBeijingTime } from "../../features/shared/time";

import { confirmDrawerClose } from "../useDrawerClose";
import type { OrderManagementModel } from "./OrderManagement";

const money=(v?:number)=>v==null?"—":`¥${Number(v).toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const tons=(v?:number)=>`${Number(v ?? 0).toFixed(3)} 吨`;
const date=(v:string)=>formatBeijingTime(v);
const labels={PENDING:"待审核",APPROVED:"已通过",REJECTED:"已驳回"};
export function OrderChangeRequestPanel({model,detailOnly=false}:{model:OrderManagementModel;detailOnly?:boolean}) {
  const r=model.changeRequests;
  const s=r.selected;
  const old=r.original;
  const canLeave = () => confirmDrawerClose(s?.status === "PENDING" && Boolean(r.reason), r.busyId !== null);
  const requestClose = () => { if (canLeave()) { r.setSelected(null); r.setReason(""); } };
  const base=s?.originalOrder || old?.versions.find(v=>v.version===s?.baseVersion);
  const before=base?.items || old?.items || [];
  const ids=new Set([...before.map(i=>i.productId),...(s?.items||[]).map(i=>i.productId)]);
  const pages=Math.max(1,Math.ceil(r.total/r.filters.size));
  return <>
    {!detailOnly&&<section className="review-workbench">
      <h2>订单变更审核</h2><p>查看商品变更后逐条审核，审核通过后更新正式订单。</p>
      <div className="review-filters">
        <select aria-label="申请状态" value={r.filters.status} onChange={e=>r.setFilters({...r.filters,status:e.target.value,page:1})}>{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}<option value="ALL">全部状态</option></select>
        <select aria-label="申请类型" value={r.filters.type} onChange={e=>r.setFilters({...r.filters,type:e.target.value,page:1})}><option value="ALL">全部类型</option><option value="MODIFY">修改订单</option><option value="WITHDRAW">撤回订单</option></select>
        <input aria-label="搜索申请" placeholder="搜索订单号、经销商或电话" value={r.filters.keyword} onChange={e=>r.setFilters({...r.filters,keyword:e.target.value,page:1})}/>
        <select aria-label="申请时间排序" value={String(r.filters.newest)} onChange={e=>r.setFilters({...r.filters,newest:e.target.value==="true",page:1})}><option value="false">最早申请优先</option><option value="true">最新申请优先</option></select>
        <button onClick={()=>void r.reload()} disabled={r.loading}>刷新审核</button>
      </div>
      {r.error&&<p role="alert" className="verify-error">{r.error}</p>}
      <div className="review-table-scroll"><table className="review-table"><thead><tr>{["申请时间","订单 / 经销商","类型 / 版本","当前金额","申请金额","种类 / 箱数 / 吨数","状态","操作"].map(t=><th key={t}>{t}</th>)}</tr></thead><tbody>
        {r.requests.map(q=><tr key={q.id}><td>{date(q.requestedAt)}</td><td><button className="review-link" onClick={()=>void r.open(q.id)}>{q.orderNo}</button><div>{q.dealerName}</div><small>{q.phone}</small></td><td>{q.requestType==="WITHDRAW"?"撤回订单":"修改订单"}<small>基于 V{q.baseVersion} · 当前 V{q.currentVersion}</small></td><td>{money(q.currentTotalAmount)}</td><td>{q.requestType==="WITHDRAW"?"撤回全部":money(q.requestedTotalAmount)}</td><td>{q.requestType==="WITHDRAW"?"—":<>{q.itemCount} 种 · {q.requestedTotalQuantity} 箱<small>{tons(q.requestedTotalTons)}</small></>}</td><td>{labels[q.status]}</td><td><button onClick={()=>void r.open(q.id)}>查看{q.status==="PENDING"?"并审核":"详情"}</button></td></tr>)}
        {!r.requests.length&&<tr><td colSpan={8}>{r.loading?"正在加载…":"暂无符合条件的申请"}</td></tr>}
      </tbody></table></div>
      <div className="order-pagination"><span>共 {r.total} 条 · 第 {r.filters.page} / {pages} 页</span><div><select aria-label="每页数量" value={r.filters.size} onChange={e=>r.setFilters({...r.filters,size:Number(e.target.value),page:1})}><option value={20}>20 条/页</option><option value={50}>50 条/页</option></select><button disabled={r.filters.page<=1||r.loading} onClick={()=>r.setFilters({...r.filters,page:r.filters.page-1})}>上一页</button><button disabled={r.filters.page>=pages||r.loading} onClick={()=>r.setFilters({...r.filters,page:r.filters.page+1})}>下一页</button></div></div>
    </section>}
    {s&&old&&<div className="drawer-backdrop"><aside className="review-drawer" role="dialog" aria-modal="true" aria-label="变更申请详情" onClick={e=>e.stopPropagation()}>
      <header><div><h2>{s.requestType==="WITHDRAW"?"撤回订单申请":"修改订单申请"} · {labels[s.status]}</h2><p>{s.orderNo} · {s.dealerName}</p></div><button disabled={r.busyId!==null} onClick={requestClose}>关闭</button></header>
      <div className="review-drawer-body"><p>申请时间：{date(s.requestedAt)} · 基于 V{s.baseVersion} · 当前 V{old.currentVersion}</p>
        <p>当前订单：{({SUBMITTED:"已提交",WITHDRAWN:"已撤回",VOIDED:"已作废"})[old.status]} · {money(old.totalAmount)} · {old.totalQuantity} 箱 · {tons(old.totalTons)}</p>
        <p>申请前 V{s.baseVersion}：{money(base?.totalAmount??old.totalAmount)} → {s.requestType==="WITHDRAW"?"撤回订单":money(s.requestedTotalAmount)}</p>
        <p>申请说明：{s.customerNote||"未填写"}</p>
        <div className="review-table-scroll"><table className="review-table"><thead><tr>{["商品 / 项目组","原数量","申请数量","变化","单价（原 → 申请）","小计（原 → 申请）","申请吨数"].map(t=><th key={t}>{t}</th>)}</tr></thead><tbody>{[...ids].map(id=>{const a=before.find(i=>i.productId===id);const b=s.items.find(i=>i.productId===id);const delta=(b?.quantity||0)-(a?.quantity||0);return <tr key={id}><td>{b?.materialName||a?.materialName}<small>{b?.productLine||a?.productLine||"未分类"}</small></td><td>{a?.quantity||0}</td><td>{b?.quantity||0}</td><td>{!a?"新增":!b?"删除":delta===0?"不变":delta>0?`+${delta}`:delta}</td><td>{money(a?.casePrice)} → {money(b?.casePrice)}</td><td>{money(a?.lineAmount)} → {money(b?.lineAmount)}</td><td>{b?tons(b.lineTons):"—"}</td></tr>;})}</tbody></table></div>
        <p>申请合计：{s.requestType==="WITHDRAW"?"撤回全部商品，保留原订单记录":`${s.requestedTotalQuantity} 箱 · ${tons(s.requestedTotalTons)} · ${money(s.requestedTotalAmount)}`}</p>
        {s.status==="PENDING"?<label>审核备注（通过选填，驳回必填）<textarea maxLength={500} value={r.reason} onChange={e=>r.setReason(e.target.value)}/></label>:<p>处理人：{s.reviewedByName||"系统"} · {s.reviewedAt?date(s.reviewedAt):""}<br/>处理说明：{s.reviewReason||"审核通过"}</p>}
        {r.error&&<p role="alert" className="verify-error">{r.error}</p>}
      </div>
      <footer><button disabled={r.busyId!==null} onClick={async()=>{if(!canLeave())return;if(await model.openOrderById(s.orderId)){r.setSelected(null);r.setReason("");}else r.setError("原订单加载失败，请重试");}}>查看完整原订单</button>{s.status==="PENDING"&&<><button disabled={r.busyId!==null} onClick={()=>void r.review(false)}>驳回</button><button className="admin-primary" disabled={r.busyId!==null} onClick={()=>void r.review(true)}>审核通过</button></>}</footer>
    </aside></div>}
  </>;
}
