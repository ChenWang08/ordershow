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
import java.io.BufferedReader;
import java.io.InputStreamReader;
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
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
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
  private String generalRegionCode;
  private int activityVersion;
  private long productId;
  private long productWithoutTonsId;
  private long orderId;
  private String orderNo;
  private String firstSubmissionKey;
  private String lightweightSubmissionKey;
  private JsonNode firstSubmissionResult;

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
    ObjectNode changes = JSON.createObjectNode().put("priceTierMinQuantity", "1500").put("priceTierCasePrice", "90.00")
        .put("priceTierPricingMode", "INCREMENTAL");
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
    assertEquals(8, whitelistPreview.path("inputCount").asInt());
    assertEquals(0, whitelistPreview.path("errorCount").asInt());
    confirmAndAwait(whitelistTask);

    HttpResponse<String> products = send(admin, "GET", "/admin/activities/" + activityId + "/products", null, null, null);
    assertEquals(200, products.statusCode(), products.body());
    assertEquals(5, data(products).size());
    JsonNode originalProduct = findProduct(data(products), "P001");
    long statusProductId = originalProduct.path("id").asLong();
    String productPath = "/admin/activities/" + activityId + "/products/" + statusProductId;
    ObjectNode optionalBlank = JSON.createObjectNode().put("productLine", "").put("specification", "").put("casePack", "");
    var optionalSaved = send(admin,"PATCH",productPath,optionalBlank,adminCsrf,originalProduct.path("version").asText());
    assertEquals(200,optionalSaved.statusCode(),optionalSaved.body());
    assertEquals("ACTIVE",data(optionalSaved).path("dataStatus").asText());
    ObjectNode incomplete = JSON.createObjectNode().put("casePriceSet",true).put("tonCaseFactorSet",true).put("casePrice",0).put("tonCaseFactor",-1).put("orderable",false).put("priceTierSet",true);
    var incompleteSaved = send(admin,"PATCH",productPath,incomplete,adminCsrf,data(optionalSaved).path("version").asText());
    assertEquals(200,incompleteSaved.statusCode(),incompleteSaved.body());
    assertEquals("INCOMPLETE",data(incompleteSaved).path("dataStatus").asText());
    assertFalse(data(incompleteSaved).path("orderable").asBoolean());
    ObjectNode restored = JSON.createObjectNode().put("casePriceSet",true).put("tonCaseFactorSet",true).put("orderable",true)
        .put("productLine",originalProduct.path("productLine").asText()).put("specification",originalProduct.path("specification").asText()).put("casePack",originalProduct.path("casePack").asText());
    restored.set("casePrice",originalProduct.path("casePrice")); restored.set("tonCaseFactor",originalProduct.path("tonCaseFactor"));
    restored.put("priceTierSet",true); restored.set("priceTierMinQuantity",originalProduct.path("priceTier").path("minQuantity"));
    restored.set("priceTierCasePrice",originalProduct.path("priceTier").path("casePrice"));
    restored.set("priceTierPricingMode",originalProduct.path("priceTier").path("pricingMode"));
    var completeSaved = send(admin,"PATCH",productPath,restored,adminCsrf,data(incompleteSaved).path("version").asText());
    assertEquals(200,completeSaved.statusCode(),completeSaved.body());
    assertEquals("ACTIVE",data(completeSaved).path("dataStatus").asText());

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
    for (JsonNode region : data(currentPublic).path("regions")) {
      if ("东区".equals(region.path("name").asText())) generalRegionCode = region.path("code").asText();
    }
    assertNotNull(generalRegionCode);

    ObjectNode verify = JSON.createObjectNode().put("customerType", "GENERAL").put("regionCode", generalRegionCode).put("phone", GENERAL_PHONE);
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
    assertEquals("INCREMENTAL", tieredProduct.path("priceTier").path("pricingMode").asText());
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
    ObjectNode adminPreviewBody = JSON.createObjectNode().put("activityCustomerId", h5CustomerId);
    adminPreviewBody.putArray("items").addObject().put("productId", productId).put("quantity", 2);
    HttpResponse<String> adminPreview = send(admin, "POST", "/admin/activities/" + activityId + "/orders/preview",
        adminPreviewBody, adminCsrf, null);
    assertEquals(200, adminPreview.statusCode(), adminPreview.body());
    assertEquals(2, data(adminPreview).path("totalQuantity").asLong());
    assertEquals("200.00", data(adminPreview).path("totalAmount").decimalValue().setScale(2).toPlainString());

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

    var ready = new java.util.concurrent.CountDownLatch(4);
    var start = new java.util.concurrent.CountDownLatch(1);
    var duplicates = new ArrayList<CompletableFuture<HttpResponse<String>>>();
    for (int i=0;i<4;i++) duplicates.add(CompletableFuture.supplyAsync(() -> {
      ready.countDown();
      try { start.await(); return send(h5,"PUT","/h5/activities/"+activityCode+"/order",first,h5Csrf,null,firstKey); }
      catch (Exception error) { throw new java.util.concurrent.CompletionException(error); }
    }));
    try { assertTrue(ready.await(10,java.util.concurrent.TimeUnit.SECONDS)); }
    finally { start.countDown(); }
    HttpResponse<String> submitted = duplicates.getFirst().join();
    assertEquals(200, submitted.statusCode(), submitted.body());
    for (var duplicate : duplicates) {
      var response = duplicate.join();
      assertEquals(200,response.statusCode(),response.body());
      assertEquals(data(submitted),data(response));
    }
    firstSubmissionKey = firstKey;
    firstSubmissionResult = data(submitted).deepCopy();
    assertEquals(1,firstSubmissionResult.path("versions").size());
    assertEquals(1,firstSubmissionResult.path("operations").size());
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

    // Exercise the production phone client's lightweight response as well as the full-history API.
    lightweightSubmissionKey = UUID.randomUUID().toString();
    var lightweight = send(h5, "PUT", "/h5/activities/" + activityCode + "/order?includeHistory=false",
        orderBody(1, productId, 2), h5Csrf, null, lightweightSubmissionKey);
    assertEquals(200, lightweight.statusCode(), lightweight.body());
    assertEquals(1, data(lightweight).path("currentVersion").asInt());
    assertTrue(data(lightweight).path("versions").isEmpty());

    HttpResponse<String> modificationDraft = send(h5, "PUT", "/h5/activities/" + activityCode + "/order-draft",
        draftBody(h5CustomerId, 1, productId, 3), h5Csrf, null);
    assertEquals(200, modificationDraft.statusCode(), modificationDraft.body());

    ObjectNode modificationRequestBody = JSON.createObjectNode().put("expectedVersion", 1).put("requestType", "MODIFY");
    modificationRequestBody.putArray("items").addObject().put("productId", productId).put("quantity", 1);
    HttpResponse<String> modificationRequest = send(h5, "POST", "/h5/activities/" + activityCode + "/order-change-requests",
        modificationRequestBody, h5Csrf, null, UUID.randomUUID().toString());
    assertEquals(200, modificationRequest.statusCode(), modificationRequest.body());
    assertEquals("PENDING", data(modificationRequest).path("status").asText());
    assertEquals(1, data(modificationRequest).path("currentVersion").asInt());
    assertEquals("100.00", data(modificationRequest).path("requestedTotalAmount").decimalValue().setScale(2).toPlainString());
    long replacedId=data(modificationRequest).path("id").asLong();
    String replacementKey=UUID.randomUUID().toString();
    var replacement=send(h5,"POST","/h5/activities/"+activityCode+"/order-change-requests",modificationRequestBody,h5Csrf,null,replacementKey);
    assertEquals(200,replacement.statusCode(),replacement.body());
    assertEquals(2,data(replacement).path("originalOrder").path("totalQuantity").asInt());
    var replacementReplay=send(h5,"POST","/h5/activities/"+activityCode+"/order-change-requests",modificationRequestBody,h5Csrf,null,replacementKey);
    assertEquals(data(replacement).path("id"),data(replacementReplay).path("id"));
    var replaced=send(admin,"GET","/admin/activities/"+activityId+"/order-change-requests/"+replacedId,null,null,null);
    assertEquals("REJECTED",data(replaced).path("status").asText());
    assertTrue(data(replaced).path("reviewReason").asText().contains("替代"));
    assertEquals(409,send(admin,"POST","/admin/activities/"+activityId+"/order-change-requests/"+replacedId+"/approve",JSON.createObjectNode(),adminCsrf,null,UUID.randomUUID().toString()).statusCode());
    var reviewPage=send(admin,"GET","/admin/activities/"+activityId+"/order-change-requests/page?status=PENDING&size=1",null,null,null);
    assertEquals(200,reviewPage.statusCode(),reviewPage.body());
    assertEquals(1,json(reviewPage).path("page").path("totalElements").asInt());
    assertFalse(data(reviewPage).get(0).has("items"));
    Instant requestInstant = Instant.parse(data(replacement).path("requestedAt").asText());
    assertTrue(Math.abs(Duration.between(requestInstant, Instant.now()).toSeconds()) < 60,
        "New request timestamps must represent UTC now, not Beijing wall time labeled as UTC");
    assertEquals(requestInstant, Instant.parse(data(reviewPage).get(0).path("requestedAt").asText()));
    var requestDetail = send(admin, "GET", "/admin/activities/" + activityId + "/order-change-requests/" + data(replacement).path("id").asLong(), null, null, null);
    assertEquals(requestInstant, Instant.parse(data(requestDetail).path("requestedAt").asText()));
    var h5Request = send(h5, "GET", "/h5/activities/" + activityCode + "/order-change-requests/current", null, null, null);
    assertEquals(requestInstant, Instant.parse(data(h5Request).path("requestedAt").asText()));
    HttpResponse<String> pendingRequests = send(admin, "GET", "/admin/activities/" + activityId + "/order-change-requests?status=PENDING", null, null, null);
    assertEquals(200, pendingRequests.statusCode(), pendingRequests.body());
    long modificationRequestId = data(pendingRequests).get(0).path("id").asLong();
    HttpResponse<String> approvedModification = send(admin, "POST", "/admin/activities/" + activityId + "/order-change-requests/" + modificationRequestId + "/approve",
        JSON.createObjectNode().put("reason", "AUTOTEST 审核通过修改申请"), adminCsrf, null, UUID.randomUUID().toString());
    assertEquals(200, approvedModification.statusCode(), approvedModification.body());
    assertEquals("APPROVED", data(approvedModification).path("status").asText());
    assertEquals(requestInstant, Instant.parse(data(approvedModification).path("requestedAt").asText()));
    assertFalse(Instant.parse(data(approvedModification).path("reviewedAt").asText()).isBefore(requestInstant));
    JsonNode modified = data(send(h5, "GET", "/h5/activities/" + activityCode + "/order", null, null, null));
    assertEquals(orderNo, modified.path("orderNo").asText());
    assertEquals(2, modified.path("currentVersion").asInt());
    assertEquals(2, modified.path("versions").size());
    assertEquals("100.00", modified.path("totalAmount").decimalValue().setScale(2).toPlainString());
    HttpResponse<String> clearedModificationDraft = send(h5, "GET",
        "/h5/activities/" + activityCode + "/order-draft", null, null, null);
    assertTrue(json(clearedModificationDraft).path("data").isMissingNode()
        || json(clearedModificationDraft).path("data").isNull());

    var newerDraft = send(h5,"PUT","/h5/activities/"+activityCode+"/order-draft",
        draftBody(h5CustomerId,2,productId,5),h5Csrf,null);
    assertEquals(200,newerDraft.statusCode());
    assertLatestReplayDoesNotMutate(first, firstKey, true);
    assertLatestReplayDoesNotMutate(orderBody(1, productId, 2), lightweightSubmissionKey, false);
    // Reproduce the exact pre-compact format on synthetic receipts only. The
    // original response is deliberately stale and has no includeHistory flag.
    storeLegacySubmissionReceipt(firstKey, firstSubmissionResult);
    storeLegacySubmissionReceipt(lightweightSubmissionKey, data(lightweight));
    assertLatestReplayDoesNotMutate(first, firstKey, true);
    assertLatestReplayDoesNotMutate(orderBody(1, productId, 2), lightweightSubmissionKey, false);
    var preservedDraft = send(h5,"GET","/h5/activities/"+activityCode+"/order-draft",null,null,null);
    assertEquals(5,data(preservedDraft).path("items").get(0).path("quantity").asInt());
    var latestAfterReplay = send(h5,"GET","/h5/activities/"+activityCode+"/order",null,null,null);
    assertEquals(2,data(latestAfterReplay).path("currentVersion").asInt());
    assertEquals(5,data(latestAfterReplay).path("operations").size());

    ObjectNode staleRequestBody = JSON.createObjectNode().put("expectedVersion", 1).put("requestType", "MODIFY");
    staleRequestBody.putArray("items").addObject().put("productId", productId).put("quantity", 4);
    HttpResponse<String> stale = send(h5, "POST", "/h5/activities/" + activityCode + "/order-change-requests",
        staleRequestBody, h5Csrf, null, UUID.randomUUID().toString());
    assertEquals(409, stale.statusCode());
    assertEquals("ORDER_VERSION_CONFLICT", json(stale).path("code").asText());

    ObjectNode withdrawRequestBody = JSON.createObjectNode().put("expectedVersion", 2).put("requestType", "WITHDRAW");
    withdrawRequestBody.putArray("items");
    HttpResponse<String> withdrawRequest = send(h5, "POST", "/h5/activities/" + activityCode + "/order-change-requests",
        withdrawRequestBody, h5Csrf, null, UUID.randomUUID().toString());
    assertEquals(200, withdrawRequest.statusCode(), withdrawRequest.body());
    assertEquals("PENDING", data(withdrawRequest).path("status").asText());
    long withdrawRequestId = data(withdrawRequest).path("id").asLong();
    HttpResponse<String> approvedWithdraw = send(admin, "POST", "/admin/activities/" + activityId + "/order-change-requests/" + withdrawRequestId + "/approve",
        JSON.createObjectNode().put("reason", "AUTOTEST 审核通过撤回申请"), adminCsrf, null, UUID.randomUUID().toString());
    assertEquals(200, approvedWithdraw.statusCode(), approvedWithdraw.body());
    JsonNode withdrawn = data(send(h5, "GET", "/h5/activities/" + activityCode + "/order", null, null, null));
    assertEquals("WITHDRAWN", withdrawn.path("status").asText());
    assertEquals(2, withdrawn.path("versions").size());
    assertEquals(1, withdrawn.path("items").size());

    HttpResponse<String> withdrawnDashboard = send(client(), "GET", "/screen/activities/" + activityCode + "/ranking", null, null, null);
    assertEquals(200, withdrawnDashboard.statusCode(), withdrawnDashboard.body());
    assertEquals(0, data(withdrawnDashboard).path("totals").path("order_count").asInt());

    ObjectNode resubmitRequestBody = JSON.createObjectNode().put("expectedVersion", 2).put("requestType", "MODIFY");
    resubmitRequestBody.putArray("items").addObject().put("productId", productId).put("quantity", 1);
    resubmitRequestBody.withArray("items").addObject().put("productId", productWithoutTonsId).put("quantity", 1);
    String screenPath = "/screen/activities/" + activityCode;
    long previousEvent = Long.parseLong(data(withdrawnDashboard).path("version").asText());
    var eventRequest = HttpRequest.newBuilder(URI.create(baseUrl + screenPath + "/events"))
        .timeout(Duration.ofSeconds(20)).GET().build();
    var eventStream = client().send(eventRequest, HttpResponse.BodyHandlers.ofInputStream());
    assertEquals(200, eventStream.statusCode());
    var notification = new CompletableFuture<Void>();
    Thread eventReader = Thread.ofVirtual().start(() -> {
      try (var reader = new BufferedReader(new InputStreamReader(eventStream.body(), StandardCharsets.UTF_8))) {
        String event = "", line;
        while ((line = reader.readLine()) != null) {
          if (line.startsWith("event:")) event = line.substring(6).trim();
          else if (line.startsWith("data:") && event.equals("invalidate")) {
            JsonNode change = JSON.readTree(line.substring(5).trim());
            if (change.path("version").asLong() > previousEvent) { notification.complete(null); return; }
          }
        }
        notification.completeExceptionally(new IllegalStateException("SSE ended before the submitted order notification"));
      } catch (Exception exception) { notification.completeExceptionally(exception); }
    });
    try {
      var parallelScreens = List.of("/dashboard", "/ranking?metric=AMOUNT", "/ranking?metric=TONS", "/reports/ORDER_DASHBOARD")
          .stream().map(path -> CompletableFuture.supplyAsync(() -> {
            try { return send(client(), "GET", screenPath + path, null, null, null); }
            catch (Exception exception) { throw new java.util.concurrent.CompletionException(exception); }
          })).toList();
      HttpResponse<String> resubmitRequest = send(h5, "PUT", "/h5/activities/" + activityCode + "/order",
          resubmitRequestBody, h5Csrf, null, UUID.randomUUID().toString());
      assertEquals(200, resubmitRequest.statusCode(), resubmitRequest.body());
      for (var future : parallelScreens) {
        var response = future.join();
        assertEquals(200, response.statusCode(), response.body());
      }
      notification.get(10, java.util.concurrent.TimeUnit.SECONDS);
      var refreshed = send(client(), "GET", screenPath + "/dashboard", null, null, null);
      assertEquals(200, refreshed.statusCode(), refreshed.body());
      assertEquals(1, data(refreshed).path("dashboard").path("totals").path("order_count").asInt());
      assertEquals("0.100000", data(refreshed).path("dashboard").path("totals").path("total_tons")
          .decimalValue().setScale(6).toPlainString());
    } finally {
      eventStream.body().close();
      eventReader.interrupt();
    }
    JsonNode resubmitted = data(send(h5, "GET", "/h5/activities/" + activityCode + "/order", null, null, null));
    assertEquals("SUBMITTED", resubmitted.path("status").asText());
    assertEquals(3, resubmitted.path("currentVersion").asInt());
    assertEquals(orderNo, resubmitted.path("orderNo").asText());
    assertEquals("0.100000", resubmitted.path("totalTons").decimalValue().setScale(6).toPlainString());
    ObjectNode zeroTonsBody = JSON.createObjectNode().put("activityCustomerId", h5CustomerId);
    zeroTonsBody.putArray("items").addObject().put("productId", productWithoutTonsId).put("quantity", 20);
    var zeroTons = send(admin, "POST", "/admin/activities/" + activityId + "/orders/preview", zeroTonsBody, adminCsrf, null);
    assertEquals(200, zeroTons.statusCode(), zeroTons.body());
    assertEquals("0.000000", data(zeroTons).path("totalTons").decimalValue().setScale(6).toPlainString());
  }

  @Test
  @Order(6)
  void attendanceMatchingLotteryCandidatesAndConcurrentDraw() throws Exception {
    long attendanceTask = upload("ATTENDANCE", "attendance-valid.xlsx", attendanceWorkbook());
    JsonNode preview = data(send(admin, "GET", "/admin/activities/" + activityId + "/imports/" + attendanceTask
        + "/attendance-match-preview", null, null, null));
    assertEquals(6, preview.path("totalCount").asInt());
    assertEquals(4, preview.path("matchedCount").asInt());
    assertEquals(0, preview.path("pendingCount").asInt());
    assertEquals(2, preview.path("unmatchedCount").asInt());
    assertEquals(4, preview.path("eligibleCustomerCount").asInt());
    long whitelistVersionId = preview.path("whitelistVersionId").asLong();
    confirmAndAwait(attendanceTask, "?attendanceWhitelistVersionId=" + whitelistVersionId);

    HttpResponse<String> attendees = send(admin, "GET", "/admin/activities/" + activityId + "/attendees", null, null, null);
    assertEquals(200, attendees.statusCode(), attendees.body());
    assertEquals(6, data(attendees).size());
    assertEquals(4, count(data(attendees), "matchStatus", "MATCHED"));
    assertTrue(attendees.body().contains("13900000006"));

    long nanjingCustomerId = 0;
    long xuzhouCustomerId = 0;
    JsonNode sameNameCustomers = data(send(admin, "GET", "/admin/activities/" + activityId
        + "/customers?customerType=SPECIAL&keyword=%E6%B1%9F%E8%8B%8F%E5%9B%9B%E5%90%88&page=1&size=20", null, null, null));
    for (JsonNode customer : sameNameCustomers) {
      if ("南京分".equals(customer.path("branchName").asText())) nanjingCustomerId = customer.path("id").asLong();
      if ("徐州分".equals(customer.path("branchName").asText())) xuzhouCustomerId = customer.path("id").asLong();
    }
    assertTrue(nanjingCustomerId > 0);
    assertTrue(xuzhouCustomerId > 0);
    assertTrue(hasAttendee(data(attendees), "南京分", nanjingCustomerId));
    assertTrue(hasAttendee(data(attendees), "徐州分", xuzhouCustomerId));

    ObjectNode allPreview = lotteryPreview("ALL_CUSTOMERS", "ALL", 10, "0");
    JsonNode allCandidates = data(send(admin, "POST", "/admin/activities/" + activityId + "/lottery/candidates/preview",
        allPreview, adminCsrf, null));
    assertEquals(8, allCandidates.path("candidateCount").asInt());

    ObjectNode orderPreview = lotteryPreview("VALID_ORDERS", "ALL", 10, "50");
    JsonNode orderCandidates = data(send(admin, "POST", "/admin/activities/" + activityId + "/lottery/candidates/preview",
        orderPreview, adminCsrf, null));
    assertEquals(1, orderCandidates.path("candidateCount").asInt());

    ObjectNode attendeePreview = lotteryPreview("ATTENDEES", "ALL", 10, "0");
    JsonNode attendeeCandidates = data(send(admin, "POST", "/admin/activities/" + activityId + "/lottery/candidates/preview",
        attendeePreview, adminCsrf, null));
    assertEquals(4, attendeeCandidates.path("candidateCount").asInt());

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
    assertEquals(4, draw.path("candidateCount").asInt());
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
  @Order(8)
  void adminReportingDashboardAndCloseReadOnlyRules() throws Exception {
    HttpResponse<String> phoneSearch = send(admin, "GET", "/admin/activities/" + activityId
        + "/customers?keyword=" + GENERAL_PHONE + "&page=1&size=20", null, null, null);
    assertEquals(200, phoneSearch.statusCode(), phoneSearch.body());
    // The fixture intentionally reuses this phone for a GENERAL and a SPECIAL customer.
    // A full-phone search should therefore return both matching customer records.
    assertEquals(2, data(phoneSearch).size());
    assertTrue(data(phoneSearch).toString().contains(Long.toString(h5CustomerId)));
    assertTrue(phoneSearch.body().contains(GENERAL_PHONE));

    HttpResponse<String> customerProducts = send(admin, "GET", "/admin/activities/" + activityId
        + "/products?activityCustomerId=" + h5CustomerId, null, null, null);
    assertEquals(200, customerProducts.statusCode(), customerProducts.body());
    assertEquals(3, data(customerProducts).size());
    for (JsonNode product : data(customerProducts)) assertTrue(product.path("orderable").asBoolean());

    HttpResponse<String> orders = send(admin, "GET", "/admin/activities/" + activityId + "/orders?page=1&size=20", null, null, null);
    assertEquals(200, orders.statusCode(), orders.body());
    assertEquals(1, json(orders).path("page").path("totalElements").asInt());
    assertEquals(orderId, json(orders).path("data").get(0).path("id").asLong());
    assertTrue(orders.body().contains(GENERAL_PHONE));

    HttpResponse<String> detail = send(admin, "GET", "/admin/activities/" + activityId + "/orders/" + orderId, null, null, null);
    assertEquals(3, data(detail).path("versions").size());
    assertEquals(8, data(detail).path("operations").size());
    assertTrue(detail.body().contains(GENERAL_PHONE));

    HttpResponse<String> dashboard = send(client(), "GET", "/screen/activities/" + activityCode + "/ranking", null, null, null);
    assertEquals(1, data(dashboard).path("totals").path("order_count").asInt());
    assertEquals(2, data(dashboard).path("totals").path("total_quantity").asInt());
    assertEquals("150.00", data(dashboard).path("totals").path("total_amount").decimalValue().setScale(2).toPlainString());
    assertEquals("0.100000", data(dashboard).path("totals").path("total_tons").decimalValue().setScale(6).toPlainString());
    assertEquals("0.100000", data(dashboard).path("companies").get(0).path("tons").decimalValue().setScale(6).toPlainString());
    assertEquals("0.100000", data(dashboard).path("branches").get(0).path("tons").decimalValue().setScale(6).toPlainString());
    HttpResponse<String> tonsDashboard = send(client(), "GET", "/screen/activities/" + activityCode + "/ranking?metric=TONS", null, null, null);
    assertEquals(200, tonsDashboard.statusCode(), tonsDashboard.body());
    assertEquals("0.100000", data(tonsDashboard).path("companies").get(0).path("tons").decimalValue().setScale(6).toPlainString());
    assertEquals("0.100000", data(tonsDashboard).path("branches").get(0).path("tons").decimalValue().setScale(6).toPlainString());

    HttpResponse<String> orderDashboard = send(client(), "GET", "/screen/activities/" + activityCode + "/dashboard", null, null, null);
    assertEquals(200, orderDashboard.statusCode(), orderDashboard.body());
    JsonNode generalRegions = data(orderDashboard).path("generalRegions");
    assertEquals(3, generalRegions.size());
    assertEquals(1, generalRegions.get(0).path("orderCount").asInt());
    assertEquals(generalRegionCode, generalRegions.get(0).path("regionCode").asText());
    assertEquals(1, generalRegions.get(0).path("productLines").size());

    HttpResponse<String> export = send(admin, "GET", "/admin/activities/" + activityId + "/orders/export", null, null, null);
    assertEquals(200, export.statusCode());
    assertTrue(export.headers().firstValue("Content-Type").orElse("").contains("spreadsheetml"));
    assertTrue(export.body().length() > 1000);

    JsonNode latestActivity = data(send(admin, "GET", "/admin/activities/" + activityId, null, null, null));
    ObjectNode closeBody = JSON.createObjectNode().put("reason", "AUTOTEST 验证截止只读");
    var cutoffRequestBody=JSON.createObjectNode().put("expectedVersion",3).put("requestType","WITHDRAW");
    cutoffRequestBody.putArray("items");
    var cutoffRequest=send(h5,"POST","/h5/activities/"+activityCode+"/order-change-requests",cutoffRequestBody,h5Csrf,null,UUID.randomUUID().toString());
    assertEquals(200,cutoffRequest.statusCode(),cutoffRequest.body());
    long cutoffRequestId=data(cutoffRequest).path("id").asLong();
    HttpResponse<String> closed = send(admin, "POST", "/admin/activities/" + activityId + "/close", closeBody,
        adminCsrf, Integer.toString(latestActivity.path("version").asInt()));
    assertEquals(200, closed.statusCode(), closed.body());
    assertEquals("CLOSED", data(closed).path("status").asText());
    assertEquals(409,send(h5,"POST","/h5/activities/"+activityCode+"/order-change-requests",cutoffRequestBody,h5Csrf,null,UUID.randomUUID().toString()).statusCode());
    var cutoffReject=send(admin,"POST","/admin/activities/"+activityId+"/order-change-requests/"+cutoffRequestId+"/reject",JSON.createObjectNode().put("reason","截止后仍可审核"),adminCsrf,null,UUID.randomUUID().toString());
    assertEquals(200,cutoffReject.statusCode(),cutoffReject.body());
    assertEquals("REJECTED",data(cutoffReject).path("status").asText());
    assertFalse(Instant.parse(data(cutoffReject).path("reviewedAt").asText())
        .isBefore(Instant.parse(data(cutoffReject).path("requestedAt").asText())));

    assertLatestReplayDoesNotMutate(orderBody(0, productId, 2), firstSubmissionKey, true);
    assertLatestReplayDoesNotMutate(orderBody(1, productId, 2), lightweightSubmissionKey, false);

    HttpResponse<String> afterClose = send(h5, "PUT", "/h5/activities/" + activityCode + "/order",
        orderBody(3, productId, 2), h5Csrf, null, UUID.randomUUID().toString());
    assertEquals(409, afterClose.statusCode());
    assertTrue(List.of("ACTIVITY_NOT_WRITABLE", "ACTIVITY_CLOSED").contains(json(afterClose).path("code").asText()));

    ObjectNode adjustBody = JSON.createObjectNode().put("expectedVersion", 3)
        .put("expectedLockVersion", data(detail).path("lockVersion").asInt()).put("reason", "AUTOTEST 截止后调整");
    adjustBody.putArray("items").addObject().put("productId", productId).put("quantity", 4);
    HttpResponse<String> adjusted = send(admin, "PUT", "/admin/activities/" + activityId + "/orders/" + orderId,
        adjustBody, adminCsrf, null, UUID.randomUUID().toString());
    assertEquals(200, adjusted.statusCode(), adjusted.body());
    assertEquals(4, data(adjusted).path("currentVersion").asInt());
    assertEquals("ADMIN", data(adjusted).path("lastModifiedSource").asText());

    ObjectNode voidBody = JSON.createObjectNode().put("expectedVersion", 4)
        .put("expectedLockVersion", data(adjusted).path("lockVersion").asInt()).put("reason", "AUTOTEST 作废验证");
    HttpResponse<String> voided = send(admin, "POST", "/admin/activities/" + activityId + "/orders/" + orderId + "/void",
        voidBody, adminCsrf, null, UUID.randomUUID().toString());
    assertEquals(200, voided.statusCode(), voided.body());
    assertEquals("VOIDED", data(voided).path("status").asText());
    assertEquals(4, data(voided).path("currentVersion").asInt());
    assertEquals(0, data(send(client(), "GET", "/screen/activities/" + activityCode + "/ranking", null, null, null))
        .path("totals").path("order_count").asInt());

    ObjectNode restoreBody = JSON.createObjectNode().put("expectedVersion", 4)
        .put("expectedLockVersion", data(voided).path("lockVersion").asInt()).put("reason", "AUTOTEST 调整并恢复");
    restoreBody.putArray("items").addObject().put("productId", productId).put("quantity", 2);
    HttpResponse<String> restored = send(admin, "PUT", "/admin/activities/" + activityId + "/orders/" + orderId,
        restoreBody, adminCsrf, null, UUID.randomUUID().toString());
    assertEquals(200, restored.statusCode(), restored.body());
    assertEquals("SUBMITTED", data(restored).path("status").asText());
    assertEquals(5, data(restored).path("currentVersion").asInt());

    JsonNode customers = data(send(admin, "GET", "/admin/activities/" + activityId
        + "/customers?customerType=GENERAL&page=1&size=20", null, null, null));
    long secondCustomerId = 0;
    for (JsonNode customer : customers) {
      if (customer.path("id").asLong() != h5CustomerId && "上海分".equals(customer.path("branchName").asText())) {
        secondCustomerId = customer.path("id").asLong(); break;
      }
    }
    assertTrue(secondCustomerId > 0);
    ObjectNode createBody = JSON.createObjectNode().put("activityCustomerId", secondCustomerId)
        .put("reason", "AUTOTEST 管理员创建");
    createBody.putArray("items").addObject().put("productId", productId).put("quantity", 1);
    HttpResponse<String> adminCreated = send(admin, "POST", "/admin/activities/" + activityId + "/orders",
        createBody, adminCsrf, null, UUID.randomUUID().toString());
    assertEquals(200, adminCreated.statusCode(), adminCreated.body());
    assertEquals("ADMIN", data(adminCreated).path("createdSource").asText());
    assertEquals(1, data(adminCreated).path("currentVersion").asInt());

    HttpResponse<String> finalDashboard = send(client(), "GET", "/screen/activities/" + activityCode + "/ranking", null, null, null);
    assertEquals(2, data(finalDashboard).path("totals").path("order_count").asInt());

    ObjectNode finishBody = JSON.createObjectNode().put("reason", "AUTOTEST 验证整场活动结束");
    HttpResponse<String> finished = send(admin, "POST", "/admin/activities/" + activityId + "/finish", finishBody,
        adminCsrf, Integer.toString(data(closed).path("version").asInt()));
    assertEquals(200, finished.statusCode(), finished.body());
    assertEquals("FINISHED", data(finished).path("status").asText());

    HttpResponse<String> historyDashboard = send(client(), "GET", "/screen/activities/" + activityCode + "/ranking", null, null, null);
    assertEquals(2, data(historyDashboard).path("totals").path("order_count").asInt());
    assertEquals("FINISHED", data(historyDashboard).path("status").asText());
    assertEquals(409, send(client(), "GET", "/screen/activities/" + activityCode + "/events", null, null, null).statusCode());

    HttpResponse<String> afterFinish = send(h5, "GET", "/h5/activities/" + activityCode + "/order", null, null, null);
    assertEquals(401, afterFinish.statusCode());
    verifyReopeningRecovery();
  }

  private void verifyReopeningRecovery() throws Exception {
    String path = "/admin/activities/" + activityId;
    String screen = "/screen/activities/" + activityCode;
    JsonNode before = data(send(admin, "GET", path, null, null, null));
    JsonNode originalOrder = data(send(admin, "GET", path + "/orders/" + orderId, null, null, null));
    JsonNode originalLottery = data(send(client(), "GET", "/public/activities/" + activityCode + "/lottery", null, null, null));
    String version = before.path("version").asText();
    ObjectNode body = JSON.createObjectNode().put("endsAt", Instant.now().plusSeconds(3600).toString())
        .put("eventEndsAt", Instant.now().plusSeconds(7200).toString()).put("reason", "AUTOTEST 误结束恢复");
    for (ObjectNode invalid : List.of(body.deepCopy().put("reason", " "),
        body.deepCopy().put("endsAt", Instant.now().minusSeconds(1).toString()),
        body.deepCopy().put("eventEndsAt", body.path("endsAt").asText()))) {
      var rejected = send(admin, "POST", path + "/reopen", invalid, adminCsrf, version);
      assertEquals(400, rejected.statusCode(), rejected.body());
    }
    assertEquals(409, send(admin, "POST", path + "/reopen", body, adminCsrf, "-1").statusCode());
    var attempts = new ArrayList<CompletableFuture<HttpResponse<String>>>();
    for (int i = 0; i < 2; i++) attempts.add(CompletableFuture.supplyAsync(() -> {
      try { return send(admin, "POST", path + "/reopen", body, adminCsrf, version); }
      catch (Exception error) { throw new RuntimeException(error); }
    }));
    var results = attempts.stream().map(CompletableFuture::join).toList();
    assertEquals(List.of(200, 409), results.stream().map(HttpResponse::statusCode).sorted().toList(), results.toString());
    JsonNode reopened = data(results.stream().filter(r -> r.statusCode() == 200).findFirst().orElseThrow());
    assertEquals("ACTIVE", reopened.path("status").asText());
    assertEquals(before.path("startsAt"), reopened.path("startsAt"));
    assertTrue(reopened.path("closedAt").isNull() || reopened.path("closedAt").isMissingNode());
    assertTrue(reopened.path("finishedAt").isNull() || reopened.path("finishedAt").isMissingNode());
    assertEquals(originalOrder, data(send(admin, "GET", path + "/orders/" + orderId, null, null, null)));
    assertEquals(originalLottery, data(send(client(), "GET", "/public/activities/" + activityCode + "/lottery", null, null, null)));
    assertEquals("ACTIVE", data(send(client(), "GET", screen + "/ranking", null, null, null)).path("status").asText());
    assertEquals(401, send(h5, "GET", "/h5/activities/" + activityCode + "/order", null, null, null).statusCode());

    ObjectNode verify = JSON.createObjectNode().put("customerType", "GENERAL").put("regionCode", generalRegionCode).put("phone", GENERAL_PHONE);
    var login = send(h5, "POST", "/public/activities/" + activityCode + "/verify-phone", verify, null, null);
    assertEquals(200, login.statusCode(), login.body());
    h5Csrf = data(login).path("csrfToken").asText();
    var addition = orderBody(originalOrder.path("currentVersion").asInt(), productId, 3);
    var submitted = send(h5, "PUT", "/h5/activities/" + activityCode + "/order", addition, h5Csrf, null, UUID.randomUUID().toString());
    assertEquals(200, submitted.statusCode(), submitted.body());
    JsonNode liveTotals = data(send(client(), "GET", screen + "/ranking", null, null, null)).path("totals");

    ObjectNode shortened = ((ObjectNode) reopened).deepCopy();
    shortened.put("endsAt", Instant.now().plusSeconds(600).toString());
    shortened.put("eventEndsAt", Instant.now().plusSeconds(1200).toString());
    var updated = send(admin, "PUT", path, shortened, adminCsrf, reopened.path("version").asText());
    assertEquals(200, updated.statusCode(), updated.body());
    var reason = JSON.createObjectNode().put("reason", "AUTOTEST 多次恢复");
    var closed = send(admin, "POST", path + "/close", reason, adminCsrf, data(updated).path("version").asText());
    assertEquals(200, closed.statusCode(), closed.body());
    var again = send(admin, "POST", path + "/reopen", body, adminCsrf, data(closed).path("version").asText());
    assertEquals(200, again.statusCode(), again.body());
    assertEquals(200, send(h5, "GET", "/h5/activities/" + activityCode + "/order", null, null, null).statusCode());
    closed = send(admin, "POST", path + "/close", reason, adminCsrf, data(again).path("version").asText());
    var finished = send(admin, "POST", path + "/finish", reason, adminCsrf, data(closed).path("version").asText());
    assertEquals(200, finished.statusCode(), finished.body());
    assertEquals(liveTotals, data(send(client(), "GET", screen + "/ranking", null, null, null)).path("totals"));

    // Exercise automatic cutoffs as well as explicit buttons, including the scheduler's catch-up window.
    body.put("endsAt", Instant.now().plusSeconds(2).toString()).put("eventEndsAt", Instant.now().plusSeconds(4).toString());
    var timed = send(admin, "POST", path + "/reopen", body, adminCsrf, data(finished).path("version").asText());
    assertEquals(200, timed.statusCode(), timed.body());
    Thread.sleep(2500);
    assertEquals("CLOSED", data(send(admin, "GET", path, null, null, null)).path("status").asText());
    Thread.sleep(2000);
    JsonNode automaticEnd = data(send(admin, "GET", path, null, null, null));
    assertEquals("FINISHED", automaticEnd.path("status").asText());
    body.put("endsAt", Instant.now().plusSeconds(600).toString()).put("eventEndsAt", Instant.now().plusSeconds(1200).toString());
    var finalReopen = send(admin, "POST", path + "/reopen", body, adminCsrf, automaticEnd.path("version").asText());
    assertEquals(200, finalReopen.statusCode(), finalReopen.body());
    closed = send(admin, "POST", path + "/close", reason, adminCsrf, data(finalReopen).path("version").asText());
    finished = send(admin, "POST", path + "/finish", reason, adminCsrf, data(closed).path("version").asText());
    assertEquals(200, finished.statusCode(), finished.body());
    assertEquals(liveTotals, data(send(client(), "GET", screen + "/ranking", null, null, null)).path("totals"));
    var logs = send(admin, "GET", path + "/audit-logs?actionCode=ACTIVITY_REOPEN", null, null, null);
    assertEquals(200, logs.statusCode(), logs.body());
    assertTrue(logs.body().contains("AUTOTEST 误结束恢复"));
  }

  @Test
  @Order(7)
  void freeTextWhitelistRegionIsPublishedToH5AndRemainsVerifiable() throws Exception {
    HttpResponse<String> listed = send(admin, "GET",
        "/admin/activities/" + activityId + "/customers?customerType=GENERAL&keyword=AUTOTEST%E7%BB%BC%E5%90%88%E7%BB%8F%E9%94%80%E5%95%86%E4%BA%8C&page=1&size=20",
        null, null, null);
    assertEquals(200, listed.statusCode(), listed.body());
    JsonNode customer = data(listed).get(0);
    ObjectNode update = JSON.createObjectNode()
        .put("customerType", "GENERAL")
        .put("regionCode", "华北新区")
        .put("branchName", customer.path("branchName").asText())
        .put("dealerShortName", customer.path("dealerShortName").asText())
        .put("dealerFullName", customer.path("dealerFullName").asText())
        .put("dealerCategory", customer.path("dealerCategory").asText())
        .put("contactName", customer.path("contactName").asText())
        .put("phone", customer.path("phone").asText())
        .put("confirmerName", customer.path("confirmerName").asText())
        .put("confirmerPhone", customer.path("confirmerPhone").asText())
        .put("expectedVersion", customer.path("lockVersion").asInt())
        .put("reason", "验证自由填写大区自动同步到 H5");
    HttpResponse<String> saved = send(admin, "PUT",
        "/admin/activities/" + activityId + "/customers/" + customer.path("id").asLong(), update, adminCsrf, null);
    assertEquals(200, saved.statusCode(), saved.body());
    String regionCode = data(saved).path("regionCode").asText();
    assertTrue(regionCode.startsWith("R_"));

    JsonNode publicActivity = publicActivitySnapshot();
    boolean visible = false;
    for (JsonNode region : publicActivity.path("regions")) {
      if (regionCode.equals(region.path("code").asText()) && "华北新区".equals(region.path("name").asText())) visible = true;
    }
    assertTrue(visible, publicActivity.toString());

    HttpClient newRegionCustomer = client();
    ObjectNode verify = JSON.createObjectNode().put("customerType", "GENERAL")
        .put("regionCode", regionCode).put("phone", "13900000002");
    HttpResponse<String> verified = send(newRegionCustomer, "POST",
        "/public/activities/" + activityCode + "/verify-phone", verify, null, null);
    assertEquals(200, verified.statusCode(), verified.body());
    assertEquals(regionCode, data(verified).path("customer").path("regionCode").asText());

    ObjectNode unassignedUpdate = update.deepCopy();
    unassignedUpdate.putNull("regionCode");
    unassignedUpdate.put("expectedVersion", data(saved).path("lockVersion").asInt());
    unassignedUpdate.put("reason", "验证未分大区客户入口");
    HttpResponse<String> unassignedSaved = send(admin, "PUT",
        "/admin/activities/" + activityId + "/customers/" + customer.path("id").asLong(), unassignedUpdate, adminCsrf, null);
    assertEquals(200, unassignedSaved.statusCode(), unassignedSaved.body());
    assertTrue(data(unassignedSaved).path("regionCode").isNull()
        || data(unassignedSaved).path("regionCode").isMissingNode());

    JsonNode mixedActivity = publicActivitySnapshot();
    assertTrue(mixedActivity.path("hasUnassignedGeneralCustomers").asBoolean());
    assertFalse(mixedActivity.path("regions").toString().contains("华北新区"));

    ObjectNode unassignedVerify = JSON.createObjectNode().put("customerType", "GENERAL")
        .put("regionCode", "UNASSIGNED").put("phone", "13900000002");
    HttpResponse<String> unassignedVerified = send(client(), "POST",
        "/public/activities/" + activityCode + "/verify-phone", unassignedVerify, null, null);
    assertEquals(200, unassignedVerified.statusCode(), unassignedVerified.body());

    ObjectNode missingRegion = JSON.createObjectNode().put("customerType", "GENERAL")
        .putNull("regionCode").put("phone", "13900000002");
    assertEquals(404, send(client(), "POST", "/public/activities/" + activityCode + "/verify-phone",
        missingRegion, null, null).statusCode());
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
    List<String> headers = List.of("客户类型", "是否返利", "产品大类", "项目组", "物料代码", "物料名称", "品牌", "品种", "规格", "箱规", "元/瓶", "元/箱", "吨箱转换系数", "是否为标品礼盒", "分公司定制品", "产品说明");
    try (XSSFWorkbook workbook = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      Sheet product = sheet(workbook, "商品目录", headers);
      row(product, "综合", "是", "调味品", "酱油", "P001", "AUTOTEST_综合商品一", "测试品牌", "原味", "500ml", "12瓶", "8.00", "100.00", "10", "否", "", "综合返利商品说明");
      row(product, "综合", "是", "调味品", "酱油", "P002", "AUTOTEST_综合缺吨数", "测试品牌", "原味", "500ml", "12瓶", "4.00", "50.00", "", "否", "", "");
      row(product, "综合", "否", "调味品", "醋", "P003", "AUTOTEST_综合商品三", "测试品牌", "陈醋", "500ml", "12瓶", "2.50", "30.00", "5", "是", "", "");
      row(product, "特渠", "是", "定制品", "礼盒", "S001", "AUTOTEST_特渠商品一", "测试品牌", "礼盒", "1套", "1箱", "200.00", "200.00", "20", "是", "", "");
      row(product, "特渠", "否", "定制品", "调味油", "S002", "AUTOTEST_特渠商品二", "测试品牌", "油", "1L", "6瓶", "13.00", "80.00", "8", "否", "", "");
      workbook.write(out);
      return out.toByteArray();
    }
  }

  private byte[] whitelistWorkbook() throws Exception {
    List<String> headers = List.of("客户类型", "大区", "分公司名称", "经销商名称（简）", "经销商名称（全）", "经销商姓名", "经销商电话", "分公司确认人姓名", "分公司确认人电话");
    try (XSSFWorkbook workbook = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      Sheet whitelist = sheet(workbook, "白名单", headers);
      row(whitelist, "综合客户", "东区", "上海分", "测试综合一", "AUTOTEST综合经销商一", "测试甲", GENERAL_PHONE, "确认甲", "13800000001");
      row(whitelist, "综合客户", "东区", "上海分", "测试综合二", "AUTOTEST综合经销商二", "测试乙", "13900000002", "确认甲", "13800000001");
      row(whitelist, "综合客户", "南区", "广州分", "测试综合三", "AUTOTEST综合经销商三", "测试丙", "13900000003", "确认乙", "13800000002");
      row(whitelist, "综合客户", "北1区", "北京分", "测试综合四", "AUTOTEST综合经销商四", "测试丁", "13900000004", "确认丙", "13800000003");
      row(whitelist, "特渠专业客户", "", "特渠分", "测试特渠一", "AUTOTEST特渠经销商一", "测试戊", SPECIAL_PHONE, "确认丁", "13800000004");
      row(whitelist, "特渠专业客户", "", "特渠分", "测试特渠二", "AUTOTEST特渠经销商二", "测试己", "13900000005", "确认丁", "13800000004");
      row(whitelist, "特渠专业客户", "", "南京分", "测试特渠同名南京", "江苏四合商贸发展有限公司", "测试庚", "13900000009", "确认戊", "13800000008");
      row(whitelist, "特渠专业客户", "", "徐州分", "测试特渠同名徐州", "江苏四合商贸发展有限公司", "测试辛", "13900000010", "确认己", "13800000009");
      workbook.write(out);
      return out.toByteArray();
    }
  }

  private byte[] attendanceWorkbook() throws Exception {
    List<String> headers = List.of("分公司", "参会人姓名", "性别", "参会人电话", "参会人员类型", "经销商名称");
    try (XSSFWorkbook workbook = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      Sheet attendance = sheet(workbook, "现场参会名单", headers);
      row(attendance, "上海分", "测试甲", "男", "13900000006", "综合经销商", "AUTOTEST综合经销商一");
      row(attendance, "上海分", "测试乙", "女", "13900000007", "综合经销商", "测试综合二");
      row(attendance, "未知分", "测试未知", "男", "13900000008", "综合经销商", "AUTOTEST_不存在经销商");
      row(attendance, "南京分", "测试庚", "男", "13900000011", "特渠专业经销商", "江苏四合商贸发展有限公司");
      row(attendance, "徐州分", "测试辛", "女", "13900000012", "特渠专业经销商", "江苏四合商贸发展有限公司");
      row(attendance, "未知分", "测试错分公司", "男", "13900000013", "特渠专业经销商", "江苏四合商贸发展有限公司");
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

  private boolean hasAttendee(JsonNode rows, String branch, long customerId) {
    for (JsonNode row : rows) {
      if (branch.equals(row.path("branchName").asText())
          && customerId == row.path("activityCustomerId").asLong()
          && "MATCHED".equals(row.path("matchStatus").asText())
          && "FULL_NAME_BRANCH".equals(row.path("matchMethod").asText())) return true;
    }
    return false;
  }

  @Test
  @Order(9)
  void automaticPriceUpdatesOnlyCurrentOrders() throws Exception {
    h5=client();
    createDraftAndRejectPrematurePublication();
    importAndPublishProductAndWhitelistFixtures();
    publishActivityAndVerifyH5IdentityAndCatalogIsolation();
    var submitted=send(h5,"PUT","/h5/activities/"+activityCode+"/order",mixedOrderBody(0,productId,200,productWithoutTonsId,1),h5Csrf,null,UUID.randomUUID().toString());
    assertEquals("20.000000", data(submitted).path("totalTons").decimalValue().setScale(6).toPlainString());
    assertEquals(200,submitted.statusCode(),submitted.body());
    JsonNode original=data(submitted);
    String base="/admin/activities/"+activityId;
    ObjectNode patch=JSON.createObjectNode().put("casePriceSet",true).put("casePrice",100)
        .put("priceTierSet",true).put("priceTierMinQuantity",100).put("priceTierCasePrice",80)
        .put("priceTierPricingMode","WHOLE_ORDER");
    JsonNode updated=original;
    JsonNode frozenVersions=null;
    for(String mode:List.of("WHOLE_ORDER","INCREMENTAL","REMOVE","REPEAT")) {
      if(mode.equals("INCREMENTAL")) patch.put("priceTierPricingMode","INCREMENTAL");
      if(mode.equals("REMOVE")) { patch.put("casePrice",110).putNull("priceTierMinQuantity").putNull("priceTierCasePrice"); }
      JsonNode product=findProduct(data(send(admin,"GET",base+"/products",null,null,null)),"P001");
      var saved=send(admin,"PATCH",base+"/products/"+productId,patch,adminCsrf,product.path("version").asText());
      assertEquals(200,saved.statusCode(),saved.body());
      JsonNode current=data(send(h5,"GET","/h5/activities/"+activityCode+"/order",null,null,null));
      String amount=mode.equals("WHOLE_ORDER")?"16000":mode.equals("INCREMENTAL")?"17980":"22000";
      assertEquals(0,new java.math.BigDecimal(amount).compareTo(current.path("items").get(0).path("lineAmount").decimalValue()));
      assertEquals(historyBusinessContent(original.path("versions")), historyBusinessContent(current.path("versions")),
          "Repricing must preserve every historical business field; only copied detail-row IDs may differ");
      if (frozenVersions == null) frozenVersions = current.path("versions").deepCopy();
      else assertEquals(frozenVersions, current.path("versions"), "Once copied, historical rows must remain unchanged");
      assertEquals(original.path("operations"),current.path("operations"));
      assertEquals(original.path("currentVersion"),current.path("currentVersion"));
      assertEquals(original.path("totalQuantity"),current.path("totalQuantity"));
      assertEquals(original.path("totalTons"),current.path("totalTons"));
      assertEquals(original.path("items").get(1),current.path("items").get(1));
      if(mode.equals("REPEAT")) assertEquals(updated,current);
      updated=current;
      JsonNode ranking=data(send(client(),"GET","/screen/activities/"+activityCode+"/ranking",null,null,null));
      assertEquals(0,current.path("totalAmount").decimalValue().compareTo(ranking.path("totals").path("total_amount").decimalValue()));
      JsonNode adminOrder=data(send(admin,"GET",base+"/orders/"+original.path("id").asLong(),null,null,null));
      assertEquals(current.path("items"),adminOrder.path("items"));
    }
    JsonNode product=findProduct(data(send(admin,"GET",base+"/products",null,null,null)),"P001");
    patch.put("casePrice",0).put("orderable",false);
    var invalid=send(admin,"PATCH",base+"/products/"+productId,patch,adminCsrf,product.path("version").asText());
    assertEquals(422,invalid.statusCode(),invalid.body());
    assertEquals(product,findProduct(data(send(admin,"GET",base+"/products",null,null,null)),"P001"));
    assertEquals(updated,data(send(h5,"GET","/h5/activities/"+activityCode+"/order",null,null,null)));
    ObjectNode withdrawRequestBody = JSON.createObjectNode().put("expectedVersion", 1).put("requestType", "WITHDRAW");
    withdrawRequestBody.putArray("items");
    var withdrawnRequest=send(h5,"POST","/h5/activities/"+activityCode+"/order-change-requests",withdrawRequestBody,h5Csrf,null,UUID.randomUUID().toString());
    assertEquals(200,withdrawnRequest.statusCode(),withdrawnRequest.body());
    long withdrawRequestId=data(withdrawnRequest).path("id").asLong();
    var withdrawnApproval=send(admin,"POST",base+"/order-change-requests/"+withdrawRequestId+"/approve",JSON.createObjectNode().put("reason","AUTOTEST 审核撤回申请"),adminCsrf,null,UUID.randomUUID().toString());
    assertEquals(200,withdrawnApproval.statusCode(),withdrawnApproval.body());
    JsonNode withdrawn=data(send(h5,"GET","/h5/activities/"+activityCode+"/order",null,null,null));
    assertEquals("WITHDRAWN",withdrawn.path("status").asText());
    patch.put("casePrice",120).put("orderable",true);
    assertEquals(200,send(admin,"PATCH",base+"/products/"+productId,patch,adminCsrf,product.path("version").asText()).statusCode());
    assertEquals(withdrawn,data(send(h5,"GET","/h5/activities/"+activityCode+"/order",null,null,null)));
    var directRestore = send(h5,"PUT","/h5/activities/"+activityCode+"/order",
        orderBody(withdrawn.path("currentVersion").asInt(), productId, 3),h5Csrf,null,UUID.randomUUID().toString());
    assertEquals(200,directRestore.statusCode(),directRestore.body());
    assertEquals(withdrawn.path("orderNo"),data(directRestore).path("orderNo"));
    withdrawn=data(directRestore);
    var restoreRequestBody=JSON.createObjectNode().put("expectedVersion",withdrawn.path("currentVersion").asInt()).put("requestType","MODIFY");
    restoreRequestBody.putArray("items").addObject().put("productId",productId).put("quantity",2);
    var restoreRequest=send(h5,"POST","/h5/activities/"+activityCode+"/order-change-requests",restoreRequestBody,h5Csrf,null,UUID.randomUUID().toString());
    assertEquals(200,restoreRequest.statusCode(),restoreRequest.body());
    var adminRestore=JSON.createObjectNode().put("expectedVersion",withdrawn.path("currentVersion").asInt()).put("expectedLockVersion",withdrawn.path("lockVersion").asInt()).put("reason","验证管理员调整自动驳回");
    adminRestore.putArray("items").addObject().put("productId",productId).put("quantity",4);
    var restoredByAdmin=send(admin,"PUT",base+"/orders/"+withdrawn.path("id").asLong(),adminRestore,adminCsrf,null,UUID.randomUUID().toString());
    assertEquals(200,restoredByAdmin.statusCode(),restoredByAdmin.body());
    var invalidated=send(admin,"GET",base+"/order-change-requests/"+data(restoreRequest).path("id").asLong(),null,null,null);
    assertEquals("REJECTED",data(invalidated).path("status").asText());
    assertTrue(data(invalidated).path("reviewReason").asText().contains("订单已发生变化"));
    verifyIncrementRecoveryRules();
  }


  private void verifyIncrementRecoveryRules() throws Exception {
    String h5Path = "/h5/activities/" + activityCode + "/order";
    String requestsPath = "/h5/activities/" + activityCode + "/order-change-requests";
    String adminPath = "/admin/activities/" + activityId;
    JsonNode current = data(send(h5,"GET",h5Path,null,null,null));
    String originalNumber = current.path("orderNo").asText();
    long originalId = current.path("id").asLong();
    ObjectNode ten = orderBody(current.path("currentVersion").asInt(),productId,10)
        .put("expectedLockVersion",current.path("lockVersion").asInt());
    String increaseKey = UUID.randomUUID().toString();
    var increased = send(h5,"PUT",h5Path,ten,h5Csrf,null,increaseKey);
    assertEquals(200,increased.statusCode(),increased.body());
    assertEquals(10,data(increased).path("totalQuantity").asInt());
    assertEquals(data(increased),data(send(h5,"PUT",h5Path,ten,h5Csrf,null,increaseKey)));
    current=data(increased);
    int version=current.path("currentVersion").asInt();
    var same=send(h5,"PUT",h5Path,orderBody(version,productId,10),h5Csrf,null,UUID.randomUUID().toString());
    assertEquals(200,same.statusCode(),same.body());
    assertEquals(current,data(same));

    // One reduced product requires approval even when other products increase the total.
    ObjectNode mixed=orderBody(version,productId,9);
    mixed.withArray("items").addObject().put("productId",productWithoutTonsId).put("quantity",100);
    var denied=send(h5,"PUT",h5Path,mixed,h5Csrf,null,UUID.randomUUID().toString());
    assertEquals(409,denied.statusCode(),denied.body());
    assertEquals("ORDER_CHANGE_REVIEW_REQUIRED",json(denied).path("code").asText());
    mixed.put("requestType","MODIFY");
    var pending=send(h5,"POST",requestsPath,mixed,h5Csrf,null,UUID.randomUUID().toString());
    assertEquals(200,pending.statusCode(),pending.body());
    long pendingId=data(pending).path("id").asLong();
    assertEquals(10,data(send(h5,"GET",h5Path,null,null,null)).path("totalQuantity").asInt());
    var invalid=orderBody(version,productId,12);
    invalid.withArray("items").addObject().put("productId",Long.MAX_VALUE).put("quantity",1);
    assertEquals(422,send(h5,"PUT",h5Path,invalid,h5Csrf,null,UUID.randomUUID().toString()).statusCode());
    assertEquals("PENDING",data(send(h5,"GET",requestsPath+"/current",null,null,null)).path("status").asText());
    var unchanged=send(h5,"PUT",h5Path,orderBody(version,productId,10),h5Csrf,null,UUID.randomUUID().toString());
    assertEquals(version,data(unchanged).path("currentVersion").asInt());
    assertEquals(pendingId,data(send(h5,"GET",requestsPath+"/current",null,null,null)).path("id").asLong());

    ObjectNode twelve=orderBody(version,productId,12);
    twelve.withArray("items").addObject().put("productId",productWithoutTonsId).put("quantity",1);
    var pureIncrease=send(h5,"PUT",h5Path,twelve,h5Csrf,null,UUID.randomUUID().toString());
    assertEquals(200,pureIncrease.statusCode(),pureIncrease.body());
    current=data(pureIncrease);
    var superseded=send(admin,"GET",adminPath+"/order-change-requests/"+pendingId,null,null,null);
    assertEquals("REJECTED",data(superseded).path("status").asText());
    assertTrue(data(superseded).path("reviewReason").asText().contains("失效"));
    var latestRequest=json(send(h5,"GET",requestsPath+"/current",null,null,null)).path("data");
    assertTrue(latestRequest.isNull() || latestRequest.isMissingNode());
    assertEquals(409,send(admin,"POST",adminPath+"/order-change-requests/"+pendingId+"/approve",JSON.createObjectNode(),adminCsrf,null,UUID.randomUUID().toString()).statusCode());

    // Deleting a product needs review; a rejected application leaves the effective order intact.
    ObjectNode deletion=orderBody(current.path("currentVersion").asInt(),productId,20).put("requestType","MODIFY");
    var deleteRequest=send(h5,"POST",requestsPath,deletion,h5Csrf,null,UUID.randomUUID().toString());
    assertEquals(200,deleteRequest.statusCode(),deleteRequest.body());
    var rejected=send(admin,"POST",adminPath+"/order-change-requests/"+data(deleteRequest).path("id").asLong()+"/reject",
        JSON.createObjectNode().put("reason","测试保留原订单"),adminCsrf,null,UUID.randomUUID().toString());
    assertEquals(200,rejected.statusCode(),rejected.body());
    assertEquals(current.path("items"),data(send(h5,"GET",h5Path,null,null,null)).path("items"));

    ObjectNode withdrawal=JSON.createObjectNode().put("expectedVersion",current.path("currentVersion").asInt()).put("requestType","WITHDRAW");
    withdrawal.putArray("items");
    var withdraw=send(h5,"POST",requestsPath,withdrawal,h5Csrf,null,UUID.randomUUID().toString());
    assertEquals(200,withdraw.statusCode(),withdraw.body());
    var approved=send(admin,"POST",adminPath+"/order-change-requests/"+data(withdraw).path("id").asLong()+"/approve",JSON.createObjectNode(),adminCsrf,null,UUID.randomUUID().toString());
    assertEquals(200,approved.statusCode(),approved.body());
    current=data(send(h5,"GET",h5Path,null,null,null));
    assertEquals("WITHDRAWN",current.path("status").asText());
    var five=orderBody(current.path("currentVersion").asInt(),productId,5).put("expectedLockVersion",current.path("lockVersion").asInt());
    var restored=send(h5,"PUT",h5Path,five,h5Csrf,null,UUID.randomUUID().toString());
    assertEquals(200,restored.statusCode(),restored.body());
    assertEquals("SUBMITTED",data(restored).path("status").asText());
    current=data(restored);
    ObjectNode stalePage=orderBody(current.path("currentVersion").asInt(),productId,6).put("expectedLockVersion",current.path("lockVersion").asInt());
    ObjectNode voidBody=JSON.createObjectNode().put("expectedVersion",current.path("currentVersion").asInt())
        .put("expectedLockVersion",current.path("lockVersion").asInt()).put("reason","测试 H5 恢复作废订单");
    var voided=send(admin,"POST",adminPath+"/orders/"+originalId+"/void",voidBody,adminCsrf,null,UUID.randomUUID().toString());
    assertEquals(200,voided.statusCode(),voided.body());
    assertEquals(409,send(h5,"PUT",h5Path,stalePage,h5Csrf,null,UUID.randomUUID().toString()).statusCode());
    current=data(voided);
    var two=orderBody(current.path("currentVersion").asInt(),productId,2).put("expectedLockVersion",current.path("lockVersion").asInt());
    String restoreKey=UUID.randomUUID().toString();
    var restoredVoid=send(h5,"PUT",h5Path,two,h5Csrf,null,restoreKey);
    assertEquals(200,restoredVoid.statusCode(),restoredVoid.body());
    current=data(restoredVoid);
    assertEquals(current,data(send(h5,"PUT",h5Path,two,h5Csrf,null,restoreKey)));
    assertEquals(originalId,current.path("id").asLong());
    assertEquals(originalNumber,current.path("orderNo").asText());
    assertEquals("SUBMITTED",current.path("status").asText());
    assertEquals(2,current.path("totalQuantity").asInt());
    assertTrue(current.path("voidedAt").isNull() || current.path("voidedAt").isMissingNode());
    assertTrue(current.path("withdrawnAt").isNull() || current.path("withdrawnAt").isMissingNode());
    assertTrue(current.path("operations").toString().contains("恢复已作废订单"));
    var ranking=data(send(client(),"GET","/screen/activities/"+activityCode+"/ranking",null,null,null));
    assertEquals(1,ranking.path("totals").path("order_count").asInt());
    assertEquals(0,current.path("totalAmount").decimalValue().compareTo(ranking.path("totals").path("total_amount").decimalValue()));
  }

  @Test
  @Order(10)
  void failedProductPublicationKeepsThePublishedCatalogAndCanRetry() throws Exception {
    createDraftAndRejectPrematurePublication();
    long originalTask = upload("PRODUCT", "products-original.xlsx", productWorkbook());
    confirmAndAwait(originalTask);
    String productsPath = "/admin/activities/" + activityId + "/products";
    JsonNode before = data(send(admin, "GET", productsPath, null, null, null));
    assertEquals(5, before.size());

    long replacementTask = upload("PRODUCT", "products-replacement.xlsx", productWorkbook());
    String boundary = "----OrderShowRollback" + UUID.randomUUID();
    ByteArrayOutputStream body = new ByteArrayOutputStream();
    write(body, "--" + boundary + "\r\nContent-Disposition: form-data; name=\"imageZip\"; filename=\"broken-images.zip\"\r\nContent-Type: application/zip\r\n\r\n");
    write(body, "not-a-zip\r\n--" + boundary + "--\r\n");
    HttpRequest confirm = request("/admin/activities/" + activityId + "/imports/" + replacementTask + "/confirm")
        .header("Content-Type", "multipart/form-data; boundary=" + boundary).header("X-CSRF-Token", adminCsrf)
        .POST(HttpRequest.BodyPublishers.ofByteArray(body.toByteArray())).build();
    var accepted = admin.send(confirm, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    assertEquals(202, accepted.statusCode(), accepted.body());
    long deadline = System.nanoTime() + Duration.ofSeconds(20).toNanos();
    JsonNode failed = task(replacementTask);
    while (!"FAILED".equals(failed.path("status").asText()) && System.nanoTime() < deadline) {
      Thread.sleep(100);
      failed = task(replacementTask);
    }
    assertEquals("FAILED", failed.path("status").asText(), failed.toString());
    assertEquals("PUBLISH_FAILED", failed.path("failureCode").asText());
    assertEquals(before, data(send(admin, "GET", productsPath, null, null, null)));

    confirmAndAwait(replacementTask);
    JsonNode after = data(send(admin, "GET", productsPath, null, null, null));
    assertEquals(5, after.size());
    assertNotEquals(before.get(0).path("id"), after.get(0).path("id"));
  }

  private HttpClient client() {
    CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
    return HttpClient.newBuilder().cookieHandler(cookies).connectTimeout(Duration.ofSeconds(5)).build();
  }

  private JsonNode publicActivitySnapshot() throws Exception {
    try (var publicClient = client()) {
      var response = publicClient.send(request("/public/activities/" + activityCode + "/events")
          .header("Accept", "text/event-stream").GET().build(), HttpResponse.BodyHandlers.ofInputStream());
      try (var body = response.body(); var executor = Executors.newVirtualThreadPerTaskExecutor()) {
        assertEquals(200, response.statusCode());
        var snapshot = executor.submit(() -> {
          var lines = new BufferedReader(new InputStreamReader(body, StandardCharsets.UTF_8));
          for (String line; (line = lines.readLine()) != null;) {
            if (line.startsWith("data:")) {
              JsonNode frame = JSON.readTree(line.substring(5).trim());
              if (frame.has("activity")) return frame.path("activity");
              if (frame.has("code")) throw new AssertionError("Activity unavailable: " + frame);
            }
          }
          throw new AssertionError("Activity SSE ended before its initial snapshot");
        });
        try {
          JsonNode activity = snapshot.get(10, TimeUnit.SECONDS);
          assertEquals(activityCode, activity.path("code").asText());
          return activity;
        } finally {
          body.close();
          snapshot.cancel(true);
        }
      }
    }
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
    var response = client.send(request.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    if ("true".equals(System.getenv("ORDER_SHOW_SUMMARY_CHECK")) && !"GET".equals(method)
        && response.statusCode() >= 200 && response.statusCode() < 300) {
      assertDashboardSummariesAfterWrite();
    }
    return response;
  }

  /** Exclude only the storage-row ID; retain order-version ID, product ID, prices, quantities and all other fields. */
  private static JsonNode historyBusinessContent(JsonNode versions) {
    JsonNode result = versions.deepCopy();
    for (JsonNode version : result) {
      var ids = new java.util.HashSet<Long>();
      for (JsonNode item : version.path("items")) {
        assertTrue(item.path("id").asLong() > 0, "History detail must have a valid storage-row ID");
        assertTrue(ids.add(item.path("id").asLong()), "History detail-row IDs must not repeat within a version");
        ((ObjectNode) item).remove("id");
      }
    }
    return result;
  }

  private void storeLegacySubmissionReceipt(String key, JsonNode original) throws Exception {
    assertEquals("http://host.docker.internal:8180/api/v1", baseUrl);
    var jdbc = new org.springframework.jdbc.core.JdbcTemplate(new org.springframework.jdbc.datasource.DriverManagerDataSource(
        "jdbc:mysql://host.docker.internal:33306/order_show_e2e?allowPublicKeyRetrieval=true&useSSL=false&serverTimezone=UTC",
        "order_show_e2e", "e2e_mysql_only_not_for_business"));
    String receipt = JSON.writeValueAsString(java.util.Map.of("format", 2, "orderId", original.path("id").asLong(),
        "orderVersion", original.path("currentVersion").asInt(), "resultJson", original.toString()));
    assertEquals(1, jdbc.update("""
        UPDATE api_idempotency SET response_json=?
        WHERE activity_id=? AND actor_type='H5_CUSTOMER' AND actor_id=? AND endpoint_code='ORDER_SUBMIT'
          AND idempotency_key=? AND status='COMPLETED'
        """, receipt, activityId, h5CustomerId, key));
  }

  /** A retry returns current server state, without replaying the write or clearing a newer draft. */
  private void assertLatestReplayDoesNotMutate(JsonNode originalBody, String key, boolean includeHistory) throws Exception {
    String path = "/h5/activities/" + activityCode + "/order?includeHistory=" + includeHistory;
    var current = send(h5, "GET", path, null, null, null);
    assertEquals(200, current.statusCode(), current.body());
    JsonNode expected = data(current).deepCopy();
    var draftBefore = json(send(h5, "GET", "/h5/activities/" + activityCode + "/order-draft", null, null, null)).path("data");
    var countsBefore = replayPersistenceCounts();
    var retries = new ArrayList<CompletableFuture<HttpResponse<String>>>();
    for (int i = 0; i < 4; i++) retries.add(CompletableFuture.supplyAsync(() -> {
      try { return send(h5, "PUT", path, originalBody, h5Csrf, null, key); }
      catch (Exception error) { throw new java.util.concurrent.CompletionException(error); }
    }));
    for (var retry : retries) {
      var response = retry.get(30, java.util.concurrent.TimeUnit.SECONDS);
      assertEquals(200, response.statusCode(), response.body());
      assertEquals(expected, data(response), "Retry must return the latest order, not the original submitted snapshot");
    }
    assertEquals(expected, data(send(h5, "GET", path, null, null, null)), "Retry must not overwrite current order");
    assertEquals(countsBefore, replayPersistenceCounts(), "Retry must not create orders, versions, items, operations or keys");
    assertEquals(draftBefore, json(send(h5, "GET", "/h5/activities/" + activityCode + "/order-draft", null, null, null)).path("data"),
        "Retry must preserve a newer draft, including its version and timestamp");
  }

  private java.util.Map<String, Object> replayPersistenceCounts() {
    assertEquals("http://host.docker.internal:8180/api/v1", baseUrl);
    var jdbc = new org.springframework.jdbc.core.JdbcTemplate(new org.springframework.jdbc.datasource.DriverManagerDataSource(
        "jdbc:mysql://host.docker.internal:33306/order_show_e2e?allowPublicKeyRetrieval=true&useSSL=false&serverTimezone=UTC",
        "order_show_e2e", "e2e_mysql_only_not_for_business"));
    return jdbc.queryForMap("""
        SELECT (SELECT COUNT(*) FROM customer_order WHERE activity_id=? AND activity_customer_id=?) orders,
          (SELECT COUNT(*) FROM order_version WHERE order_id=?) versions,
          (SELECT COUNT(*) FROM order_item WHERE order_id=?) items,
          (SELECT COUNT(*) FROM order_version_item i JOIN order_version v ON v.id=i.order_version_id WHERE v.order_id=?) history_items,
          (SELECT COUNT(*) FROM order_operation WHERE order_id=?) operations,
          (SELECT COUNT(*) FROM api_idempotency WHERE activity_id=? AND actor_type='H5_CUSTOMER' AND actor_id=? AND endpoint_code='ORDER_SUBMIT') submission_keys
        """, activityId, h5CustomerId, orderId, orderId, orderId, orderId, activityId, h5CustomerId);
  }

  /** Opt-in exact DB reconciliation after every successful API mutation, including lifecycle/price changes. */
  private void assertDashboardSummariesAfterWrite() {
    assertEquals("http://host.docker.internal:8180/api/v1", baseUrl);
    var source = new org.springframework.jdbc.datasource.DriverManagerDataSource(
        "jdbc:mysql://host.docker.internal:33306/order_show_e2e?allowPublicKeyRetrieval=true&useSSL=false&serverTimezone=UTC",
        "root", "e2e_root_only_not_for_business");
    var jdbc = new org.springframework.jdbc.core.JdbcTemplate(source);
    var maintenance = new com.fengyi.ordershow.dashboard.DashboardSummaryMaintenance(jdbc,
        new org.springframework.jdbc.datasource.DataSourceTransactionManager(source));
    for (long id : jdbc.queryForList("SELECT DISTINCT activity_id FROM customer_order", Long.class)) {
      long after = 0;
      while (true) {
        var batch = maintenance.reconcile(id, after, 200);
        assertTrue(batch.differences().isEmpty(), "Summary differences after API write: " + batch.differences());
        after = batch.nextAfterId();
        if (batch.checked() < 200) break;
      }
    }
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
