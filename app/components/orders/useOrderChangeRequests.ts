"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminQuery } from "../../features/admin/useAdminQuery";
import { ApiError, approveAdminOrderChangeRequest, rejectAdminOrderChangeRequest, loadOrderChangePage, loadOrderChangeDetail, loadPendingOrderChanges, loadAdminOrder, type OrderChangeRequest, type RuntimeOrder } from "../../api";

export function useOrderChangeRequests(activityId: number, onChanged?: () => void, enabled = true) {
  const [filters,setFilters]=useState({status:"PENDING",type:"ALL",keyword:"",page:1,size:20,newest:false});
  const [busyId,setBusyId]=useState<number|null>(null);
  const [error,setError]=useState("");
  const [selected,setSelected]=useState<OrderChangeRequest|null>(null);
  const [original,setOriginal]=useState<RuntimeOrder|null>(null);
  const [reason,setReason]=useState("");
  const detailGeneration=useRef(0);
  const loader=useCallback(async(_key:string, signal:AbortSignal)=>{
    const [result,ids]=await Promise.all([loadOrderChangePage(activityId,filters,signal),loadPendingOrderChanges(activityId,signal)]);
    return {result,ids};
  },[activityId,filters]);
  const query=useAdminQuery(String(activityId),loader);
  const reload=query.refresh;
  useEffect(()=>{
    if(!enabled)return;
    const start=window.setTimeout(()=>void reload(),250);
    return()=>window.clearTimeout(start);
  },[reload,enabled]);
  useEffect(()=>()=>{detailGeneration.current++;},[activityId]);
  const open=async(id:number)=>{
    const token=++detailGeneration.current;setError("");setReason("");setSelected(null);setOriginal(null);
    try {
      const request=await loadOrderChangeDetail(activityId,id);
      const order=await loadAdminOrder(activityId,request.orderId);
      if(token===detailGeneration.current){setSelected(request);setOriginal(order);}
    }catch(e){if(token===detailGeneration.current)setError(e instanceof ApiError?e.message:"详情加载失败");}
  };
  const review=async(approve:boolean)=>{
    if(!selected || busyId!==null)return;
    if(!approve&&!reason.trim()){setError("请填写驳回原因");return;}
    setBusyId(selected.id);setError("");
    try{
      const result=approve?await approveAdminOrderChangeRequest(activityId,selected.id,reason):await rejectAdminOrderChangeRequest(activityId,selected.id,reason);
      setSelected(result);await reload(true);onChanged?.();
      if(approve&&result.status==="REJECTED")setError(result.reviewReason||"订单已变化，申请已自动驳回");
    }catch(e){setError(e instanceof ApiError?e.message:"审核失败");await reload(true);}
    finally{setBusyId(null);}
  };
  return {requests:query.data?.result.data ?? [],pending:query.data?.ids ?? [],loaded:Boolean(query.data),
    filters,setFilters,total:query.data?.result.page.totalElements ?? 0,loading:query.loading,busyId,
    error:error || query.error,setError,reload,selected,setSelected,original,reason,setReason,open,review};
}
