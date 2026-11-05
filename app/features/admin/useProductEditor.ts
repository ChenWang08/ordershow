"use client";

import { deleteConfirmedRows } from "./delete-confirmed-rows";

import { saveFailure, saveRequestFailure, type DrawerSaveResult } from "../../components/drawer-save-result";
import { positiveProductNumber, productCompletenessStatus } from "../../domain/product-completeness";

import { useState } from "react";
import {
  ApiError, createAdminProduct, updateAdminProduct, updateImportRow, deleteImportRows, deleteAdminProduct,
  loadAdminProductEditorState,
} from "../../api";
import { productMaterialNameKey, type ProductImportRow } from "../../domain/import-domain";
import { productImageRelationStatus, productImageStatusForAssets, synchronizeProductImageAssetStatuses, revokeProductImageAssets } from "../../domain/product-images";
import { mergeProductImageReviews, runtimeProductToImportRow } from "./admin-utils";
import { saveProductImages } from "./product-editor-images";
import type { ProductModuleOptions } from "./product-module-types";
import type { useProductImport } from "./useProductImport";

type ProductEditorOptions = ProductModuleOptions & {
  productImport: Pick<ReturnType<typeof useProductImport>, "productFileName" | "productImportError" | "setProductImageAssets" | "setProductImportInputCount">;
  refreshServerImportPreview: (type: "PRODUCT" | "WHITELIST" | "ATTENDANCE") => Promise<void>;
};

