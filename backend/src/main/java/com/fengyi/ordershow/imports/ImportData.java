package com.fengyi.ordershow.imports;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.security.CryptoService;
import java.util.LinkedHashMap;
import java.util.Map;


final class ImportData {
  private ImportData() {}
  record MaterializeRow(long id, Map<String, Object> normalized, Map<String, Object> edited,
                                byte[] sensitiveBytes, byte[] editedSensitiveBytes) {
    Map<String, Object> effective() { Map<String, Object> result = new LinkedHashMap<>(normalized); if (edited != null) result.putAll(edited); return result; }
    Map<String, Object> sensitive(CryptoService crypto, ObjectMapper json) {
      byte[] bytes = editedSensitiveBytes != null ? editedSensitiveBytes : sensitiveBytes;
      if (bytes == null) return Map.of();
      try { return json.readValue(crypto.decrypt(bytes), new TypeReference<>() {}); } catch (Exception exception) { throw new IllegalStateException(exception); }
    }
  }

}
