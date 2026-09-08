package com.fengyi.ordershow.imports;

import static com.fengyi.ordershow.imports.ImportValues.*;
import com.fengyi.ordershow.imports.ImportData.MaterializeRow;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.activity.ActivityRegionService;
import com.fengyi.ordershow.security.CryptoService;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;


@Service
public class WhitelistImportWriter {
  private final JdbcTemplate jdbc;
  private final CryptoService crypto;
  private final ObjectMapper json;
  private final ActivityRegionService regions;
  public WhitelistImportWriter(JdbcTemplate jdbc, CryptoService crypto, ObjectMapper json, ActivityRegionService regions) { this.jdbc = jdbc; this.crypto = crypto; this.json = json; this.regions = regions; }
  void write(long activityId, long taskId, long versionId, List<MaterializeRow> rows) {
    for (MaterializeRow row : rows) {
      Map<String, Object> data = row.effective();
      Map<String, Object> sensitive = row.sensitive(crypto, json);
      String customerType = text(data.get("customerType"));
      String fullName = text(data.get("dealerFullName"));
      String normalizedName = normalize(fullName);
      String branchName = text(data.get("branchName"));
      String normalizedBranch = normalize(branchName);
      jdbc.update("""
          INSERT INTO customer(customer_type, dealer_full_name, normalized_dealer_full_name, branch_name, normalized_branch_name) VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE dealer_full_name = VALUES(dealer_full_name), branch_name = VALUES(branch_name),
            normalized_branch_name = VALUES(normalized_branch_name), updated_at = UTC_TIMESTAMP(3)
          """, customerType, fullName, normalizedName, branchName, normalizedBranch);
      Long customerId = jdbc.queryForObject("SELECT id FROM customer WHERE customer_type = ? AND normalized_dealer_full_name = ? AND normalized_branch_name = ?", Long.class, customerType, normalizedName, normalizedBranch);
      String phone = CryptoService.normalizePhone(text(sensitive.get("dealerPhone")));
      String confirmerPhone = CryptoService.normalizePhone(text(sensitive.get("confirmerPhone")));
      jdbc.update("""
          INSERT INTO activity_customer(activity_id, customer_id, customer_type, region_code, branch_name, normalized_branch_name,
            dealer_short_name, dealer_full_name, normalized_dealer_full_name, dealer_category, contact_name, phone, phone_lookup_hash, phone_masked,
            confirmer_name, confirmer_phone, confirmer_phone_masked, excel_sequence, is_active,
            source_import_task_id, data_version_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?, ?)
          """, activityId, customerId, customerType,
          "GENERAL".equals(customerType) ? regions.resolveCode(activityId, text(data.get("regionName"))) : null,
          nullableText(data.get("branchName")), normalizedBranch, nullableText(data.get("dealerShortName")), fullName, normalizedName, nullableText(data.get("dealerCategory")),
          nullableText(data.get("contactName")), phone, crypto.lookupHash(phone), CryptoService.maskPhone(phone),
          nullableText(data.get("confirmerName")), confirmerPhone.isBlank() ? null : confirmerPhone,
          confirmerPhone.isBlank() ? null : CryptoService.maskPhone(confirmerPhone), intValue(data.get("sequence"), 0), taskId, versionId);
    }
  }
}