export function useProductEditor({
  activityId, activityStatus, productRows, setProductRows, productImportCompleted,
  serverImportTasks, setActionNotice, recordOperation, productImport, refreshServerImportPreview,
}: ProductEditorOptions) {
  const activityStarted = activityStatus === "running" || activityStatus === "closed" || activityStatus === "finished";
  const activityClosed = activityStatus === "closed" || activityStatus === "finished";
  const activityPublished = activityStatus !== "draft";
  const baseDataReadOnly = activityStatus === "scheduled" || activityClosed;
  const { productFileName, productImportError, setProductImageAssets, setProductImportInputCount } = productImport;
  const [editingProductRow, setEditingProductRow] = useState<ProductImportRow | null>(null);
  const [productFormOpen, setProductFormOpen] = useState(false);
  const openProductForm = () => {
    if (baseDataReadOnly) {
      setActionNotice(activityClosed ? "活动已截止，商品数据只读。" : "活动已发布，修改商品请先撤回发布。" );
      return;
    }
    if (!productImportCompleted && (!productFileName || productImportError)) {
      setActionNotice("请先完成一次商品 Excel 解析，再手动添加商品。" );
      return;
    }
    setEditingProductRow(null);
    setProductFormOpen(true);
  };
  const saveProductRow = async (row: ProductImportRow, reason = ""): Promise<DrawerSaveResult> => {
    if (activityClosed) {
      return saveFailure("活动已截止，商品数据只读。" );
    }
    const nextRow = { ...row, status: productCompletenessStatus(row.casePrice, row.conversion), imageStatus: productImageStatusForAssets(row.images) };
    const numeric = (value: string) => value.trim() === "" ? null : Number(value);
    const productBody = {
      customerType: nextRow.customerType === "综合" ? "GENERAL" : nextRow.customerType === "特渠" ? "SPECIAL" : "ALL",
      rebateStatus: nextRow.rebate === "参与" ? "PARTICIPATING" : nextRow.rebate === "不参与" ? "NOT_PARTICIPATING" : "ALL",
      categoryName: nextRow.category, productLine: nextRow.line, materialCode: nextRow.materialCode,
      materialName: nextRow.materialName, description: nextRow.description ?? "", brandName: nextRow.brand, varietyName: nextRow.variety,
      specification: nextRow.spec, casePack: nextRow.casePack, bottlePrice: numeric(nextRow.unitPrice),
      casePrice: positiveProductNumber(nextRow.casePrice), tonCaseFactor: positiveProductNumber(nextRow.conversion), giftBox: nextRow.gift === "是",
      priceTierMinQuantity: numeric(nextRow.priceTierMinQuantity), priceTierCasePrice: numeric(nextRow.priceTierCasePrice),
      priceTierPricingMode: nextRow.priceTierPricingMode,
      ...(productImportCompleted && nextRow.priceTiers ? { priceTiers: nextRow.priceTiers.map(tier => ({ minQuantity: Number(tier.minQuantity), casePrice: Number(tier.casePrice) })) } : {}),
      visible: true, orderable: positiveProductNumber(nextRow.casePrice) !== null, branchScope: nextRow.branchScope, reason,
      ...(nextRow.dealerScopeEdited ? { dealerScope: (nextRow.dealerScope ?? []).map(s => ({ branchName: s.branchName, customerIds: s.members.map(m => m.customerId) })) } : {}),
    };
    if (editingProductRow) {
      if (!productImportCompleted && editingProductRow.serverRowId && serverImportTasks.PRODUCT) {
        try {
          await updateImportRow(Number(activityId), serverImportTasks.PRODUCT, editingProductRow.serverRowId, {
            customerType: nextRow.customerType === "综合" ? "GENERAL" : nextRow.customerType === "特渠" ? "SPECIAL" : "ALL",
            rebateStatus: nextRow.rebate === "参与" ? "PARTICIPATING" : nextRow.rebate === "不参与" ? "NOT_PARTICIPATING" : "ALL",
            customerTypeInvalid: false, rebateStatusInvalid: false,
            categoryName: nextRow.category, productLine: nextRow.line, materialCode: nextRow.materialCode,
            materialName: nextRow.materialName, description: nextRow.description ?? "", brandName: nextRow.brand, varietyName: nextRow.variety,
            specification: nextRow.spec, casePack: nextRow.casePack, bottlePrice: nextRow.unitPrice,
            casePrice: nextRow.casePrice, tonCaseFactor: nextRow.conversion, giftBox: nextRow.gift === "是",
            priceTierMinQuantity: nextRow.priceTierMinQuantity, priceTierCasePrice: nextRow.priceTierCasePrice,
            priceTierPricingMode: nextRow.priceTierPricingMode,
            branchScope: nextRow.branchScope,
          });
        } catch (error) { return saveFailure(error instanceof ApiError ? error.message : "商品预览修改失败"); }
      }
      let savedRow: ProductImportRow = { ...nextRow, manuallyEdited: true };
      let refreshedCatalogRows: ProductImportRow[] | null = null;
      let detailsSaved = false;
      if (productImportCompleted && editingProductRow.serverVersion === undefined) {
        return saveFailure("当前商品缺少后端版本信息，请刷新列表后重试。", true);
      }
      if (productImportCompleted && editingProductRow.serverVersion !== undefined) {
        try {
          const productId = Number(editingProductRow.id);
          const saved = await updateAdminProduct(Number(activityId), Number(editingProductRow.id), editingProductRow.serverVersion, {
            ...productBody, bottlePriceSet: true, casePriceSet: true, tonCaseFactorSet: true, priceTierSet: true,
          });
          if (!saved) return saveFailure("商品保存结果异常，请刷新列表核对。", true);
          detailsSaved = true;
          savedRow = { ...nextRow, id: String(saved.id), serverVersion: saved.version };
          savedRow = { ...nextRow, ...runtimeProductToImportRow(saved), dealerScope: nextRow.dealerScope,
            effectiveDealerCount: nextRow.effectiveDealerCount, dealerScopeRestricted: nextRow.dealerScopeRestricted,
            images: nextRow.images, imageStatus: nextRow.imageStatus, manuallyEdited: true };
          const groupNames = [editingProductRow.materialName, nextRow.materialName];
          const imageState = await saveProductImages(Number(activityId), productId, nextRow.images ?? [], editingProductRow.images ?? [], groupNames);
          const scopeChanged = nextRow.dealerScopeEdited || nextRow.branchScope !== editingProductRow.branchScope
            || nextRow.customerType !== editingProductRow.customerType || nextRow.materialName !== editingProductRow.materialName;
          const state = imageState ?? (scopeChanged ? await loadAdminProductEditorState(Number(activityId), productId) : null);
          if (state) {
            refreshedCatalogRows = mergeProductImageReviews(state.products.map(runtimeProductToImportRow), state.reviews);
            const refreshed = refreshedCatalogRows.find(product => product.id === nextRow.id);
            if (!refreshed) throw new Error("商品状态读取不完整");
            savedRow = { ...refreshed, manuallyEdited: true };
          }
        } catch (error) {
          if (detailsSaved) {
            setProductRows((current) => current.map((item) => item.id === savedRow.id ? savedRow : item));
            return saveFailure(`商品资料已保存，但图片处理或列表刷新未完成${error instanceof ApiError ? `：${error.message}` : ""}。请先刷新列表核对，再继续编辑。`, true);
          }
          return saveRequestFailure(error, "商品保存失败，请检查网络连接");
        }
      }
      const sharedName = !productImportCompleted
        && productMaterialNameKey(editingProductRow.materialName) === productMaterialNameKey(savedRow.materialName)
        ? productMaterialNameKey(savedRow.materialName) : "";
      const confirmedImageIds = new Set((savedRow.images ?? [])
        .filter((image) => productImageRelationStatus(image) === "CONFIRMED").map((image) => image.id));
      const applySavedPreviewImage = (item: ProductImportRow) => {
        if (item.id === nextRow.id) return savedRow;
        if (sharedName && productMaterialNameKey(item.materialName) === sharedName) {
          const images = savedRow.images?.map((image) => ({ ...image }));
          return { ...item, images, imageStatus: productImageStatusForAssets(images) };
        }
        if (productImportCompleted || confirmedImageIds.size === 0) return item;
        const images = item.images?.filter((image) => !confirmedImageIds.has(image.id));
        return { ...item, images: images?.length ? images : undefined, imageStatus: productImageStatusForAssets(images) };
      };
      if (refreshedCatalogRows) {
        const replacements = new Map(refreshedCatalogRows.map(item => [item.id, item]));
        replacements.set(savedRow.id, savedRow);
        setProductRows(current => current.map(item => replacements.get(item.id) ?? item));
        revokeProductImageAssets(nextRow.images ?? []);
      } else if (productImportCompleted) {
        setProductRows(current => current.map(item => item.id === savedRow.id ? savedRow : item));
      } else {
        setProductRows((current) => current.map(applySavedPreviewImage));
        const previewRowsAfterSave = productRows.map(applySavedPreviewImage);
        setProductImageAssets((current) => synchronizeProductImageAssetStatuses(current, previewRowsAfterSave));
        try { await refreshServerImportPreview("PRODUCT"); }
        catch (error) {
          return saveFailure(`修改已保存，但预览刷新失败${error instanceof ApiError ? `：${error.message}` : ""}。请先刷新列表核对。`, true);
        }
      }
      if (activityStarted) recordOperation("活动开始后改单条商品", nextRow.materialName, `修改前：物料代码 ${editingProductRow.materialCode || "—"}、名称 ${editingProductRow.materialName || "—"}、元/箱 ${editingProductRow.casePrice || "—"}、分公司 ${editingProductRow.branchScope || "全部"}、状态 ${editingProductRow.status}；修改后：物料代码 ${nextRow.materialCode || "—"}、名称 ${nextRow.materialName || "—"}、元/箱 ${nextRow.casePrice || "—"}、分公司 ${nextRow.branchScope || "全部"}、状态 ${nextRow.status}；原因：${reason || "—"}。`);
      if (!activityStarted) recordOperation("修改商品", nextRow.materialName, "已保存当前商品资料。");
      setActionNotice("保存成功");
      return { ok: true };
    }
    if (!productImportCompleted && productFileName) {
      return saveFailure("导入预览阶段不能新增商品；请先发布本次 Excel，再使用单条新增。");
    }
    let manualRow: ProductImportRow = { ...nextRow, source: "manual", manuallyEdited: true };
    let productCreated = false;
    if (productImportCompleted) {
      try {
        const saved = await createAdminProduct(Number(activityId), productBody);
        productCreated = true;
        manualRow = { ...manualRow, id: String(saved.id), serverVersion: saved.version };
        manualRow = { ...runtimeProductToImportRow(saved), source: "manual", manuallyEdited: true };
        const state = await saveProductImages(Number(activityId), Number(saved.id), nextRow.images ?? [], [], [nextRow.materialName]);
        const details = state ?? await loadAdminProductEditorState(Number(activityId), Number(saved.id));
        const replacements = mergeProductImageReviews(details.products.map(runtimeProductToImportRow), details.reviews);
        const refreshed = replacements.find(item => item.id === String(saved.id));
        if (!refreshed) throw new Error("新增商品状态读取不完整");
        manualRow = { ...refreshed, source: "manual", manuallyEdited: true };
        const byId = new Map(replacements.map(item => [item.id, item]));
        setProductRows(current => current.map(item => byId.get(item.id) ?? item));
      } catch (error) {
        if (productCreated) {
          setProductRows((current) => [...current.filter((item) => item.id !== manualRow.id), manualRow]);
          return saveFailure(`商品已添加，但图片处理或列表刷新未完成${error instanceof ApiError ? `：${error.message}` : ""}。请先刷新列表，再编辑该商品，请勿重复添加。`, true);
        }
        return saveRequestFailure(error, "商品新增失败，请检查网络连接", true);
      }
    }
    setProductRows((current) => [...current, manualRow]);
    if (productImportCompleted) revokeProductImageAssets(nextRow.images ?? []);
    if (!productImportCompleted && productFileName) {
      setProductImportInputCount((current) => current + 1);
    }
    recordOperation(activityStarted ? "活动开始后手动新增商品" : "手动添加商品", manualRow.materialName, `物料代码：${manualRow.materialCode || "—"}；客户类型：${manualRow.customerType}；返利：${manualRow.rebate}；${activityStarted ? `原因：${reason || "—"}。` : ""}`);
    setActionNotice(`${activityStarted ? "已记录并添加" : "已添加"}商品：${manualRow.materialName}`);
    return { ok: true };
  };
  const deleteProductRows = async (ids: string[]) => {
    if (activityPublished) {
      setActionNotice("活动发布后禁止删除商品；待开始状态请先撤回发布。");
      return;
    }
    if (!productImportCompleted && serverImportTasks.PRODUCT) {
      const targets = productRows.filter((row) => ids.includes(row.id) && row.serverRowId);
      try {
        if (targets.length > 0) await deleteImportRows(Number(activityId), serverImportTasks.PRODUCT, targets.map((row) => row.serverRowId!));
      } catch (error) { setActionNotice(error instanceof ApiError ? error.message : "商品预览删除失败"); return; }
    } else if (productImportCompleted) {
      const result = await deleteConfirmedRows(ids, async id => {
        const row = productRows.find(item => item.id === id);
        if (!row || row.serverVersion === undefined) throw new Error("记录版本缺失，请刷新列表核对。");
        await deleteAdminProduct(Number(activityId), Number(id), row.serverVersion);
      });
      if (result.deleted.length) setProductRows(current => current.filter(row => !result.deleted.includes(row.id)));
      setEditingProductRow(current => current && result.deleted.includes(current.id) ? null : current);
      if (result.deleted.length) recordOperation("删除商品", result.deleted.length + " 条", "已同步移除服务器确认删除的记录。");
      setActionNotice(result.error ? "已删除 " + result.deleted.length + " 条，其余记录未确认删除：" + result.error
        : "已删除 " + result.deleted.length + " 条商品，已有订单不会被删除。");
      return;
    }
    setProductRows((current) => current.filter((row) => !ids.includes(row.id)));
    if (!productImportCompleted) await refreshServerImportPreview("PRODUCT");
    setEditingProductRow((current) => current && ids.includes(current.id) ? null : current);
    recordOperation("删除商品", `${ids.length} 条商品`, "从当前有效商品列表移除；已有订单明细和金额不受影响。" );
    setActionNotice(`${productImportCompleted ? "已删除" : "已从待导入结果移除"} ${ids.length} 条商品，已有订单明细和金额不受影响。`);
  };
  return { editingProductRow, setEditingProductRow, productFormOpen, setProductFormOpen, openProductForm, saveProductRow, deleteProductRows };
}
