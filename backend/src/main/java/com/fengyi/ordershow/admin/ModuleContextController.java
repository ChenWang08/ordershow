package com.fengyi.ordershow.admin;

import com.fengyi.ordershow.common.ApiResponse;
import com.fengyi.ordershow.common.TraceFilter;
import jakarta.servlet.http.HttpServletRequest;
import java.util.HashMap;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

/** Minimal aggregate dependencies: no customer names, phone numbers or management data. */
@RestController
public class ModuleContextController {
  private final JdbcTemplate jdbc;
  public ModuleContextController(JdbcTemplate jdbc) { this.jdbc = jdbc; }
  @GetMapping("/admin/activities/{activityId}/module-context")
  ApiResponse<Context> context(@PathVariable long activityId, HttpServletRequest request) {
    Map<String, Long> counts = new HashMap<>();
    jdbc.query("""
        SELECT c.customer_type, COUNT(*) AS total FROM activity_customer c
        JOIN activity_data_binding b ON b.activity_id=c.activity_id AND b.data_type='WHITELIST' AND b.current_version_id=c.data_version_id
        WHERE c.activity_id=? AND c.is_active=TRUE GROUP BY c.customer_type
        """, (org.springframework.jdbc.core.RowCallbackHandler) rs -> counts.put(rs.getString(1), rs.getLong(2)), activityId);
    long attendees = jdbc.queryForObject("""
        SELECT COUNT(*) FROM activity_attendee a LEFT JOIN activity_data_binding b
        ON b.activity_id=a.activity_id AND b.data_type='ATTENDANCE'
        WHERE a.activity_id=? AND a.is_active=TRUE AND
        ((b.current_version_id IS NULL AND a.data_version_id IS NULL) OR a.data_version_id=b.current_version_id)
        """, Long.class, activityId);
    boolean whitelistPublished = !jdbc.queryForList("SELECT current_version_id FROM activity_data_binding WHERE activity_id=? AND data_type='WHITELIST' AND current_version_id IS NOT NULL", Long.class, activityId).isEmpty();
    return ApiResponse.of(new Context(counts.values().stream().mapToLong(Long::longValue).sum(), counts,
        counts.containsKey("ALL") ? "UNSPECIFIED" : "TYPED", attendees, whitelistPublished), TraceFilter.id(request));
  }
  public record Context(long customerCount, Map<String, Long> customersByType, String customerTypeMode,
                        long attendeeCount, boolean whitelistPublished) {}
}
