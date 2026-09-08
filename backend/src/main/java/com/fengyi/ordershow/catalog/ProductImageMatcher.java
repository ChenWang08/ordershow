package com.fengyi.ordershow.catalog;

import com.fengyi.ordershow.catalog.ProductService.ProductView;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;


final class ProductImageMatcher {
  private ProductImageMatcher() {}
  static ImageCandidates imageCandidates(String filename, List<ProductView> products) {
    List<String> imageKeys = imagePathCandidates(filename).stream().map(ProductImageMatcher::imageMatchName).filter(key -> !key.isBlank()).toList();
    if (imageKeys.isEmpty()) return new ImageCandidates(List.of(), false);
    Map<String, List<ProductView>> groups = products.stream()
        .collect(java.util.stream.Collectors.groupingBy(product -> imageMatchName(product.materialName())));
    for (String imageKey : imageKeys) {
      List<ProductView> exact = groups.get(imageKey);
      if (exact != null) return new ImageCandidates(exact, false);
    }

    double best = 0;
    List<String> bestKeys = new ArrayList<>();
    for (String productKey : groups.keySet()) {
      if (productKey.isBlank()) continue;
      double score = imageKeys.stream().mapToDouble(imageKey -> imageNameScore(imageKey, productKey)).max().orElse(0);
      if (score > best + 0.015) {
        best = score;
        bestKeys.clear();
        bestKeys.add(productKey);
      } else if (score >= best - 0.015 && score > 0) {
        bestKeys.add(productKey);
      }
    }
    if (best < 0.55 || bestKeys.isEmpty()) return new ImageCandidates(List.of(), false);
    if (best < 0.90 || bestKeys.size() > 1) return new ImageCandidates(List.of(), true);
    return new ImageCandidates(groups.get(bestKeys.getFirst()), false);
  }

  static double imageNameScore(String image, String product) {
    if (signaturesConflict(signature(image), signature(product))) return 0;
    if (image.equals(product)) return 1;
    String imageCore = withoutPackaging(image).replace("x", "");
    String productCore = withoutPackaging(product).replace("x", "");
    if (imageCore.equals(productCore)) return 0.98;
    if (image.contains(product) || product.contains(image)) {
      double ratio = (double) Math.min(image.length(), product.length()) / Math.max(image.length(), product.length());
      if (Math.min(image.length(), product.length()) >= 7 && ratio >= 0.5) return 0.91 + ratio * 0.08;
    }
    int distance = editDistance(image, product);
    return 1d - (double) distance / Math.max(image.length(), product.length());
  }

  private static int editDistance(String left, String right) {
    int[] previous = new int[right.length() + 1];
    for (int column = 0; column <= right.length(); column++) previous[column] = column;
    for (int row = 1; row <= left.length(); row++) {
      int[] current = new int[right.length() + 1];
      current[0] = row;
      for (int column = 1; column <= right.length(); column++) {
        int replace = previous[column - 1] + (left.charAt(row - 1) == right.charAt(column - 1) ? 0 : 1);
        current[column] = Math.min(Math.min(previous[column] + 1, current[column - 1] + 1), replace);
      }
      previous = current;
    }
    return previous[right.length()];
  }

  private static String imageMatchName(String value) {
    if (value == null) return "";
    String normalized = value.toLowerCase(Locale.CHINA)
        .replaceAll("^\\d{8}(?=[\\p{IsHan}])", "")
        .replaceAll("(?i)(主图|产品图|白底图|清图|组装好发货|天津定制|河南定制|北京定制|武汉分特渠|随货发)", "")
        .replaceAll("(?i)[\\-_]o$", "")
        .replace('×', 'x').replace('*', 'x')
        .replaceAll("[^\\p{IsHan}a-z0-9.]", "")
        .replaceAll("(主图|清)\\d*$", "");
    return normalized;
  }

  static List<String> imagePathCandidates(String path) {
    if (path == null) return List.of();
    List<String> segments = new ArrayList<>(java.util.Arrays.stream(path.replace('\\', '/').split("/"))
        .map(String::trim).filter(segment -> !segment.isBlank() && !segment.equals(".") && !segment.equals("..")).toList());
    if (segments.isEmpty()) return List.of();
    int last = segments.size() - 1;
    segments.set(last, segments.get(last).replaceFirst("(?i)\\.(jpg|jpeg|png|webp|gif|bmp)$", ""));
    java.util.LinkedHashSet<String> candidates = new java.util.LinkedHashSet<>();
    for (int start = 0; start < segments.size(); start++) {
      String candidate = String.join("", segments.subList(start, segments.size()));
      if (imageMatchName(candidate).length() >= 6) candidates.add(candidate);
    }
    return List.copyOf(candidates);
  }

  private static final List<String> IMAGE_VARIETIES = List.of(
      "清香米醋", "香甜米醋", "精酿陈醋", "山西陈醋", "镇江香醋", "酿造白醋", "零添加米醋",
      "零添加特级味极鲜", "零添加金标生抽", "蒸鱼豉油酱油", "蒸鱼豉油", "味极鲜酱油", "金标生抽", "薄盐生抽", "红烧老抽", "草菇老抽", "生抽", "老抽",
      "藤椒油", "花椒油", "小磨香油", "芝麻油", "调和油", "菜籽油", "玉米油", "葵花籽油",
      "白醋", "陈醋", "香醋", "米醋");
  private static final List<String> IMAGE_BRANDS = List.of("金龙鱼", "梁汾", "丸庄", "香满园", "胡姬花", "口福");
  private static final List<String> IMAGE_CATEGORIES = List.of("酱油", "陈醋", "香醋", "米醋", "白醋", "醋", "料酒", "蚝油", "调味油", "食用油");
  private static final List<String> IMAGE_GRADES = List.of("特级", "一级", "二级", "三级");

