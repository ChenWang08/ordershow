import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/load-ts-module.mjs";
const asset=(id,extra={})=>({id:String(id),url:"/api/v1/public/files/"+id,relationStatus:"CONFIRMED",...extra});
const {
  buildProductImageDecisions, matchProductImages, productImageBaseName, productImagePathCandidates,
  readManualProductImage, revokeProductImageAssets,
} = loadModule("app/domain/product-images.ts");

test("manual product image selection accepts 2 MiB and names a file one byte over the limit", async () => {
  const limit = 2 * 1024 * 1024;
  const exact = new File([new Uint8Array(limit)], "at-limit.jpg");
  const oversized = new File([new Uint8Array(limit + 1)], "too-large.jpg");

  const selected = await readManualProductImage(exact);
  assert.equal(selected.file, exact);
  revokeProductImageAssets([selected]);
  await assert.rejects(readManualProductImage(oversized), /too-large\.jpg 超过 2 MiB/);
});

const importRow = (id, materialName) => ({ id: String(id), serverRowId: id, materialName });
const zipImage = (id, archivePath) => ({
  id, archivePath, source: "zip", url: `local-image:${id}`, fileName: productImageBaseName(archivePath),
  matchingNames: productImagePathCandidates(archivePath),
});

function importImageDecisions(rows, images) {
  const result = matchProductImages(rows, images);
  return buildProductImageDecisions(result.rows, result.assets).map(({ status, targetRowIds }) => [status, [...targetRowIds]]);
}

test("unique full-name matches take priority over near matches and are shared by same-name rows", () => {
  const rows = [
    importRow(1, "金龙鱼御品珍珠米/5kg×4(纸箱)LS-重庆工厂"),
    importRow(2, "金龙鱼御品珍珠米/5kg×4(纸箱)LS-除重庆工厂"),
    importRow(3, "金龙鱼御品珍珠米/5kg×4(纸箱)LS-重庆工厂"),
  ];
  const images = [
    zipImage("a", "products/金龙鱼御品珍珠米5kg×4(纸箱)LS-除重庆工厂.jpg"),
    zipImage("b", "products/金龙鱼御品珍珠米5kg×4(纸箱)LS-重庆工厂.jpg"),
  ];

  assert.deepEqual(importImageDecisions(rows, images), [["CONFIRMED", [2]], ["CONFIRMED", [1, 3]]]);
});

test("multiple exact images stay pending even when stored under separate ZIP folders", () => {
  const rows = [importRow(1, "金龙鱼御品珍珠米/5kg×4(纸箱)/财")];
  const images = [
    zipImage("a", "first/金龙鱼御品珍珠米5kg×4(纸箱)财.jpg"),
    zipImage("b", "second/金龙鱼御品珍珠米5kg×4(纸箱)财.png"),
  ];

  assert.deepEqual(importImageDecisions(rows, images), [["PENDING", [1]], ["PENDING", [1]]]);
});

test("fuzzy candidates keep their score gap and leave an exact match confirmed", () => {
  const rows = [
    importRow(1, "金龙鱼御品珍珠米/5kg×4(纸箱)/财"),
    importRow(2, "金龙鱼御品珍珠米/5kg×4(纸箱)/吉"),
  ];
  const images = [
    zipImage("a", "金龙鱼御品珍珠米5kg×4(纸箱)财.jpg"),
    zipImage("b", "金龙鱼御品珍珠米5kg4(纸箱)财.jpg"),
  ];

  assert.deepEqual(importImageDecisions(rows, images), [["CONFIRMED", [1]], ["PENDING", [2]]]);
});

test("a name reconstructed from ZIP folders still uses the existing fallback", () => {
  const rows = [importRow(1, "金龙鱼御品东北大米/5kg×4(纸箱)LS")];
  const images = [zipImage("a", "products/金龙鱼御品东北大米/5kg×4(纸箱)LS.jpg")];

  assert.deepEqual(importImageDecisions(rows, images), [["CONFIRMED", [1]]]);
});

test("normalization collisions between distinct material names stay pending", () => {
  const rows = [importRow(1, "金龙鱼御品东北大米"), importRow(2, "金龙鱼御品东北大米主图")];
  const images = [zipImage("a", "金龙鱼御品东北大米.jpg")];

  assert.deepEqual(importImageDecisions(rows, images), [["PENDING", [1, 2]]]);
});

function harness(extra={}) {
  const calls=[],api={
    deleteAdminProductImage:async(...args)=>calls.push(["delete",...args]),
    updateAdminProductImage:async(...args)=>calls.push(["order",...args]),
    addAdminProductImage:async(...args)=>{calls.push(["upload",...args]);return {id:9};},
    selectProductImageReview:async(...args)=>calls.push(["select",...args]),
    excludeProductImageReview:async(...args)=>calls.push(["exclude",...args]),
    loadAdminProductEditorState:async(...args)=>{calls.push(["state",...args]);return {products:[{id:2,images:[{id:9,fileId:90,primary:true,sortNo:0}]}],reviews:[]};},
    ...extra,
  };
  return {...loadModule("app/features/admin/product-editor-images.ts",{"../../api":api},{Error}),calls};
}
test("unchanged stored images and pending candidates need no image reads or writes",async()=>{
  const h=harness(), images=[asset(1),asset("review-5",{reviewCandidateId:5,relationStatus:"CANDIDATE"})];
  assert.equal(await h.saveProductImages(1,2,images,images,["商品"]),null);assert.deepEqual(h.calls,[]);
});
test("removing shared images deletes the removed ID, reorders the survivor and reads the affected group",async()=>{
  const h=harness();await h.saveProductImages(1,2,[asset(2)],[asset(1),asset(2)],["旧名","新名"]);
  assert.deepEqual(h.calls,[["delete",1,2,1],["order",1,2,2,true,0],["state",1,2,["旧名","新名"]]]);
});
test("primary changes keep every retained image and preserve the selected display order",async()=>{
  const h=harness();await h.saveProductImages(1,2,[asset(2),asset(1)],[asset(1),asset(2)],["商品"]);
  assert.deepEqual(h.calls.slice(0,2),[["order",1,2,2,true,0],["order",1,2,1,false,1]]);
  assert.equal(h.calls.filter(c=>c[0]==="delete").length,0);
});
test("selecting a review resolves its new stored ID and does not upload it again",async()=>{
  const h=harness();const candidate=asset("review-5",{url:"/api/v1/public/files/90",reviewCandidateId:5});
  await h.saveProductImages(1,2,[candidate],[{...candidate,relationStatus:"CANDIDATE"}],["商品"]);
  assert.deepEqual(h.calls.map(c=>c[0]),["select","state","state"]);
});
test("excluding a pending review does not delete stored images",async()=>{
  const h=harness();await h.saveProductImages(1,2,[],[asset("review-5",{reviewCandidateId:5,relationStatus:"CANDIDATE"})],["商品"]);
  assert.deepEqual(h.calls.map(c=>c[0]),["exclude","state"]);
});
test("manual upload uses the returned image identity and partial image failures propagate for reload",async()=>{
  const h=harness();await h.saveProductImages(1,2,[asset("local",{file:{}})],[],["商品"]);
  assert.deepEqual(h.calls.map(c=>c[0]),["upload","order","state"]);assert.equal(h.calls[1][3],9);
  const failure=harness({deleteAdminProductImage:async()=>{throw new Error("conflict");}});
  await assert.rejects(failure.saveProductImages(1,2,[],[asset(1)],["商品"]),/conflict/);
});
