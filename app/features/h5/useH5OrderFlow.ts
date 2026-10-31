"use client";

import { formatBeijingTime } from "../shared/time";

import { createIdempotencyKey } from "../../services/api/idempotency-key";


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, createH5OrderChangeRequest, loadH5Products, saveH5Order, verifyPhone, type H5CustomerType, type OrderChangeRequest, type RuntimeIdentity, type RuntimeOrder, type H5Product } from "../../api";
import type { WhitelistRow } from "../../domain/import-domain";
import { maskPhone, normalizePhone } from "../shared/utils";
import { useH5CatalogSearch } from "./useH5CatalogSearch";
import { useH5Draft } from "./useH5Draft";
import { h5DraftBaseline, h5DraftBaseItems } from "./h5-local-draft";
import { readH5OrderSnapshot, sameH5Order, useH5OrderSync, type H5OrderSnapshot } from "./useH5OrderSync";
import { h5EntryPolicy } from "./h5-entry-policy";
import { createH5SubmissionManager } from "./h5-submission";
import { productRowToProduct, runtimeProductToProduct, priceBreakdown, groupByProductLine, summarizeOrderLineAmounts, h5QuantitySignature, h5OrderItems, h5RequiresReview, type H5Props, type H5Step, type H5Channel, type H5OrderStatus, type Product, type SubmittedOrderItem } from "./h5-domain";

