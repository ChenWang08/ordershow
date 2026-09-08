"use client";

import { useEffect, useState } from "react";
import { ApiError, adminLogin, adminLogout, adminMe, changeAdminPassword, type AdminIdentity } from "../../api";
import { AdminIdentityContext, AdminSessionContext } from "../../admin-context";

export function AdminGateway({ children }: { children: React.ReactNode }) {
  const [admin, setAdmin] = useState<AdminIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    void adminMe().then((value) => setAdmin(value)).catch(() => setAdmin(null)).finally(() => setLoading(false));
  }, []);
  const login = async () => {
    setLoading(true); setError("");
    try { setAdmin(await adminLogin(username, password)); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : "管理后台连接失败"); }
    finally { setLoading(false); }
  };
  const logout = async () => {
    setLoading(true); setError("");
    try {
      await adminLogout();
      setAdmin(null);
      setPassword("");
      setNewPassword("");
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "退出登录失败，请稍后重试");
    } finally { setLoading(false); }
  };
  const changePassword = async () => {
    setLoading(true); setError("");
    try {
      await changeAdminPassword(password, newPassword);
      setAdmin(await adminMe()); setPassword(""); setNewPassword("");
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : "密码修改失败"); }
    finally { setLoading(false); }
  };
  if (loading && !admin) return <section className="admin-shell"><main className="admin-main"><div className="admin-panel"><div className="empty-state">正在连接管理服务…</div></div></main></section>;
  if (!admin || admin.mustChangePassword) return (
    <section className="admin-shell"><main className="admin-main"><div className="admin-panel admin-login-panel">
      <div className="admin-login-heading"><span className="admin-login-mark">金</span><div><h2>{admin ? "首次登录修改密码" : "管理后台登录"}</h2><p>{admin ? "修改初始密码后才可以导入数据和修改活动配置" : "请输入管理员账号密码，系统会自动识别超级管理员或部门账号，无需选择角色"}</p></div></div>
      <form className="admin-login-form" onSubmit={(event) => { event.preventDefault(); void (admin ? changePassword() : login()); }}>
        {!admin && <label><span>用户名</span><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="请输入后台账号" /></label>}
        <label><span>{admin ? "当前密码" : "密码"}</span><input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={admin ? "请输入初始密码" : "请输入登录密码"} /></label>
        {admin && <label><span>新密码（至少 8 位）</span><input autoComplete="new-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="请设置新的后台密码" /></label>}
        {!admin && <div className="admin-login-hint"><b>账号说明</b><span>超级管理员由系统初始化；部门账号由超级管理员创建，每个部门一个共享账号。登录后只能看到授权范围内的活动和数据。</span></div>}
        {admin && <div className="admin-login-hint"><b>首次登录安全要求</b><span>当前账号：{admin.displayName} · {admin.roleCode === "SUPER_ADMIN" ? "超级管理员" : admin.departmentName || "部门账号"}。请先修改初始密码。</span></div>}
        {error && <div className="warning-box" role="alert"><b>操作失败</b><span>{error}</span></div>}
        <button type="submit" className="admin-primary" disabled={loading || !password || (Boolean(admin) && newPassword.length < 8)}>{loading ? "正在处理…" : admin ? "修改密码并进入后台" : "登录"}</button>
      </form>
    </div></main></section>
  );
  return <AdminIdentityContext.Provider value={admin}><AdminSessionContext.Provider value={{ logout, busy: loading, error }}>{children}</AdminSessionContext.Provider></AdminIdentityContext.Provider>;
}
