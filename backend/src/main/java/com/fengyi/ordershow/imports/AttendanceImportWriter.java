package com.fengyi.ordershow.imports;

import static com.fengyi.ordershow.imports.ImportValues.*;
import com.fengyi.ordershow.imports.ImportData.MaterializeRow;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.customer.AttendanceMatchingService;
import com.fengyi.ordershow.security.CryptoService;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;


@Service
public class AttendanceImportWriter {
  private final JdbcTemplate jdbc;
  private final CryptoService crypto;
  private final ObjectMapper json;
  private final AttendanceMatchingService attendanceMatching;
  public AttendanceImportWriter(JdbcTemplate jdbc, CryptoService crypto, ObjectMapper json, AttendanceMatchingService attendanceMatching) { this.jdbc = jdbc; this.crypto = crypto; this.json = json; this.attendanceMatching = attendanceMatching; }
  void write(long activityId, long taskId, long versionId, List<MaterializeRow> rows, long adminId) {
    Long whitelistVersion = attendanceMatching.currentWhitelistVersion(activityId);
    for (MaterializeRow row : rows) {
      Map<String, Object> data = row.effective();
      String phone = CryptoService.normalizePhone(text(row.sensitive(crypto, json).get("contactPhone")));
      AttendanceMatchingService.MatchResult match = attendanceMatching.match(activityId, whitelistVersion,
          text(data.get("participantType")), text(data.get("branchName")), text(data.get("dealerFullName")));
      jdbc.update("""
          INSERT INTO activity_attendee(activity_id, activity_customer_id, match_status, match_method, match_reason_code,
            participant_name, gender, participant_type,
            dealer_name_snapshot, branch_name_snapshot, phone, phone_lookup_hash, phone_masked,
            source_import_task_id, data_version_id, is_active, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?)
          """, activityId, match.customerId(), match.status(), match.method(), match.reasonCode(),
          nullableText(data.get("participantName")), nullableText(data.get("gender")),
          nullableText(data.get("participantType")), text(data.get("dealerFullName")), nullableText(data.get("branchName")),
          phone.isBlank() ? null : phone, phone.matches("1\\d{10}") ? crypto.lookupHash(phone) : null,
          phone.isBlank() ? null : CryptoService.maskPhone(phone), taskId, versionId, adminId);
    }
  }
}
