"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError, adjustAdminOrder, createAdminOrder, loadAdminOrder, loadOrderProducts, previewAdminOrder, searchAdminCustomers, voidAdminOrder, type AdminCustomer, type AdminOrderPreview, type RuntimeProduct } from "../../api";
import { estimateLineAmount, editorErrorMessage, editorCustomerFromOrder, toOrderRecord, formatMoney, type OrderRecord, type OrderVersionItem } from "./order-domain";
import type { useOrderList } from "./useOrderList";

type EditorOptions = Pick<ReturnType<typeof useOrderList>, "selected" | "setOrders" | "setLoadError" | "setSelectedNo" | "setReloadKey"> & { activityId: number };

export function useOrderEditor({ activityId, selected, setOrders, setLoadError, setSelectedNo, setReloadKey }: EditorOptions) {
  const [editorMode, setEditorMode] = useState<"create" | "adjust" | null>(null);
  const [editorOrder, setEditorOrder] = useState<OrderRecord | null>(null);
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [products, setProducts] = useState<RuntimeProduct[]>([]);
  const [editorCustomerId, setEditorCustomerId] = useState("");
  const [editorCustomerSnapshot, setEditorCustomerSnapshot] = useState<AdminCustomer | null>(null);
  const [editorCustomerSearch, setEditorCustomerSearch] = useState("");
  const [customerSearchBusy, setCustomerSearchBusy] = useState(false);
  const [editorQuantities, setEditorQuantities] = useState<Record<number, number>>({});
  const [editorExistingItems, setEditorExistingItems] = useState<OrderVersionItem[]>([]);
  const [editorProductSearch, setEditorProductSearch] = useState("");
  const [editorReason, setEditorReason] = useState("");
  const [editorPreview, setEditorPreview] = useState<AdminOrderPreview | null>(null);
  const [editorPreviewBusy, setEditorPreviewBusy] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorError, setEditorError] = useState("");
  const editorCustomer = editorCustomerSnapshot ?? customers.find((customer) => String(customer.id) === editorCustomerId) ?? null;
  const editorCustomerResults = customers.filter((customer) => customer.active);
  const customerProductMatches = useMemo(() => {
    if (!editorCustomer) return [];
    const branch = (editorCustomer.branchName || "").trim().toLowerCase();
    return products.filter((product) => {
      const typeMatches = editorCustomer.customerType === "ALL" || product.customerType === "ALL" || product.customerType === editorCustomer.customerType;
      const branchMatches = product.branchScope.length === 0 || product.branchScope.some((value) => value.trim().toLowerCase() === branch);
      return product.orderable && product.casePrice != null && typeMatches && branchMatches;
    });
  }, [editorCustomer, products]);
  const editorProducts = useMemo(() => {
    const keyword = editorProductSearch.trim().toLowerCase();
    return customerProductMatches.filter((product) => !keyword || product.materialName.toLowerCase().includes(keyword) || (product.materialCode || "").toLowerCase().includes(keyword));
  }, [customerProductMatches, editorProductSearch]);
  const existingProductIds = useMemo(() => new Set(editorExistingItems.map((item) => item.productId).filter((id): id is number => id != null)), [editorExistingItems]);
  const editorAddedProducts = useMemo(() => customerProductMatches.filter((product) => !existingProductIds.has(product.id) && (editorQuantities[product.id] || 0) > 0), [customerProductMatches, editorQuantities, existingProductIds]);
  const editorAddProducts = useMemo(() => editorProducts.filter((product) => !existingProductIds.has(product.id) && !(editorQuantities[product.id] > 0)), [editorProducts, editorQuantities, existingProductIds]);
  const editorItems = useMemo(() => Object.entries(editorQuantities)
    .map(([productId, quantity]) => ({ productId: Number(productId), quantity: Math.floor(Number(quantity)) }))
    .filter((item) => item.quantity > 0), [editorQuantities]);
  const editorTotalQuantity = useMemo(() => editorItems.reduce((total, item) => total + item.quantity, 0), [editorItems]);
  const editorEstimatedAmount = useMemo(() => {
    if (editorItems.length === 0) return 0;
    let total = 0;
    for (const item of editorItems) {
      const product = products.find((candidate) => candidate.id === item.productId);
      const snapshot = editorExistingItems.find((candidate) => candidate.productId === item.productId);
      const pricedProduct = product ?? snapshot;
      if (!pricedProduct) return null;
      const amount = estimateLineAmount(pricedProduct, item.quantity);
      if (amount == null) return null;
      total += amount;
    }
    return total;
  }, [editorExistingItems, editorItems, products]);

  useEffect(() => {
    if (editorMode !== "create") return;
    const keyword = editorCustomerSearch.trim();
    if (!keyword) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      setCustomerSearchBusy(true);
      try {
        const rows = await searchAdminCustomers(activityId, keyword);
        if (active) setCustomers(rows.filter((customer) => customer.active));
      } catch (reason) {
        if (active) {
          setCustomers([]);
          setLoadError(editorErrorMessage(reason, "客户搜索失败，请稍后重试"));
        }
      } finally {
        if (active) setCustomerSearchBusy(false);
      }
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [activityId, editorCustomerSearch, editorMode, setLoadError]);

  useEffect(() => {
    if (!editorMode || !editorCustomer || editorItems.length === 0) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      setEditorPreviewBusy(true);
      try {
        const preview = await previewAdminOrder(activityId, editorCustomer.id, editorItems);
        if (active) { setEditorPreview(preview); setEditorPreviewBusy(false); setEditorError(""); }
      } catch (reason) {
        if (active) { setEditorPreview(null); setEditorPreviewBusy(false); setEditorError(editorErrorMessage(reason, "订单试算失败，请检查商品和客户范围")); }
      }
    }, 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [activityId, editorCustomer, editorItems, editorMode]);

  const loadEditorResources = async (activityCustomerId?: number) => {
    const productRows = await loadOrderProducts(activityId, activityCustomerId ? { activityCustomerId } : {});
    setProducts(productRows);
    return { productRows };
  };

  const openCreateEditor = async () => {
    setEditorBusy(true); setEditorError("");
    try {
      await loadEditorResources();
      setEditorMode("create"); setEditorOrder(null); setEditorCustomerId(""); setEditorCustomerSnapshot(null); setCustomers([]); setEditorCustomerSearch(""); setCustomerSearchBusy(false);
      setEditorQuantities({}); setEditorExistingItems([]);
      setEditorProductSearch(""); setEditorReason(""); setEditorPreview(null); setEditorPreviewBusy(false);
    } catch (reason) {
      setLoadError(editorErrorMessage(reason, "订单编辑数据加载失败"));
    } finally { setEditorBusy(false); }
  };

  const openAdjustEditor = async (order: OrderRecord) => {
    if (!order.id) return;
    setEditorBusy(true); setEditorError("");
    try {
      const detail = await loadAdminOrder(activityId, order.id);
      await loadEditorResources(detail.activityCustomerId);
      const record = toOrderRecord(detail);
      const quantities = Object.fromEntries((detail.items || []).filter((item) => item.productId).map((item) => [item.productId, Number(item.quantity)]));
      setEditorMode("adjust"); setEditorOrder(record); setEditorCustomerId(String(detail.activityCustomerId)); setEditorCustomerSnapshot(editorCustomerFromOrder(detail)); setCustomers([]); setEditorCustomerSearch(""); setCustomerSearchBusy(false);
      setEditorExistingItems(record.items);
      setEditorQuantities(quantities); setEditorProductSearch(""); setEditorReason(""); setEditorPreview(null); setEditorPreviewBusy(false);
      setOrders((current) => current.map((item) => item.no === record.no ? record : item));
    } catch (reason) {
      setLoadError(editorErrorMessage(reason, "订单编辑数据加载失败"));
    } finally { setEditorBusy(false); }
  };

  const closeEditor = () => {
    if (editorBusy) return;
    setEditorMode(null); setEditorOrder(null); setEditorCustomerId(""); setEditorCustomerSnapshot(null); setEditorCustomerSearch(""); setEditorExistingItems([]);
    setEditorError(""); setEditorPreview(null); setEditorPreviewBusy(false);
  };

  const setEditorQuantity = (productId: number, value: number) => {
    const quantity = Math.min(999999, Math.max(0, Number.isFinite(value) ? Math.floor(value) : 0));
    setEditorQuantities((current) => ({ ...current, [productId]: quantity }));
    setEditorPreview(null); setEditorPreviewBusy(false);
    setEditorError("");
  };

  const saveEditor = async () => {
    if (!editorCustomer || editorItems.length === 0 || !editorReason.trim() || !editorPreview || editorPreviewBusy) return;
    setEditorBusy(true); setEditorError("");
    try {
      const saved = editorMode === "create"
        ? await createAdminOrder(activityId, editorCustomer.id, editorItems, editorReason.trim())
        : await adjustAdminOrder(activityId, editorOrder!.id!, editorOrder!.currentVersion, editorOrder!.lockVersion, editorItems, editorReason.trim());
      const record = toOrderRecord(saved);
      setOrders((current) => {
        const exists = current.some((item) => item.id === record.id);
        return exists ? current.map((item) => item.id === record.id ? record : item) : [record, ...current];
      });
      setSelectedNo(record.no); setReloadKey((value) => value + 1); setEditorMode(null); setEditorOrder(null);
    } catch (reason) {
      setEditorError(editorErrorMessage(reason, "订单保存失败，请稍后重试"));
    } finally { setEditorBusy(false); }
  };

  const voidSelected = async () => {
    if (!selected?.id || selected.status === "已作废") return;
    const reason = window.prompt("请输入作废原因");
    if (!reason?.trim()) return;
    if (!window.confirm(`确认作废订单 ${selected.no}？订单历史会保留。`)) return;
    setEditorBusy(true);
    try {
      const saved = await voidAdminOrder(activityId, selected.id, selected.currentVersion, selected.lockVersion, reason.trim());
      const record = toOrderRecord(saved);
      setOrders((current) => current.map((item) => item.id === record.id ? record : item));
      setReloadKey((value) => value + 1);
    } catch (reasonValue) {
      setLoadError(reasonValue instanceof ApiError ? reasonValue.message : "订单作废失败");
    } finally { setEditorBusy(false); }
  };


  const selectEditorCustomer = async (customer: AdminCustomer) => { setEditorCustomerId(String(customer.id)); setEditorCustomerSnapshot(customer); setEditorCustomerSearch(""); setEditorQuantities({}); setEditorPreview(null); setEditorPreviewBusy(false); setEditorError(""); setEditorBusy(true); try { await loadEditorResources(customer.id); } catch (reason) { setEditorError(editorErrorMessage(reason, "客户商品目录加载失败，请稍后重试")); } finally { setEditorBusy(false); } };
  const editorAmountLabel = editorPreview
    ? formatMoney(editorPreview.totalAmount)
    : editorTotalQuantity === 0
      ? "¥0.00"
      : editorEstimatedAmount != null
        ? `约 ${formatMoney(editorEstimatedAmount)}`
      : editorPreviewBusy
        ? "试算中…"
        : editorError
          ? "试算失败"
          : "待试算";
  const editorTonsLabel = editorPreview
    ? editorPreview.totalTons == null ? "—" : Number(editorPreview.totalTons).toFixed(3)
    : editorTotalQuantity === 0 ? "—" : editorPreviewBusy ? "试算中…" : "待试算";

  return { editorMode, editorOrder, setCustomers, setEditorCustomerId, setEditorCustomerSnapshot, editorCustomerSearch, setEditorCustomerSearch, customerSearchBusy, setCustomerSearchBusy, editorQuantities, setEditorQuantities, editorExistingItems, editorProductSearch, setEditorProductSearch, editorReason, setEditorReason, editorPreview, setEditorPreview, editorPreviewBusy, setEditorPreviewBusy, editorBusy, editorError, setEditorError, editorCustomer, editorCustomerResults, editorProducts, editorAddedProducts, editorAddProducts, editorItems, editorTotalQuantity, editorEstimatedAmount, openCreateEditor, openAdjustEditor, closeEditor, setEditorQuantity, saveEditor, voidSelected, selectEditorCustomer, editorAmountLabel, editorTonsLabel };
}
