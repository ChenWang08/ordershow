package com.fengyi.ordershow.order;

import static org.assertj.core.api.Assertions.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.catalog.ProductService;
import com.fengyi.ordershow.common.TierPricing;
import com.fengyi.ordershow.common.TierPricing.Step;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;

class MultiTierPricingTest {
  private static final List<Step> TIERS = List.of(step(500,"290"),step(1000,"280"),step(2000,"270"),step(5000,"260"));
  private static Step step(long quantity,String price) { return new Step(quantity,new BigDecimal(price)); }
  private OrderPricingCalculator.PricingResult calculate(String mode,long quantity) {
    return OrderPricingCalculator.calculatePrice(new BigDecimal("300"),TIERS,mode,quantity);
  }

  @Test void wholeOrderUsesHighestReachedThresholdIncludingTheThresholdBox() {
    for (long quantity : new long[]{0,1,499,500,501,999,1000,1001,1999,2000,4999,5000,999999}) {
      int price=quantity>=5000?260:quantity>=2000?270:quantity>=1000?280:quantity>=500?290:300;
      assertThat(calculate("WHOLE_ORDER",quantity).lineAmount()).isEqualByComparingTo(BigDecimal.valueOf(quantity*price));
    }
    assertThat(calculate("WHOLE_ORDER",1200).lineAmount()).isEqualByComparingTo("336000");
  }

  @Test void incrementalPricingPartitionsEveryBoxOnceAcrossArbitraryTiers() {
    for(long quantity:new long[]{0,1,499,500,501,999,1000,1001,1200,1999,2000,4999,5000,999999}) {
      var result=calculate("INCREMENTAL",quantity);
      assertThat(result.pricingDetails().segments().stream().mapToLong(TierPricing.Segment::quantity).sum()).isEqualTo(quantity);
      assertThat(result.pricingDetails().segments().stream().map(TierPricing.Segment::amount).reduce(BigDecimal.ZERO,BigDecimal::add)).isEqualByComparingTo(result.lineAmount());
    }
    assertThat(calculate("INCREMENTAL",500).lineAmount()).isEqualByComparingTo("149990");
    assertThat(calculate("INCREMENTAL",1200).lineAmount()).isEqualByComparingTo("350980");
    assertThat(calculate("INCREMENTAL",1200).pricingDetails().segments()).extracting(TierPricing.Segment::quantity).containsExactly(499L,500L,201L);
  }

  @Test void fourDecimalPricesRoundTheFinalTotalAndAllocateSegmentRounding() {
    var result=OrderPricingCalculator.calculatePrice(new BigDecimal("0.1050"),List.of(step(2,"0.1049")),"INCREMENTAL",3);
    assertThat(result.lineAmount()).isEqualByComparingTo("0.31");
    assertThat(result.pricingDetails().segments().stream().map(TierPricing.Segment::amount).reduce(BigDecimal.ZERO,BigDecimal::add)).isEqualByComparingTo("0.31");
    assertThat(TierPricing.decode(TierPricing.encode(result.pricingDetails()))).isEqualTo(result.pricingDetails());
  }

  @Test void validationRejectsOverlapsIncreasingPricesMissingValuesAndInvalidModes() {
    for(var tiers:List.of(List.of(step(500,"290"),step(500,"280")),List.of(step(1000,"290"),step(500,"280")),
        List.of(step(500,"290"),step(1000,"295")),List.of(step(0,"290")),List.of(step(1000000,"290")),List.of(step(500,"0")),List.of(step(500,"290.12345")))) {
      assertThatThrownBy(()->ProductService.validatePriceTiers(new BigDecimal("300"),tiers,"WHOLE_ORDER")).isInstanceOf(com.fengyi.ordershow.common.DomainException.class);
    }
    assertThatThrownBy(()->ProductService.validatePriceTiers(new BigDecimal("300"),TIERS,"UNKNOWN")).isInstanceOf(com.fengyi.ordershow.common.DomainException.class);
    assertThat(ProductService.validatePriceTiers(new BigDecimal("300"),List.of(),"WHOLE_ORDER")).isNull();
  }

