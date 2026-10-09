package com.fengyi.ordershow.maintenance;

import java.nio.CharBuffer;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.support.TransactionTemplate;

/** No HTTP endpoint or application startup: invoked only by the server maintenance CLI. */
public final class SuperAdminPasswordReset {
  private final JdbcTemplate jdbc;
  private final PasswordEncoder passwords;
  private final TransactionTemplate transaction;

  public SuperAdminPasswordReset(JdbcTemplate jdbc, PasswordEncoder passwords, TransactionTemplate transaction) {
    this.jdbc = jdbc;
    this.passwords = passwords;
    this.transaction = transaction;
  }

  public Target inspect() { return uniqueTarget(false); }

  private Target uniqueTarget(boolean lock) {
    List<Target> users = jdbc.query("""
        SELECT id, username, status, lock_version FROM admin_user
        WHERE role_code = 'SUPER_ADMIN'
        """ + (lock ? " FOR UPDATE" : ""), (rs, row) -> new Target(
        rs.getLong("id"), rs.getString("username"), rs.getString("status"), rs.getInt("lock_version")));
    if (users.size() != 1) throw new IllegalArgumentException("必须恰好存在一个超级管理员，未执行重置。");
    return users.getFirst();
  }

  public Result reset(Target confirmed, char[] password) {
    validate(password);
    String hash = passwords.encode(CharBuffer.wrap(password));
    String trace = UUID.randomUUID().toString();
    // The return value is delivered only after commit. Exceptions (including commit
    // uncertainty) propagate to the CLI, which must not report success.
    return transaction.execute(status -> {
      Target current = uniqueTarget(true);
      if (!current.equals(confirmed)) throw new IllegalArgumentException("账号在确认后已发生变化，请重新运行命令。");
      String oldHash = jdbc.queryForObject("SELECT password_hash FROM admin_user WHERE id = ?", String.class, current.id());
      if (passwords.matches(CharBuffer.wrap(password), oldHash)) throw new IllegalArgumentException("新密码不能与当前密码相同。");
      int changed = jdbc.update("""
          UPDATE admin_user SET password_hash = ?, must_change_password = FALSE,
            password_changed_at = UTC_TIMESTAMP(3), lock_version = lock_version + 1
          WHERE id = ? AND role_code = 'SUPER_ADMIN' AND lock_version = ?
          """, hash, current.id(), current.version());
      if (changed != 1) throw new IllegalStateException("账号更新未完成。");
      int revoked = jdbc.update("""
          UPDATE admin_session SET revoked_at = UTC_TIMESTAMP(3), revoke_reason = 'SERVER_PASSWORD_RESET'
          WHERE admin_user_id = ? AND revoked_at IS NULL
          """, current.id());
      // Synchronous audit in this same transaction, not the best-effort HTTP audit queue.
      jdbc.update("""
          INSERT INTO audit_log(actor_type, admin_user_id, action_code, object_type, object_id,
            reason, result, trace_id, occurred_at)
          VALUES ('SYSTEM', ?, 'ADMIN_PASSWORD_SERVER_RESET', 'ADMIN_USER', ?,
            '服务器维护重置', 'SUCCESS', ?, UTC_TIMESTAMP(3))
          """, current.id(), Long.toString(current.id()), trace);
      return new Result(current, revoked, trace);
    });
  }

  static void validate(char[] password) {
    if (password == null || password.length < 8 || password.length > 100
        || CharBuffer.wrap(password).chars().allMatch(Character::isWhitespace)) {
      throw new IllegalArgumentException("密码须为 8～100 个字符，且不能全为空白。");
    }
    var bytes = StandardCharsets.UTF_8.encode(CharBuffer.wrap(password));
    int size = bytes.remaining();
    while (bytes.hasRemaining()) bytes.put((byte) 0);
    if (size > 72) throw new IllegalArgumentException("密码超过 BCrypt 的 72 字节上限，请缩短密码。");
  }

  public record Target(long id, String username, String status, int version) {}
  public record Result(Target target, int revokedSessions, String traceId) {}
}
