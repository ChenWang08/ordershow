"use client";

import { useState } from "react";
import {
  ApiError, createAdminProduct, updateAdminProduct, updateImportRow, deleteImportRows, deleteAdminProduct,
  addAdminProductImage, updateAdminProductImage, deleteAdminProductImage, selectProductImageReview,
  excludeProductImageReview, loadAdminProducts, loadProductImageReviews,
} from "../../api";
import { productMaterialNameKey, type ProductImportRow } from "../../domain/import-domain";
import { productImageRelationStatus, productImageStatusForAssets, synchronizeProductImageAssetStatuses } from "../../domain/product-images";
import { mergeProductImageReviews, runtimeProductToImportRow } from "./admin-utils";
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
  const saveProductRow = async (row: ProductImportRow, reason = "") => {
    if (activityClosed) {
      setActionNotice("活动已截止，商品数据只读。" );
      return false;
    }
    const nextRow = { ...row, imageStatus: productImageStatusForAssets(row.images) };
    const numeric = (value: string) => value.trim() === "" ? null : Number(value);
    const productBody = {
      customerType: nextRow.customerType === "综合" ? "GENERAL" : nextRow.customerType === "特渠" ? "SPECIAL" : "ALL",
      rebateStatus: nextRow.rebate === "参与" ? "PARTICIPATING" : nextRow.rebate === "不参与" ? "NOT_PARTICIPATING" : "ALL",
      categoryName: nextRow.category, productLine: nextRow.line, materialCode: nextRow.materialCode,
      materialName: nextRow.materialName, description: nextRow.description ?? "", brandName: nextRow.brand, varietyName: nextRow.variety,
      specification: nextRow.spec, casePack: nextRow.casePack, bottlePrice: numeric(nextRow.unitPrice),
      casePrice: numeric(nextRow.casePrice), tonCaseFactor: numeric(nextRow.conversion), giftBox: nextRow.gift === "是",
      priceTierMinQuantity: numeric(nextRow.priceTierMinQuantity), priceTierCasePrice: numeric(nextRow.priceTierCasePrice),
      priceTierPricingMode: nextRow.priceTierPricingMode,
      visible: true, orderable: Number(nextRow.casePrice) > 0, branchScope: nextRow.branchScope, reason,
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
        } catch (error) { setActionNotice(error instanceof ApiError ? error.message : "商品预览修改失败"); return false; }
      }
      let savedRow: ProductImportRow = { ...nextRow, manuallyEdited: true };
      let refreshedCatalogRows: ProductImportRow[] | null = null;
      if (productImportCompleted && editingProductRow.serverVersion !== undefined) {
        try {
          const productId = Number(editingProductRow.id);
          const saved = await updateAdminProduct(Number(activityId), Number(editingProductRow.id), editingProductRow.serverVersion, {
            ...productBody, bottlePriceSet: true, casePriceSet: true, tonCaseFactorSet: true, priceTierSet: true,
          });
          if (!saved) return false;
          savedRow = { ...savedRow, id: String(saved.id), serverVersion: saved.version,
            status: saved.dataStatus === "INCOMPLETE" ? "待完善" : "有效" };
          const desiredImages = savedRow.images ?? [];
          const selectedReview = desiredImages.find((image) => image.reviewCandidateId
            && productImageRelationStatus(image) === "CONFIRMED");
          const originalReviewIds = (editingProductRow.images ?? []).map((image) => image.reviewCandidateId)
            .filter((id): id is number => id !== undefined);
          if (selectedReview?.reviewCandidateId) {
            await selectProductImageReview(Number(activityId), selectedReview.reviewCandidateId);
          } else {
            const retainedReviewIds = new Set(desiredImages.map((image) => image.reviewCandidateId).filter((id): id is number => id !== undefined));
            for (const candidateId of originalReviewIds.filter((id) => !retainedReviewIds.has(id))) {
              await excludeProductImageReview(Number(activityId), candidateId);
            }
          }
          const desiredPersistedIds = new Set(desiredImages.map((image) => Number(image.id)).filter(Number.isSafeInteger));
          const originalPersistedIds = (editingProductRow.images ?? []).map((image) => Number(image.id)).filter(Number.isSafeInteger);
          for (const imageId of originalPersistedIds.filter((imageId) => !desiredPersistedIds.has(imageId))) {
            await deleteAdminProductImage(Number(activityId), productId, imageId);
          }
          const uploadedIds = new Map<string, number>();
          for (const image of desiredImages.filter((item) => !Number.isSafeInteger(Number(item.id)) && item.file)) {
            const uploaded = await addAdminProductImage(Number(activityId), productId, image.file!, false);
            uploadedIds.set(image.id, uploaded.id);
          }
          const orderedImageIds = desiredImages.map((image) => Number.isSafeInteger(Number(image.id)) ? Number(image.id) : uploadedIds.get(image.id))
            .filter((imageId): imageId is number => imageId !== undefined);
          for (let index = 0; index < orderedImageIds.length; index += 1) {
            await updateAdminProductImage(Number(activityId), productId, orderedImageIds[index], index === 0, index);
          }
          const [refreshedProducts, refreshedReviews] = await Promise.all([
            loadAdminProducts(Number(activityId)), loadProductImageReviews(Number(activityId)),
          ]);
          refreshedCatalogRows = mergeProductImageReviews(refreshedProducts.map(runtimeProductToImportRow), refreshedReviews);
          const refreshed = refreshedProducts.find((product) => product.id === productId);
          if (refreshed) savedRow = { ...runtimeProductToImportRow(refreshed), manuallyEdited: true };
        } catch (error) { setActionNotice(error instanceof ApiError ? `商品或图片保存失败：${error.message}` : "商品或图片保存失败，请刷新后重试"); return false; }
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
        setProductRows(refreshedCatalogRows);
      } else {
        setProductRows((current) => current.map(applySavedPreviewImage));
        const previewRowsAfterSave = productRows.map(applySavedPreviewImage);
        setProductImageAssets((current) => synchronizeProductImageAssetStatuses(current, previewRowsAfterSave));
        await refreshServerImportPreview("PRODUCT");
      }
      if (activityStarted) recordOperation("活动开始后改单条商品", nextRow.materialName, `修改前：物料代码 ${editingProductRow.materialCode || "—"}、名称 ${editingProductRow.materialName || "—"}、元/箱 ${editingProductRow.casePrice || "—"}、分公司 ${editingProductRow.branchScope || "全部"}、状态 ${editingProductRow.status}；修改后：物料代码 ${nextRow.materialCode || "—"}、名称 ${nextRow.materialName || "—"}、元/箱 ${nextRow.casePrice || "—"}、分公司 ${nextRow.branchScope || "全部"}、状态 ${nextRow.status}；原因：${reason || "—"}。`);
      setActionNotice("保存成功");
      return true;
    }
    if (!productImportCompleted && productFileName) {
      setActionNotice("导入预览阶段不能新增商品；请先发布本次 Excel，再使用单条新增。");
      return false;
    }
    let manualRow: ProductImportRow = { ...nextRow, source: "manual", manuallyEdited: true };
    if (productImportCompleted) {
      try {
        const saved = await createAdminProduct(Number(activityId), productBody);
        manualRow = { ...manualRow, id: String(saved.id), serverVersion: saved.version, sequence: saved.sortNo,
          status: saved.dataStatus === "INCOMPLETE" ? "待完善" : "有效" };
        const desiredImages = nextRow.images ?? [];
        if (desiredImages.length > 0) {
          const uploadedIds = new Map<string, number>();
          for (const image of desiredImages.filter((item) => item.file)) {
            const uploaded = await addAdminProductImage(Number(activityId), Number(saved.id), image.file!, false);
            uploadedIds.set(image.id, uploaded.id);
          }
          const orderedImageIds = desiredImages.map((image) => Number.isSafeInteger(Number(image.id)) ? Number(image.id) : uploadedIds.get(image.id))
            .filter((imageId): imageId is number => imageId !== undefined);
          for (let index = 0; index < orderedImageIds.length; index += 1) {
            await updateAdminProductImage(Number(activityId), Number(saved.id), orderedImageIds[index], index === 0, index);
          }
          const refreshedProducts = await loadAdminProducts(Number(activityId));
          const refreshed = refreshedProducts.find((product) => product.id === Number(saved.id));
          if (refreshed) manualRow = { ...runtimeProductToImportRow(refreshed), manuallyEdited: true };
        }
      } catch (error) { setActionNotice(error instanceof ApiError ? error.message : "商品新增失败"); return false; }
    }
    setProductRows((current) => [...current, manualRow]);
    if (!productImportCompleted && productFileName) {
      setProductImportInputCount((current) => current + 1);
    }
    recordOperation(activityStarted ? "活动开始后手动新增商品" : "手动添加商品", manualRow.materialName, `物料代码：${manualRow.materialCode || "—"}；客户类型：${manualRow.customerType}；返利：${manualRow.rebate}；${activityStarted ? `原因：${reason || "—"}。` : ""}`);
    setActionNotice(`${activityStarted ? "已记录并添加" : "已添加"}商品：${manualRow.materialName}`);
    return true;
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
      const targets = productRows.filter((row) => ids.includes(row.id) && row.serverVersion !== undefined);
      try {
        for (const row of targets) await deleteAdminProduct(Number(activityId), Number(row.id), row.serverVersion!);
      } catch (error) { setActionNotice(error instanceof ApiError ? error.message : "商品移除失败"); return; }
    }
    setProductRows((current) => current.filter((row) => !ids.includes(row.id)));
    if (!productImportCompleted) await refreshServerImportPreview("PRODUCT");
    setEditingProductRow((current) => current && ids.includes(current.id) ? null : current);
    recordOperation("删除商品", `${ids.length} 条商品`, "从当前有效商品列表移除；已有订单明细和金额不受影响。" );
    setActionNotice(`${productImportCompleted ? "已删除" : "已从待导入结果移除"} ${ids.length} 条商品，已有订单明细和金额不受影响。`);
  };
  return { editingProductRow, setEditingProductRow, productFormOpen, setProductFormOpen, openProductForm, saveProductRow, deleteProductRows };
}
