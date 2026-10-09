package com.fengyi.ordershow.admin;

import com.fengyi.ordershow.common.ApiResponse;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.common.TraceFilter;
import com.fengyi.ordershow.security.AdminPrincipal;
import com.fengyi.ordershow.security.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/admin")
public class AdminAuthController {
  private final AuthService auth;
  private final JdbcTemplate jdbc;
  private final PasswordEncoder passwordEncoder;

  public AdminAuthController(AuthService auth, JdbcTemplate jdbc, PasswordEncoder passwordEncoder) {
    this.auth = auth;
    this.jdbc = jdbc;
    this.passwordEncoder = passwordEncoder;
  }

  @PostMapping("/auth/login")
  ApiResponse<AuthService.LoginResult> login(@Valid @RequestBody LoginRequest body,
                                              HttpServletRequest request, HttpServletResponse response) {
    return ApiResponse.of(auth.login(body.username(), body.password(), request, response), TraceFilter.id(request));
  }

  @PostMapping("/auth/logout")
  ApiResponse<Boolean> logout(HttpServletRequest request, HttpServletResponse response) {
    auth.logout(request, response);
    return ApiResponse.of(true, TraceFilter.id(request));
  }

  @GetMapping("/me")
  ApiResponse<MeResponse> me(HttpServletRequest request) {
    AdminPrincipal principal = auth.requireAdmin(request);
    return ApiResponse.of(new MeResponse(principal.id(), principal.username(), principal.displayName(), principal.roleCode(),
        principal.departmentId(), principal.departmentName(), principal.mustChangePassword(), auth.csrfFromCookie(request), principal.permissions()), TraceFilter.id(request));
  }

  @PostMapping("/auth/change-password")
  @Transactional
  ApiResponse<Boolean> changePassword(@Valid @RequestBody ChangePasswordRequest body, HttpServletRequest request) {
    AdminPrincipal principal = auth.requireAdmin(request);
    if (!principal.isSuperAdmin()) {
      throw DomainException.forbidden("DEPARTMENT_PASSWORD_MANAGED", "账号密码由管理员统一管理");
    }
    String currentHash = jdbc.queryForObject("SELECT password_hash FROM admin_user WHERE id = ? FOR UPDATE", String.class, principal.id());
    // A server reset may have committed while this request waited for the account lock.
    request.removeAttribute(AuthService.ADMIN_REQUEST_ATTRIBUTE);
    auth.requireAdmin(request);
    if (currentHash == null || !passwordEncoder.matches(body.currentPassword(), currentHash)) {
      throw DomainException.badRequest("CURRENT_PASSWORD_INCORRECT", "当前密码不正确");
    }
    if (body.currentPassword().equals(body.newPassword())) {
      throw DomainException.badRequest("PASSWORD_UNCHANGED", "新密码不能与当前密码相同");
    }
    jdbc.update("UPDATE admin_user SET password_hash = ?, must_change_password = FALSE, password_changed_at = UTC_TIMESTAMP(3), lock_version = lock_version + 1 WHERE id = ?",
        passwordEncoder.encode(body.newPassword()), principal.id());
    // Keep the current browser session alive, but invalidate other devices after a password change.
    auth.revokeOtherAdminSessions(request, principal.id(), "PASSWORD_CHANGED");
    return ApiResponse.of(true, TraceFilter.id(request));
  }

  public record LoginRequest(@NotBlank String username, @NotBlank String password) {}
  public record ChangePasswordRequest(@NotBlank String currentPassword, @NotBlank @Size(min = 8, max = 100) String newPassword) {}
  public record MeResponse(long id, String username, String displayName, String roleCode, Long departmentId,
                           String departmentName, boolean mustChangePassword, String csrfToken, java.util.Set<com.fengyi.ordershow.security.AdminPermission> permissions) {}
}
