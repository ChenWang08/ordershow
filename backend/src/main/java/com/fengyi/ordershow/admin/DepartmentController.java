package com.fengyi.ordershow.admin;

import com.fengyi.ordershow.common.ApiResponse;
import com.fengyi.ordershow.common.TraceFilter;
import com.fengyi.ordershow.security.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/admin")
public class DepartmentController {
  private final DepartmentService service;
  private final AuthService auth;

  public DepartmentController(DepartmentService service, AuthService auth) {
    this.service = service;
    this.auth = auth;
  }

  @GetMapping("/departments")
  ApiResponse<List<DepartmentService.DepartmentView>> departments(HttpServletRequest request) {
    return ApiResponse.of(service.listDepartments(auth.requireAdmin(request)), TraceFilter.id(request));
  }

  @PostMapping("/departments")
  ApiResponse<DepartmentService.DepartmentView> createDepartment(@Valid @RequestBody DepartmentRequest body,
      HttpServletRequest request) {
    return ApiResponse.of(service.createDepartmentWithAccount(auth.requireAdmin(request), body.name(), body.username(), body.password()), TraceFilter.id(request));
  }

  @PatchMapping("/departments/{departmentId}")
  ApiResponse<DepartmentService.DepartmentView> updateDepartment(@PathVariable long departmentId,
      @RequestBody DepartmentPatch body, HttpServletRequest request) {
    return ApiResponse.of(service.updateDepartment(auth.requireAdmin(request), departmentId, body.name(), body.status()), TraceFilter.id(request));
  }

  @GetMapping("/users")
  ApiResponse<List<DepartmentService.AdminUserView>> users(HttpServletRequest request) {
    return ApiResponse.of(service.listUsers(auth.requireAdmin(request)), TraceFilter.id(request));
  }

  @PostMapping("/departments/{departmentId}/account")
  ApiResponse<DepartmentService.AdminUserView> createUser(@PathVariable long departmentId,
      @Valid @RequestBody CreateUserRequest body,
      HttpServletRequest request) {
    return ApiResponse.of(service.createDepartmentUser(auth.requireAdmin(request), body.username(), body.password(), departmentId), TraceFilter.id(request));
  }

  @PatchMapping("/users/{userId}")
  ApiResponse<DepartmentService.AdminUserView> updateUser(@PathVariable long userId,
      @RequestBody UpdateUserRequest body, HttpServletRequest request) {
    return ApiResponse.of(service.updateUser(auth.requireAdmin(request), userId, body.status(), body.password()), TraceFilter.id(request));
  }

  public record DepartmentRequest(@NotBlank @Size(max = 100) String name,
                                  @NotBlank @Size(max = 64) String username,
                                  @NotBlank @Size(min = 8, max = 100) String password) {}
  public record DepartmentPatch(@Size(max = 100) String name, @Size(max = 20) String status) {}
  public record CreateUserRequest(@NotBlank @Size(max = 64) String username,
                                  @NotBlank @Size(min = 8, max = 100) String password) {}
  public record UpdateUserRequest(@Size(max = 20) String status,
                                  @Size(min = 8, max = 100) String password) {}
}
