"use client";

import { formatBeijingTime } from "../shared/time";


import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError, createAdminDepartment, createDepartmentUser, loadAdminDepartments, loadAdminUsers,
  updateAdminDepartment, updateAdminUser, type AdminDepartment, type AdminUser,
} from "../../api";

function suggestDepartmentCode(name: string) {
  const normalized = name.trim();
  if (!normalized) return "";
  const stem = normalized.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).toUpperCase() || "DEPT";
  const bytes = new TextEncoder().encode(normalized);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${stem}-${(hash >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
}

type AccountTarget = Pick<AdminDepartment, "id" | "name" | "code">;

export function DepartmentAdminPanel() {
  const [departments, setDepartments] = useState<AdminDepartment[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [departmentName, setDepartmentName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [accountTarget, setAccountTarget] = useState<AccountTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    const [nextDepartments, nextUsers] = await Promise.all([loadAdminDepartments(), loadAdminUsers()]);
    setDepartments(nextDepartments);
    setUsers(nextUsers.filter(user => user.roleCode !== "DEPARTMENT_MEMBER"));
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([loadAdminDepartments(), loadAdminUsers()]).then(([nextDepartments, nextUsers]) => {
      if (!active) return;
      setDepartments(nextDepartments);
      setUsers(nextUsers.filter(user => user.roleCode !== "DEPARTMENT_MEMBER"));
    }).catch((reason) => {
      if (active) setError(reason instanceof ApiError ? reason.message : "部门数据加载失败");
    });
    return () => { active = false; };
  }, []);

  const departmentCodePreview = useMemo(
    () => accountTarget?.code || suggestDepartmentCode(departmentName),
    [accountTarget, departmentName],
  );
  const derivedDisplayName = accountTarget?.name || departmentName.trim();

  const run = async (
    operation: () => Promise<unknown>,
    success: string | ((result: unknown) => string),
  ) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await operation();
      await refresh();
      setNotice(typeof success === "function" ? success(result) : success);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "操作失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  const clearAccountForm = () => {
    setDepartmentName("");
    setUsername("");
    setPassword("");
    setAccountTarget(null);
  };

  const createAccount = () => {
    const name = accountTarget?.name || departmentName.trim();
    if (!name || !username.trim() || password.length < 8) {
      setError(accountTarget
        ? "请填写登录用户名和至少 8 位登录密码"
        : "请填写部门名称、登录用户名和至少 8 位登录密码");
      return;
    }
    void run(async () => {
      if (accountTarget) {
        await createDepartmentUser(accountTarget.id, { username: username.trim(), password });
      } else {
        await createAdminDepartment({ name, username: username.trim(), password });
      }
      clearAccountForm();
    }, `部门“${name}”的账号已创建，登录密码由超级管理员统一管理`);
  };

  const copyCredentials = async () => {
    const name = accountTarget?.name || departmentName.trim();
    if (!name || !username.trim() || !password) {
      setError("请先填写部门名称、登录用户名和登录密码");
      return;
    }
    const credentials = `部门：${name}\n后台登录用户名：${username.trim()}\n登录密码：${password}`;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard-unavailable");
      await navigator.clipboard.writeText(credentials);
      setError("");
      setNotice("账号信息已复制，请通过安全渠道交给部门负责人");
    } catch {
      setError("浏览器未允许自动复制，请手动保存账号信息");
    }
  };

  const startExistingAccount = (item: AdminDepartment) => {
    setAccountTarget({ id: item.id, name: item.name, code: item.code });
    setDepartmentName("");
    setUsername("");
    setPassword("");
    setError("");
    setNotice(`已选择部门“${item.name}”，账号会自动绑定到该部门`);
  };

  const toggleDepartment = (item: AdminDepartment) => {
    const next = item.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
    if (!window.confirm(`${next === "DISABLED" ? "停用" : "启用"}部门“${item.name}”？`)) return;
    void run(async () => {
      await updateAdminDepartment(item.id, { status: next });
    }, `部门已${next === "DISABLED" ? "停用" : "启用"}`);
  };

  const toggleUser = (item: AdminUser) => {
    const next = item.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
    if (!window.confirm(`${next === "DISABLED" ? "停用" : "启用"}账号“${item.username}”？`)) return;
    void run(async () => {
      await updateAdminUser(item.id, { status: next });
    }, `账号已${next === "DISABLED" ? "停用" : "启用"}`);
  };

  const resetUserPassword = (item: AdminUser) => {
    const nextPassword = window.prompt(`请输入“${item.username}”的新登录密码（至少 8 位）：`);
    if (nextPassword === null) return;
    if (nextPassword.length < 8) {
      setError("新登录密码至少需要 8 位");
      return;
    }
    if (!window.confirm(`重置后账号“${item.username}”的现有会话会失效，新密码立即生效，确认继续？`)) return;
    void run(async () => {
      await updateAdminUser(item.id, { password: nextPassword });
    }, "密码已重置，新密码已立即生效，请通过安全渠道交给部门负责人");
  };

  return (
    <section className="admin-panel department-admin-panel">
      <div className="panel-title">
        <div>
          <h2>部门与账号管理</h2>
          <p>每个部门绑定一个部门管理员账号，可在“成员管理”中新增成员。部门管理员密码由超级管理员统一设置和重置。</p>
        </div>
      </div>
      {error && <div className="warning-box"><b>操作失败</b><span>{error}</span></div>}
      {notice && <div className="import-completed-banner"><span className="success-icon">✓</span><p><b>{notice}</b><small>数据权限由后端按部门强制校验。</small></p></div>}

      <div className="department-form-card department-create-card">
        <div className="department-card-heading">
          <div>
            <h3>{accountTarget ? `为“${accountTarget.name}”创建账号` : "新建部门账号"}</h3>
            <p>{accountTarget ? "该账号会自动绑定当前部门，不需要再次选择所属部门。" : "填写部门名称后系统生成唯一编号，并同时创建部门共享账号。"}</p>
          </div>
        </div>
        <div className="department-form-grid">
          {accountTarget ? <div className="department-code-preview">
            <span>部门（自动绑定）</span>
            <b>{accountTarget.name}</b>
            <small>部门编码：{accountTarget.code}</small>
          </div> : <label className="department-form-field">
            <span>部门名称 <em>必填</em></span>
            <input value={departmentName} maxLength={100} onChange={(event) => setDepartmentName(event.target.value)} placeholder="例如 华东业务部" />
          </label>}
          <div className="department-code-preview">
            <span>部门编号（系统生成）</span>
            <b>{departmentCodePreview || "填写部门名称后生成"}</b>
            <small>创建成功后编号固定，部门名称修改不会改变编号。</small>
          </div>
          <div className="department-code-preview">
            <span>账号显示名（自动）</span>
            <b>{derivedDisplayName || "与部门名称相同"}</b>
            <small>账号显示名自动使用部门名称。</small>
          </div>
          <label className="department-form-field">
            <span>登录用户名 <em>必填</em></span>
            <input value={username} maxLength={64} autoComplete="off" onChange={(event) => setUsername(event.target.value)} placeholder="例如 east_admin" />
          </label>
          <label className="department-form-field">
            <span>登录密码（至少 8 位） <em>必填</em></span>
            <input type="password" value={password} maxLength={100} autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} placeholder="由超级管理员设置" />
          </label>
        </div>
        <div className="department-form-actions">
          <div className="inline-actions">
            <button type="button" className="admin-primary" disabled={busy} onClick={createAccount}>{accountTarget ? "创建账号" : "创建部门和账号"}</button>
            <button type="button" className="secondary-button" disabled={busy || !username.trim() || !password || !(accountTarget?.name || departmentName.trim())} onClick={() => void copyCredentials()}>复制账号信息</button>
            {accountTarget && <button type="button" className="secondary-button" disabled={busy} onClick={clearAccountForm}>取消</button>}
          </div>
        </div>
      </div>

      <div className="data-section-title"><div><b>部门列表</b><span>停用部门会立即撤销其账号会话；有未结束活动的部门不能停用。</span></div></div>
      <div className="table-scroll department-table department-list-table">
        <div className="table-row table-head"><b>部门</b><b>账号</b><b>活动数</b><b>状态</b><b>操作</b></div>
        {departments.map((item) => <div className="table-row" key={item.id}>
          <span>{item.name}<small>编码：{item.code}</small></span>
          <span>{item.accountUsername || "未创建"}</span>
          <span>{item.activityCount}</span>
          <span>{item.status === "ACTIVE" ? "启用" : "停用"}</span>
          <div className="department-table-actions"><div className="inline-actions">
            {item.status === "ACTIVE" && !item.accountId && <button type="button" onClick={() => startExistingAccount(item)} disabled={busy}>创建账号</button>}
            <button type="button" onClick={() => toggleDepartment(item)} disabled={busy || (item.code === "DEFAULT" && item.status === "ACTIVE")}>{item.status === "ACTIVE" ? "停用" : "启用"}</button>
          </div></div>
        </div>)}
      </div>

      <div className="data-section-title"><div><b>账号列表</b><span>账号显示名自动使用部门名称；重置密码后立即生效。</span></div></div>
      <div className="table-scroll department-table department-account-table">
        <div className="table-row table-head"><b>用户名</b><b>部门</b><b>状态</b><b>最后登录</b><b>操作</b></div>
        {users.map((item) => <div className="table-row" key={item.id}>
          <span>{item.username}<small>{item.displayName}</small></span>
          <span>{item.departmentName || "总部"}</span>
          <span>{item.status === "ACTIVE" ? "启用" : "停用"}</span>
          <span>{item.lastLoginAt ? formatBeijingTime(item.lastLoginAt) : "未登录"}</span>
          <div className="department-table-actions">{item.roleCode === "DEPARTMENT_ADMIN" && <div className="inline-actions"><button type="button" onClick={() => resetUserPassword(item)} disabled={busy}>重置密码</button><button type="button" onClick={() => toggleUser(item)} disabled={busy}>{item.status === "ACTIVE" ? "停用" : "启用"}</button></div>}</div>
        </div>)}
      </div>
    </section>
  );
}
