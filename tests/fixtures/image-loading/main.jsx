import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ProductArt } from "/app/features/h5/ProductArt.tsx";
import { ProductImportTable } from "/app/features/admin/products/ProductImportTable.tsx";
import { ProductImageEditor } from "/app/features/admin/products/ProductImageEditor.tsx";
import { ProductImageUploadCard } from "/app/features/admin/products/ProductImageUploadCard.tsx";
import { ProductFormDrawer } from "/app/features/admin/products/ProductFormDrawer.tsx";
import { ProductImageViewer } from "/app/features/shared/components/ProductImageViewer.tsx";
import { ActivityBackgroundCard } from "/app/features/admin/ActivityBackgroundCard.tsx";
import { LotterySettings, LotteryBoard, initialLotteryRounds } from "/app/features/lottery/Lottery.tsx";
import { registerLocalImage, localThumbnailUrl, releaseLocalImage } from "/app/domain/local-image-preview.ts";
import { parseProductImageZip, revokeProductImageAssets } from "/app/domain/product-images.ts";
import JSZip from "jszip";
import "/app/globals.css";

const url = id => `/api/v1/public/files/${id}`;
const images = [1, 2, 3].map(id => ({ id: String(id), url: url(id), fileName: `image-${id}.jpg`, normalizedName: "image", source: "server" }));
const row = { id: "1", sequence: 1, customerType: "综合", rebate: "参与", category: "", line: "", materialCode: "", materialName: "图片测试商品", brand: "", variety: "", spec: "", casePack: "", unitPrice: "10", casePrice: "10", conversion: "10", gift: "否", branchScope: "", status: "有效", source: "manual", images, imageStatus: "已匹配" };
const kind = new URLSearchParams(location.search).get("kind") || "scroll";
window.previewReads = 0;
window.revokedUrls = [];
const revoke = URL.revokeObjectURL.bind(URL);
URL.revokeObjectURL = value => { window.revokedUrls.push(value); revoke(value); };
window.checkZip = async () => {
  const zip = new JSZip(); zip.file("图片测试商品.png", new Uint8Array([1, 2, 3]));
  const assets = await parseProductImageZip(new File([await zip.generateAsync({ type: "blob" })], "images.zip"));
  const lazy = assets[0].url.startsWith("local-image:"); revokeProductImageAssets(assets); return lazy;
};
function Fixture() {
  const [preview, setPreview] = useState(false);
  const [editing, setEditing] = useState(true);
  const [rows, setRows] = useState(images);
  const [local, setLocal] = useState("");
  window.prepareLocal = async () => {
    const canvas = document.createElement("canvas"); canvas.width = 1600; canvas.height = 800;
    canvas.getContext("2d").fillRect(0, 0, 1600, 800);
    const blob = await new Promise(resolve => canvas.toBlob(resolve));
    const token = registerLocalImage(async () => { window.previewReads++; return blob; });
    window.releasePreview = () => releaseLocalImage(token);
    window.readLocalThumbnail = () => localThumbnailUrl(token);
    setLocal(token);
  };
  if (kind === "table") return <ProductImportTable rows={[row]} onEdit={() => {}} />;
  if (kind === "editor") return <ProductImageEditor materialName={row.materialName} images={rows} onChange={setRows} />;
  if (kind === "drawer") return editing ? <ProductFormDrawer rows={[row]} initialRow={{ ...row, images: [] }} activityId={1} scopeEnabled={false} onClose={() => setEditing(false)} onSave={async () => ({ ok: true })} /> : <p>已关闭</p>;
  if (kind === "upload") return <ProductImageUploadCard fileName="images.zip" stats={{ totalProducts: 1, matchedProducts: 0, pendingProducts: 1, unmatchedProducts: 0 }} assets={images.map(image => ({ ...image, matchStatus: "待确认" }))} error="" onFile={() => {}} onRemove={() => {}} />;
  if (kind === "background") return <ActivityBackgroundCard activityId={1} editable={false} initialActivity={{ id: 1, h5BackgroundUrl: url(4), desktopBackgroundUrl: url(5) }} />;
  const rounds = [{ ...initialLotteryRounds[0], id: 1, prize: "奖品", prizeImageUrl: url(6), status: "published" }];
  if (kind === "lottery") return <LotterySettings active={false} rounds={rounds} attendanceRows={[]} activityId={1} customerCount={0} readOnly onChange={() => {}} />;
  if (kind === "board") return <LotteryBoard rounds={rounds} attendanceRows={[]} activityId={1} activityFinished={false} onComplete={() => {}} />;
  return <>
    <button onClick={() => setPreview(true)}>查看原图</button>
    <div id="scroll" style={{ height: 300, overflowY: "auto", width: 220 }}>
      {Array.from({ length: 30 }, (_, index) => <div key={index} style={{ height: 100 }}><ProductArt imageUrl={url(100 + index)} /></div>)}
      <div style={{ height: 100 }}><ProductArt imageUrl={local} /></div>
    </div>
    {preview && <ProductImageViewer productName="测试" images={images} onClose={() => setPreview(false)} />}
  </>;
}
createRoot(document.getElementById("root")).render(<React.StrictMode><Fixture /></React.StrictMode>);
