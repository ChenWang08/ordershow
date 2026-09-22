package com.fengyi.ordershow.order;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Arrays;
import org.junit.jupiter.api.Test;

class H5SubmitFingerprintTest {
  @Test void fieldAndProductOrderingAreCanonicalButVersionQuantityAndResponseModeMatter() throws Exception {
    var json = new ObjectMapper();
    var a = json.readValue("{\"expectedVersion\":0,\"items\":[{\"productId\":2,\"quantity\":3},{\"productId\":1,\"quantity\":4}]}",OrderService.SubmitRequest.class);
    var b = json.readValue("{\"items\":[{\"quantity\":4,\"productId\":1},{\"quantity\":3,\"productId\":2}],\"expectedVersion\":0}",OrderService.SubmitRequest.class);
    assertArrayEquals(H5SubmitFingerprint.digest(a,false),H5SubmitFingerprint.digest(b,false));
    assertFalse(Arrays.equals(H5SubmitFingerprint.digest(a,false),H5SubmitFingerprint.digest(a,true)));
    assertFalse(Arrays.equals(H5SubmitFingerprint.digest(a,false),H5SubmitFingerprint.digest(new OrderService.SubmitRequest(1,a.items()),false)));
    var changed = new OrderService.SubmitRequest(0,java.util.List.of(new OrderService.SubmitItem(2,4),new OrderService.SubmitItem(1,4)));
    assertFalse(Arrays.equals(H5SubmitFingerprint.digest(a,false),H5SubmitFingerprint.digest(changed,false)));
  }
}