  private static ImageSignature signature(String value) {
    String normalized = imageMatchName(value);
    Set<String> volumes = new HashSet<>();
    java.util.regex.Matcher volumeMatcher = java.util.regex.Pattern.compile("(\\d+(?:\\.\\d+)?)(ml|kg|l|g)").matcher(normalized);
    while (volumeMatcher.find()) {
      double amount = Double.parseDouble(volumeMatcher.group(1));
      String unit = volumeMatcher.group(2);
      double converted = unit.equals("l") || unit.equals("kg") ? amount * 1000 : amount;
      volumes.add(java.math.BigDecimal.valueOf(converted).stripTrailingZeros().toPlainString() + (unit.equals("l") || unit.equals("ml") ? "ml" : "g"));
    }
    Set<String> packs = regexTokens(normalized, "x(\\d+)", 1);
    packs.addAll(regexTokens(normalized, "(?:ml|kg|g|l)(\\d+)(?!\\d)", 1));
    String brand = longestContained(normalized, IMAGE_BRANDS);
    String category = longestContained(normalized, IMAGE_CATEGORIES).replaceAll("(?:陈|香|米|白)醋", "醋");
    String variety = IMAGE_VARIETIES.stream().filter(normalized::contains).max(java.util.Comparator.comparingInt(String::length)).orElse("");
    String grade = longestContained(normalized, IMAGE_GRADES);
    return new ImageSignature(volumes, packs, brand, category, variety, grade,
        namedTokens(normalized, Map.of("玻璃瓶", "glass", "塑料瓶", "pet", "pet瓶", "pet", "pe瓶", "pe", "pe壶", "pe", "铁罐", "metal")),
        namedTokens(normalized, Map.of("葫芦瓶", "gourd")),
        namedTokens(normalized, Map.of("纸箱", "carton", "礼盒", "gift", "塑料袋", "bag", "袋装", "bag", "散装", "bulk")));
  }

  private static String longestContained(String value, List<String> terms) {
    return terms.stream().filter(value::contains).max(java.util.Comparator.comparingInt(String::length)).orElse("");
  }

  private static Set<String> regexTokens(String value, String regex, int group) {
    Set<String> tokens = new HashSet<>();
    java.util.regex.Matcher matcher = java.util.regex.Pattern.compile(regex).matcher(value);
    while (matcher.find()) tokens.add(matcher.group(group));
    return tokens;
  }

  private static Set<String> namedTokens(String value, Map<String, String> terms) {
    return terms.entrySet().stream().filter(entry -> value.contains(entry.getKey())).map(Map.Entry::getValue).collect(java.util.stream.Collectors.toSet());
  }

  private static boolean setsConflict(Set<String> first, Set<String> second) {
    return !first.isEmpty() && !second.isEmpty() && first.stream().noneMatch(second::contains);
  }

  private static boolean signaturesConflict(ImageSignature first, ImageSignature second) {
    return setsConflict(first.volumes(), second.volumes()) || setsConflict(first.packCounts(), second.packCounts())
        || (!first.brand().isBlank() && !second.brand().isBlank() && !first.brand().equals(second.brand()))
        || (!first.category().isBlank() && !second.category().isBlank() && !first.category().equals(second.category()))
        || (!first.variety().isBlank() && !second.variety().isBlank() && !first.variety().equals(second.variety()))
        || (!first.grade().isBlank() && !second.grade().isBlank() && !first.grade().equals(second.grade()))
        || setsConflict(first.containerMaterial(), second.containerMaterial())
        || setsConflict(first.containerShape(), second.containerShape())
        || setsConflict(first.outerPackaging(), second.outerPackaging());
  }

  private static String withoutPackaging(String value) {
    return value.replaceAll("(?i)(玻璃瓶|塑料瓶|塑料袋|纸箱|pe瓶|pe壶|pet瓶|pet|葫芦瓶|铁罐|礼盒随货发|礼盒随货|礼盒|袋装|散装)", "");
  }

  static String materialNameKey(String value) {
    return imageMatchName(value);
  }

  static String baseName(String path) { String name = path.replace('\\', '/'); name = name.substring(name.lastIndexOf('/') + 1); int dot = name.lastIndexOf('.'); return (dot > 0 ? name.substring(0, dot) : name).trim(); }

  private static String normalize(String value) { return value == null ? "" : value.toLowerCase(Locale.CHINA).replaceAll("[\\s　_\\-（）()\\[\\]【】{}：:，,。·/\\\\]+", ""); }

  record ImageCandidates(List<ProductView> products, boolean ambiguous) {}
  private record ImageSignature(Set<String> volumes, Set<String> packCounts, String brand, String category, String variety, String grade,
                                Set<String> containerMaterial, Set<String> containerShape, Set<String> outerPackaging) {}
}