export function useH5OrderFlow({ activityStatus, importedRows, importedWhitelistRows, runtimeActivity }: H5Props) {
  const activityClosed = activityStatus === "closed" || activityStatus === "finished";
  const activityNotStarted = activityStatus === "draft" || activityStatus === "scheduled";
  const entryPolicy = h5EntryPolicy(runtimeActivity);
  const directEntry = entryPolicy.mode === "direct";
  const [runtimeProducts, setRuntimeProducts] = useState<H5Product[] | null>(null);
  const [runtimeIdentity, setRuntimeIdentity] = useState<RuntimeIdentity | null>(null);
  const unspecifiedWhitelist = runtimeIdentity ? runtimeIdentity.customerType === "ALL" : runtimeActivity?.whitelistCustomerTypeMode === "UNSPECIFIED";
  const [runtimeOrder, setRuntimeOrder] = useState<RuntimeOrder | null>(null);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [runtimeMessage, setRuntimeMessage] = useState("");
  const [pendingChangeRequest, setPendingChangeRequest] = useState<OrderChangeRequest | null>(null);
  const [orderNeedsRefresh, setOrderNeedsRefresh] = useState(false);
  const [pendingSubmission, setPendingSubmission] = useState(false);
  const submissionBusy = useRef(false);
  const entryBusy = useRef(false);
  const orderActionBusy = useRef(false);
  const identityGeneration = useRef(0);
  const { busy: orderSyncBusy, cooldownSeconds, lastSuccessAt, readLatest, markSynced, confirmSynced, reset: resetOrderSync } = useH5OrderSync();
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
  const [step, setStep] = useState<H5Step>("verify");
  const [selectedChannel, setChannel] = useState<H5Channel>("");
  const verificationChannel = entryPolicy.channel || selectedChannel;
  const channel: H5Channel = !["channel", "region", "verify"].includes(step) && runtimeIdentity ? (runtimeIdentity.customerType === "GENERAL" ? "综合客户" : runtimeIdentity.customerType === "SPECIAL" ? "特渠专业客户" : "") : verificationChannel;
  const [region, setRegion] = useState("");
  const [verifiedBranch, setVerifiedBranch] = useState("");
  const [verifiedIdentity, setVerifiedIdentity] = useState<WhitelistRow | null>(null);
  const [submittedIdentity, setSubmittedIdentity] = useState<WhitelistRow | null>(null);
  const [phone, updatePhone] = useState("");
  const [identityChoice, setIdentityChoice] = useState<{ phone: string; types: Array<"GENERAL" | "SPECIAL"> } | null>(null);
  const setPhone = (value: string) => {
    if (entryBusy.current) return;
    updatePhone(value); setIdentityChoice(null); setVerifyError("");
  };
  const cancelIdentityChoice = () => {
    if (entryBusy.current) return;
    setIdentityChoice(null); setVerifyError("");
  };
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
  const syncView = useRef({ step, customerOrderReadOnly });
  useEffect(() => { syncView.current = { step, customerOrderReadOnly }; }, [step, customerOrderReadOnly]);
  useEffect(() => () => { identityGeneration.current += 1; }, []);
  const entryStep = ["channel", "region", "verify"].includes(step);
  const visibleStep = entryStep && (entryPolicy.mode === "loading" || entryPolicy.mode === "empty") ? entryPolicy.mode
    : entryStep ? "verify" : step;
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
    ? "手机号验证"
    : runtimeIdentity
    ? `${runtimeIdentity.customerType === "GENERAL" ? "综合客户" : runtimeIdentity.customerType === "SPECIAL" ? "特渠专业客户" : "不区分客户类型"}${runtimeIdentity.customerType === "ALL" ? "" : identityRegion ? ` · ${identityRegion}` : ""}`
    : importedIdentity ? `${importedIdentity.customerType || "不区分客户类型"}${importedIdentity.customerType === "" ? "" : identityRegion ? ` · ${identityRegion}` : ""}` : unspecifiedWhitelist ? "不区分客户类型" : channel === "综合客户" ? `综合客户${selectedRegionName ? ` · ${selectedRegionName}` : ""}` : "特渠专业客户";
  const dealerName = runtimeIdentity?.dealerFullName || importedIdentity?.dealerFull || "—";
  const displayBranch = runtimeIdentity?.branchName || identityBranch;
  const displayPhone = runtimeIdentity?.phoneMasked || (importedIdentity ? maskPhone(importedIdentity.dealerPhone) : "—");

  const { draftMessage, setDraftMessage, restoreDraft, flushDraft, discardDraft, resetDraft, hasDraftChanges } = useH5Draft({
    activityClosed: customerOrderReadOnly, editing: step === "order" || step === "confirm",
    paused: pendingSubmission || orderNeedsRefresh || runtimeBusy || orderSyncBusy,
    catalog, quantities, runtimeActivity, runtimeIdentity, runtimeOrder, request: pendingChangeRequest,
  });
  const applyRuntimeOrder = useCallback((order: RuntimeOrder | null, liveCatalog: Product[], preserveDraft = false) => {
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
    if (!preserveDraft) setQuantities(itemQuantities);
    setSubmittedQuantities(itemQuantities); setSubmittedItems(items);
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
  }, []);

  const applyLatestSnapshot = useCallback(({ order, request }: H5OrderSnapshot, editing = false) => {
    const hasDraft = hasDraftChanges();
    const preserveDraft = h5DraftBaseline(runtimeOrder, pendingChangeRequest) === h5DraftBaseline(order, request) && hasDraft;
    applyRuntimeOrder(order, catalog, preserveDraft);
    setPendingChangeRequest(request);
    if (!preserveDraft) {
      if (runtimeIdentity && runtimeActivity) discardDraft({ ...runtimeIdentity, activityCode: runtimeActivity.code, endsAt: runtimeActivity.endsAt, order, request });
      if (editing && request?.requestType === "MODIFY") {
        const available = new Set(catalog.filter(product => product.isOrderable).map(product => Number(product.id)));
        setQuantities(Object.fromEntries(h5DraftBaseItems(order, request).filter(item => available.has(item.productId)).map(item => [String(item.productId), item.quantity])));
      }
      setDraftMessage(hasDraft ? "订单或申请已更新，旧草稿未恢复，已加载最新内容。" : "");
    }
    setOrderNeedsRefresh(false);
    confirmSynced();
  }, [runtimeOrder, pendingChangeRequest, applyRuntimeOrder, catalog, runtimeIdentity, runtimeActivity,
    hasDraftChanges, discardDraft, setDraftMessage, confirmSynced]);

  // Save locally and detach the old customer before verification replaces the session.
  const resetEntry = async (nextChannel: H5Channel = "") => {
    if (entryBusy.current || submissionBusy.current || orderActionBusy.current || runtimeBusy) return;
    entryBusy.current = true;
    identityGeneration.current += 1;
    resetOrderSync();
    setRuntimeBusy(true);
    try {
      const saved = resetDraft();
      setRuntimeIdentity(null); setRuntimeProducts(null);
      applyRuntimeOrder(null, []);
      setVerifiedIdentity(null); setSubmittedIdentity(null); setVerifiedBranch("");
      updatePhone(""); setIdentityChoice(null); setVerifyError(""); setDraftMessage("");
      setRuntimeMessage(saved ? "" : "当前浏览器无法保存草稿，未提交修改暂存于本页；刷新或关闭页面后可能丢失。");
      setPendingChangeRequest(null); setPendingSubmission(false); setSubmitMode("first");
      changeAttempt.current = { signature: "", key: "" };
      setChannel(nextChannel); setRegion("");
      setStep("verify");
    } finally {
      entryBusy.current = false;
      setRuntimeBusy(false);
    }
  };

  const changeQty = (id: string, delta: number) => {
    if (customerOrderReadOnly || pendingSubmission || orderNeedsRefresh || runtimeBusy || submissionBusy.current) return;
    setQuantities((old) => ({ ...old, [id]: Math.min(999999, Math.max(0, (old[id] || 0) + delta)) }));
  };

  const refreshOrderStatus = useCallback(async () => {
    if (!runtimeIdentity || !runtimeActivity || entryBusy.current || submissionBusy.current || orderActionBusy.current
      || runtimeBusy || pendingSubmission || orderNeedsRefresh || (step !== "submitted" && step !== "success")) return;
    const generation = identityGeneration.current;
    try {
      flushDraft();
      if (generation !== identityGeneration.current || orderActionBusy.current) return;
      const snapshot = await readLatest({ activityCode: runtimeActivity.code, customerId: runtimeIdentity.customerId });
      if (!snapshot || generation !== identityGeneration.current || orderActionBusy.current
        || (syncView.current.step !== "submitted" && syncView.current.step !== "success")) return;
      applyLatestSnapshot(snapshot);
      setRuntimeMessage("");
      if (!snapshot.order || snapshot.order.status !== "SUBMITTED" || snapshot.request) setStep("submitted");
    } catch (error) {
      if (generation === identityGeneration.current) setRuntimeMessage(error instanceof Error ? `刷新失败：${error.message}` : "刷新失败，请稍后重试。");
    }
  }, [runtimeIdentity, runtimeActivity, runtimeBusy, pendingSubmission, orderNeedsRefresh, step, readLatest,
    applyLatestSnapshot, flushDraft]);

  const previousStep = useRef(step);
  useEffect(() => {
    const entered = step === "submitted" && previousStep.current !== "submitted";
    previousStep.current = step;
    if (entered) void refreshOrderStatus();
  }, [step, refreshOrderStatus]);
  useEffect(() => {
    const refreshOnReturn = () => { if (!document.hidden) void refreshOrderStatus(); };
    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);
    window.addEventListener("pageshow", refreshOnReturn);
    return () => {
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
      window.removeEventListener("pageshow", refreshOnReturn);
    };
  }, [refreshOrderStatus]);

  const startEditingOrder = async () => {
    if (customerOrderReadOnly || pendingSubmission || orderNeedsRefresh || runtimeBusy || entryBusy.current
      || submissionBusy.current || orderActionBusy.current || !runtimeIdentity || !runtimeActivity) return;
    orderActionBusy.current = true;
    setRuntimeBusy(true); setRuntimeMessage("");
    const generation = identityGeneration.current;
    try {
      flushDraft();
      const snapshot = await readLatest({ activityCode: runtimeActivity.code, customerId: runtimeIdentity.customerId }, true);
      if (!snapshot || generation !== identityGeneration.current) return;
      const canEdit = !syncView.current.customerOrderReadOnly && !(Date.parse(runtimeActivity.endsAt) <= Date.now());
      applyLatestSnapshot(snapshot, canEdit);
      if (!canEdit) {
        setRuntimeMessage("当前活动暂不允许修改订单。"); return;
      }
      setCartOpen(false); setStep("order");
    } catch (error) {
      if (generation === identityGeneration.current) setRuntimeMessage(error instanceof Error ? `无法进入修改：${error.message}` : "最新订单加载失败，请重试。");
    } finally { orderActionBusy.current = false; if (generation === identityGeneration.current) setRuntimeBusy(false); }
  };

  const verifyIdentity = async (selectedType?: H5CustomerType) => {
    if (entryBusy.current || runtimeBusy || submissionBusy.current || orderActionBusy.current) return;
    if (activityNotStarted || entryPolicy.mode === "loading" || entryPolicy.mode === "empty") return;
    const normalizedPhone = normalizePhone(phone);
    if (!/^1\d{10}$/.test(normalizedPhone)) { setVerifyError("请输入有效的 11 位手机号"); return; }
    if (selectedType && (!identityChoice || identityChoice.phone !== normalizedPhone || !identityChoice.types.some(type => type === selectedType))) {
      setIdentityChoice(null); setVerifyError("请重新验证手机号后选择客户类型"); return;
    }
    if (runtimeActivity) {
      entryBusy.current = true;
      identityGeneration.current += 1;
      const generation = identityGeneration.current;
      resetOrderSync();
      setRuntimeBusy(true); setVerifyError(""); setRuntimeMessage("");
      try {
        resetDraft();
        const result = await verifyPhone(normalizedPhone, selectedType);
        if (result.selectionRequired) {
          setIdentityChoice({ phone: normalizedPhone, types: result.customerTypes });
          return;
        }
        setIdentityChoice(null);
        const identity = result.customer;
        let recoveryNeedsRefresh = false;
        let recoveryPending = false;
        setPendingSubmission(false); setOrderNeedsRefresh(false);
        try {
          const recovered = await submission.recover({ activityCode: runtimeActivity.code, customerId: identity.customerId });
          if (recovered) {
            discardDraft({ ...identity, activityCode: runtimeActivity.code, endsAt: runtimeActivity.endsAt, order: recovered, request: null });
            setRuntimeMessage("已确认上次提交成功，正在显示最新订单。");
          }
        } catch (error) {
          recoveryPending = true;
          setPendingSubmission(true);
          setRuntimeMessage(error instanceof ApiError ? error.message : "上次提交结果待确认，请重试确认。");
          recoveryNeedsRefresh = error instanceof ApiError && ["SUBMISSION_RECOVERY_EXPIRED", "IDEMPOTENCY_RESULT_UNAVAILABLE", "ORDER_VERSION_CONFLICT"].includes(error.code);
        }
        const liveRows = await loadH5Products();
        const liveCatalog = liveRows.map(runtimeProductToProduct);
        const { order, request: pendingRequest } = await readH5OrderSnapshot(runtimeActivity.code);
        if (generation !== identityGeneration.current) return;
        if (order && order.activityCustomerId !== identity.customerId) throw new Error("客户身份已变化，请重新验证手机号。");
        setPendingChangeRequest(pendingRequest);
        setRuntimeIdentity(identity); setRuntimeProducts(liveRows); setVerifiedBranch(identity.branchName || "");
        applyRuntimeOrder(order, liveCatalog);
        setOrderNeedsRefresh(recoveryNeedsRefresh);
        const restored = restoreDraft({ ...identity, activityCode: runtimeActivity.code, endsAt: runtimeActivity.endsAt, order, request: pendingRequest },
          liveCatalog, !customerOrderReadOnly && !recoveryPending && Date.parse(runtimeActivity.endsAt) > Date.now());
        if (restored) {
          setQuantities(restored);
          setStep("order");
        } else {
          setStep(order ? "submitted" : "order");
        }
        markSynced();
      } catch (error) {
        setVerifyError(error instanceof ApiError ? error.message : "连接服务失败，请稍后重试。");
      } finally { entryBusy.current = false; if (generation === identityGeneration.current) setRuntimeBusy(false); }
      return;
    }
    if (importedWhitelistRows) {
      const matches = importedWhitelistRows.filter(item => item.status === "有效" && normalizePhone(item.dealerPhone) === normalizedPhone
        && (!selectedType || item.customerType === (selectedType === "GENERAL" ? "综合客户" : "特渠专业客户")));
      if (matches.length > 1) {
        const types = matches.map(item => item.customerType);
        if (matches.length === 2 && types.includes("综合客户") && types.includes("特渠专业客户")) {
          setIdentityChoice({ phone: normalizedPhone, types: ["GENERAL", "SPECIAL"] });
        } else setVerifyError("该手机号的白名单身份存在冲突，请联系工作人员确认");
        return;
      }
      const identity = matches[0];
      if (!identity) {
        setVerifyError("该手机号不在本次活动白名单中，请核对后重新输入。");
        return;
      }
      setIdentityChoice(null); setChannel(identity.customerType); setRegion(identity.region || "");
      setVerifyError("");
      setVerifiedIdentity(identity);
      setVerifiedBranch(identity.branch);
      setStep(orderStatus === "none" ? "order" : "submitted");
      return;
    }
    setVerifyError("订货服务暂不可用，请稍后刷新页面重试。");
  };

  const submitOrder = async (recover = false) => {
    if (submissionBusy.current || runtimeBusy || entryBusy.current || orderActionBusy.current || orderSyncBusy) return;
    if (runtimeActivity && runtimeIdentity) {
      submissionBusy.current = true;
      setRuntimeBusy(true); setRuntimeMessage("");
      const scope = { activityCode: runtimeActivity.code, customerId: runtimeIdentity.customerId };
      const body = { expectedVersion: runtimeOrder?.currentVersion || 0, expectedLockVersion: runtimeOrder?.lockVersion,
        items: selected.map((product) => ({ productId: Number(product.id), quantity: quantities[product.id] })) };
      try {
        flushDraft();
        const isFirstSubmit = !runtimeOrder;
        if (!isFirstSubmit && runtimeOrder.status === "SUBMITTED" && !pendingSubmission && !recover && h5QuantitySignature(body.items) === h5QuantitySignature(h5OrderItems(runtimeOrder))) {
          discardDraft();
          setPendingSubmission(false); setOrderNeedsRefresh(false); setStep("submitted");
          return;
        }
        if (requiresReview && !recover && !pendingSubmission) {
          const request = await createH5OrderChangeRequest(runtimeActivity.code, runtimeIdentity.customerId, body.expectedVersion,
            "MODIFY", body.items, "", changeKey([scope, "MODIFY", body]), body.expectedLockVersion);
          changeAttempt.current.signature = "";
          setPendingChangeRequest(request);
          const cleared = discardDraft({ ...runtimeIdentity, activityCode: runtimeActivity.code, endsAt: runtimeActivity.endsAt, order: runtimeOrder, request });
          setPendingSubmission(false); setOrderNeedsRefresh(false);
          markSynced();
          setRuntimeMessage("");
          if (cleared) setDraftMessage("");
          setStep("submitted");
          return;
        }
        const order = recover || pendingSubmission ? await submission.recover(scope) : await submission.submit(scope,body);
        if (!order) { setPendingSubmission(false); setOrderNeedsRefresh(true); return; }
        setPendingSubmission(false); setOrderNeedsRefresh(false);
        setSubmitMode(isFirstSubmit ? "first" : runtimeOrder.status !== "SUBMITTED" ? "restore" : "update");
        setPendingChangeRequest(null);
        const cleared = discardDraft({ ...runtimeIdentity, activityCode: runtimeActivity.code, endsAt: runtimeActivity.endsAt, order, request: null });
        setSubmittedIdentity(verifiedIdentity ? { ...verifiedIdentity } : null);
        applyRuntimeOrder(order, catalog);
        markSynced();
        if (cleared) setDraftMessage("");
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
    if (runtimeBusy || submissionBusy.current || entryBusy.current || orderActionBusy.current || pendingSubmission || orderNeedsRefresh || customerOrderReadOnly) {
      if (pendingSubmission) setRuntimeMessage("请先确认上次提交结果，再撤回订单。");
      return;
    }
    if (runtimeActivity && runtimeIdentity && runtimeOrder) {
      orderActionBusy.current = true;
      setRuntimeBusy(true); setRuntimeMessage("");
      const generation = identityGeneration.current;
      try {
        flushDraft();
        const snapshot = await readLatest({ activityCode: runtimeActivity.code, customerId: runtimeIdentity.customerId }, true);
        if (!snapshot || generation !== identityGeneration.current) return;
        if (syncView.current.customerOrderReadOnly || Date.parse(runtimeActivity.endsAt) <= Date.now()) {
          setRuntimeMessage("当前活动暂不允许申请撤回。"); return;
        }
        if (!sameH5Order(runtimeOrder, snapshot.order) || snapshot.order?.status !== "SUBMITTED") {
          applyLatestSnapshot(snapshot);
          setCancelConfirmOpen(false); setCartOpen(false); setStep("submitted");
          setRuntimeMessage("订单已更新，请核对最新订单后再操作。");
          return;
        }
        if (snapshot.request?.status === "PENDING" && snapshot.request.requestType === "WITHDRAW") {
          applyLatestSnapshot(snapshot);
          setCancelConfirmOpen(false); setCartOpen(false); setStep("submitted");
          setRuntimeMessage("已有撤回申请待审核，请刷新状态查看处理结果。");
          return;
        }
        const current = snapshot.order;
        const request = await createH5OrderChangeRequest(runtimeActivity.code, runtimeIdentity.customerId, current.currentVersion,
          "WITHDRAW", [], "", changeKey([runtimeActivity.code, runtimeIdentity.customerId, "WITHDRAW", current.currentVersion, current.lockVersion]), current.lockVersion);
        changeAttempt.current.signature = "";
        setPendingChangeRequest(request);
        const cleared = discardDraft({ ...runtimeIdentity, activityCode: runtimeActivity.code, endsAt: runtimeActivity.endsAt, order: current, request });
        markSynced();
        setRuntimeMessage("");
        if (cleared) setDraftMessage("");
        setCancelConfirmOpen(false); setCartOpen(false); setStep("submitted");
      } catch (error) {
        setRuntimeMessage(error instanceof ApiError ? error.message : "订单撤回失败，请稍后重试。");
      } finally { orderActionBusy.current = false; if (generation === identityGeneration.current) setRuntimeBusy(false); }
      return;
    }
    setRuntimeMessage("订货服务暂不可用，订单未撤回，请稍后重试。");
  };

  const reloadLatestOrder = async () => {
    if (submissionBusy.current || runtimeBusy || entryBusy.current || orderActionBusy.current || !runtimeActivity || !runtimeIdentity) return;
    if (!window.confirm("加载最新订单将放弃本次未提交的修改，是否继续？")) return;
    orderActionBusy.current = true;
    setRuntimeBusy(true);
    const generation = identityGeneration.current;
    try {
      flushDraft();
      const rows = await loadH5Products();
      const snapshot = await readLatest({ activityCode: runtimeActivity.code, customerId: runtimeIdentity.customerId }, true);
      if (!snapshot || generation !== identityGeneration.current) return;
      setRuntimeProducts(rows);
      applyRuntimeOrder(snapshot.order, rows.map(runtimeProductToProduct));
      setPendingChangeRequest(snapshot.request);
      if (discardDraft({ ...runtimeIdentity, activityCode: runtimeActivity.code, endsAt: runtimeActivity.endsAt, ...snapshot })) setDraftMessage("");
      confirmSynced();
      submission.clear({ activityCode: runtimeActivity.code, customerId: runtimeIdentity.customerId });
      setPendingSubmission(false); setOrderNeedsRefresh(false);
      setRuntimeMessage("已加载最新订单，请重新核对后修改。此前未提交的修改已清除。");
      setStep("submitted");
    } catch { setRuntimeMessage("最新订单加载失败，请重试。原订单和未提交内容已保留。"); }
    finally { orderActionBusy.current = false; if (generation === identityGeneration.current) setRuntimeBusy(false); }
  };
  const prepareLiveRoomExit = async () => {
    if (runtimeBusy || submissionBusy.current) return false;
    if (pendingSubmission || orderNeedsRefresh) {
      return window.confirm("订单提交结果尚待确认，返回直播间不会取消提交。确定离开吗？");
    }
    if (!customerOrderReadOnly && !flushDraft()) {
      return window.confirm("当前浏览器无法保存草稿，离开后未提交修改可能丢失。是否继续返回直播间？");
    }
    return true;
  };
  return { orderSyncBusy, cooldownSeconds, lastSuccessAt, refreshOrderStatus, identityChoice, cancelIdentityChoice, resetEntry,
    directEntry, catalogSearch, prepareLiveRoomExit, catalog, requiresReview, pendingSubmission, pendingChangeRequest,
    recoverSubmission: () => submitOrder(true), activityStatus, runtimeActivity, activityClosed, activityNotStarted,
    unspecifiedWhitelist, runtimeOrder, runtimeBusy, runtimeMessage, orderNeedsRefresh, step, setStep, channel, setChannel,
    region, setRegion, setVerifiedBranch, setVerifiedIdentity, phone, setPhone, verifyError, setVerifyError, setRebateFilter,
    line, setLine, search, setSearch, previewProduct, setPreviewProduct, cartOpen, setCartOpen, orderStatus, customerOrderReadOnly,
    submitMode, orderVersion, orderUpdatedAt, orderWithdrawnAt, orderEvents, cancelConfirmOpen, setCancelConfirmOpen, quantities,
    setQuantities, visibleStep, regionOptions, regionalized, selectedRegionName, lineOptions, hasRebateSplit, effectiveRebateFilter,
    visibleProducts, visibleProductGroups, selected, selectedLineGroups, selectedLineSummaries, totalBoxes, totalAmount,
    orderViewQuantities, orderViewSelected, orderViewLineGroups, orderViewLineSummaries, orderViewBoxes, orderViewAmount,
    importedIdentity, identityBranch, identityLabel, dealerName, displayBranch, displayPhone, changeQty, startEditingOrder,
    verifyIdentity, submitOrder, withdrawOrder, reloadLatestOrder, draftMessage };
}

export type H5OrderModel = ReturnType<typeof useH5OrderFlow>;
