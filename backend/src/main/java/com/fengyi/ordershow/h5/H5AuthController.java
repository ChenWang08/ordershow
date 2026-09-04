package com.fengyi.ordershow.h5;

import com.fengyi.ordershow.common.ApiResponse;
import com.fengyi.ordershow.common.TraceFilter;
import com.fengyi.ordershow.security.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/public/activities/{activityCode}")
public class H5AuthController {
  private final AuthService auth;

  public H5AuthController(AuthService auth) { this.auth = auth; }

  @PostMapping("/verify-phone")
  ApiResponse<AuthService.H5LoginResult> verify(@PathVariable String activityCode,
      @Valid @RequestBody VerifyRequest body, HttpServletRequest request, HttpServletResponse response) {
    return ApiResponse.of(auth.verifyH5(activityCode, body.customerType(), body.regionCode(), body.phone(), request, response),
        TraceFilter.id(request));
  }

  public record VerifyRequest(String customerType, String regionCode, @NotBlank String phone) {}
}
