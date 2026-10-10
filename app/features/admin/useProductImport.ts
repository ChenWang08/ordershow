"use client";

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  ApiError, cancelImport, confirmImport, loadAdminProducts, loadProductImageReviews,
  loadImportRows, uploadImport, waitForImport, type ImportStagingRow,
} from "../../api";
import {
  bindProductStaging, cloneProductRows, summarizeProductImportRows, productImportIdentityKey,
  type ProductImportRow, type ProductImageAsset, type ProductImageStats,
} from "../../domain/import-domain";
import {
  buildProductImageDecisions, matchProductImages, parseProductImageZip,
  revokeProductImageAssets, synchronizeProductImageAssetStatuses,
} from "../../domain/product-images";
import { mergeProductImageReviews, parseProductWorkbook, runtimeProductToImportRow } from "./admin-utils";
import type { ImportTaskIds, ProductModuleOptions } from "./product-module-types";

type ProductImportOptions = ProductModuleOptions & {
  productImportHasRun: boolean;
  setProductImportCompleted: (completed: boolean) => void;
  onProductImportCommitted: () => void;
  setServerImportTasks: Dispatch<SetStateAction<ImportTaskIds>>;
  setServerImportBlocking: Dispatch<SetStateAction<ImportTaskIds>>;
  serverImportBlocking: ImportTaskIds;
};

