"use client";

import { useEffect, useState } from "react";
import { ApiError, adminLogin, adminLogout, adminMe, changeAdminPassword, type AdminIdentity } from "../../api";
import { AdminIdentityContext, AdminSessionContext } from "../../admin-context";
import { setAdminPreferenceOwner } from "../../api";

export function AdminGateway({ children }: { children: React.ReactNode }) {
  const [admin, setAdmin] = useState<AdminIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void adminMe().then((value) => { if (active) { setAdminPreferenceOwner(value.id); setAdmin(value); } }).catch(() => { if (active) setAdmin(null); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!admin) return;
    let active = true;
    const check = () => { void adminMe().then((value) => {
      if (active && (value.id !== admin.id || value.departmentId !== admin.departmentId || value.roleCode !== admin.roleCode)) {
        setAdminPreferenceOwner(null); setAdmin(null);
      } else if (active && JSON.stringify(value) !== JSON.stringify(admin)) { setAdmin(value); }
    }).catch(() => { if (active) { setAdminPreferenceOwner(null); setAdmin(null); } }); };
    window.addEventListener("focus", check);
    window.addEventListener("admin-permissions-changed", check);
    const timer = window.setInterval(check, 15000);
    return () => { active = false; window.removeEventListener("focus", check); window.removeEventListener("admin-permissions-changed", check); window.clearInterval(timer); };
  }, [admin]);
  const login = async () => {
    setLoading(true); setError("");
    try { const value = await adminLogin(username, password); setAdminPreferenceOwner(value.id); setAdmin(value); setPassword(""); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : "管理后台连接失败"); }
    finally { setLoading(false); }
  };
  const logout = async () => {
    setLoading(true); setError("");
    try {
      await adminLogout();
      setAdminPreferenceOwner(null);
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
  const mustChangePassword = Boolean(admin?.roleCode === "SUPER_ADMIN" && admin.mustChangePassword);
  if (!admin || mustChangePassword) return (
    <section className="admin-shell"><main className="admin-main"><div className="admin-panel admin-login-panel">
      <div className="admin-login-heading"><span className="admin-login-mark">金</span><div><h2>{admin ? "首次登录修改密码" : "管理后台登录"}</h2><p>{admin ? "修改初始密码后才可以导入数据和修改活动配置" : "请输入管理员账号密码，系统会自动识别超级管理员、部门管理员或成员账号，无需选择角色"}</p></div></div>
      <form className="admin-login-form" onSubmit={(event) => { event.preventDefault(); void (admin ? changePassword() : login()); }}>
        {!admin && <label><span>用户名</span><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="请输入后台账号" /></label>}
        <label><span>{admin ? "当前密码" : "密码"}</span><input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={admin ? "请输入初始密码" : "请输入登录密码"} /></label>
        {admin && <label><span>新密码（至少 8 位）</span><input autoComplete="new-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="请设置新的后台密码" /></label>}
        {!admin && <div className="admin-login-hint"><b>账号说明</b><span>超级管理员管理部门；部门管理员管理本部门成员。部门及成员账号的密码由管理员统一设置和重置，登录后按所属部门和功能权限使用后台。</span></div>}
        {admin && mustChangePassword && <div className="admin-login-hint"><b>首次登录安全要求</b><span>当前账号：{admin.displayName} · 超级管理员。请先修改初始密码。</span></div>}
        {error && <div className="warning-box" role="alert"><b>操作失败</b><span>{error}</span></div>}
        <button type="submit" className="admin-primary" disabled={loading || !password || (Boolean(admin) && newPassword.length < 8)}>{loading ? "正在处理…" : admin ? "修改密码并进入后台" : "登录"}</button>
      </form>
    </div></main></section>
  );
  return <AdminIdentityContext.Provider value={admin}><AdminSessionContext.Provider value={{ logout, busy: loading, error }}>{children}</AdminSessionContext.Provider></AdminIdentityContext.Provider>;
}
