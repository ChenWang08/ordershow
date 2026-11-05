import { addAdminProductImage, deleteAdminProductImage, updateAdminProductImage, selectProductImageReview,
  excludeProductImageReview, loadAdminProductEditorState } from "../../api";
import type { ProductImageAsset } from "../../domain/import-domain";
import { productImageRelationStatus } from "../../domain/product-images";

const persisted = (image: ProductImageAsset) => !image.reviewCandidateId && Number.isSafeInteger(Number(image.id));
const fileId = (url: string) => url.match(/\/public\/files\/(\d+)/)?.[1];

/** Image writes are independent from product detail writes; unchanged images need no requests. */
export async function saveProductImages(activityId: number, productId: number, desired: ProductImageAsset[],
  original: ProductImageAsset[], groupNames: string[]) {
  let changed = false;
  const selected = desired.find(image => image.reviewCandidateId && productImageRelationStatus(image) === "CONFIRMED"
    && !original.some(old => old.reviewCandidateId === image.reviewCandidateId && productImageRelationStatus(old) === "CONFIRMED"));
  if (selected?.reviewCandidateId) { await selectProductImageReview(activityId, selected.reviewCandidateId); changed = true; }
  if (!selected) {
    const retained = new Set(desired.map(image => image.reviewCandidateId));
    for (const image of original.filter(image => image.reviewCandidateId && !retained.has(image.reviewCandidateId))) {
      await excludeProductImageReview(activityId, image.reviewCandidateId!); changed = true;
    }
  }
  const desiredIds = new Set(desired.filter(persisted).map(image => Number(image.id)));
  for (const image of original.filter(image => persisted(image) && !desiredIds.has(Number(image.id)))) {
    await deleteAdminProductImage(activityId, productId, Number(image.id)); changed = true;
  }
  const uploaded = new Map<string, number>();
  for (const image of desired.filter(image => !persisted(image) && image.file)) {
    uploaded.set(image.id, (await addAdminProductImage(activityId, productId, image.file!, false)).id); changed = true;
  }
  // Selection creates a new product-image ID; resolve it from the authoritative group snapshot.
  const selectedState = selected ? await loadAdminProductEditorState(activityId, productId, groupNames) : null;
  const actual = selectedState?.products.find(product => product.id === productId)?.images;
  const orderedIds = desired.filter(image => productImageRelationStatus(image) === "CONFIRMED").map(image => {
    if (persisted(image)) return Number(image.id);
    const id = uploaded.get(image.id) ?? actual?.find(item => String(item.fileId) === fileId(image.url))?.id;
    if (id === undefined) throw new Error("商品图片保存结果不完整，请刷新列表核对");
    return id;
  });
  const originalIds = actual ? [...actual].sort((a, b) => Number(b.primary) - Number(a.primary) || a.sortNo - b.sortNo).map(image => image.id)
    : original.filter(persisted).map(image => Number(image.id));
  for (let index = 0; index < orderedIds.length; index++) {
    const actualImage = actual?.find(image => image.id === orderedIds[index]);
    if (originalIds[index] !== orderedIds[index] || (actualImage && (actualImage.sortNo !== index || actualImage.primary !== (index === 0)))) {
      await updateAdminProductImage(activityId, productId, orderedIds[index], index === 0, index); changed = true;
    }
  }
  return changed ? loadAdminProductEditorState(activityId, productId, groupNames) : null;
}
