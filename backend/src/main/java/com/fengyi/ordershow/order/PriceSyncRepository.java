package com.fengyi.ordershow.order;

import com.fengyi.ordershow.order.OrderPricingCalculator.PricingResult;
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
            nullableLong(rs, "tier_min_quantity"), rs.getString("pricing_mode"), rs.getBigDecimal("line_amount")),
        activityId, productId);
  }

  void updateItem(long itemId, PricingResult price) {
    jdbc.update("""
          UPDATE order_item SET case_price=?,base_case_price=?,base_price_quantity=?,tier_case_price=?,
            tier_min_quantity=?,tier_price_quantity=?,pricing_mode=?,applied_tier_min_quantity=?,line_amount=? WHERE id=?
          """, price.casePriceSnapshot(), price.baseCasePrice(), price.baseQuantity(), price.tierCasePrice(),
        price.tierMinQuantity(), price.tierQuantity(), price.pricingMode(), price.appliedTierMinQuantity(), price.lineAmount(), itemId);
  }

  void updateOrderTotal(long orderId) {
    jdbc.update("UPDATE customer_order SET total_amount=(SELECT SUM(line_amount) FROM order_item WHERE order_id=?),lock_version=lock_version+1,last_modified_at=UTC_TIMESTAMP(3) WHERE id=?", orderId, orderId);
  }

  List<CatalogPrice> currentProducts(long activityId) {
    return jdbc.query("""
        SELECT p.id,p.case_price,t.min_quantity,t.case_price tier_price,t.pricing_mode
        FROM activity_product p JOIN activity_data_binding b ON b.activity_id=p.activity_id AND b.data_type='PRODUCT' AND b.current_version_id=p.data_version_id
        LEFT JOIN activity_product_price_tier t ON t.activity_product_id=p.id WHERE p.activity_id=? ORDER BY p.id
        """, (rs, rowNum) -> new CatalogPrice(rs.getLong("id"), rs.getBigDecimal("case_price"),
            nullableLong(rs, "min_quantity"), rs.getBigDecimal("tier_price"), rs.getString("pricing_mode")), activityId);
  }

  private static Long nullableLong(ResultSet rs, String column) throws SQLException {
    long value = rs.getLong(column);
    return rs.wasNull() ? null : value;
  }

  record CurrentItem(long id, long orderId, long quantity, BigDecimal baseCasePrice, BigDecimal casePrice,
                     BigDecimal tierCasePrice, Long tierMinQuantity, String pricingMode, BigDecimal lineAmount) {}
  record CatalogPrice(long id, BigDecimal casePrice, Long minQuantity, BigDecimal tierPrice, String pricingMode) {}
}
