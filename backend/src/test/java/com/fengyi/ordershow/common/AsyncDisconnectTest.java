package com.fengyi.ordershow.common;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.request.async.AsyncRequestNotUsableException;
import org.springframework.web.context.request.async.AsyncRequestTimeoutException;
import jakarta.servlet.http.HttpServletResponse;

class AsyncDisconnectTest {
  @RestController
  static class Probe {
    @GetMapping("/disconnected")
    String disconnected() throws AsyncRequestNotUsableException {throw new AsyncRequestNotUsableException("client gone");}
    @GetMapping("/ordinary-error")
    String ordinary() {throw new IllegalStateException("real failure");}
    @GetMapping("/stream-timeout")
    String streamTimeout(HttpServletResponse response) {response.setContentType("text/event-stream");throw new AsyncRequestTimeoutException();}
    @GetMapping("/ordinary-timeout")
    String ordinaryTimeout() {throw new AsyncRequestTimeoutException();}
  }
  @Test
  void disconnectedStreamDoesNotWriteAnotherJsonError() throws Exception {
    var mvc=MockMvcBuilders.standaloneSetup(new Probe()).setControllerAdvice(new GlobalExceptionHandler()).build();
    mvc.perform(get("/disconnected").accept("text/event-stream")).andExpect(content().string(""));
  }
  @Test
  void ordinaryApplicationErrorsStillReturnProblemDetails() throws Exception {
    var mvc=MockMvcBuilders.standaloneSetup(new Probe()).setControllerAdvice(new GlobalExceptionHandler()).build();
    mvc.perform(get("/ordinary-error")).andExpect(status().isInternalServerError()).andExpect(jsonPath("$.code").value("INTERNAL_ERROR"));
  }
  @Test
  void expiredStreamClosesWithoutTryingToWriteProblemJson() throws Exception {
    var mvc=MockMvcBuilders.standaloneSetup(new Probe()).setControllerAdvice(new GlobalExceptionHandler()).build();
    mvc.perform(get("/stream-timeout")).andExpect(status().isOk()).andExpect(content().string(""));
  }
  @Test
  void nonStreamTimeoutIsNotHidden() throws Exception {
    var mvc=MockMvcBuilders.standaloneSetup(new Probe()).setControllerAdvice(new GlobalExceptionHandler()).build();
    mvc.perform(get("/ordinary-timeout")).andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.code").value("ASYNC_REQUEST_TIMEOUT"));
  }
}
