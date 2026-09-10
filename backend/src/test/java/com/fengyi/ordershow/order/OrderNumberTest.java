package com.fengyi.ordershow.order;

import static org.assertj.core.api.Assertions.*;
import java.math.BigInteger;
import java.util.UUID;
import java.util.HashSet;
import org.junit.jupiter.api.Test;

class OrderNumberTest {
  @Test void preservesTheFullIdentifierInsteadOfOnlyFourRandomCharacters() {
    var first=UUID.fromString("cfd30000-0000-4000-8000-000000000001");
    var second=UUID.fromString("cfd30000-0000-4000-8000-000000000002");
    String number=OrderRepository.orderNo(first);
    assertThat(number).startsWith("ZY").hasSizeLessThanOrEqualTo(27);
    assertThat(number).isNotEqualTo(OrderRepository.orderNo(second));
    assertThat(new BigInteger(number.substring(2),36)).isEqualTo(new BigInteger(first.toString().replace("-",""),16));
  }
  @Test void generatedNumbersFitTheExistingColumnAndAreDistinctInABurst() {
    var numbers=new HashSet<String>();
    for(int n=0;n<10000;n++) {
      String value=OrderRepository.orderNo(101);
      assertThat(value).matches("ZY[0-9A-Z]{1,25}");assertThat(numbers.add(value)).isTrue();
    }
  }
}
