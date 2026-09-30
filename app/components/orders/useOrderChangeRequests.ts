"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, approveAdminOrderChangeRequest, rejectAdminOrderChangeRequest, loadOrderChangePage, loadOrderChangeDetail, loadPendingOrderChanges, loadAdminOrder, type OrderChangeRequest, type RuntimeOrder } from "../../api";

export function useOrderChangeRequests(activityId: number, onChanged?: () => void) {
  const [requests,setRequests]=useState<OrderChangeRequest[]>([]);
  const [pending,setPending]=useState<Array<{id:number;orderId:number}>>([]);
  const [filters,setFilters]=useState({status:"PENDING",type:"ALL",keyword:"",page:1,size:20,newest:false});
  const [total,setTotal]=useState(0);
  const [loading,setLoading]=useState(false);
  const [busyId,setBusyId]=useState<number|null>(null);
  const [error,setError]=useState("");
  const [selected,setSelected]=useState<OrderChangeRequest|null>(null);
  const [original,setOriginal]=useState<RuntimeOrder|null>(null);
  const [reason,setReason]=useState("");
  const generation=useRef(0);
  const detailGeneration=useRef(0);
  const reload=useCallback(async()=>{
    const token=++generation.current;
    setLoading(true);
    try {
      const [result,ids]=await Promise.all([loadOrderChangePage(activityId,filters),loadPendingOrderChanges(activityId)]);
      if(token!==generation.current)return;
      setRequests(result.data);setTotal(result.page.totalElements);setPending(ids);
    } catch(e) {if(token===generation.current)setError(e instanceof ApiError?e.message:"申请加载失败");}
    finally {if(token===generation.current)setLoading(false);}
  },[activityId,filters]);
  useEffect(()=>{
    const sequence = generation;
    const start=window.setTimeout(()=>void reload(),250);
    const timer=window.setInterval(()=>void reload(),15000);
    return()=>{sequence.current++;window.clearTimeout(start);window.clearInterval(timer);};
  },[reload]);
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
      setSelected(result);await reload();onChanged?.();
      if(approve&&result.status==="REJECTED")setError(result.reviewReason||"订单已变化，申请已自动驳回");
    }catch(e){setError(e instanceof ApiError?e.message:"审核失败");await reload();}
    finally{setBusyId(null);}
  };
  return {requests,pending,filters,setFilters,total,loading,busyId,error,setError,reload,selected,setSelected,original,reason,setReason,open,review};
}
