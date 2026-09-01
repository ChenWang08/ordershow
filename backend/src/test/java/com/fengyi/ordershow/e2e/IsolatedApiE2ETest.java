package com.fengyi.ordershow.e2e;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.ByteArrayOutputStream;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@EnabledIfEnvironmentVariable(named = "ORDER_SHOW_E2E", matches = "order-show-e2e")
class IsolatedApiE2ETest {
  private static final ObjectMapper JSON = new ObjectMapper();
  private static final String INITIAL_PASSWORD = "E2eChangeMe123!";
  private static final String TEST_PASSWORD = "E2eChanged456!";
  private static final String GENERAL_PHONE = "13900000001";
  private static final String SPECIAL_PHONE = "13900000001";

  private String baseUrl;
  private HttpClient admin;
  private HttpClient h5;
  private String adminCsrf;
  private String h5Csrf;
  private long h5CustomerId;
  private long activityId;
  private String activityCode;
  private int activityVersion;
  private long productId;
  private long productWithoutTonsId;
  private long orderId;
  private String orderNo;

  @BeforeAll
  void guardEnvironment() {
    baseUrl = System.getenv().getOrDefault("ORDER_SHOW_E2E_BASE_URL", "").replaceAll("/$", "");
    assertEquals("http://host.docker.internal:8180/api/v1", baseUrl,
        "Refusing to run destructive E2E setup against an unapproved URL");
    admin = client();
    h5 = client();
  }

  @Test
  @Order(1)
  void environmentAndAuthenticationGuards() throws Exception {
    HttpResponse<String> health = send(admin, "GET", "/actuator/health", null, null, null);
    assertEquals(200, health.statusCode());
    assertEquals("UP", json(health).path("status").asText());

    HttpResponse<String> unauthorized = send(client(), "GET", "/admin/activities", null, null, null);
    assertEquals(401, unauthorized.statusCode());

    ObjectNode login = JSON.createObjectNode().put("username", "e2e_admin").put("password", INITIAL_PASSWORD);
    HttpResponse<String> loggedIn = send(admin, "POST", "/admin/auth/login", login, null, null);
    assertEquals(200, loggedIn.statusCode(), loggedIn.body());
    JsonNode loginData = data(loggedIn);
    assertTrue(loginData.path("mustChangePassword").asBoolean());
    adminCsrf = loginData.path("csrfToken").asText();
    assertFalse(adminCsrf.isBlank());

    ObjectNode forbiddenActivity = activityBody("AUTOTEST_FORBIDDEN", Instant.now().plusSeconds(600), Instant.now().plusSeconds(3600));
    HttpResponse<String> passwordGate = send(admin, "POST", "/admin/activities", forbiddenActivity, null, null);
    assertEquals(403, passwordGate.statusCode());
    assertEquals("PASSWORD_CHANGE_REQUIRED", json(passwordGate).path("code").asText());

    ObjectNode password = JSON.createObjectNode().put("currentPassword", INITIAL_PASSWORD).put("newPassword", TEST_PASSWORD);
    HttpResponse<String> changed = send(admin, "POST", "/admin/auth/change-password", password, adminCsrf, null);
    assertEquals(200, changed.statusCode(), changed.body());

    HttpResponse<String> missingCsrf = send(admin, "POST", "/admin/activities", forbiddenActivity, null, null);
    assertEquals(403, missingCsrf.statusCode());
    assertEquals("CSRF_INVALID", json(missingCsrf).path("code").asText());
  }

  @Test
  @Order(2)
  void createDraftAndRejectPrematurePublication() throws Exception {
    Instant starts = Instant.now().plusSeconds(600);
    HttpResponse<String> created = send(admin, "POST", "/admin/activities",
        activityBody("AUTOTEST_自动化测试活动", starts, starts.plusSeconds(7200)), adminCsrf, null);
    assertEquals(200, created.statusCode(), created.body());
    JsonNode activity = data(created);
    activityId = activity.path("id").asLong();
    activityCode = activity.path("code").asText();
    activityVersion = activity.path("version").asInt();
    assertTrue(activityId > 0);
    assertFalse(activityCode.isBlank());
    assertEquals("DRAFT", activity.path("status").asText());

    HttpResponse<String> publish = send(admin, "POST", "/admin/activities/" + activityId + "/publish", null,
        adminCsrf, Integer.toString(activityVersion));
    assertEquals(409, publish.statusCode());
    assertEquals("ACTIVITY_DATA_INCOMPLETE", json(publish).path("code").asText());
  }

