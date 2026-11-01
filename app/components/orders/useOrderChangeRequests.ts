"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLazyAdminQuery } from "../../features/admin/useLazyAdminQuery";
import { ApiError, approveAdminOrderChangeRequest, rejectAdminOrderChangeRequest, loadOrderChangePage, loadOrderChangeDetail, loadPendingOrderChanges, loadAdminOrder, type OrderChangeRequest, type RuntimeOrder } from "../../api";

export function useOrderChangeRequests(activityId: number, onChanged?: () => void, enabled = true, revision = 0) {
  const [filters,setFilters]=useState({status:"PENDING",type:"ALL",keyword:"",page:1,size:20,newest:false});
  const [busyId,setBusyId]=useState<number|null>(null);
  const [error,setError]=useState("");
  const [selected,setSelected]=useState<OrderChangeRequest|null>(null);
  const [original,setOriginal]=useState<RuntimeOrder|null>(null);
  const [reason,setReason]=useState("");
  const detailGeneration=useRef(0);
  const detailController=useRef<AbortController|null>(null);
  const loader=useCallback(async(signal:AbortSignal)=>{
    const [result,ids]=await Promise.all([loadOrderChangePage(activityId,filters,signal),loadPendingOrderChanges(activityId,signal)]);
    return {result,ids};
  },[activityId,filters]);
  const query=useLazyAdminQuery(JSON.stringify([activityId,filters,revision]),enabled,loader);
  const reload=query.refresh;
  useEffect(()=>()=>{detailGeneration.current++;detailController.current?.abort();},[activityId,enabled]);
  const open=async(id:number)=>{
    const token=++detailGeneration.current;setError("");setReason("");setSelected(null);setOriginal(null);
    detailController.current?.abort();
    const controller=new AbortController();detailController.current=controller;
    try {
      const request=await loadOrderChangeDetail(activityId,id,controller.signal);
      if(token!==detailGeneration.current)return;
      const order=await loadAdminOrder(activityId,request.orderId,controller.signal);
      if(token===detailGeneration.current){setSelected(request);setOriginal(order);}
    }catch(e){if(token===detailGeneration.current)setError(e instanceof ApiError?e.message:"详情加载失败");}
  };
  const review=async(approve:boolean)=>{
    if(!selected || busyId!==null)return;
    if(!approve&&!reason.trim()){setError("请填写驳回原因");return;}
    setBusyId(selected.id);setError("");
    try{
      const result=approve?await approveAdminOrderChangeRequest(activityId,selected.id,reason):await rejectAdminOrderChangeRequest(activityId,selected.id,reason);
      setSelected(result);query.invalidate();await reload();onChanged?.();
      if(approve&&result.status==="REJECTED")setError(result.reviewReason||"订单已变化，申请已自动驳回");
    }catch(e){setError(e instanceof ApiError?e.message:"审核失败");query.invalidate();await reload();}
    finally{setBusyId(null);}
  };
  return {requests:query.data?.result.data ?? [],pending:query.data?.ids ?? [],loaded:Boolean(query.data),
    filters,setFilters,total:query.data?.result.page.totalElements ?? 0,loading:query.loading,busyId,
    error:error || query.error,setError,reload,selected,setSelected,original,reason,setReason,open,review};
}
