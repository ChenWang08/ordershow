package com.fengyi.ordershow.maintenance;

import com.fengyi.ordershow.config.SecurityConfiguration;
import java.io.Console;
import java.util.Arrays;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

/** Runs as a separate JVM inside the existing backend container, without SpringApplication. */
public final class ResetSuperAdminPassword {
  private ResetSuperAdminPassword() {}

  public static void main(String[] args) {
    Console console = System.console();
    if (args.length != 0 || console == null) {
      System.err.println("需要交互终端；不接受命令参数、管道或环境变量传入新密码。请使用 docker compose exec（不要加 -T）。");
      System.exit(2);
      return;
    }
    char[] password = null;
    char[] confirmation = null;
    int exit = 0;
    try {
      String url = required("DB_URL");
      DriverManagerDataSource source = new DriverManagerDataSource(url, required("DB_USERNAME"), required("DB_PASSWORD"));
      var connectionProperties = new java.util.Properties();
      connectionProperties.setProperty("connectTimeout", "5000");
      connectionProperties.setProperty("socketTimeout", "20000");
      source.setConnectionProperties(connectionProperties);
      JdbcTemplate jdbc = new JdbcTemplate(source);
      jdbc.setQueryTimeout(15);
      TransactionTemplate transaction = new TransactionTemplate(new DataSourceTransactionManager(source));
      transaction.setTimeout(15);
      var reset = new SuperAdminPasswordReset(jdbc, SecurityConfiguration.passwordEncoder(), transaction);
      var target = reset.inspect();
      String database = jdbc.queryForObject("SELECT DATABASE()", String.class);
      String server = jdbc.queryForObject("SELECT @@hostname", String.class);
      console.printf("目标数据库：%s，数据库服务器：%s%n超级管理员：%s（ID %d，状态 %s）%n",
          database, server, target.username(), target.id(), target.status());
      console.printf("将更换密码并撤销该账号所有旧会话；账号启停状态保持不变。%n");
      String expected = database + "/" + target.username();
      String answer = console.readLine("确认请输入 %s（其他输入取消）：", expected);
      if (!expected.equals(answer)) {
        console.printf("已取消，未修改账号。%n");
        return;
      }
      password = readVisiblePassword(console, "新密码（明文显示）：");
      confirmation = readVisiblePassword(console, "再次输入新密码（明文显示）：");
      if (password == null || confirmation == null) throw new IllegalArgumentException("输入已取消，未修改账号。");
      if (!Arrays.equals(password, confirmation)) throw new IllegalArgumentException("两次密码不一致，未修改账号。");
      var result = reset.reset(target, password);
      console.printf("重置成功。已撤销 %d 条旧会话。操作编号：%s%n", result.revokedSessions(), result.traceId());
      console.printf("新密码无需再次改密；停用账号仍不能登录。.env 未修改。%n");
    } catch (IllegalArgumentException error) {
      // Only fixed validation messages are printed, never SQL, hashes, passwords or connection strings.
      console.printf("未执行重置：%s%n", error.getMessage());
      exit = 2;
    } catch (Exception error) {
      console.printf("未确认重置成功。数据库操作或提交结果可能异常；不要假定旧密码或旧会话已失效。%n");
      console.printf("恢复数据库连接后先核对登录及审计记录，再重新运行命令。错误类型：%s%n", error.getClass().getSimpleName());
      exit = 1;
    } finally {
      if (password != null) Arrays.fill(password, '\0');
      if (confirmation != null) Arrays.fill(confirmation, '\0');
    }
    if (exit != 0) System.exit(exit);
  }

  private static char[] readVisiblePassword(Console console, String prompt) {
    String value = console.readLine("%s", prompt);
    return value == null ? null : value.toCharArray();
  }

  private static String required(String key) {
    String value = System.getenv(key);
    if (value == null || value.isBlank()) throw new IllegalArgumentException("缺少服务器环境配置：" + key);
    return value;
  }
}