  @Test
  @Order(3)
  void importAndPublishProductAndWhitelistFixtures() throws Exception {
    long productTask = upload("PRODUCT", "products-valid.xlsx", productWorkbook());
    assertEquals("PREVIEW_READY", task(productTask).path("status").asText());
    assertEquals(5, task(productTask).path("inputCount").asInt());
    HttpResponse<String> productRows = send(admin, "GET", "/admin/activities/" + activityId + "/imports/" + productTask + "/rows", null, null, null);
    JsonNode p001 = null;
    for (JsonNode row : data(productRows)) {
      if ("P001".equals(row.path("normalizedData").path("materialCode").asText())) { p001 = row; break; }
    }
    assertNotNull(p001);
    ObjectNode changes = JSON.createObjectNode().put("priceTierMinQuantity", "1500").put("priceTierCasePrice", "90.00");
    ObjectNode tierPatch = JSON.createObjectNode().set("changes", changes);
    tierPatch.put("deleted", false);
    HttpResponse<String> tierSaved = send(admin, "PATCH", "/admin/activities/" + activityId + "/imports/" + productTask
        + "/rows/" + p001.path("id").asLong(), tierPatch, adminCsrf, null);
    assertEquals(200, tierSaved.statusCode(), tierSaved.body());
    assertEquals(0, task(productTask).path("errorCount").asInt());
    confirmAndAwait(productTask);

    long whitelistTask = upload("WHITELIST", "whitelist-valid.xlsx", whitelistWorkbook());
    JsonNode whitelistPreview = task(whitelistTask);
    assertEquals("PREVIEW_READY", whitelistPreview.path("status").asText());
    assertEquals(6, whitelistPreview.path("inputCount").asInt());
    assertEquals(0, whitelistPreview.path("errorCount").asInt());
    confirmAndAwait(whitelistTask);

    HttpResponse<String> products = send(admin, "GET", "/admin/activities/" + activityId + "/products", null, null, null);
    assertEquals(200, products.statusCode(), products.body());
    assertEquals(5, data(products).size());
  }

  @Test
  @Order(4)
  void publishActivityAndVerifyH5IdentityAndCatalogIsolation() throws Exception {
    HttpResponse<String> current = send(admin, "GET", "/admin/activities/" + activityId, null, null, null);
    JsonNode existing = data(current);
    activityVersion = existing.path("version").asInt();
    Instant starts = Instant.now().plusSeconds(5);
    ObjectNode updateBody = activityBody("AUTOTEST_自动化测试活动", starts, starts.plusSeconds(7200));
    HttpResponse<String> updated = send(admin, "PUT", "/admin/activities/" + activityId, updateBody,
        adminCsrf, Integer.toString(activityVersion));
    assertEquals(200, updated.statusCode(), updated.body());
    activityVersion = data(updated).path("version").asInt();

    HttpResponse<String> published = send(admin, "POST", "/admin/activities/" + activityId + "/publish", null,
        adminCsrf, Integer.toString(activityVersion));
    assertEquals(200, published.statusCode(), published.body());
    assertEquals("SCHEDULED", data(published).path("configuredStatus").asText());
    activityVersion = data(published).path("version").asInt();

    Thread.sleep(6000);
    HttpResponse<String> currentPublic = send(client(), "GET", "/public/activities/current", null, null, null);
    assertEquals(200, currentPublic.statusCode(), currentPublic.body());
    assertEquals(activityCode, data(currentPublic).path("code").asText());
    assertEquals("ACTIVE", data(currentPublic).path("status").asText());

    ObjectNode verify = JSON.createObjectNode().put("customerType", "GENERAL").put("regionCode", "EAST").put("phone", GENERAL_PHONE);
    HttpResponse<String> verified = send(h5, "POST", "/public/activities/" + activityCode + "/verify-phone", verify, null, null);
    assertEquals(200, verified.statusCode(), verified.body());
    h5Csrf = data(verified).path("csrfToken").asText();
    h5CustomerId = data(verified).path("customer").path("customerId").asLong();
    assertFalse(h5Csrf.isBlank());
    assertTrue(h5CustomerId > 0);
    assertTrue(data(verified).path("customer").path("phoneMasked").asText().contains("****"));
    assertFalse(verified.body().contains(GENERAL_PHONE));

    HttpResponse<String> catalog = send(h5, "GET", "/h5/activities/" + activityCode + "/products", null, null, null);
    assertEquals(200, catalog.statusCode(), catalog.body());
    JsonNode products = data(catalog);
    assertEquals(3, products.size());
    for (JsonNode product : products) assertEquals("GENERAL", product.path("customerType").asText());
    JsonNode tieredProduct = findProduct(products, "P001");
    productId = tieredProduct.path("id").asLong();
    assertEquals(1500, tieredProduct.path("priceTier").path("minQuantity").asLong());
    assertEquals("90.00", tieredProduct.path("priceTier").path("casePrice").decimalValue().setScale(2).toPlainString());
    productWithoutTonsId = findProduct(products, "P002").path("id").asLong();
    assertTrue(productId > 0);
    assertTrue(productWithoutTonsId > 0);

    HttpClient special = client();
    ObjectNode specialVerify = JSON.createObjectNode().put("customerType", "SPECIAL").putNull("regionCode").put("phone", SPECIAL_PHONE);
    HttpResponse<String> specialLogin = send(special, "POST", "/public/activities/" + activityCode + "/verify-phone", specialVerify, null, null);
    assertEquals(200, specialLogin.statusCode(), specialLogin.body());
    HttpResponse<String> specialCatalog = send(special, "GET", "/h5/activities/" + activityCode + "/products", null, null, null);
    assertEquals(2, data(specialCatalog).size());
    for (JsonNode product : data(specialCatalog)) assertEquals("SPECIAL", product.path("customerType").asText());
  }

