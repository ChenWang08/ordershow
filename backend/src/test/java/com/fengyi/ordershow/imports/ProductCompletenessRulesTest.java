package com.fengyi.ordershow.imports;
import com.fengyi.ordershow.common.ProductCompleteness;
import java.util.Map;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class ProductCompletenessRulesTest {
  @Test void optionalFieldsDoNotAffectEitherImportValidator() {
    var row = Map.<String,Object>of("casePrice","100","tonCaseFactor","10");
    assertFalse(ImportValues.optionalProductMissing(row));
    assertFalse(ImportWorkbookRules.optionalProductMissing(row));
    assertFalse(ProductCompleteness.incomplete("1,000.25","1e2"));
  }
  @Test void everyInvalidPriceOrFactorRequiresCompletion() {
    for (String value : new String[]{"", " ", "0", "-1", "abc", "NaN", "Infinity", "0x10"}) {
      for (String field : new String[]{"casePrice","tonCaseFactor"}) {
        var row = new java.util.HashMap<String,Object>(Map.of("casePrice","100","tonCaseFactor","10"));
        row.put(field,value);
        assertTrue(ImportValues.optionalProductMissing(row), field+value);
        assertTrue(ImportWorkbookRules.optionalProductMissing(row), field+value);
      }
    }
  }
}