  @Test void apiRejectsFractionalThresholdInsteadOfSilentlyTruncatingIt() {
    assertThatThrownBy(()->new ObjectMapper().readValue("{\"minQuantity\":500.5,\"casePrice\":290}",Step.class))
        .isInstanceOf(com.fasterxml.jackson.databind.JsonMappingException.class);
  }

  @Test void independentFirstPriceIsUsedAtEveryBoundaryAndInOrderSnapshots() {
    var rules=List.of(step(1,"298"),step(100,"290"),step(500,"280"));
    for(String mode:List.of("WHOLE_ORDER","INCREMENTAL")) for(long quantity:new long[]{0,1,99,100,101,499,500,501,999999}) {
      long expected="WHOLE_ORDER".equals(mode)?quantity*(quantity<100?298:quantity<500?290:280)
          :Math.min(quantity,99)*298+Math.min(Math.max(quantity-99,0),400)*290+Math.max(quantity-499,0)*280;
      var result=OrderPricingCalculator.calculatePrice(new BigDecimal("300"),rules,mode,quantity);
      assertThat(result.lineAmount()).isEqualByComparingTo(BigDecimal.valueOf(expected));
      assertThat(OrderPricingCalculator.calculatePrice(new BigDecimal("999"),rules,mode,quantity)).isEqualTo(result);
      assertThat(result.baseCasePrice()).isEqualByComparingTo("298");
      assertThat(result.pricingDetails().tiers()).isEqualTo(rules);
      assertThat(result.pricingDetails().segments().stream().mapToLong(TierPricing.Segment::quantity).sum()).isEqualTo(quantity);
      if(quantity<100) assertThat(result.appliedTierMinQuantity()).isNull();
      else assertThat(result.appliedTierMinQuantity()).isEqualTo(quantity>=500?500L:100L);
    }
  }

  @Test void independentFirstCanExceedOrdinaryPriceAndLegacyRequestsFreezeTheOldBase() {
    var custom=List.of(step(1,"350"),step(100,"340"));
    assertThat(ProductService.validatePriceTiers(new BigDecimal("300"),custom,"INCREMENTAL").tiers()).isEqualTo(custom);
    var old=ProductService.validatePriceTiers(new BigDecimal("300"),TIERS,"INCREMENTAL");
    assertThat(old.minQuantity()).isEqualTo(500);
    assertThat(old.tiers()).containsExactly(step(1,"300"),TIERS.get(0),TIERS.get(1),TIERS.get(2),TIERS.get(3));
    assertThat(ProductService.validatePriceTier(new BigDecimal("300"),100L,new BigDecimal("290"),"WHOLE_ORDER").tiers())
        .containsExactly(step(1,"300"),step(100,"290"));
    for(String price:List.of("0","-1","298.12345")) assertThatThrownBy(()->ProductService.validatePriceTiers(new BigDecimal("300"),List.of(step(1,price)),"WHOLE_ORDER"))
        .isInstanceOf(com.fengyi.ordershow.common.DomainException.class);
  }

  @Test void aSingleFirstTierAndFourDecimalPricesDoNotCreateAnEmptyLeadingSegment() {
    for(String mode:List.of("WHOLE_ORDER","INCREMENTAL")) {
      var single=OrderPricingCalculator.calculatePrice(new BigDecimal("300"),List.of(step(1,"350")),mode,3);
      assertThat(single.lineAmount()).isEqualByComparingTo("1050");
      assertThat(single.baseQuantity()).isEqualTo(3);
      assertThat(single.tierQuantity()).isZero();
      assertThat(single.appliedTierMinQuantity()).isNull();
      assertThat(single.pricingDetails().segments()).hasSize(1);
      var precise=OrderPricingCalculator.calculatePrice(new BigDecimal("300"),List.of(step(1,"0.105"),step(2,"0.1049")),mode,3);
      assertThat(precise.lineAmount()).isEqualByComparingTo("0.31");
      assertThat(precise.pricingDetails().segments().stream().map(TierPricing.Segment::amount).reduce(BigDecimal.ZERO,BigDecimal::add)).isEqualByComparingTo("0.31");
    }
  }
}