// Mounted by the admin shell: navigating between tabs must retain the import preview.
export function useProductImport({
  activityId, activityStatus, productRows, setProductRows, productImportHasRun, setProductImportCompleted, onProductImportCommitted,
  serverImportTasks, setServerImportTasks, serverImportBlocking, setServerImportBlocking,
  setActionNotice, recordOperation,
}: ProductImportOptions) {
  const activityPublished = activityStatus !== "draft";
  const [productFileName, setProductFileName] = useState("");
  const [productImportWarnings, setProductImportWarnings] = useState<string[]>([]);
  const [productImportError, setProductImportError] = useState("");
  const [productSheetCounts, setProductSheetCounts] = useState<Array<{ name: string; count: number }>>([]);
  const [productImportInputCount, setProductImportInputCount] = useState(0);
  const productImportStats = useMemo(() => summarizeProductImportRows(productRows), [productRows]);
  const [pendingProductRollbackRows, setPendingProductRollbackRows] = useState<ProductImportRow[] | null>(null);
  const [productImageAssets, setProductImageAssets] = useState<ProductImageAsset[]>([]);
  const [productImageFileName, setProductImageFileName] = useState("");
  const [productImageAttemptName, setProductImageAttemptName] = useState("");
  const [productImageUploadFile, setProductImageUploadFile] = useState<File | null>(null);
  const productImageStats = useMemo<ProductImageStats>(() => ({
    totalProducts: productRows.length,
    matchedProducts: productRows.filter((row) => row.imageStatus === "已匹配").length,
    pendingProducts: productRows.filter((row) => row.imageStatus === "待确认").length,
    unmatchedProducts: productRows.filter((row) => row.imageStatus !== "已匹配" && row.imageStatus !== "待确认").length,
  }), [productRows]);
  const resolvedProductImageAssets = useMemo(
    () => synchronizeProductImageAssetStatuses(productImageAssets, productRows),
    [productImageAssets, productRows],
  );
  const [productImageError, setProductImageError] = useState("");
  const beginProductImport = () => {
    if (activityPublished) {
      setActionNotice("活动发布后商品 Excel 已锁定，请先撤回发布。");
      return;
    }
    setProductImportCompleted(false);
    setProductFileName("");
    setProductSheetCounts([]);
    setProductImportWarnings([]);
    setProductImportError("");
    setProductImportInputCount(0);
    setPendingProductRollbackRows(null);
    revokeProductImageAssets(productImageAssets);
    setProductImageAssets([]);
    setProductImageFileName("");
    setProductImageAttemptName("");
    setProductImageUploadFile(null);
  };
  const cancelProductImport = async () => {
    const taskId = serverImportTasks.PRODUCT;
    if (taskId && Number.isFinite(Number(activityId))) {
      try {
        await cancelImport(Number(activityId), taskId);
      } catch (error) {
        setActionNotice(error instanceof ApiError ? error.message : "取消商品导入失败，请稍后重试。");
        return;
      }
      setServerImportTasks((current) => ({ ...current, PRODUCT: undefined }));
      setServerImportBlocking((current) => ({ ...current, PRODUCT: 0 }));
    }
    const hadConfirmedImport = productImportHasRun;
    if (pendingProductRollbackRows) setProductRows(cloneProductRows(pendingProductRollbackRows));
    setPendingProductRollbackRows(null);
    revokeProductImageAssets(productImageAssets);
    setProductImageAssets([]);
    setProductImageFileName("");
    setProductImageAttemptName("");
    setProductImageUploadFile(null);
    setProductFileName("");
    setProductSheetCounts([]);
    setProductImportWarnings([]);
    setProductImportError("");
    setProductImportInputCount(0);
    setProductImportCompleted(hadConfirmedImport);
    setActionNotice("已取消本次商品替换，当前商品目录保持不变。" );
  };
  const confirmProductImport = async () => {
    if (activityPublished) {
      setActionNotice("活动发布后禁止确认商品 Excel 导入，请先撤回发布。");
      return;
    }
    if ((serverImportBlocking.PRODUCT ?? 0) > 0) {
      setActionNotice(`仍有 ${serverImportBlocking.PRODUCT} 条商品异常，请先编辑或删除后再发布。`);
      return;
    }
    const imageWarningCount = productImageStats.pendingProducts + productImageStats.unmatchedProducts;
    const previousRestricted = (pendingProductRollbackRows ?? []).filter(row => (row.dealerScope?.length ?? 0) > 0);
    const identity = productImportIdentityKey;
    const newIdentities = new Set(productRows.map(identity));
    const notInherited = previousRestricted.filter(row => !newIdentities.has(identity(row)));
    if (notInherited.length && !window.confirm(`有 ${notInherited.length} 个原商品的经销商限制无法按商品身份继承：${notInherited.slice(0,5).map(row => row.materialName).join("、")}。新商品以本次 Excel 分公司限制为准，需在确认导入后重新设置经销商限制。是否继续？`)) return;
    if (imageWarningCount > 0 && !window.confirm(`本批次有 ${productImageStats.pendingProducts} 个商品图片待确认、${productImageStats.unmatchedProducts} 个商品图片未匹配。发布后这些商品将使用默认图片，是否继续？`)) return;
    const taskId = serverImportTasks.PRODUCT;
    let publishedRows: ProductImportRow[] | null = null;
    if (taskId) {
      try {
        await confirmImport(Number(activityId), taskId, productImageUploadFile ?? undefined,
          buildProductImageDecisions(productRows, resolvedProductImageAssets));
        await waitForImport(Number(activityId), taskId);
        const [products, imageReviews] = await Promise.all([
          loadAdminProducts(Number(activityId)), loadProductImageReviews(Number(activityId)),
        ]);
        publishedRows = mergeProductImageReviews(products.map(runtimeProductToImportRow), imageReviews);
      } catch (error) {
        setActionNotice(error instanceof ApiError ? error.message : "商品导入发布失败，请检查后重试。");
        return;
      }
    }
    const cleanRows = publishedRows ?? productRows;
    setProductRows(cleanRows);
    setPendingProductRollbackRows(null);
    setProductImportCompleted(true);
    onProductImportCommitted();
    recordOperation("替换商品 Excel", productFileName || "商品信息 Excel", `共 ${productImportStats.total} 条；有效 ${productImportStats.valid} 条，待完善 ${productImportStats.incomplete} 条。`);
    setActionNotice(`商品目录已替换：共 ${productImportStats.total} 条，有效 ${productImportStats.valid} 条、待完善 ${productImportStats.incomplete} 条${productImageUploadFile ? "，本批次图片已同步" : "，未匹配商品使用默认图片"}。`);
  };
  const handleProductFile = async (file: File) => {
    if (activityPublished) {
      setProductImportError("活动发布后商品 Excel 已锁定，请先撤回发布。");
      setActionNotice("活动发布后商品 Excel 已锁定，请先撤回发布。");
      return;
    }
    setProductImportError("");
    try {
      const result = await parseProductWorkbook(file);
      let serverRows: ImportStagingRow[] = [];
      if (Number.isFinite(Number(activityId))) {
        const task = await uploadImport(Number(activityId), "PRODUCT", file);
        setServerImportTasks((current) => ({ ...current, PRODUCT: Number(task.id) }));
        setServerImportBlocking((current) => ({ ...current, PRODUCT: Number(task.errorCount || 0) }));
        serverRows = await loadImportRows(Number(activityId), Number(task.id));
      }
      revokeProductImageAssets(productImageAssets);
      const imageResult = matchProductImages(result.rows, []);
      const nextRows = bindProductStaging(imageResult.rows, serverRows);
      setProductImageAssets([]);
      setProductImageFileName("");
      setProductImageAttemptName("");
      setProductImageUploadFile(null);
      setPendingProductRollbackRows(pendingProductRollbackRows ? pendingProductRollbackRows : cloneProductRows(productRows));
      setProductRows(nextRows);
      setProductFileName(file.name);
      setProductSheetCounts(result.sheetCounts);
      setProductImportInputCount(result.rows.length);
      setProductImportWarnings(result.warnings);
      setProductImportCompleted(false);
      const stats = summarizeProductImportRows(nextRows);
      setActionNotice(`已解析 ${stats.total} 条商品：有效 ${stats.valid} 条、待完善 ${stats.incomplete} 条、待核对 ${stats.review} 条，请检查后确认替换。`);
    } catch (error) {
      setProductFileName(file.name);
      setProductSheetCounts([]);
      setProductImportInputCount(0);
      setProductImportWarnings([]);
      setProductImportError(error instanceof Error ? error.message : "文件解析失败，请检查 Excel 格式。");
      setProductImportCompleted(false);
    }
  };
  const handleProductImageFile = async (file: File) => {
    if (activityPublished) {
      setProductImageError("活动发布后禁止批量导入商品图片，请先撤回发布。");
      setActionNotice("活动发布后禁止批量导入商品图片，请先撤回发布。");
      return;
    }
    setProductImageError("");
    setProductImageAttemptName(file.name);
    try {
      const assets = await parseProductImageZip(file);
      const imageResult = matchProductImages(productRows, assets);
      revokeProductImageAssets(productImageAssets);
      setProductImageAssets(imageResult.assets);
      setProductImageFileName(file.name);
      setProductImageUploadFile(file);
      setProductRows(imageResult.rows);
      setActionNotice(`已读取 ${assets.length} 张图片：已匹配 ${imageResult.stats.matchedProducts} 个商品、待确认 ${imageResult.stats.pendingProducts} 个商品、未匹配 ${imageResult.stats.unmatchedProducts} 个商品。`);
    } catch (error) {
      setProductImageError(error instanceof Error ? error.message : "图片 ZIP 解析失败，请检查文件。");
    }
  };
  const removeProductImages = () => {
    if (activityPublished) {
      setActionNotice("活动发布后禁止批量移除商品图片，请先撤回发布。");
      return;
    }
    revokeProductImageAssets(productImageAssets);
    setProductImageAssets([]);
    setProductImageFileName("");
    setProductImageAttemptName("");
    setProductImageUploadFile(null);
    setProductImageError("");
    setProductRows((current) => current.map((row) => ({ ...row, images: undefined, imageStatus: "未匹配" })));
    setActionNotice("已移除本批次 ZIP，全部商品恢复为未匹配；当前已发布目录不受影响。");
  };
  return {
    productFileName,
    setProductFileName,
    productImportWarnings,
    productImportError,
    productSheetCounts,
    setProductSheetCounts,
    productImportInputCount,
    setProductImportInputCount,
    productImportStats,
    setPendingProductRollbackRows,
    productImageStats,
    resolvedProductImageAssets,
    productImageFileName: productImageError ? productImageAttemptName || productImageFileName : productImageFileName,
    productImageError,
    setProductImageAssets,
    beginProductImport,
    cancelProductImport,
    confirmProductImport,
    handleProductFile,
    handleProductImageFile,
    removeProductImages,
  };
}
