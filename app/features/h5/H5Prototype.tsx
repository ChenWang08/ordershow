"use client";

/* eslint-disable @next/next/no-img-element -- product images are supplied by runtime APIs. */

import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, apiAssetUrl, deleteH5OrderDraft, loadH5Order, loadH5OrderDraft, loadH5Products, saveH5Order, saveH5OrderDraft, verifyPhone, withdrawH5Order, type RuntimeActivity, type RuntimeIdentity, type RuntimeOrder, type RuntimeProduct } from "../../api";
import type { ProductImportRow, WhitelistRow } from "../../domain/import-domain";
import { FestivalDecor } from "../shared/components/FestivalDecor";
import { ProductImageViewer } from "../shared/components/ProductImageViewer";
import type { ActivityStatus } from "../shared/types";
import { maskPhone, money, normalizePhone } from "../shared/utils";

type H5Step = "channel" | "region" | "verify" | "order" | "confirm" | "success" | "submitted";
type H5OrderStatus = "none" | "submitted" | "withdrawn";
type H5Channel = "综合客户" | "特渠专业客户" | "";
type Product = {
  id: string;
  name: string;
  line: string;
  spec: string;
  price: number;
  tierMinQuantity?: number;
  tierCasePrice?: number;
  rebate: boolean;
  gift: boolean;
  atlas: number;
  customerType: "综合" | "特渠" | "全部";
  branchScope: string[];
  status: "有效" | "待核对" | "待完善";
  isOrderable: boolean;
  materialCode?: string;
  casePack?: string;
  imageUrl?: string;
  imageUrls?: string[];
};

function splitBranchScope(value: string) {
  return value.split(/[，,、]/).map((item) => item.trim()).filter(Boolean);
}

function productRowToProduct(row: ProductImportRow): Product {
  const lineAtlas = row.line === "酱油" ? 1 : row.line === "食醋" ? 2 : row.gift === "是" ? 3 : 0;
  const imageUrls = row.imageStatus === "待确认" || row.imageStatus === "未匹配"
    ? []
    : row.images?.map((image) => image.url) ?? [];
  return {
    id: row.id,
    name: row.materialName,
    line: row.line,
    spec: row.spec,
    price: Number(row.casePrice) || 0,
    tierMinQuantity: row.priceTierMinQuantity ? Number(row.priceTierMinQuantity) : undefined,
    tierCasePrice: row.priceTierCasePrice ? Number(row.priceTierCasePrice) : undefined,
    rebate: row.rebate === "参与",
    gift: row.gift === "是",
    atlas: lineAtlas,
    customerType: row.customerType,
    branchScope: splitBranchScope(row.branchScope),
    status: row.status,
    isOrderable: Number(row.casePrice) > 0,
    materialCode: row.materialCode,
    casePack: row.casePack,
    imageUrl: imageUrls?.[0],
    imageUrls,
  };
}

function runtimeProductToProduct(row: RuntimeProduct): Product {
  const selectedImage = [...row.images].sort((a, b) => Number(b.primary) - Number(a.primary) || a.sortNo - b.sortNo)[0];
  const imageUrls = selectedImage ? [apiAssetUrl(selectedImage.url)] : [];
  return {
    id: String(row.id),
    name: row.materialName,
    line: row.productLine || row.categoryName || "未分类",
    spec: row.specification || row.casePack || "",
    price: Number(row.casePrice || 0),
    tierMinQuantity: row.priceTier?.minQuantity,
    tierCasePrice: row.priceTier?.casePrice,
    rebate: row.rebateStatus === "PARTICIPATING",
    gift: row.giftBox,
    atlas: row.productLine === "酱油" ? 1 : row.productLine === "食醋" ? 2 : row.giftBox ? 3 : 0,
    customerType: row.customerType === "GENERAL" ? "综合" : "特渠",
    branchScope: row.branchScope ?? [],
    status: row.dataStatus === "INCOMPLETE" ? "待完善" : "有效",
    isOrderable: row.orderable,
    materialCode: row.materialCode,
    casePack: row.casePack,
    imageUrl: imageUrls[0],
    imageUrls,
  };
}

function ProductArt({ atlas, imageUrl, alt = "商品图片" }: { atlas: number; imageUrl?: string; alt?: string }) {
  return imageUrl ? <img className="product-art product-photo" src={imageUrl} alt={alt} /> : <span className={`product-art atlas-${atlas}`} role="img" aria-label="临时商品图" />;
}

type SubmittedOrderItem = { product: Product; quantity: number };

function effectiveCasePrice(product: Product, quantity: number) {
  return product.tierMinQuantity != null && product.tierCasePrice != null && quantity >= product.tierMinQuantity
    ? product.tierCasePrice : product.price;
}

function tierPriceLabel(product: Product, quantity: number) {
  if (product.tierMinQuantity == null || product.tierCasePrice == null) return "";
  return quantity >= product.tierMinQuantity
    ? `已享满${product.tierMinQuantity}箱整批优惠`
    : `满${product.tierMinQuantity}箱，整批¥${money(product.tierCasePrice)}/箱`;
}

