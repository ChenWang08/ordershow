"use client";

import { type ProductImageAsset, type ProductImageStats } from "../../../domain/import-domain";
import { Thumbnail } from "../../shared/components/Thumbnail";

export function ProductImageUploadCard({ fileName, stats, assets, error, loading = false, disabled = false, disabledMessage = "请先上传商品 Excel", onFile, onRemove }: { fileName: string; stats: ProductImageStats; assets: ProductImageAsset[]; error: string; loading?: boolean; disabled?: boolean; disabledMessage?: string; onFile: (file: File) => void | Promise<void>; onRemove: () => void }) {
  const ready = Boolean(fileName && !error);
  const reviewAssets = assets.filter((asset) => asset.matchStatus === "待确认" || asset.matchStatus === "未匹配");
  return (
    <article className={`file-upload-card image-upload-card ${ready ? "ready" : ""}`}>
      <div className="file-card-heading"><span>图</span><div><b>商品图片 ZIP</b><small>按商品物料名称匹配图片</small></div><em>{loading ? "正在处理" : error ? "解析失败" : fileName ? "解析完成" : "待上传"}</em></div>
      {fileName ? <p title={fileName}>{fileName}</p> : <p>尚未选择商品图片 ZIP 文件（选填）</p>}
      <div className="image-import-stats"><span>商品<b>{stats.totalProducts}</b></span><span>已匹配<b>{stats.matchedProducts}</b></span><span>待确认<b>{stats.pendingProducts}</b></span><span>未匹配<b>{stats.unmatchedProducts}</b></span></div>
      {reviewAssets.length > 0 && <div className="image-match-review"><b>需要处理的图片</b><div>{reviewAssets.map((asset) => <div className="image-match-review-row" key={asset.id}><Thumbnail src={asset.url} alt="" /><span title={asset.fileName}>{asset.fileName}</span><em className={asset.matchStatus === "待确认" ? "pending" : "unmatched"}>{asset.matchStatus}</em></div>)}</div></div>}
      {error && <small className="image-upload-error">{error}</small>}
      <footer><small>{disabled ? disabledMessage : ready ? `已预览 ${assets.length} 张图片，确认替换后才会保存` : "支持 JPG、PNG、WEBP、GIF、BMP"}</small><div>{fileName && <button type="button" disabled={disabled} onClick={onRemove}>移除</button>}<label className={disabled ? "disabled" : ""}><input type="file" accept=".zip,application/zip" disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; if (file) void onFile(file); event.currentTarget.value = ""; }} />{fileName ? "替换 ZIP" : "选择 ZIP"}</label></div></footer>
    </article>
  );
}