  @Test
  @Order(5)
  void orderSubmitIdempotencyModifyWithdrawAndResubmit() throws Exception {
    ObjectNode first = orderBody(0, productId, 2);
    String firstKey = UUID.randomUUID().toString();

    HttpResponse<String> wrongOwner = send(h5, "PUT", "/h5/activities/" + activityCode + "/order-draft",
        draftBody(h5CustomerId + 1, 0, productId, 2), h5Csrf, null);
    assertEquals(403, wrongOwner.statusCode(), wrongOwner.body());
    assertEquals("DRAFT_CUSTOMER_MISMATCH", json(wrongOwner).path("code").asText());

    HttpResponse<String> savedDraft = send(h5, "PUT", "/h5/activities/" + activityCode + "/order-draft",
        draftBody(h5CustomerId, 0, productId, 2), h5Csrf, null);
    assertEquals(200, savedDraft.statusCode(), savedDraft.body());
    assertEquals(h5CustomerId, data(savedDraft).path("customerId").asLong());
    assertEquals(0, data(savedDraft).path("baseOrderVersion").asInt());
    assertEquals(2, data(savedDraft).path("items").get(0).path("quantity").asLong());
    Instant draftUpdatedAt = Instant.parse(data(savedDraft).path("updatedAt").asText());
    assertTrue(draftUpdatedAt.isBefore(Instant.now().plusSeconds(5)));
    assertTrue(draftUpdatedAt.isAfter(Instant.now().minusSeconds(30)));
    HttpResponse<String> loadedDraft = send(h5, "GET", "/h5/activities/" + activityCode + "/order-draft", null, null, null);
    assertEquals(200, loadedDraft.statusCode(), loadedDraft.body());
    assertEquals(data(savedDraft).path("id").asLong(), data(loadedDraft).path("id").asLong());

    HttpResponse<String> missingCsrf = send(h5, "PUT", "/h5/activities/" + activityCode + "/order", first, null, null, firstKey);
    assertEquals(403, missingCsrf.statusCode());

    HttpResponse<String> submitted = send(h5, "PUT", "/h5/activities/" + activityCode + "/order", first, h5Csrf, null, firstKey);
    assertEquals(200, submitted.statusCode(), submitted.body());
    JsonNode order = data(submitted);
    orderId = order.path("id").asLong();
    orderNo = order.path("orderNo").asText();
    assertEquals("SUBMITTED", order.path("status").asText());
    assertEquals(1, order.path("currentVersion").asInt());
    assertEquals(2, order.path("totalQuantity").asLong());
    assertEquals("200.00", order.path("totalAmount").decimalValue().setScale(2).toPlainString());
    assertEquals("0.200000", order.path("totalTons").decimalValue().setScale(6).toPlainString());
    HttpResponse<String> clearedDraft = send(h5, "GET", "/h5/activities/" + activityCode + "/order-draft", null, null, null);
    assertEquals(200, clearedDraft.statusCode(), clearedDraft.body());
    assertTrue(json(clearedDraft).path("data").isMissingNode() || json(clearedDraft).path("data").isNull());

    HttpResponse<String> staleDraft = send(h5, "PUT", "/h5/activities/" + activityCode + "/order-draft",
        draftBody(h5CustomerId, 0, productId, 3), h5Csrf, null);
    assertEquals(409, staleDraft.statusCode(), staleDraft.body());
    assertEquals("DRAFT_BASE_ORDER_VERSION_CONFLICT", json(staleDraft).path("code").asText());

    HttpResponse<String> replay = send(h5, "PUT", "/h5/activities/" + activityCode + "/order", first, h5Csrf, null, firstKey);
    assertEquals(200, replay.statusCode(), replay.body());
    assertEquals(orderId, data(replay).path("id").asLong());
    assertEquals(1, data(replay).path("currentVersion").asInt());

    HttpResponse<String> reused = send(h5, "PUT", "/h5/activities/" + activityCode + "/order",
        orderBody(1, productId, 3), h5Csrf, null, firstKey);
    assertEquals(409, reused.statusCode());
    assertEquals("IDEMPOTENCY_KEY_REUSED", json(reused).path("code").asText());

    HttpResponse<String> modificationDraft = send(h5, "PUT", "/h5/activities/" + activityCode + "/order-draft",
        draftBody(h5CustomerId, 1, productId, 3), h5Csrf, null);
    assertEquals(200, modificationDraft.statusCode(), modificationDraft.body());

    HttpResponse<String> modified = send(h5, "PUT", "/h5/activities/" + activityCode + "/order",
        orderBody(1, productId, 3), h5Csrf, null, UUID.randomUUID().toString());
    assertEquals(200, modified.statusCode(), modified.body());
    assertEquals(orderNo, data(modified).path("orderNo").asText());
    assertEquals(2, data(modified).path("currentVersion").asInt());
    assertEquals("300.00", data(modified).path("totalAmount").decimalValue().setScale(2).toPlainString());
    HttpResponse<String> clearedModificationDraft = send(h5, "GET",
        "/h5/activities/" + activityCode + "/order-draft", null, null, null);
    assertTrue(json(clearedModificationDraft).path("data").isMissingNode()
        || json(clearedModificationDraft).path("data").isNull());

    HttpResponse<String> stale = send(h5, "PUT", "/h5/activities/" + activityCode + "/order",
        orderBody(1, productId, 4), h5Csrf, null, UUID.randomUUID().toString());
    assertEquals(409, stale.statusCode());
    assertEquals("ORDER_VERSION_CONFLICT", json(stale).path("code").asText());

    ObjectNode withdrawBody = JSON.createObjectNode().put("expectedVersion", 2);
    HttpResponse<String> withdrawn = send(h5, "POST", "/h5/activities/" + activityCode + "/order/withdraw",
        withdrawBody, h5Csrf, null, UUID.randomUUID().toString());
    assertEquals(200, withdrawn.statusCode(), withdrawn.body());
    assertEquals("WITHDRAWN", data(withdrawn).path("status").asText());
    assertEquals(2, data(withdrawn).path("versions").size());
    assertEquals(1, data(withdrawn).path("items").size());

    HttpResponse<String> withdrawnDashboard = send(client(), "GET", "/screen/activities/" + activityCode + "/ranking", null, null, null);
    assertEquals(200, withdrawnDashboard.statusCode(), withdrawnDashboard.body());
    assertEquals(0, data(withdrawnDashboard).path("totals").path("order_count").asInt());

    HttpResponse<String> resubmitted = send(h5, "PUT", "/h5/activities/" + activityCode + "/order",
        mixedOrderBody(2, productId, 1, productWithoutTonsId, 1), h5Csrf, null, UUID.randomUUID().toString());
    assertEquals(200, resubmitted.statusCode(), resubmitted.body());
    assertEquals("SUBMITTED", data(resubmitted).path("status").asText());
    assertEquals(3, data(resubmitted).path("currentVersion").asInt());
    assertEquals(orderNo, data(resubmitted).path("orderNo").asText());
  }

