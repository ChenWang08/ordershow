package com.fengyi.ordershow.common;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.util.List;

/** Serializable rules and charged segments, shared by catalog and immutable order snapshots. */
public final class TierPricing {
  private static final ObjectMapper JSON = new ObjectMapper();
  private TierPricing() {}

  public static BigDecimal basePrice(BigDecimal ordinaryPrice, List<Step> tiers) {
    return tiers != null && !tiers.isEmpty() && tiers.getFirst().minQuantity() == 1
        ? tiers.getFirst().casePrice() : ordinaryPrice;
  }

  public record Step(@com.fasterxml.jackson.databind.annotation.JsonDeserialize(using = WholeQuantity.class) long minQuantity, BigDecimal casePrice) {
    public Step {
      if (casePrice != null) casePrice = casePrice.stripTrailingZeros();
    }
  }
  public static final class WholeQuantity extends com.fasterxml.jackson.databind.JsonDeserializer<Long> {
    @Override public Long deserialize(com.fasterxml.jackson.core.JsonParser parser, com.fasterxml.jackson.databind.DeserializationContext context) throws java.io.IOException {
      try { return new BigDecimal(parser.getValueAsString()).longValueExact(); }
      catch (RuntimeException invalid) { throw com.fasterxml.jackson.databind.exc.InvalidFormatException.from(parser, "阶梯起始箱数必须为整数", parser.getValueAsString(), Long.class); }
    }
  }
  public record Segment(long minQuantity, Long maxQuantity, long quantity, BigDecimal casePrice, BigDecimal amount) {
    public Segment { casePrice = casePrice.stripTrailingZeros(); amount = amount.setScale(2); }
  }
  public record Details(List<Step> tiers, List<Segment> segments) {
    public Details { tiers = List.copyOf(tiers); segments = List.copyOf(segments); }
  }
  public static String encode(Details value) {
    if (value == null) return null;
    try { return JSON.writeValueAsString(value); }
    catch (Exception exception) { throw new IllegalStateException("Cannot encode pricing snapshot", exception); }
  }
  public static Details decode(String value) {
    if (value == null || value.isBlank()) return null;
    try { return JSON.readValue(value, Details.class); }
    catch (Exception exception) { throw new IllegalStateException("Cannot read pricing snapshot", exception); }
  }
}