type H5DraftSnapshot = {
  customerId: number;
  baseOrderVersion: number;
  baseSignature: string;
  signature: string;
  items: Array<{ productId: number; quantity: number }>;
};

function h5QuantitySignature(items: Array<{ productId: number; quantity: number }>) {
  return JSON.stringify(items.filter((item) => item.quantity > 0).sort((a, b) => a.productId - b.productId));
}

function h5OrderItems(order: RuntimeOrder | null) {
  return order?.items.map((item) => ({ productId: item.productId, quantity: item.quantity })) ?? [];
}

export function H5Prototype({ activityStatus, importedRows, importedWhitelistRows, runtimeActivity }: { activityStatus: ActivityStatus; importedRows: ProductImportRow[] | null; importedWhitelistRows: WhitelistRow[] | null; runtimeActivity: RuntimeActivity | null }) {
  const activityClosed = activityStatus === "closed" || activityStatus === "finished";
  const activityNotStarted = activityStatus === "draft" || activityStatus === "scheduled";
  const [runtimeProducts, setRuntimeProducts] = useState<RuntimeProduct[] | null>(null);
  const [runtimeIdentity, setRuntimeIdentity] = useState<RuntimeIdentity | null>(null);
  const [runtimeOrder, setRuntimeOrder] = useState<RuntimeOrder | null>(null);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [runtimeMessage, setRuntimeMessage] = useState("");
  const catalog = useMemo(() => runtimeProducts ? runtimeProducts.map(runtimeProductToProduct) : importedRows ? importedRows.map(productRowToProduct) : [], [runtimeProducts, importedRows]);
  const [step, setStep] = useState<H5Step>("channel");
  const [channel, setChannel] = useState<H5Channel>("");
  const [region, setRegion] = useState("");
  const [verifiedBranch, setVerifiedBranch] = useState("");
  const [verifiedIdentity, setVerifiedIdentity] = useState<WhitelistRow | null>(null);
  const [submittedIdentity, setSubmittedIdentity] = useState<WhitelistRow | null>(null);
  const [phone, setPhone] = useState("");
  const [verifyError, setVerifyError] = useState("");
  const [rebate, setRebate] = useState(true);
  const [line, setLine] = useState("全部");
  const [search, setSearch] = useState("");
  const [previewProduct, setPreviewProduct] = useState<Product | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [orderStatus, setOrderStatus] = useState<H5OrderStatus>("none");
  const [submitMode, setSubmitMode] = useState<"first" | "update">("first");
  const [orderVersion, setOrderVersion] = useState(0);
  const [orderUpdatedAt, setOrderUpdatedAt] = useState("");
  const [orderWithdrawnAt, setOrderWithdrawnAt] = useState("");
  const [orderEvents, setOrderEvents] = useState<Array<{ time: string; title: string; detail: string }>>([]);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [submittedQuantities, setSubmittedQuantities] = useState<Record<string, number>>({});
  const [submittedItems, setSubmittedItems] = useState<SubmittedOrderItem[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [draftReady, setDraftReady] = useState(false);
  const [draftMessage, setDraftMessage] = useState("");
  const draftOwnerIdRef = useRef<number | null>(null);
  const lastSavedDraftSignatureRef = useRef("");
  const latestDraftSnapshotRef = useRef<H5DraftSnapshot | null>(null);
  const draftSaveTimerRef = useRef<number | null>(null);
  const draftSaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const whitelistRegions = runtimeActivity?.regions ?? [];
  const regionOptions = [
    ...whitelistRegions.map((item) => ({ value: item.code, name: item.name, detail: `${item.name}综合经销商` })),
    ...(whitelistRegions.length > 0 && runtimeActivity?.hasUnassignedGeneralCustomers
      ? [{ value: "UNASSIGNED", name: "不分大区", detail: "白名单中未填写大区的综合经销商" }]
      : []),
  ];
  const regionalized = whitelistRegions.length > 0;
  const selectedRegionName = regionOptions.find((item) => item.value === region)?.name || region;
  const lineOptions = useMemo(() => ["全部", ...Array.from(new Set(catalog.map((product) => product.line).filter(Boolean)))], [catalog]);
  const effectiveLine = lineOptions.includes(line) ? line : "全部";
  const h5CustomerType = channel === "综合客户" ? "综合" : "特渠";
  const normalizedProductSearch = search.trim().toLocaleLowerCase("zh-CN");
  const visibleProducts = catalog.filter(
    (p) => (p.status === "有效" || p.status === "待完善")
      && (p.customerType === "全部" || p.customerType === h5CustomerType)
      && p.rebate === rebate
      && (p.branchScope.length === 0 || p.branchScope.includes(verifiedBranch))
      && (effectiveLine === "全部" || p.line === effectiveLine)
      && (!normalizedProductSearch
        || p.name.toLocaleLowerCase("zh-CN").includes(normalizedProductSearch)
        || (p.materialCode ?? "").toLocaleLowerCase("zh-CN").includes(normalizedProductSearch)),
  );
  const selected = catalog.filter((p) => (quantities[p.id] || 0) > 0);
  const totalBoxes = selected.reduce((sum, p) => sum + quantities[p.id], 0);
  const totalAmount = selected.reduce((sum, p) => sum + quantities[p.id] * effectiveCasePrice(p, quantities[p.id]), 0);
  const orderViewQuantities = submittedQuantities;
  const orderViewSelected = submittedItems.map((item) => item.product);
  const orderViewBoxes = orderViewSelected.reduce((sum, p) => sum + orderViewQuantities[p.id], 0);
  const orderViewAmount = orderViewSelected.reduce((sum, p) => sum + orderViewQuantities[p.id] * p.price, 0);
  const importedIdentity = verifiedIdentity ?? submittedIdentity;
  const identityRegionCode = runtimeIdentity?.regionCode || importedIdentity?.region || region;
  const identityRegion = regionOptions.find((item) => item.value === identityRegionCode)?.name || identityRegionCode;
  const identityBranch = runtimeIdentity?.branchName || importedIdentity?.branch || verifiedBranch;
  const identityLabel = runtimeIdentity
    ? `${runtimeIdentity.customerType === "GENERAL" ? "综合客户" : "特渠专业客户"}${identityRegion ? ` · ${identityRegion}` : ""}`
    : importedIdentity ? `${importedIdentity.customerType}${identityRegion ? ` · ${identityRegion}` : ""}` : channel === "综合客户" ? `综合客户${selectedRegionName ? ` · ${selectedRegionName}` : ""}` : "特渠专业客户";
  const dealerName = runtimeIdentity?.dealerFullName || importedIdentity?.dealerFull || "—";
  const displayBranch = runtimeIdentity?.branchName || identityBranch;
  const displayPhone = runtimeIdentity?.phoneMasked || (importedIdentity ? maskPhone(importedIdentity.dealerPhone) : "—");

  const queueDraftSync = (snapshot: H5DraftSnapshot, showStatus = true) => {
    draftSaveChainRef.current = draftSaveChainRef.current.catch(() => undefined).then(async () => {
      if (draftOwnerIdRef.current !== snapshot.customerId || lastSavedDraftSignatureRef.current === snapshot.signature) return;
      if (showStatus) setDraftMessage("正在自动保存草稿…");
      if (snapshot.signature === snapshot.baseSignature) {
        await deleteH5OrderDraft(snapshot.customerId);
      } else {
        await saveH5OrderDraft(snapshot.customerId, snapshot.baseOrderVersion, snapshot.items);
      }
      if (draftOwnerIdRef.current === snapshot.customerId) {
        lastSavedDraftSignatureRef.current = snapshot.signature;
        if (showStatus) setDraftMessage(snapshot.signature === snapshot.baseSignature ? "未提交修改已清除" : "草稿已自动保存");
      }
    }).catch((error) => {
      if (draftOwnerIdRef.current === snapshot.customerId && showStatus) {
        setDraftMessage(error instanceof ApiError ? `草稿保存失败：${error.message}` : "草稿保存失败，请检查网络");
      }
    });
    return draftSaveChainRef.current;
  };

  useEffect(() => {
    if (!draftReady || !runtimeIdentity || activityClosed) return;
    const items = catalog.filter((product) => product.isOrderable && (quantities[product.id] || 0) > 0)
      .map((product) => ({ productId: Number(product.id), quantity: quantities[product.id] }));
    const snapshot = {
      customerId: runtimeIdentity.customerId,
      baseOrderVersion: runtimeOrder?.currentVersion || 0,
      baseSignature: h5QuantitySignature(h5OrderItems(runtimeOrder)),
      signature: h5QuantitySignature(items),
      items,
    };
    latestDraftSnapshotRef.current = snapshot;
    if (draftSaveTimerRef.current != null) window.clearTimeout(draftSaveTimerRef.current);
    if (snapshot.signature !== lastSavedDraftSignatureRef.current) {
      draftSaveTimerRef.current = window.setTimeout(() => void queueDraftSync(snapshot), 800);
    }
    return () => {
      if (draftSaveTimerRef.current != null) window.clearTimeout(draftSaveTimerRef.current);
    };
  }, [activityClosed, catalog, draftReady, quantities, runtimeIdentity, runtimeOrder]);

  useEffect(() => {
    const flushOnPageHide = () => {
      const snapshot = latestDraftSnapshotRef.current;
      if (!snapshot || snapshot.signature === lastSavedDraftSignatureRef.current) return;
      if (snapshot.signature === snapshot.baseSignature) void deleteH5OrderDraft(snapshot.customerId, true);
      else void saveH5OrderDraft(snapshot.customerId, snapshot.baseOrderVersion, snapshot.items, true);
    };
    window.addEventListener("pagehide", flushOnPageHide);
    return () => window.removeEventListener("pagehide", flushOnPageHide);
  }, []);

  const applyRuntimeOrder = (order: RuntimeOrder | null, liveCatalog: Product[], preserveDraft = false) => {
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
      const found = catalogProduct ? { ...catalogProduct, price: Number(item.casePrice), tierMinQuantity: undefined, tierCasePrice: undefined } : {
        id, name: item.materialName, line: item.productLine || "未分类", spec: item.specification || "", price: Number(item.casePrice),
        rebate: true, gift: false, atlas: 0, customerType: "全部" as const, branchScope: [], status: "有效" as const, isOrderable: true,
      };
      return { product: found, quantity: item.quantity };
    });
    setQuantities(itemQuantities); setSubmittedQuantities(itemQuantities); setSubmittedItems(items);
    setOrderStatus(order.status === "WITHDRAWN" ? "withdrawn" : "submitted");
    setOrderVersion(order.currentVersion);
    setOrderUpdatedAt(new Date(order.lastModifiedAt).toLocaleString("zh-CN", { hour12: false }));
    setOrderWithdrawnAt(order.withdrawnAt ? new Date(order.withdrawnAt).toLocaleString("zh-CN", { hour12: false }) : "");
    setOrderEvents(order.operations.map((event) => ({
      time: new Date(event.occurredAt).toLocaleString("zh-CN", { hour12: false }),
      title: event.type === "WITHDRAW" ? "客户撤回订单" : event.type === "SUBMIT" ? "客户首次提交" : "客户修改并重新提交",
      detail: `经销商手机端 · ${event.orderVersion ? `版本 V${event.orderVersion}` : "订单状态变更"}`,
    })));
  };

  const changeQty = (id: string, delta: number) => {
    setQuantities((old) => ({ ...old, [id]: Math.min(999999, Math.max(0, (old[id] || 0) + delta)) }));
  };

  const startEditingOrder = () => {
    if (orderStatus === "withdrawn") setQuantities({ ...submittedQuantities });
    setStep("order");
  };

  const verifyIdentity = async () => {
    if (activityNotStarted) return;
    const normalizedPhone = normalizePhone(phone);
    if (runtimeActivity) {
      setRuntimeBusy(true); setVerifyError(""); setRuntimeMessage("");
      try {
        if (draftSaveTimerRef.current != null) window.clearTimeout(draftSaveTimerRef.current);
        if (latestDraftSnapshotRef.current) await queueDraftSync(latestDraftSnapshotRef.current, false);
        setDraftReady(false);
        const identity = await verifyPhone(channel === "综合客户" ? "GENERAL" : "SPECIAL", region, normalizedPhone);
        const preserveDraft = runtimeIdentity?.activityId === identity.activityId
          && runtimeIdentity.customerId === identity.customerId;
        const liveRows = await loadH5Products();
        const liveCatalog = liveRows.map(runtimeProductToProduct);
        const order = await loadH5Order();
        const draft = activityClosed ? null : await loadH5OrderDraft();
        const baseVersion = order?.currentVersion || 0;
        const validDraft = draft?.baseOrderVersion === baseVersion ? draft : null;
        setRuntimeIdentity(identity); setRuntimeProducts(liveRows); setVerifiedBranch(identity.branchName || "");
        applyRuntimeOrder(order, liveCatalog, preserveDraft);
        draftOwnerIdRef.current = identity.customerId;
        if (validDraft) {
          const availableIds = new Set(liveCatalog.filter((product) => product.isOrderable).map((product) => product.id));
          const restored: Record<string, number> = {};
          validDraft.items.forEach((item) => { if (availableIds.has(String(item.productId))) restored[String(item.productId)] = item.quantity; });
          setQuantities(restored);
          lastSavedDraftSignatureRef.current = h5QuantitySignature(validDraft.items);
          setDraftMessage(`已恢复 ${new Date(validDraft.updatedAt).toLocaleString("zh-CN", {
            hour12: false,
            timeZone: "Asia/Shanghai",
          })} 保存的草稿`);
          setStep("order");
        } else {
          const baseItems = h5OrderItems(order);
          lastSavedDraftSignatureRef.current = draft ? h5QuantitySignature(draft.items) : h5QuantitySignature(baseItems);
          setDraftMessage(draft ? "订单已更新，旧草稿未恢复" : "");
          setStep(order ? "submitted" : "order");
        }
        setDraftReady(!activityClosed);
      } catch (error) {
        setVerifyError(error instanceof ApiError ? error.message : "连接服务失败，请稍后重试。");
      } finally { setRuntimeBusy(false); }
      return;
    }
    if (importedWhitelistRows) {
      const expectedType: WhitelistRow["customerType"] = channel === "综合客户" ? "综合客户" : "特渠专业客户";
      const identity = importedWhitelistRows.find((item) => item.status === "有效" && item.customerType === expectedType && normalizePhone(item.dealerPhone) === normalizedPhone);
      if (!identity) {
        const otherChannelIdentity = importedWhitelistRows.find((item) => item.status === "有效" && normalizePhone(item.dealerPhone) === normalizedPhone);
        setVerifyError(otherChannelIdentity ? `该手机号登记在${otherChannelIdentity.customerType}白名单中，请返回选择对应订货通道。` : "该手机号不在本次活动白名单中，请核对后重新输入。");
        return;
      }
      if (expectedType === "综合客户" && identity.region !== region) {
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

  const submitOrder = async () => {
    if (runtimeActivity) {
      setRuntimeBusy(true); setRuntimeMessage("");
      try {
        if (draftSaveTimerRef.current != null) window.clearTimeout(draftSaveTimerRef.current);
        await draftSaveChainRef.current.catch(() => undefined);
        const isFirstSubmit = !runtimeOrder;
        const order = await saveH5Order(runtimeOrder?.currentVersion || 0,
          selected.map((product) => ({ productId: Number(product.id), quantity: quantities[product.id] })));
        setSubmitMode(isFirstSubmit ? "first" : "update");
        setSubmittedIdentity(verifiedIdentity ? { ...verifiedIdentity } : null);
        applyRuntimeOrder(order, catalog);
        lastSavedDraftSignatureRef.current = h5QuantitySignature(h5OrderItems(order));
        setDraftMessage("");
        setStep("success");
      } catch (error) {
        setRuntimeMessage(error instanceof ApiError ? error.message : "订单提交失败，请稍后重试。");
      } finally { setRuntimeBusy(false); }
      return;
    }
    setRuntimeMessage("订货服务暂不可用，订单未提交，请稍后重试。");
  };

  const withdrawOrder = async () => {
    if (runtimeActivity && runtimeOrder) {
      setRuntimeBusy(true); setRuntimeMessage("");
      try {
        if (draftSaveTimerRef.current != null) window.clearTimeout(draftSaveTimerRef.current);
        await draftSaveChainRef.current.catch(() => undefined);
        const order = await withdrawH5Order(runtimeOrder.currentVersion);
        applyRuntimeOrder(order, catalog); lastSavedDraftSignatureRef.current = h5QuantitySignature(h5OrderItems(order));
        setDraftMessage(""); setCancelConfirmOpen(false); setCartOpen(false); setStep("submitted");
      } catch (error) {
        setRuntimeMessage(error instanceof ApiError ? error.message : "订单撤回失败，请稍后重试。");
      } finally { setRuntimeBusy(false); }
      return;
    }
    setRuntimeMessage("订货服务暂不可用，订单未撤回，请稍后重试。");
  };

  return (
    <div className="h5-stage">
      <div className="device-caption">
        <span>客户订货 H5</span>
        <small>手机端 · 实时业务数据</small>
      </div>
      <div className="phone-shell">
        <div className="phone-screen">
          <FestivalDecor />
          {step === "channel" && (
            <section className="h5-page verify-page entry-page">
              <div className="mini-brand"><b>金龙鱼</b><span>调味品事业部</span></div>
              <div className="h5-hero-copy entry-hero">
                <span className="eyebrow">订货会</span>
                <h1>月满家圆<br /><em>味启新程</em></h1>
                <p>新品发布及旺季动员会</p>
              </div>
              <div className="verify-card entry-card">
                <span className="step-tag">订货通道</span>
                <h2>选择您的订货通道</h2>
                <p>请选择白名单中登记的客户类型，进入对应订货专区。</p>
                <div className="channel-options">
                  <button onClick={() => { setChannel("综合客户"); setRegion(""); setVerifiedBranch(""); setVerifiedIdentity(null); setStep(regionalized ? "region" : "verify"); }}>
                    <i className="channel-icon">综</i>
                    <span><b>综合客户订货</b><small>{regionalized ? "综合经销商 · 进入后选择所属片区" : "综合经销商 · 手机号验证身份"}</small></span>
                    <em>›</em>
                  </button>
                  <button onClick={() => { setChannel("特渠专业客户"); setRegion(""); setVerifiedBranch(""); setVerifiedIdentity(null); setStep("verify"); }}>
                    <i className="channel-icon special">特</i>
                    <span><b>特渠专业客户订货</b><small>专业渠道经销商 · 手机号验证身份</small></span>
                    <em>›</em>
                  </button>
                </div>
                <small>通道选择不会改变白名单中的客户身份</small>
              </div>
            </section>
          )}

          {step === "region" && (
            <section className="h5-page verify-page entry-page">
              <div className="entry-nav"><button onClick={() => setStep("channel")}>‹</button><span>综合客户订货</span></div>
              <div className="mini-brand"><b>金龙鱼</b><span>调味品事业部</span></div>
              <div className="h5-hero-copy region-hero">
                <span className="eyebrow">订货会</span>
                <h1>选择所属<br /><em>经营大区</em></h1>
                <p>请按白名单登记信息选择</p>
              </div>
              <div className="verify-card entry-card region-card">
                <span className="step-tag">综合客户</span>
                <h2>请选择所属大区</h2>
                <p>验证手机号时，系统会再次核对客户类型和经营区域。</p>
                <div className="region-options">
                {regionOptions.map((item) => (
                    <button key={item.value} onClick={() => { setRegion(item.value); setStep("verify"); }}>
                      <i>{item.name.slice(0, 1)}</i><b>{item.name}</b><small>{item.detail}</small>
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}

          {step === "verify" && (
            <section className="h5-page verify-page">
              <div className="entry-nav"><button onClick={() => setStep(channel === "综合客户" && regionalized ? "region" : "channel")}>‹</button><span>{identityLabel}</span></div>
              <div className="mini-brand"><b>金龙鱼</b><span>调味品事业部</span></div>
              <div className="h5-hero-copy">
                <span className="eyebrow">订货会</span>
                <h1>月满家圆<br /><em>味启新程</em></h1>
                <p>新品发布及旺季动员会</p>
              </div>
              <div className="verify-card">
                <div className="verify-context"><span className="step-tag">{identityLabel}</span><button onClick={() => setStep("channel")}>重新选择</button></div>
                <h2>输入白名单手机号</h2>
                <p>验证通过后，将为您展示{channel === "综合客户" ? `${selectedRegionName ? `${selectedRegionName}综合客户` : "综合客户"}` : "特渠专业客户"}的订货商品。</p>
                <label>
                  <span>手机号</span>
                  <input value={phone} onChange={(e) => { setPhone(e.target.value); setVerifyError(""); }} inputMode="tel" />
                </label>
                {verifyError && <div className="verify-error" role="alert">{verifyError}</div>}
                <button className="primary-btn" disabled={runtimeBusy || !phone.trim() || activityNotStarted} onClick={() => void verifyIdentity()}>{runtimeBusy ? "正在验证…" : activityStatus === "draft" ? "活动尚未发布" : activityStatus === "scheduled" ? "订货尚未开始" : activityClosed ? "验证并查看订单" : orderStatus === "none" ? "验证并进入订货" : "验证并查看订单"}</button>
                {runtimeMessage && <div className="verify-error" role="status">{runtimeMessage}</div>}
                <small>{activityStatus === "draft" ? "当前活动仍在准备中" : activityStatus === "scheduled" ? `将于 ${runtimeActivity ? new Date(runtimeActivity.startsAt).toLocaleString("zh-CN", { hour12: false }) : "设定时间"} 开放订货` : activityClosed ? "订货已截止，验证后可查看历史订单" : "仅用于本次订货会身份识别"}</small>
              </div>
            </section>
          )}

          {step === "order" && (
            <section className="h5-page order-page">
              <header className="order-header">
                <button className="text-btn" onClick={() => setStep(orderStatus === "none" ? "verify" : "submitted")}>‹</button>
                <div><b>订货会</b><span>{identityLabel}</span></div>
                <button className="round-btn" aria-label="更多">•••</button>
              </header>
              <div className="dealer-card">
                <span>已识别经销商</span>
                <b>{dealerName}</b>
                <small>{identityLabel} · {displayBranch || "未标注分公司"} · {importedIdentity?.dealerName || "已验证客户"} · 手机 {displayPhone}</small>
              </div>
              <div className="policy-note"><b>订货提示</b><span>{activityClosed ? "活动已截止，当前订单仅可查看。" : "所有商品按箱订购，提交后可在截止时间前修改或取消本次订货。"}</span></div>
              {draftMessage && <div className="h5-draft-status" role="status">{draftMessage}</div>}
              <div className="product-toolbar">
                <div className="segment">
                  <button className={rebate ? "active" : ""} onClick={() => setRebate(true)}>返利产品</button>
                  <button className={!rebate ? "active" : ""} onClick={() => setRebate(false)}>非返利产品</button>
                </div>
                <label className="search-box">⌕<input placeholder="搜索商品" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
              </div>
              <div className="line-tabs">
                {lineOptions.map((item) => (
                  <button key={item} className={line === item ? "active" : ""} onClick={() => setLine(item)}>{item}</button>
                ))}
              </div>
              <div className="product-list">
                {visibleProducts.map((product) => (
                  <article className="product-card" key={product.id}>
                    <button type="button" className="product-image product-image-button" disabled={!product.imageUrls?.length} aria-label={`查看${product.name}商品图片`} onClick={() => product.imageUrls?.length && setPreviewProduct(product)}><ProductArt atlas={product.atlas} imageUrl={product.imageUrl} alt={product.name} /></button>
                    <div className="product-info">
                      <h3>{product.name}</h3>
                      <div className="product-action">
                        <div className="product-price-block"><strong>{product.isOrderable ? <>¥{money(effectiveCasePrice(product, quantities[product.id] || 0))}<small>/箱</small></> : "价格待完善"}</strong>{product.isOrderable && tierPriceLabel(product, quantities[product.id] || 0) && <small>{tierPriceLabel(product, quantities[product.id] || 0)}</small>}</div>
                        <div className="stepper">
                          <button aria-label={`${product.name}减少一箱`} onClick={() => changeQty(product.id, -1)} disabled={activityClosed || !product.isOrderable || !quantities[product.id]}>−</button>
                          <input aria-label={`${product.name}订货箱数`} disabled={activityClosed} inputMode="numeric" type="number" min="0" max="999999" value={quantities[product.id] || 0} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setQuantities({ ...quantities, [product.id]: Math.min(999999, Math.max(0, Math.floor(Number(e.target.value) || 0))) })} />
                          <button aria-label={`${product.name}增加一箱`} onClick={() => changeQty(product.id, 1)} disabled={activityClosed || !product.isOrderable}>＋</button>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
                {visibleProducts.length === 0 && <div className="empty-state">没有符合条件的商品</div>}
              </div>
              <div className="order-bar">
                <button className="cart-summary" disabled={activityClosed || !totalBoxes} onClick={() => setCartOpen(true)}>
                  <span>已选 {selected.length} 种 · {totalBoxes} 箱 <em>查看明细⌃</em></span><b>¥{money(totalAmount)}</b>
                </button>
                <button className="confirm-cart-btn" disabled={activityClosed || (!totalBoxes && orderStatus === "none")} onClick={() => totalBoxes ? setStep("confirm") : setCancelConfirmOpen(true)}>{totalBoxes ? "确认订单" : "取消本次订货"}</button>
              </div>
            </section>
          )}

          {step === "order" && cartOpen && (
            <div className="cart-sheet-layer">
              <button className="cart-sheet-backdrop" aria-label="关闭购物明细" onClick={() => setCartOpen(false)} />
              <section className="cart-sheet" aria-label="已选商品明细">
                <header><div><b>已选商品</b><span>{selected.length} 种 · {totalBoxes} 箱</span></div><button disabled={!selected.length} onClick={() => setQuantities({})}>清空</button></header>
                <div className="cart-sheet-list">
                  {selected.map((product) => (
                    <article key={product.id}>
                      <ProductArt atlas={product.atlas} imageUrl={product.imageUrl} alt={product.name} />
                      <div className="cart-item-info">
                        <b>{product.name}</b>
                        <span>¥{money(effectiveCasePrice(product, quantities[product.id]))}/箱{tierPriceLabel(product, quantities[product.id]) ? ` · ${tierPriceLabel(product, quantities[product.id])}` : ""}</span>
                        <strong>小计 ¥{money(effectiveCasePrice(product, quantities[product.id]) * quantities[product.id])}</strong>
                      </div>
                      <div className="cart-item-actions">
                        <button className="remove-item" disabled={activityClosed} onClick={() => setQuantities((old) => ({ ...old, [product.id]: 0 }))}>删除</button>
                        <div className="stepper">
                          <button aria-label={`${product.name}减少一箱`} onClick={() => changeQty(product.id, -1)} disabled={activityClosed}>−</button>
                          <input aria-label={`${product.name}订货箱数`} disabled={activityClosed} inputMode="numeric" type="number" min="0" max="999999" value={quantities[product.id]} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setQuantities({ ...quantities, [product.id]: Math.min(999999, Math.max(0, Math.floor(Number(e.target.value) || 0))) })} />
                          <button aria-label={`${product.name}增加一箱`} onClick={() => changeQty(product.id, 1)} disabled={activityClosed}>＋</button>
                        </div>
                      </div>
                    </article>
                  ))}
                  {!selected.length && <div className="cart-empty">还没有选择商品</div>}
                </div>
                <footer><div><span>合计</span><b>¥{money(totalAmount)}</b><small>共 {totalBoxes} 箱</small></div><button disabled={activityClosed || (!totalBoxes && orderStatus === "none")} onClick={() => { setCartOpen(false); if (totalBoxes) setStep("confirm"); else setCancelConfirmOpen(true); }}>{totalBoxes ? "去确认订单" : "取消本次订货"}</button></footer>
              </section>
            </div>
          )}

          {step === "confirm" && (
            <section className="h5-page confirm-page">
              <header className="simple-header"><button onClick={() => setStep("order")}>‹</button><b>确认订单</b><span /></header>
              <div className="confirm-hero"><span>请核对订货信息</span><h2>{dealerName}</h2><small>{identityLabel}{identityBranch ? ` · ${identityBranch}` : ""}</small></div>
              <div className="confirm-list">
                {selected.map((product) => (
                  <div key={product.id}>
                    <ProductArt atlas={product.atlas} imageUrl={product.imageUrl} alt={product.name} />
                    <p><b>{product.name}</b><span>¥{money(effectiveCasePrice(product, quantities[product.id]))}/箱{tierPriceLabel(product, quantities[product.id]) ? ` · ${tierPriceLabel(product, quantities[product.id])}` : ""}</span></p>
                    <strong>× {quantities[product.id]}</strong>
                  </div>
                ))}
              </div>
              <div className="summary-card">
                <p className="grand-total"><span>订单总金额</span><b>¥{money(totalAmount)}</b></p>
              </div>
              <label className="agreement"><input type="checkbox" defaultChecked /> 我已核对商品与订货数量</label>
              {runtimeMessage && <div className="verify-error" role="alert">{runtimeMessage}</div>}
              <button className="submit-order" disabled={activityClosed || runtimeBusy} onClick={() => void submitOrder()}>{runtimeBusy ? "正在提交…" : orderStatus === "none" ? "确认提交订单" : orderStatus === "withdrawn" ? "重新提交订单" : "确认修改并提交"}</button>
            </section>
          )}

          {step === "submitted" && (
            <section className="h5-page submitted-page">
              <header className="simple-header"><button onClick={() => setStep("verify")}>‹</button><b>我的订单</b><span /></header>
              <div className={`submitted-state-card ${orderStatus === "withdrawn" ? "withdrawn" : ""}`}>
                <span className="submitted-status">{orderStatus === "withdrawn" ? "已撤回" : "已提交"}</span>
                <h2>{orderStatus === "withdrawn" ? "当前订单已撤回" : "您的订货已成功提交"}</h2>
                <p>{orderStatus === "withdrawn" ? "商品明细和订单号已保留，截止前可继续订货并重新提交。" : "订单截止前可修改或取消本次订货，修改后将以最新提交内容为准。"}</p>
              </div>
              <div className="submitted-meta">
                <p><span>订单编号</span><b>{runtimeOrder?.orderNo || "ZYORDER280018"}</b></p>
                <p><span>最后提交时间</span><b>{orderUpdatedAt}</b></p>
                <p><span>当前版本</span><b>V{orderVersion}</b></p>
                <p><span>编辑权限</span><b className={activityClosed ? "muted" : ""}>{activityClosed ? "已截止" : orderStatus === "withdrawn" ? "可重新提交" : "可修改或取消"}</b></p>
                {orderStatus === "withdrawn" && orderWithdrawnAt && <p><span>取消时间</span><b>{orderWithdrawnAt}</b></p>}
                <p><span>经销商</span><b>{dealerName}</b></p>
              </div>
              <div className="confirm-list submitted-list">
                {orderViewSelected.map((product) => (
                  <div key={product.id}>
                    <ProductArt atlas={product.atlas} imageUrl={product.imageUrl} alt={product.name} />
                    <p><b>{product.name}</b><span>¥{money(product.price)}/箱</span></p>
                    <strong>× {orderViewQuantities[product.id]}</strong>
                  </div>
                ))}
              </div>
              <div className="summary-card">
                <p className="grand-total"><span>订单总金额</span><b>¥{money(orderViewAmount)}</b></p>
                <p><span>订货数量</span><b>{orderViewBoxes} 箱 · {orderViewSelected.length} 种商品</b></p>
              </div>
              <div className="submitted-note">{activityClosed ? "活动已截止，当前订单仅可查看，不能修改、取消或重新提交。" : orderStatus === "withdrawn" ? "该订单当前不计入有效订单、金额统计和抽奖资格；截止前可点击“继续订货”恢复提交。" : "订单状态会同步至管理后台和活动看板；如需调整商品或数量，请点击“修改订单”。"}</div>
              {orderEvents.length > 0 && <section className="submitted-events"><h3>操作记录</h3>{orderEvents.map((event, index) => <p key={`${event.time}-${index}`}><b>{event.time.slice(11)} {event.title}</b><span>{event.detail}</span></p>)}</section>}
              <div className="submitted-actions">
                {!activityClosed && (orderStatus === "withdrawn" ? <button className="primary-btn" onClick={startEditingOrder}>继续订货</button> : <button className="primary-btn" onClick={startEditingOrder}>修改订单</button>)}
                <button className="ghost-btn" onClick={() => setStep("channel")}>返回活动首页</button>
              </div>
            </section>
          )}

          {step === "success" && (
            <section className="h5-page success-page">
              <div className="success-mark">✓</div>
              <span>{submitMode === "first" ? "提交成功" : "修改成功"}</span>
              <h2>{submitMode === "first" ? "您的订货已成功提交" : "订单修改已重新提交"}</h2>
              <p>订单编号：{runtimeOrder?.orderNo || "ZYORDER280018"}</p>
              <div className="success-amount"><span>订单总金额</span><b>¥{money(runtimeOrder?.totalAmount ?? totalAmount)}</b><small>{totalBoxes} 箱 · {selected.length} 种商品</small></div>
              <div className="success-note">订单号保持不变，截止前您可以再次进入并修改或取消本次订货。看板将在数秒内同步最新数据。</div>
              <button className="primary-btn" onClick={() => setStep("submitted")}>查看订单</button>
              <button className="ghost-btn" onClick={() => { setChannel(""); setRegion(""); setVerifiedBranch(""); setVerifiedIdentity(null); setStep("channel"); }}>返回活动首页</button>
            </section>
          )}
          {cancelConfirmOpen && (
            <div className="h5-modal-layer" role="dialog" aria-modal="true" aria-label="取消本次订货确认">
              <div className="h5-modal">
                <h3>确认取消本次订货？</h3>
                <p>取消后不会生成空订单，系统会保留最近一次非空提交的商品、金额和订单号，并将当前订单标记为已撤回。</p>
                {runtimeMessage && <div className="verify-error" role="alert">{runtimeMessage}</div>}
                <div><button className="ghost-btn" onClick={() => setCancelConfirmOpen(false)}>继续修改</button><button className="primary-btn" disabled={runtimeBusy} onClick={() => void withdrawOrder()}>{runtimeBusy ? "正在处理…" : "确认取消"}</button></div>
              </div>
            </div>
          )}
        </div>
      </div>
      {previewProduct && <ProductImageViewer productName={previewProduct.name} images={(previewProduct.imageUrls ?? []).map((url, index) => ({ url, fileName: `${previewProduct.name} · 第 ${index + 1} 张` }))} onClose={() => setPreviewProduct(null)} />}
    </div>
  );
}