  @Test
  @Order(6)
  void attendanceMatchingLotteryCandidatesAndConcurrentDraw() throws Exception {
    long attendanceTask = upload("ATTENDANCE", "attendance-valid.xlsx", attendanceWorkbook());
    JsonNode preview = data(send(admin, "GET", "/admin/activities/" + activityId + "/imports/" + attendanceTask
        + "/attendance-match-preview", null, null, null));
    assertEquals(3, preview.path("totalCount").asInt());
    assertEquals(2, preview.path("matchedCount").asInt());
    assertEquals(0, preview.path("pendingCount").asInt());
    assertEquals(1, preview.path("unmatchedCount").asInt());
    assertEquals(2, preview.path("eligibleCustomerCount").asInt());
    long whitelistVersionId = preview.path("whitelistVersionId").asLong();
    confirmAndAwait(attendanceTask, "?attendanceWhitelistVersionId=" + whitelistVersionId);

    HttpResponse<String> attendees = send(admin, "GET", "/admin/activities/" + activityId + "/attendees", null, null, null);
    assertEquals(200, attendees.statusCode(), attendees.body());
    assertEquals(3, data(attendees).size());
    assertEquals(2, count(data(attendees), "matchStatus", "MATCHED"));
    assertTrue(attendees.body().contains("13900000006"));

    ObjectNode allPreview = lotteryPreview("ALL_CUSTOMERS", "ALL", 10, "0");
    JsonNode allCandidates = data(send(admin, "POST", "/admin/activities/" + activityId + "/lottery/candidates/preview",
        allPreview, adminCsrf, null));
    assertEquals(6, allCandidates.path("candidateCount").asInt());

    ObjectNode orderPreview = lotteryPreview("VALID_ORDERS", "ALL", 10, "50");
    JsonNode orderCandidates = data(send(admin, "POST", "/admin/activities/" + activityId + "/lottery/candidates/preview",
        orderPreview, adminCsrf, null));
    assertEquals(1, orderCandidates.path("candidateCount").asInt());

    ObjectNode attendeePreview = lotteryPreview("ATTENDEES", "ALL", 10, "0");
    JsonNode attendeeCandidates = data(send(admin, "POST", "/admin/activities/" + activityId + "/lottery/candidates/preview",
        attendeePreview, adminCsrf, null));
    assertEquals(2, attendeeCandidates.path("candidateCount").asInt());

    ObjectNode ruleBody = lotteryRuleBody();
    HttpResponse<String> createdRule = send(admin, "POST", "/admin/activities/" + activityId + "/lottery/rules",
        ruleBody, adminCsrf, null);
    assertEquals(200, createdRule.statusCode(), createdRule.body());
    long ruleId = data(createdRule).path("id").asLong();
    long roundId = data(createdRule).path("rounds").get(0).path("id").asLong();

    HttpResponse<String> publishedRule = send(admin, "POST", "/admin/activities/" + activityId + "/lottery/rules/"
        + ruleId + "/publish", null, adminCsrf, null);
    assertEquals(200, publishedRule.statusCode(), publishedRule.body());
    assertEquals("READY", data(publishedRule).path("rounds").get(0).path("status").asText());

    List<CompletableFuture<HttpResponse<String>>> draws = new ArrayList<>();
    for (int index = 0; index < 10; index++) {
      draws.add(CompletableFuture.supplyAsync(() -> {
        try {
          return send(admin, "POST", "/admin/activities/" + activityId + "/lottery/rounds/" + roundId + "/draw",
              null, adminCsrf, null);
        } catch (Exception exception) {
          throw new RuntimeException(exception);
        }
      }));
    }
    List<HttpResponse<String>> drawResponses = draws.stream().map(CompletableFuture::join).toList();
    assertEquals(1, drawResponses.stream().filter(response -> response.statusCode() == 200).count());
    assertEquals(9, drawResponses.stream().filter(response -> response.statusCode() == 409).count());
    JsonNode draw = data(drawResponses.stream().filter(response -> response.statusCode() == 200).findFirst().orElseThrow());
    assertEquals(2, draw.path("candidateCount").asInt());
    assertEquals(1, draw.path("actualWinnerCount").asInt());
    assertEquals(1, draw.path("winners").size());
    assertFalse(draw.toString().contains(GENERAL_PHONE));

    HttpResponse<String> completed = send(admin, "POST", "/admin/activities/" + activityId + "/lottery/rounds/"
        + roundId + "/complete", null, adminCsrf, null);
    assertEquals(200, completed.statusCode(), completed.body());
    assertEquals("COMPLETED", data(completed).path("status").asText());

    HttpResponse<String> noReason = send(admin, "POST", "/admin/activities/" + activityId + "/lottery/rounds/"
        + roundId + "/reset", JSON.createObjectNode().put("reason", ""), adminCsrf, null);
    assertEquals(400, noReason.statusCode());

    HttpResponse<String> reset = send(admin, "POST", "/admin/activities/" + activityId + "/lottery/rounds/"
        + roundId + "/reset", JSON.createObjectNode().put("reason", "AUTOTEST 重抽验证"), adminCsrf, null);
    assertEquals(200, reset.statusCode(), reset.body());
    assertEquals("RESET", data(reset).path("status").asText());

    JsonNode statistics = data(send(admin, "GET", "/admin/activities/" + activityId + "/lottery/statistics", null, null, null));
    assertEquals(0, statistics.path("validWinnerRecords").asInt());
    assertEquals(1, statistics.path("invalidatedWinnerRecords").asInt());

    HttpResponse<String> publicLottery = send(client(), "GET", "/public/activities/" + activityCode + "/lottery", null, null, null);
    assertEquals(200, publicLottery.statusCode(), publicLottery.body());
    assertFalse(publicLottery.body().contains(GENERAL_PHONE));
    assertFalse(publicLottery.body().contains("13900000006"));
  }

