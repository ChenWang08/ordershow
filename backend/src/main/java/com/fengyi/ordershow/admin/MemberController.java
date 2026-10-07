package com.fengyi.ordershow.admin;

import com.fengyi.ordershow.audit.AuditService;
import com.fengyi.ordershow.common.ApiResponse;
import com.fengyi.ordershow.common.TraceFilter;
import com.fengyi.ordershow.security.AdminPermission;
import com.fengyi.ordershow.security.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Set;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/admin/members")
public class MemberController {
  private final MemberService members;
  private final AuthService auth;
  public MemberController(MemberService members, AuthService auth) { this.members = members; this.auth = auth; }

  @GetMapping
  ApiResponse<List<MemberService.MemberView>> list(@RequestParam(required=false) Long departmentId, HttpServletRequest request) {
    return ApiResponse.of(members.list(auth.requireAdmin(request), departmentId), TraceFilter.id(request));
  }
  @PostMapping
  ApiResponse<MemberService.MemberView> create(@Valid @RequestBody Create body, HttpServletRequest request) {
    var member = members.create(auth.requireAdmin(request), body.departmentId(), body.username(), body.displayName(), body.password(), body.permissions());
    request.setAttribute(AuditService.REASON_REQUEST_ATTRIBUTE, "创建成员 " + member.username() + "；权限 " + member.permissions());
    return ApiResponse.of(member, TraceFilter.id(request));
  }
  @PatchMapping("/{id}")
  ApiResponse<MemberService.MemberView> update(@PathVariable long id, @Valid @RequestBody Update body, HttpServletRequest request) {
    var member = members.update(auth.requireAdmin(request), id, body.lockVersion(), body.displayName(), body.status(), body.password(), body.permissions());
    request.setAttribute(AuditService.REASON_REQUEST_ATTRIBUTE, "更新成员 " + member.username() + "；状态 " + member.status() + "；权限 " + member.permissions() + (body.password() != null ? "；重置密码" : ""));
    return ApiResponse.of(member, TraceFilter.id(request));
  }
  public record Create(Long departmentId, @NotBlank @Size(max=64) String username,
      @NotBlank @Size(max=100) String displayName, @NotBlank @Size(min=8,max=100) String password, Set<AdminPermission> permissions) {}
  public record Update(@NotNull Integer lockVersion, @Size(max=100) String displayName, String status,
      @Size(min=8,max=100) String password, Set<AdminPermission> permissions) {}
}
