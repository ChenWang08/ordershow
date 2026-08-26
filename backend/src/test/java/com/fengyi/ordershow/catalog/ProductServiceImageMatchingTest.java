package com.fengyi.ordershow.catalog;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ProductServiceImageMatchingTest {

  @Test
  void restoresProductNameFromZipPathSegments() {
    assertThat(ProductService.imagePathCandidates("产品图片/醋/金龙鱼清香米醋/420mL×15(玻璃瓶/纸箱).jpg"))
        .contains("金龙鱼清香米醋420mL×15(玻璃瓶纸箱)");
  }

  @Test
  void matchesSameProductWithEquivalentSeparators() {
    assertThat(ProductService.imageNameScore(
        "金龙鱼清香米醋420mlx15玻璃瓶纸箱",
        "金龙鱼清香米醋420mlx15玻璃瓶纸箱")).isEqualTo(1d);
  }

  @Test
  void rejectsDifferentVarietyEvenWhenNamesAreSimilar() {
    assertThat(ProductService.imageNameScore(
        "金龙鱼花椒油100mlx20葫芦瓶",
        "金龙鱼藤椒油100mlx20葫芦瓶")).isZero();
  }

  @Test
  void rejectsDifferentCasePack() {
    assertThat(ProductService.imageNameScore(
        "金龙鱼藤椒油100mlx6葫芦瓶",
        "金龙鱼藤椒油100mlx20葫芦瓶")).isZero();
  }

  @Test
  void rejectsExplicitContainerConflict() {
    assertThat(ProductService.imageNameScore(
        "金龙鱼清香米醋420mlx15塑料瓶纸箱",
        "金龙鱼清香米醋420mlx15玻璃瓶纸箱")).isZero();
  }

  @Test
  void rejectsDifferentSoySauceVarietyAndGrade() {
    assertThat(ProductService.imageNameScore(
        "金龙鱼零添加特级味极鲜酱油特级1.8lx6纸箱",
        "金龙鱼蒸鱼豉油酱油y二级1.8lx6纸箱")).isZero();
    assertThat(ProductService.imageNameScore(
        "金龙鱼零添加金标生抽一级1.8lx6纸箱",
        "金龙鱼蒸鱼豉油酱油y二级1.8lx6纸箱")).isZero();
  }

  @Test
  void rejectsDifferentBrandAndCategory() {
    assertThat(ProductService.imageNameScore(
        "梁汾陈醋4.5度1.8lx6纸箱",
        "金龙鱼蒸鱼豉油酱油y二级1.8lx6纸箱")).isZero();
  }
}
