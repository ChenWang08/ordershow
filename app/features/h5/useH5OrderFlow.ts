"use client";

import { formatBeijingTime } from "../shared/time";

import { createIdempotencyKey } from "../../services/api/idempotency-key";


import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, createH5OrderChangeRequest, loadH5Order, loadH5OrderChangeRequest, loadH5OrderDraft, loadH5Products, saveH5Order, verifyPhone, type OrderChangeRequest, type RuntimeIdentity, type RuntimeOrder, type RuntimeProduct } from "../../api";
import type { WhitelistRow } from "../../domain/import-domain";
import { maskPhone, normalizePhone } from "../shared/utils";
import { useH5CatalogSearch } from "./useH5CatalogSearch";
import { useH5Draft } from "./useH5Draft";
import { h5EntryPolicy } from "./h5-entry-policy";
import { createH5SubmissionManager } from "./h5-submission";
import { productRowToProduct, runtimeProductToProduct, priceBreakdown, groupByProductLine, summarizeOrderLineAmounts, h5QuantitySignature, h5OrderItems, h5RequiresReview, type H5Props, type H5Step, type H5Channel, type H5OrderStatus, type Product, type SubmittedOrderItem } from "./h5-domain";

export function useH5OrderFlow({ activityStatus, importedRows, importedWhitelistRows, runtimeActivity }: H5Props) {
  const activityClosed = activityStatus === "closed" || activityStatus === "finished";
  const activityNotStarted = activityStatus === "draft" || activityStatus === "scheduled";
  const entryPolicy = h5EntryPolicy(runtimeActivity);
  const unspecifiedWhitelist = runtimeActivity?.whitelistCustomerTypeMode === "UNSPECIFIED";
  const directEntry = entryPolicy.mode === "direct";
  const [runtimeProducts, setRuntimeProducts] = useState<RuntimeProduct[] | null>(null);
  const [runtimeIdentity, setRuntimeIdentity] = useState<RuntimeIdentity | null>(null);
  const [runtimeOrder, setRuntimeOrder] = useState<RuntimeOrder | null>(null);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [runtimeMessage, setRuntimeMessage] = useState("");
  const [pendingChangeRequest, setPendingChangeRequest] = useState<OrderChangeRequest | null>(null);
  const [orderNeedsRefresh, setOrderNeedsRefresh] = useState(false);
  const [pendingSubmission, setPendingSubmission] = useState(false);
  const submissionBusy = useRef(false);
  const entryBusy = useRef(false);
  const identityGeneration = useRef(0);
  const changeAttempt = useRef({ signature: "", key: "" });
  const changeKey = (value: unknown) => {
    const signature = JSON.stringify(value);
    if (signature !== changeAttempt.current.signature) changeAttempt.current = { signature, key: createIdempotencyKey() };
    return changeAttempt.current.key;
  };
  const [submission] = useState(() => createH5SubmissionManager({
    storage: () => typeof window === "undefined" ? undefined : window.sessionStorage,
    send: (pending, signal) => saveH5Order(pending.body.expectedVersion, pending.body.items, pending.key, pending.scope.activityCode, pending.scope.customerId, signal, pending.body.expectedLockVersion),
  }));
  const catalog = useMemo(() => runtimeProducts ? runtimeProducts.map(runtimeProductToProduct) : importedRows ? importedRows.map(productRowToProduct) : [], [runtimeProducts, importedRows]);
  const [step, setStep] = useState<H5Step>(() => unspecifiedWhitelist ? "verify" : "channel");
  const [selectedChannel, setChannel] = useState<H5Channel>("");
  const verificationChannel = entryPolicy.channel || selectedChannel;
  const channel: H5Channel = !["channel", "region", "verify"].includes(step) && runtimeIdentity ? (runtimeIdentity.customerType === "GENERAL" ? "综合客户" : runtimeIdentity.customerType === "SPECIAL" ? "特渠专业客户" : "") : verificationChannel;
  const [region, setRegion] = useState("");
  const [verifiedBranch, setVerifiedBranch] = useState("");
  const [verifiedIdentity, setVerifiedIdentity] = useState<WhitelistRow | null>(null);
  const [submittedIdentity, setSubmittedIdentity] = useState<WhitelistRow | null>(null);
  const [phone, setPhone] = useState("");
  const [verifyError, setVerifyError] = useState("");
  const [previewProduct, setPreviewProduct] = useState<Product | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [orderStatus, setOrderStatus] = useState<H5OrderStatus>("none");
  const customerOrderReadOnly = activityClosed || activityNotStarted;
  const [submitMode, setSubmitMode] = useState<"first" | "update" | "restore">("first");
  const [orderVersion, setOrderVersion] = useState(0);
  const [orderUpdatedAt, setOrderUpdatedAt] = useState("");
  const [orderWithdrawnAt, setOrderWithdrawnAt] = useState("");
  const [orderEvents, setOrderEvents] = useState<Array<{ time: string; title: string; detail: string }>>([]);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [submittedQuantities, setSubmittedQuantities] = useState<Record<string, number>>({});
  const [submittedItems, setSubmittedItems] = useState<SubmittedOrderItem[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const entryStep = ["channel", "region", "verify"].includes(step);
  const visibleStep = entryStep && (entryPolicy.mode === "loading" || entryPolicy.mode === "empty") ? entryPolicy.mode
    : directEntry && entryStep ? "verify" : entryStep && entryPolicy.mode === "choose" && !selectedChannel ? "channel" : step;
  const whitelistRegions = runtimeActivity?.regions ?? [];
  const regionOptions = [
    ...whitelistRegions.map((item) => ({ value: item.code, name: item.name, detail: `${item.name}综合经销商` })),
    ...(whitelistRegions.length > 0 && runtimeActivity?.hasUnassignedGeneralCustomers
      ? [{ value: "UNASSIGNED", name: "不分大区", detail: "白名单中未填写大区的综合经销商" }]
      : []),
  ];
  const regionalized = whitelistRegions.length > 0;
  const selectedRegionName = directEntry ? "" : regionOptions.find((item) => item.value === region)?.name || region;
  const h5CustomerType = channel === "综合客户" ? "综合" : "特渠";
  const catalogSearch = useH5CatalogSearch(catalog, h5CustomerType, unspecifiedWhitelist, verifiedBranch,
    JSON.stringify([runtimeActivity?.code, runtimeIdentity?.customerId ?? verifiedIdentity?.id, channel, verifiedBranch]), visibleStep === "order");
  const { lineOptions, hasRebateSplit, visibleProducts, search, setSearch, setLine, setRebateFilter } = catalogSearch;
  const { line, rebate: effectiveRebateFilter } = catalogSearch.selection;
  const selected = catalog.filter((p) => (quantities[p.id] || 0) > 0);
  const selectedOrderItems = selected.map((product) => ({ product, quantity: quantities[product.id] }));
  const visibleProductGroups = groupByProductLine(visibleProducts, (product) => product.line);
  const selectedLineGroups = groupByProductLine(selectedOrderItems, (item) => item.product.line);
  const selectedLineSummaries = summarizeOrderLineAmounts(selectedOrderItems);
  const requiresReview = h5RequiresReview(runtimeOrder, selected.map(product => ({ productId: Number(product.id), quantity: quantities[product.id] })));
  const totalBoxes = selected.reduce((sum, p) => sum + quantities[p.id], 0);
  const totalAmount = selected.reduce((sum, p) => sum + priceBreakdown(p, quantities[p.id]).amount, 0);
  const orderViewQuantities = submittedQuantities;
  const orderViewSelected = submittedItems.map((item) => item.product);
  const orderViewLineGroups = groupByProductLine(submittedItems, (item) => item.product.line);
  const orderViewLineSummaries = summarizeOrderLineAmounts(submittedItems);
  const orderViewBoxes = orderViewSelected.reduce((sum, p) => sum + orderViewQuantities[p.id], 0);
  const orderViewAmount = orderViewSelected.reduce((sum, p) => sum + priceBreakdown(p, orderViewQuantities[p.id]).amount, 0);
  const importedIdentity = verifiedIdentity ?? submittedIdentity;
  const identityRegionCode = runtimeIdentity ? runtimeIdentity.regionCode || "" : importedIdentity ? importedIdentity.region || "" : directEntry ? "" : region;
  const identityRegion = regionOptions.find((item) => item.value === identityRegionCode)?.name || identityRegionCode;
  const identityBranch = runtimeIdentity?.branchName || importedIdentity?.branch || verifiedBranch;
  const identityLabel = entryStep
    ? unspecifiedWhitelist ? "不区分客户类型" : channel === "综合客户" ? `综合客户${selectedRegionName ? ` · ${selectedRegionName}` : ""}` : "特渠专业客户"
    : runtimeIdentity
    ? `${runtimeIdentity.customerType === "GENERAL" ? "综合客户" : runtimeIdentity.customerType === "SPECIAL" ? "特渠专业客户" : "不区分客户类型"}${runtimeIdentity.customerType === "ALL" ? "" : identityRegion ? ` · ${identityRegion}` : ""}`
    : importedIdentity ? `${importedIdentity.customerType || "不区分客户类型"}${importedIdentity.customerType === "" ? "" : identityRegion ? ` · ${identityRegion}` : ""}` : unspecifiedWhitelist ? "不区分客户类型" : channel === "综合客户" ? `综合客户${selectedRegionName ? ` · ${selectedRegionName}` : ""}` : "特渠专业客户";
  const dealerName = runtimeIdentity?.dealerFullName || importedIdentity?.dealerFull || "—";
  const displayBranch = runtimeIdentity?.branchName || identityBranch;
  const displayPhone = runtimeIdentity?.phoneMasked || (importedIdentity ? maskPhone(importedIdentity.dealerPhone) : "—");

  const { setDraftReady, draftMessage, setDraftMessage, draftOwnerIdRef, lastSavedDraftSignatureRef, latestDraftSnapshotRef, draftSaveTimerRef, draftSaveChainRef, queueDraftSync } = useH5Draft({ activityClosed: activityClosed || pendingSubmission || runtimeBusy || pendingChangeRequest?.status === "PENDING", catalog, quantities, runtimeIdentity, runtimeOrder });
  const applyRuntimeOrder = (order: RuntimeOrder | null, liveCatalog: Product[], preserveDraft = false) => {
    setOrderNeedsRefresh(false);
    setRuntimeOrder(order);
    if (!order) {
      if (!preserveDraft) setQuantities({});
      setOrderStatus("none"); setOrderVersion(0); setSubmittedQuantities({}); setSubmittedItems([]); setOrderEvents([]);
      setOrderUpdatedAt(""); setOrderWithdrawnAt(""); setCartOpen(false); setCancelConfirmOpen(false); setPreviewProduct(null);
      return;
    }
    const itemQuantities: Record<string, number> = {};
    const items = order.items.map((item) => {
      const id = String(item.productId);
      itemQuantities[id] = item.quantity;
      const catalogProduct = liveCatalog.find((product) => product.id === id);
      const orderLine = item.productLine?.trim() || catalogProduct?.line || "未分类";
      const snapshot = { price: Number(item.baseCasePrice ?? item.casePrice), tierMinQuantity: item.tierMinQuantity,
        tierCasePrice: item.tierCasePrice == null ? undefined : Number(item.tierCasePrice), tierPricingMode: item.pricingMode };
      const found = catalogProduct ? { ...catalogProduct, line: orderLine, ...snapshot } : {
        id, name: item.materialName, line: orderLine, spec: item.specification || "", ...snapshot,
        rebate: true, gift: false, atlas: 0, customerType: "全部" as const, branchScope: [], status: "有效" as const, isOrderable: true,
      };
      const lineAmount = item.lineAmount == null ? undefined : Number(item.lineAmount);
      return { product: found, quantity: item.quantity, lineAmount: Number.isFinite(lineAmount) ? lineAmount : undefined };
    });
    setQuantities(itemQuantities); setSubmittedQuantities(itemQuantities); setSubmittedItems(items);
    setOrderStatus(order.status === "WITHDRAWN" ? "withdrawn" : order.status === "VOIDED" ? "voided" : "submitted");
    setOrderVersion(order.currentVersion);
    setOrderUpdatedAt(formatBeijingTime(order.lastModifiedAt));
    setOrderWithdrawnAt(order.withdrawnAt ? formatBeijingTime(order.withdrawnAt) : "");
    setOrderEvents(order.operations.map((event) => ({
      time: formatBeijingTime(event.occurredAt, {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      title: event.type === "RESUBMIT" ? "客户重新订货，恢复订单" : event.type === "MODIFY_SUBMIT" ? "客户增加订货" : event.type === "FIRST_SUBMIT" ? "客户首次提交" : event.type === "WITHDRAW" ? "客户撤回订单" : event.type === "SUBMIT" ? "客户首次提交" : event.type === "H5_CHANGE_REQUESTED" ? "客户提交变更申请" : event.type === "H5_CHANGE_APPROVED" ? "管理员审核通过变更" : event.type === "H5_CHANGE_REJECTED" ? "管理员驳回变更" : event.type === "ADMIN_CREATE" ? "管理员创建订单" : event.type === "ADMIN_VOID" ? "管理员作废订单" : event.type === "ADMIN_RESTORE" ? "管理员调整并恢复订单" : event.type === "ADMIN_ADJUST" ? "管理员调整订单" : "客户修改并重新提交",
      detail: `${event.source === "SYSTEM" ? "系统" : event.source === "ADMIN" ? event.adminName || "管理员" : "经销商手机端"} · ${event.orderVersion ? `版本 V${event.orderVersion}` : "订单状态变更"}${event.reason ? ` · ${event.reason}` : ""}`,
    })));
  };

  // Finish old-customer draft writes before verification replaces the session.
  const resetEntry = async (nextChannel: H5Channel = "") => {
    if (entryBusy.current || submissionBusy.current || runtimeBusy) return;
    entryBusy.current = true;
    identityGeneration.current += 1;
    setRuntimeBusy(true);
    setDraftReady(false);
    try {
      if (draftSaveTimerRef.current != null) window.clearTimeout(draftSaveTimerRef.current);
      const snapshot = latestDraftSnapshotRef.current;
      if (snapshot && snapshot.signature !== lastSavedDraftSignatureRef.current) {
        await queueDraftSync(snapshot);
        if (snapshot.signature !== lastSavedDraftSignatureRef.current) {
          setRuntimeMessage("草稿尚未保存，请重试后再切换客户。");
          setDraftReady(!customerOrderReadOnly && pendingChangeRequest?.status !== "PENDING");
          return;
        }
      }
      await draftSaveChainRef.current;
      latestDraftSnapshotRef.current = null;
      draftOwnerIdRef.current = null;
      lastSavedDraftSignatureRef.current = "";
      setRuntimeIdentity(null); setRuntimeProducts(null);
      applyRuntimeOrder(null, []);
      setVerifiedIdentity(null); setSubmittedIdentity(null); setVerifiedBranch("");
      setPhone(""); setVerifyError(""); setRuntimeMessage(""); setDraftMessage("");
      setPendingChangeRequest(null); setPendingSubmission(false); setSubmitMode("first");
      changeAttempt.current = { signature: "", key: "" };
      setChannel(nextChannel); setRegion("");
      setStep(nextChannel === "综合客户" && regionalized ? "region" : nextChannel ? "verify" : "channel");
    } finally {
      entryBusy.current = false;
      setRuntimeBusy(false);
    }
  };

  const changeQty = (id: string, delta: number) => {
    setQuantities((old) => ({ ...old, [id]: Math.min(999999, Math.max(0, (old[id] || 0) + delta)) }));
  };

  useEffect(() => {
    if (!runtimeIdentity || runtimeBusy || pendingSubmission || orderNeedsRefresh || (step !== "submitted" && step !== "success")) return;
    let active = true;
    const generation = identityGeneration.current;
    let loading = false;
    const refresh = async () => {
      if (loading || document.hidden) return;
      loading = true;
      try {
        const request = await loadH5OrderChangeRequest();
        const order = await loadH5Order();
        if (request && order && request.currentVersion !== order.currentVersion) return;
        if (active && generation === identityGeneration.current) {
          setPendingChangeRequest(request?.status === "PENDING" || request?.status === "REJECTED" ? request : null);
          if (request?.status === "APPROVED" || request?.status === "REJECTED") setRuntimeMessage("");
        }
        if (active && generation === identityGeneration.current && order && (order.currentVersion !== runtimeOrder?.currentVersion || order.lockVersion !== runtimeOrder?.lockVersion)) {
          applyRuntimeOrder(order, catalog);
        }
      } catch { /* Preserve the last confirmed order when offline. */ }
      finally { loading = false; }
    };
    const timer = window.setInterval(() => void refresh(), 15000);
    window.addEventListener("focus", refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [runtimeIdentity, runtimeBusy, pendingSubmission, orderNeedsRefresh, step, runtimeOrder, catalog]);

  const startEditingOrder = () => {
    if (customerOrderReadOnly || pendingSubmission) return;
    if (pendingChangeRequest?.requestType === "MODIFY" && ["PENDING", "REJECTED"].includes(pendingChangeRequest.status)) {
      setQuantities(Object.fromEntries(pendingChangeRequest.items.map(item=>[String(item.productId),item.quantity])));
      setRuntimeMessage(""); setStep("order"); return;
    }
    if ((orderStatus === "withdrawn" || orderStatus === "voided") || pendingChangeRequest?.status === "REJECTED") setQuantities({ ...submittedQuantities });
    setStep("order");
  };

  const verifyIdentity = async () => {
    if (entryBusy.current || runtimeBusy || submissionBusy.current) return;
    if (activityNotStarted || entryPolicy.mode === "loading" || entryPolicy.mode === "empty") return;
    const normalizedPhone = normalizePhone(phone);
    if (runtimeActivity) {
      entryBusy.current = true;
      setRuntimeBusy(true); setVerifyError(""); setRuntimeMessage("");
      try {
        if (draftSaveTimerRef.current != null) window.clearTimeout(draftSaveTimerRef.current);
        if (latestDraftSnapshotRef.current) await queueDraftSync(latestDraftSnapshotRef.current, false);
        setDraftReady(false);
        const identity = await verifyPhone(unspecifiedWhitelist ? "ALL" : verificationChannel === "综合客户" ? "GENERAL" : "SPECIAL", directEntry || verificationChannel !== "综合客户" ? "" : region, normalizedPhone);
        let recoveryNeedsRefresh = false;
        setPendingSubmission(false); setOrderNeedsRefresh(false);
        try {
          const recovered = await submission.recover({ activityCode: runtimeActivity.code, customerId: identity.customerId });
          if (recovered) setRuntimeMessage("已确认上次提交成功，正在显示最新订单。");
        } catch (error) {
          setPendingSubmission(true);
          setRuntimeMessage(error instanceof ApiError ? error.message : "上次提交结果待确认，请重试确认。");
          recoveryNeedsRefresh = error instanceof ApiError && ["SUBMISSION_RECOVERY_EXPIRED", "IDEMPOTENCY_RESULT_UNAVAILABLE", "ORDER_VERSION_CONFLICT"].includes(error.code);
        }
        const preserveDraft = runtimeIdentity?.activityId === identity.activityId
          && runtimeIdentity.customerId === identity.customerId;
        const liveRows = await loadH5Products();
        const liveCatalog = liveRows.map(runtimeProductToProduct);
        const order = await loadH5Order();
        const pendingRequest = order ? await loadH5OrderChangeRequest() : null;
        setPendingChangeRequest(pendingRequest?.status === "PENDING" || pendingRequest?.status === "REJECTED" ? pendingRequest : null);
        const draft = activityClosed || pendingRequest?.status === "PENDING" ? null : await loadH5OrderDraft();
        const baseVersion = order?.currentVersion || 0;
        const validDraft = draft?.baseOrderVersion === baseVersion ? draft : null;
        setRuntimeIdentity(identity); setRuntimeProducts(liveRows); setVerifiedBranch(identity.branchName || "");
        applyRuntimeOrder(order, liveCatalog, preserveDraft);
        setOrderNeedsRefresh(recoveryNeedsRefresh);
        draftOwnerIdRef.current = identity.customerId;
        if (validDraft && pendingRequest?.status !== "PENDING") {
          const availableIds = new Set(liveCatalog.filter((product) => product.isOrderable).map((product) => product.id));
          const restored: Record<string, number> = {};
          validDraft.items.forEach((item) => { if (availableIds.has(String(item.productId))) restored[String(item.productId)] = item.quantity; });
          setQuantities(restored);
          lastSavedDraftSignatureRef.current = h5QuantitySignature(validDraft.items);
          setDraftMessage(`已恢复 ${formatBeijingTime(validDraft.updatedAt)} 保存的草稿`);
          setStep("order");
        } else {
          const baseItems = h5OrderItems(order);
          lastSavedDraftSignatureRef.current = draft ? h5QuantitySignature(draft.items) : h5QuantitySignature(baseItems);
          setDraftMessage(draft ? "订单已更新，旧草稿未恢复" : "");
          setStep(order ? "submitted" : "order");
        }
        setDraftReady(!activityClosed && pendingRequest?.status !== "PENDING");
      } catch (error) {
        setVerifyError(error instanceof ApiError ? error.message : "连接服务失败，请稍后重试。");
      } finally { entryBusy.current = false; setRuntimeBusy(false); }
      return;
    }
    if (importedWhitelistRows) {
      const expectedType: WhitelistRow["customerType"] = unspecifiedWhitelist ? "" : channel === "综合客户" ? "综合客户" : "特渠专业客户";
      const identity = importedWhitelistRows.find((item) => item.status === "有效" && item.customerType === expectedType && normalizePhone(item.dealerPhone) === normalizedPhone);
      if (!identity) {
        const otherChannelIdentity = importedWhitelistRows.find((item) => item.status === "有效" && normalizePhone(item.dealerPhone) === normalizedPhone);
        setVerifyError(otherChannelIdentity && !unspecifiedWhitelist ? `该手机号登记在${otherChannelIdentity.customerType}白名单中，请返回选择对应订货通道。` : "该手机号不在本次活动白名单中，请核对后重新输入。");
        return;
      }
      if (!unspecifiedWhitelist && expectedType === "综合客户" && identity.region !== region) {
        setVerifyError(`该手机号登记为综合客户 · ${identity.region}，请重新选择订货大区。`);
        return;
      }
      setVerifyError("");
      setVerifiedIdentity(identity);
      setVerifiedBranch(identity.branch);
      setStep(orderStatus === "none" ? "order" : "submitted");
      return;
    }
    setVerifyError("订货服务暂不可用，请稍后刷新页面重试。");
  };

  const submitOrder = async (recover = false) => {
    if (submissionBusy.current || runtimeBusy) return;
    if (runtimeActivity && runtimeIdentity) {
      submissionBusy.current = true;
      setRuntimeBusy(true); setRuntimeMessage("");
      const scope = { activityCode: runtimeActivity.code, customerId: runtimeIdentity.customerId };
      const body = { expectedVersion: runtimeOrder?.currentVersion || 0, expectedLockVersion: runtimeOrder?.lockVersion,
        items: selected.map((product) => ({ productId: Number(product.id), quantity: quantities[product.id] })) };
      try {
        if (draftSaveTimerRef.current != null) window.clearTimeout(draftSaveTimerRef.current);
        await draftSaveChainRef.current.catch(() => undefined);
        const isFirstSubmit = !runtimeOrder;
        if (!isFirstSubmit && runtimeOrder.status === "SUBMITTED" && !pendingSubmission && !recover && h5QuantitySignature(body.items) === h5QuantitySignature(h5OrderItems(runtimeOrder))) {
          setPendingSubmission(false); setOrderNeedsRefresh(false); setStep("submitted");
          return;
        }
        if (requiresReview && !recover && !pendingSubmission) {
          const request = await createH5OrderChangeRequest(runtimeActivity.code, runtimeIdentity.customerId, body.expectedVersion,
            "MODIFY", body.items, "", changeKey([scope, "MODIFY", body]), body.expectedLockVersion);
          changeAttempt.current.signature = "";
          setPendingChangeRequest(request);
          setPendingSubmission(false); setOrderNeedsRefresh(false);
          setRuntimeMessage("");
          setDraftMessage(""); setStep("submitted");
          return;
        }
        const order = recover || pendingSubmission ? await submission.recover(scope) : await submission.submit(scope,body);
        if (!order) { setPendingSubmission(false); setOrderNeedsRefresh(true); return; }
        setPendingSubmission(false); setOrderNeedsRefresh(false);
        setSubmitMode(isFirstSubmit ? "first" : runtimeOrder.status !== "SUBMITTED" ? "restore" : "update");
        setPendingChangeRequest(null);
        setDraftReady(!activityClosed);
        latestDraftSnapshotRef.current = null;
        setSubmittedIdentity(verifiedIdentity ? { ...verifiedIdentity } : null);
        applyRuntimeOrder(order, catalog);
        lastSavedDraftSignatureRef.current = h5QuantitySignature(h5OrderItems(order));
        setDraftMessage("");
        setStep("success");
      } catch (error) {
        try { setPendingSubmission(Boolean(submission.read(scope))); }
        catch { setPendingSubmission(true); }
        setRuntimeMessage(error instanceof ApiError ? error.message : "网络连接异常，提交结果待确认，请重试确认。");
        if (error instanceof ApiError && ["ORDER_VERSION_CONFLICT", "SUBMISSION_RECOVERY_EXPIRED", "IDEMPOTENCY_RESULT_UNAVAILABLE", "ORDER_CHANGE_REVIEW_REQUIRED", "ORDER_CHANGE_REVIEW_NOT_REQUIRED"].includes(error.code)) setOrderNeedsRefresh(true);
      } finally { submissionBusy.current = false; setRuntimeBusy(false); }
      return;
    }
    setRuntimeMessage("订货服务暂不可用，订单未提交，请稍后重试。");
  };

  const withdrawOrder = async () => {
    if (runtimeBusy || submissionBusy.current || pendingSubmission) {
      if (pendingSubmission) setRuntimeMessage("请先确认上次提交结果，再撤回订单。");
      return;
    }
    if (runtimeActivity && runtimeIdentity && runtimeOrder) {
      setRuntimeBusy(true); setRuntimeMessage("");
      try {
        if (draftSaveTimerRef.current != null) window.clearTimeout(draftSaveTimerRef.current);
        await draftSaveChainRef.current.catch(() => undefined);
        const request = await createH5OrderChangeRequest(runtimeActivity.code, runtimeIdentity.customerId, runtimeOrder.currentVersion,
          "WITHDRAW", [], "", changeKey([runtimeActivity.code, runtimeIdentity.customerId, "WITHDRAW", runtimeOrder.currentVersion, runtimeOrder.lockVersion]), runtimeOrder.lockVersion);
        changeAttempt.current.signature = "";
        setPendingChangeRequest(request);
        setRuntimeMessage("");
        setDraftMessage(""); setCancelConfirmOpen(false); setCartOpen(false); setStep("submitted");
      } catch (error) {
        setRuntimeMessage(error instanceof ApiError ? error.message : "订单撤回失败，请稍后重试。");
      } finally { setRuntimeBusy(false); }
      return;
    }
    setRuntimeMessage("订货服务暂不可用，订单未撤回，请稍后重试。");
  };

  const reloadLatestOrder = async () => {
                if (submissionBusy.current || runtimeBusy) return;
                setRuntimeBusy(true);
                try {
                  const rows = await loadH5Products();
                  const current = await loadH5Order();
                  const latestRequest = await loadH5OrderChangeRequest();
                  setPendingChangeRequest(latestRequest?.status === "APPROVED" ? null : latestRequest);
                  setRuntimeProducts(rows);
                  applyRuntimeOrder(current, rows.map(runtimeProductToProduct));
                  if (runtimeActivity && runtimeIdentity) submission.clear({ activityCode: runtimeActivity.code, customerId: runtimeIdentity.customerId });
                  setPendingSubmission(false); setOrderNeedsRefresh(false);
                  setRuntimeMessage("已加载最新订单，请重新核对后修改。此前未提交的修改已清除。");
                  setStep("submitted");
                } catch { setRuntimeMessage("最新订单加载失败，请重试。"); }
                finally { setRuntimeBusy(false); }
                };
  const prepareLiveRoomExit = async () => {
    if (runtimeBusy || submissionBusy.current) return false;
    if (pendingSubmission || orderNeedsRefresh) {
      return window.confirm("订单提交结果尚待确认，返回直播间不会取消提交。确定离开吗？");
    }
    if (!customerOrderReadOnly && pendingChangeRequest?.status !== "PENDING") {
      if (draftSaveTimerRef.current != null) window.clearTimeout(draftSaveTimerRef.current);
      const snapshot = latestDraftSnapshotRef.current;
      if (snapshot && snapshot.signature !== lastSavedDraftSignatureRef.current) {
        await queueDraftSync(snapshot);
        if (snapshot.signature !== lastSavedDraftSignatureRef.current) {
          return window.confirm("草稿尚未保存，退出后未保存的修改可能丢失。是否继续返回直播间？");
        }
      }
    }
    return true;
  };
  return { resetEntry, directEntry, catalogSearch, prepareLiveRoomExit, catalog, requiresReview, pendingSubmission, pendingChangeRequest, recoverSubmission: () => submitOrder(true), activityStatus, runtimeActivity, activityClosed, activityNotStarted, unspecifiedWhitelist, runtimeOrder, runtimeBusy, runtimeMessage, orderNeedsRefresh, step, setStep, channel, setChannel, region, setRegion, setVerifiedBranch, setVerifiedIdentity, phone, setPhone, verifyError, setVerifyError, setRebateFilter, line, setLine, search, setSearch, previewProduct, setPreviewProduct, cartOpen, setCartOpen, orderStatus, customerOrderReadOnly, submitMode, orderVersion, orderUpdatedAt, orderWithdrawnAt, orderEvents, cancelConfirmOpen, setCancelConfirmOpen, quantities, setQuantities, visibleStep, regionOptions, regionalized, selectedRegionName, lineOptions, hasRebateSplit, effectiveRebateFilter, visibleProducts, visibleProductGroups, selected, selectedLineGroups, selectedLineSummaries, totalBoxes, totalAmount, orderViewQuantities, orderViewSelected, orderViewLineGroups, orderViewLineSummaries, orderViewBoxes, orderViewAmount, importedIdentity, identityBranch, identityLabel, dealerName, displayBranch, displayPhone, changeQty, startEditingOrder, verifyIdentity, submitOrder, withdrawOrder, reloadLatestOrder, draftMessage };
}

export type H5OrderModel = ReturnType<typeof useH5OrderFlow>;
