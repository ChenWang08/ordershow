package com.fengyi.ordershow.order;

import com.fengyi.ordershow.order.OrderPricingCalculator.PricingResult;
import com.fengyi.ordershow.catalog.ProductService.PriceTierView;
import com.fengyi.ordershow.common.TierPricing;
import com.fengyi.ordershow.common.TierPricing.Details;
import java.util.LinkedHashMap;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Price synchronization uses the caller's transaction and only updates current rows. */
@Repository
public class PriceSyncRepository {
  private final JdbcTemplate jdbc;

  public PriceSyncRepository(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  List<CurrentItem> submittedItems(long activityId, long productId) {
    return jdbc.query("SELECT i.* FROM order_item i JOIN customer_order o ON o.id=i.order_id WHERE o.activity_id=? AND o.status='SUBMITTED' AND i.activity_product_id=? ORDER BY o.id",
        (rs, rowNum) -> new CurrentItem(rs.getLong("id"), rs.getLong("order_id"), rs.getLong("quantity"),
            rs.getBigDecimal("base_case_price"), rs.getBigDecimal("case_price"), rs.getBigDecimal("tier_case_price"),
            nullableLong(rs, "tier_min_quantity"), rs.getString("pricing_mode"), rs.getBigDecimal("line_amount"), TierPricing.decode(rs.getString("pricing_details"))),
        activityId, productId);
  }

  void applyChanges(long activityId, List<Change> changes) {
    jdbc.batchUpdate("""
        UPDATE order_item SET case_price=?,base_case_price=?,base_price_quantity=?,tier_case_price=?,
          tier_min_quantity=?,tier_price_quantity=?,pricing_mode=?,applied_tier_min_quantity=?,line_amount=?,pricing_details=? WHERE id=?
        """, changes.stream().map(change -> {
          var p = change.price();
          return new Object[]{p.casePriceSnapshot(), p.baseCasePrice(), p.baseQuantity(), p.tierCasePrice(), p.tierMinQuantity(),
              p.tierQuantity(), p.pricingMode(), p.appliedTierMinQuantity(), p.lineAmount(), TierPricing.encode(p.pricingDetails()), change.row().id()};
        }).toList());
    jdbc.batchUpdate("""
        UPDATE customer_order SET total_amount=total_amount+?,lock_version=lock_version+1,last_modified_at=UTC_TIMESTAMP(3) WHERE id=?
        """, changes.stream().map(change -> new Object[]{change.price().lineAmount().subtract(change.row().lineAmount()), change.row().orderId()}).toList());
    jdbc.batchUpdate("""
        INSERT INTO domain_event_outbox(activity_id,aggregate_type,aggregate_id,event_type,payload_json,available_at)
        VALUES (?,'ORDER',?,'ORDER_PRICE_UPDATED',JSON_OBJECT('orderId',?),UTC_TIMESTAMP(3))
        """, changes.stream().map(change -> new Object[]{activityId, String.valueOf(change.row().orderId()), change.row().orderId()}).toList());
  }

  List<CatalogPrice> currentProducts(long activityId) {
    var products = new LinkedHashMap<Long, CatalogPrice>();
    jdbc.query("""
        SELECT p.id,p.case_price,t.min_quantity,t.case_price tier_price,t.pricing_mode
        FROM activity_product p JOIN activity_data_binding b ON b.activity_id=p.activity_id AND b.data_type='PRODUCT' AND b.current_version_id=p.data_version_id
        LEFT JOIN activity_product_price_tier t ON t.activity_product_id=p.id WHERE p.activity_id=? ORDER BY p.id,t.min_quantity
        """, (org.springframework.jdbc.core.RowCallbackHandler) rs -> {
          long id = rs.getLong("id");
          Long min = nullableLong(rs, "min_quantity");
          PriceTierView rule = min == null ? null : new PriceTierView(min, rs.getBigDecimal("tier_price"), rs.getString("pricing_mode"));
          CatalogPrice old = products.get(id);
          products.put(id, new CatalogPrice(id, rs.getBigDecimal("case_price"), old == null || old.rule() == null ? rule : old.rule().append(rule)));
        }, activityId);
    return List.copyOf(products.values());
  }

  private static Long nullableLong(ResultSet rs, String column) throws SQLException {
    long value = rs.getLong(column);
    return rs.wasNull() ? null : value;
  }

  record CurrentItem(long id, long orderId, long quantity, BigDecimal baseCasePrice, BigDecimal casePrice,
                     BigDecimal tierCasePrice, Long tierMinQuantity, String pricingMode, BigDecimal lineAmount, Details pricingDetails) {
    CurrentItem(long id, long orderId, long quantity, BigDecimal baseCasePrice, BigDecimal casePrice, BigDecimal tierCasePrice, Long tierMinQuantity, String pricingMode, BigDecimal lineAmount) {
      this(id, orderId, quantity, baseCasePrice, casePrice, tierCasePrice, tierMinQuantity, pricingMode, lineAmount, null);
    }
  }
  record Change(CurrentItem row, PricingResult price) {}
  record CatalogPrice(long id, BigDecimal casePrice, PriceTierView rule) {
    CatalogPrice(long id, BigDecimal casePrice, Long minQuantity, BigDecimal tierPrice, String pricingMode) {
      this(id, casePrice, minQuantity == null ? null : new PriceTierView(minQuantity, tierPrice, pricingMode));
    }
  }
}
