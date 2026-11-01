package com.fengyi.ordershow;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.Reader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.yaml.snakeyaml.Yaml;

class OpenApiContractTest {
  @Test
  void contractIsValidYamlAndExposesAuditedAdminOrderManagement() throws Exception {
    Path contract = List.of(
            Path.of("docs/design/openapi/order-show-api.yaml"),
            Path.of("../docs/design/openapi/order-show-api.yaml"))
        .stream().filter(Files::isRegularFile).findFirst().orElseThrow();

    Map<String, Object> document;
    try (Reader reader = Files.newBufferedReader(contract)) {
      document = new Yaml().load(reader);
    }

    assertThat(document.get("openapi")).isEqualTo("3.1.0");
    @SuppressWarnings("unchecked")
    Map<String, Object> paths = (Map<String, Object>) document.get("paths");
    assertThat(paths).containsKeys(
        "/admin/members", "/admin/members/{id}",
        "/public/activities/current",
        "/public/activities/{activityCode}/events",
        "/public/activities/{activityCode}/verify-phone",
        "/public/activities/{activityCode}/lottery",
        "/admin/activities/{activityId}",
        "/admin/activities/{activityId}/module-context",
        "/admin/activities/{activityId}/overview",
        "/screen/activities/{activityCode}/ranking",
        "/screen/activities/{activityCode}/dashboard",
        "/screen/activities/{activityCode}/reports/{reportCode}",
        "/admin/activities/{activityId}/orders/customer-options",
        "/admin/activities/{activityId}/orders/product-options",
        "/admin/activities/{activityId}/orders",
        "/admin/activities/{activityId}/orders/preview",
        "/admin/activities/{activityId}/publish",
        "/admin/activities/{activityId}/withdraw-publication",
        "/admin/activities/{activityId}/close",
        "/admin/activities/{activityId}/reopen",
        "/admin/activities/{activityId}/orders/{orderId}",
        "/admin/activities/{activityId}/orders/{orderId}/void",
        "/admin/activities/{activityId}/orders/export",
        "/admin/activities/{activityId}/products/{productId}",
        "/admin/activities/{activityId}/customers/{customerId}",
        "/admin/activities/{activityId}/attendees",
        "/admin/activities/{activityId}/attendees/{attendeeId}",
        "/h5/activities/{activityCode}/order",
        "/h5/activities/{activityCode}/order-draft",
        "/h5/activities/{activityCode}/order/withdraw",
        "/h5/activities/{activityCode}/order-change-requests",
        "/h5/activities/{activityCode}/order-change-requests/current",
        "/admin/activities/{activityId}/order-change-requests",
        "/admin/activities/{activityId}/order-change-requests/{requestId}/approve",
        "/admin/activities/{activityId}/order-change-requests/{requestId}/reject");
    assertThat(paths.keySet()).noneMatch(path -> path.startsWith("/admin/") && path.endsWith("/withdraw"));
    @SuppressWarnings("unchecked")
    Map<String, Object> orderCollection = (Map<String, Object>) paths.get("/admin/activities/{activityId}/orders");
    @SuppressWarnings("unchecked")
    Map<String, Object> orderResource = (Map<String, Object>) paths.get("/admin/activities/{activityId}/orders/{orderId}");
    assertThat(orderCollection).containsKeys("get", "post");
    assertThat(orderResource).containsKeys("get", "put");
    assertThat(paths).doesNotContainKey("/admin/activities/{activityId}/customers/{customerId}/status");
    assertThat(paths).containsKey("/public/activities/{activityCode}");
  }
}