  @Test
  @Order(7)
  void adminReportingDashboardAndCloseReadOnlyRules() throws Exception {
    HttpResponse<String> orders = send(admin, "GET", "/admin/activities/" + activityId + "/orders?page=1&size=20", null, null, null);
    assertEquals(200, orders.statusCode(), orders.body());
    assertEquals(1, json(orders).path("page").path("totalElements").asInt());
    assertEquals(orderId, json(orders).path("data").get(0).path("id").asLong());
    assertFalse(orders.body().contains(GENERAL_PHONE));

    HttpResponse<String> detail = send(admin, "GET", "/admin/activities/" + activityId + "/orders/" + orderId, null, null, null);
    assertEquals(3, data(detail).path("versions").size());
    assertEquals(4, data(detail).path("operations").size());

    HttpResponse<String> dashboard = send(client(), "GET", "/screen/activities/" + activityCode + "/ranking", null, null, null);
    assertEquals(1, data(dashboard).path("totals").path("order_count").asInt());
    assertEquals(2, data(dashboard).path("totals").path("total_quantity").asInt());
    assertEquals("150.00", data(dashboard).path("totals").path("total_amount").decimalValue().setScale(2).toPlainString());
    assertEquals("0.100000", data(dashboard).path("totals").path("total_tons").decimalValue().setScale(6).toPlainString());
    assertEquals("0.100000", data(dashboard).path("companies").get(0).path("tons").decimalValue().setScale(6).toPlainString());
    assertEquals("0.100000", data(dashboard).path("branches").get(0).path("tons").decimalValue().setScale(6).toPlainString());

    HttpResponse<String> export = send(admin, "GET", "/admin/activities/" + activityId + "/orders/export", null, null, null);
    assertEquals(200, export.statusCode());
    assertTrue(export.headers().firstValue("Content-Type").orElse("").contains("spreadsheetml"));
    assertTrue(export.body().length() > 1000);

    JsonNode latestActivity = data(send(admin, "GET", "/admin/activities/" + activityId, null, null, null));
    ObjectNode closeBody = JSON.createObjectNode().put("reason", "AUTOTEST 验证截止只读");
    HttpResponse<String> closed = send(admin, "POST", "/admin/activities/" + activityId + "/close", closeBody,
        adminCsrf, Integer.toString(latestActivity.path("version").asInt()));
    assertEquals(200, closed.statusCode(), closed.body());
    assertEquals("CLOSED", data(closed).path("status").asText());

    HttpResponse<String> afterClose = send(h5, "PUT", "/h5/activities/" + activityCode + "/order",
        orderBody(3, productId, 2), h5Csrf, null, UUID.randomUUID().toString());
    assertEquals(409, afterClose.statusCode());
    assertTrue(List.of("ACTIVITY_NOT_WRITABLE", "ACTIVITY_CLOSED").contains(json(afterClose).path("code").asText()));

    HttpResponse<String> finalDashboard = send(client(), "GET", "/screen/activities/" + activityCode + "/ranking", null, null, null);
    assertEquals(1, data(finalDashboard).path("totals").path("order_count").asInt());

    ObjectNode finishBody = JSON.createObjectNode().put("reason", "AUTOTEST 验证整场活动结束");
    HttpResponse<String> finished = send(admin, "POST", "/admin/activities/" + activityId + "/finish", finishBody,
        adminCsrf, Integer.toString(data(closed).path("version").asInt()));
    assertEquals(200, finished.statusCode(), finished.body());
    assertEquals("FINISHED", data(finished).path("status").asText());

    HttpResponse<String> historyDashboard = send(client(), "GET", "/screen/activities/" + activityCode + "/ranking", null, null, null);
    assertEquals(1, data(historyDashboard).path("totals").path("order_count").asInt());
    assertEquals("FINISHED", data(historyDashboard).path("status").asText());
    assertEquals(409, send(client(), "GET", "/screen/activities/" + activityCode + "/events", null, null, null).statusCode());

    HttpResponse<String> afterFinish = send(h5, "GET", "/h5/activities/" + activityCode + "/order", null, null, null);
    assertEquals(401, afterFinish.statusCode());
  }

