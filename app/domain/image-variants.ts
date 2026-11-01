/** Versioned public image derivatives. Original URLs keep their existing meaning. */
export function imageVariantUrl(url?: string | null, variant: "thumbnail" | "display" = "thumbnail") {
  if (!url) return "";
  const match = url.match(/^(.*\/public\/files\/\d+)(?:\/(?:thumbnail|display))?(?:\?[^#]*)?$/);
  return match ? `${match[1]}/${variant}?v=1` : "";
}