  private long upload(String importType, String filename, byte[] content) throws Exception {
    String boundary = "----OrderShowE2E" + UUID.randomUUID();
    ByteArrayOutputStream body = new ByteArrayOutputStream();
    write(body, "--" + boundary + "\r\nContent-Disposition: form-data; name=\"importType\"\r\n\r\n" + importType + "\r\n");
    write(body, "--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" + filename
        + "\"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n");
    body.write(content);
    write(body, "\r\n--" + boundary + "--\r\n");
    HttpRequest request = request("/admin/activities/" + activityId + "/imports")
        .header("Content-Type", "multipart/form-data; boundary=" + boundary)
        .header("X-CSRF-Token", adminCsrf)
        .POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray())).build();
    HttpResponse<String> response = admin.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    assertEquals(201, response.statusCode(), response.body());
    return data(response).path("id").asLong();
  }

  private void confirmAndAwait(long taskId) throws Exception {
    confirmAndAwait(taskId, "");
  }

  private void confirmAndAwait(long taskId, String query) throws Exception {
    HttpResponse<String> confirmed = send(admin, "POST", "/admin/activities/" + activityId + "/imports/" + taskId + "/confirm" + query,
        null, adminCsrf, null);
    assertEquals(202, confirmed.statusCode(), confirmed.body());
    long deadline = System.nanoTime() + Duration.ofSeconds(20).toNanos();
    while (System.nanoTime() < deadline) {
      JsonNode current = task(taskId);
      if ("COMPLETED".equals(current.path("status").asText())) return;
      if ("FAILED".equals(current.path("status").asText())) throw new AssertionError("Import failed: " + current);
      Thread.sleep(250);
    }
    throw new AssertionError("Import did not complete: " + task(taskId));
  }

  private JsonNode task(long taskId) throws Exception {
    HttpResponse<String> response = send(admin, "GET", "/admin/activities/" + activityId + "/imports/" + taskId, null, null, null);
    assertEquals(200, response.statusCode(), response.body());
    return data(response);
  }

  private ObjectNode activityBody(String name, Instant starts, Instant ends) {
    ObjectNode body = JSON.createObjectNode();
    body.put("name", name).put("description", "AUTOTEST isolated environment")
        .put("timezone", "Asia/Shanghai").put("startsAt", starts.toString()).put("endsAt", ends.toString())
        .put("eventEndsAt", ends.plusSeconds(4 * 60 * 60).toString())
        .put("customerScope", "ALL").put("companyRankingTopN", 20).put("branchRankingTopN", 20).put("tonDisplayScale", 3);
    ArrayNode regions = body.putArray("regions");
    regions.addObject().put("code", "EAST").put("name", "东区").put("sortNo", 10);
    regions.addObject().put("code", "SOUTH").put("name", "南区").put("sortNo", 20);
    regions.addObject().put("code", "NORTH_1").put("name", "北1区").put("sortNo", 30);
    regions.addObject().put("code", "NORTH_2").put("name", "北2区").put("sortNo", 40);
    return body;
  }

  private ObjectNode orderBody(int expectedVersion, long selectedProductId, long quantity) {
    ObjectNode body = JSON.createObjectNode().put("expectedVersion", expectedVersion);
    body.putArray("items").addObject().put("productId", selectedProductId).put("quantity", quantity);
    return body;
  }

  private ObjectNode mixedOrderBody(int expectedVersion, long firstProductId, long firstQuantity,
                                    long secondProductId, long secondQuantity) {
    ObjectNode body = JSON.createObjectNode().put("expectedVersion", expectedVersion);
    ArrayNode items = body.putArray("items");
    items.addObject().put("productId", firstProductId).put("quantity", firstQuantity);
    items.addObject().put("productId", secondProductId).put("quantity", secondQuantity);
    return body;
  }

  private ObjectNode draftBody(long customerId, int baseOrderVersion, long selectedProductId, long quantity) {
    ObjectNode body = JSON.createObjectNode().put("customerId", customerId).put("baseOrderVersion", baseOrderVersion);
    body.putArray("items").addObject().put("productId", selectedProductId).put("quantity", quantity);
    return body;
  }

  private ObjectNode lotteryPreview(String scope, String customerType, int winnerCount, String minimumAmount) {
    return JSON.createObjectNode().put("roundNo", 1).put("winnerCount", winnerCount).put("candidateScope", scope)
        .put("customerType", customerType).put("minimumOrderAmount", minimumAmount).put("excludePreviousWinners", false);
  }

  private ObjectNode lotteryRuleBody() {
    ObjectNode body = JSON.createObjectNode().put("name", "AUTOTEST_抽奖规则");
    ArrayNode rounds = body.putArray("rounds");
    rounds.addObject().put("name", "AUTOTEST_现场轮").put("prizeName", "测试奖品")
        .put("winnerCount", 1).put("candidateScope", "ATTENDEES").put("customerType", "ALL")
        .put("minimumOrderAmount", "0").putNull("qualificationCutoffAt")
        .put("excludePreviousWinners", false).put("displayNameType", "FULL_NAME");
    return body;
  }

  private byte[] productWorkbook() throws Exception {
    List<String> headers = List.of("产品大类", "产品线", "物料代码", "物料名称", "品牌", "品种", "规格", "箱规", "元/瓶", "元/箱", "吨箱转换系数", "是否为标品礼盒", "分公司定制品");
    try (XSSFWorkbook workbook = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      Sheet generalRebate = sheet(workbook, "综合参与返利", headers);
      row(generalRebate, "调味品", "酱油", "P001", "AUTOTEST_综合商品一", "测试品牌", "原味", "500ml", "12瓶", "8.00", "100.00", "10", "否", "");
      row(generalRebate, "调味品", "酱油", "P002", "AUTOTEST_综合缺吨数", "测试品牌", "原味", "500ml", "12瓶", "4.00", "50.00", "", "否", "");
      Sheet generalNoRebate = sheet(workbook, "综合不参与返利", headers);
      row(generalNoRebate, "调味品", "醋", "P003", "AUTOTEST_综合商品三", "测试品牌", "陈醋", "500ml", "12瓶", "2.50", "30.00", "5", "是", "");
      Sheet specialRebate = sheet(workbook, "特渠参与返利", headers);
      row(specialRebate, "定制品", "礼盒", "S001", "AUTOTEST_特渠商品一", "测试品牌", "礼盒", "1套", "1箱", "200.00", "200.00", "20", "是", "");
      Sheet specialNoRebate = sheet(workbook, "特渠不参与返利", headers);
      row(specialNoRebate, "定制品", "调味油", "S002", "AUTOTEST_特渠商品二", "测试品牌", "油", "1L", "6瓶", "13.00", "80.00", "8", "否", "");
      workbook.write(out);
      return out.toByteArray();
    }
  }

  private byte[] whitelistWorkbook() throws Exception {
    List<String> headers = List.of("序号", "大区", "分公司名称", "经销商名称（简）", "经销商名称（全）", "经销商类型", "经销商姓名", "经销商电话", "分公司确认人姓名", "分公司确认人电话");
    try (XSSFWorkbook workbook = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      Sheet general = sheet(workbook, "综合客户白名单", headers);
      row(general, "1", "东区", "上海分", "测试综合一", "AUTOTEST_综合经销商一", "综合", "测试甲", GENERAL_PHONE, "确认甲", "13800000001");
      row(general, "2", "东区", "上海分", "测试综合二", "AUTOTEST_综合经销商二", "综合", "测试乙", "13900000002", "确认甲", "13800000001");
      row(general, "3", "南区", "广州分", "测试综合三", "AUTOTEST_综合经销商三", "综合", "测试丙", "13900000003", "确认乙", "13800000002");
      row(general, "4", "北1区", "北京分", "测试综合四", "AUTOTEST_综合经销商四", "综合", "测试丁", "13900000004", "确认丙", "13800000003");
      Sheet special = sheet(workbook, "特渠客户白名单", headers);
      row(special, "1", "", "特渠分", "测试特渠一", "AUTOTEST_特渠经销商一", "特渠", "测试戊", SPECIAL_PHONE, "确认丁", "13800000004");
      row(special, "2", "", "特渠分", "测试特渠二", "AUTOTEST_特渠经销商二", "特渠", "测试己", "13900000005", "确认丁", "13800000004");
      workbook.write(out);
      return out.toByteArray();
    }
  }

  private byte[] attendanceWorkbook() throws Exception {
    List<String> headers = List.of("分公司", "参会人姓名", "性别", "参会人电话", "参会人员类型", "经销商名称");
    try (XSSFWorkbook workbook = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      Sheet attendance = sheet(workbook, "现场参会名单", headers);
      row(attendance, "上海分", "测试甲", "男", "13900000006", "综合经销商", "AUTOTEST_综合经销商一");
      row(attendance, "上海分", "测试乙", "女", "13900000007", "综合经销商", "测试综合二");
      row(attendance, "未知分", "测试未知", "男", "13900000008", "综合经销商", "AUTOTEST_不存在经销商");
      workbook.write(out);
      return out.toByteArray();
    }
  }

  private Sheet sheet(XSSFWorkbook workbook, String name, List<String> headers) {
    Sheet sheet = workbook.createSheet(name);
    Row header = sheet.createRow(0);
    for (int index = 0; index < headers.size(); index++) header.createCell(index).setCellValue(headers.get(index));
    return sheet;
  }

  private void row(Sheet sheet, String... values) {
    Row row = sheet.createRow(sheet.getLastRowNum() + 1);
    for (int index = 0; index < values.length; index++) row.createCell(index).setCellValue(values[index]);
  }

  private JsonNode findProduct(JsonNode products, String materialCode) {
    for (JsonNode product : products) if (materialCode.equals(product.path("materialCode").asText())) return product;
    throw new AssertionError("Missing product " + materialCode + ": " + products);
  }

  private long count(JsonNode rows, String field, String expected) {
    long count = 0;
    for (JsonNode row : rows) if (expected.equals(row.path(field).asText())) count++;
    return count;
  }

  private HttpClient client() {
    CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
    return HttpClient.newBuilder().cookieHandler(cookies).connectTimeout(Duration.ofSeconds(5)).build();
  }

  private HttpRequest.Builder request(String path) {
    return HttpRequest.newBuilder(URI.create(baseUrl + path)).timeout(Duration.ofSeconds(30)).header("Origin", "http://localhost:3100");
  }

  private HttpResponse<String> send(HttpClient client, String method, String path, JsonNode body,
                                    String csrf, String ifMatch) throws Exception {
    return send(client, method, path, body, csrf, ifMatch, null);
  }

  private HttpResponse<String> send(HttpClient client, String method, String path, JsonNode body,
                                    String csrf, String ifMatch, String idempotencyKey) throws Exception {
    HttpRequest.Builder request = request(path);
    if (body != null) request.header("Content-Type", "application/json");
    if (csrf != null) request.header("X-CSRF-Token", csrf);
    if (ifMatch != null) request.header("If-Match", ifMatch);
    if (idempotencyKey != null) request.header("Idempotency-Key", idempotencyKey);
    HttpRequest.BodyPublisher publisher = body == null ? HttpRequest.BodyPublishers.noBody()
        : HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body), StandardCharsets.UTF_8);
    request.method(method, publisher);
    return client.send(request.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
  }

  private JsonNode json(HttpResponse<String> response) throws Exception {
    return JSON.readTree(response.body());
  }

  private JsonNode data(HttpResponse<String> response) throws Exception {
    JsonNode root = json(response);
    assertNotNull(root.get("data"), response.body());
    return root.get("data");
  }

  private static void write(ByteArrayOutputStream output, String value) throws Exception {
    output.write(value.getBytes(StandardCharsets.UTF_8));
  }
}
