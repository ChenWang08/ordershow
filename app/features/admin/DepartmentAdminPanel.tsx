"use client";

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

export function DepartmentAdminPanel() {
  const [departments, setDepartments] = useState<AdminDepartment[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [departmentName, setDepartmentName] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [initialPassword, setInitialPassword] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    const [nextDepartments, nextUsers] = await Promise.all([loadAdminDepartments(), loadAdminUsers()]);
    setDepartments(nextDepartments);
    setUsers(nextUsers);
    setDepartmentId((current) => {
      const currentStillAvailable = current && nextDepartments.some((item) =>
        String(item.id) === current && item.status === "ACTIVE" && !item.accountId);
      if (currentStillAvailable) return current;
      return String(nextDepartments.find((item) => item.status === "ACTIVE" && !item.accountId)?.id || "");
    });
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([loadAdminDepartments(), loadAdminUsers()]).then(([nextDepartments, nextUsers]) => {
      if (!active) return;
      setDepartments(nextDepartments);
      setUsers(nextUsers);
      setDepartmentId(String(nextDepartments.find((item) => item.status === "ACTIVE" && !item.accountId)?.id || ""));
    }).catch((reason) => {
      if (active) setError(reason instanceof ApiError ? reason.message : "部门数据加载失败");
    });
    return () => { active = false; };
  }, []);

  const availableDepartments = useMemo(
    () => departments.filter((item) => item.status === "ACTIVE" && !item.accountId),
    [departments],
  );
  const departmentCodePreview = useMemo(() => suggestDepartmentCode(departmentName), [departmentName]);

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

  const createDepartment = () => {
    if (!departmentName.trim()) {
      setError("请填写部门名称");
      return;
    }
    void run(async () => {
      const created = await createAdminDepartment(departmentName.trim());
      setDepartmentName("");
      setDepartmentId(String(created.id));
      return created.code;
    }, (code) => `部门已创建，系统编码为 ${code}，编码已固定`);
  };

  const createUser = () => {
    if (!departmentId || !username.trim() || !displayName.trim() || initialPassword.length < 8) {
      setError("请选择未绑定账号的部门，并填写用户名、显示名和至少 8 位初始密码");
      return;
    }
    void run(async () => {
      await createDepartmentUser({ username: username.trim(), displayName: displayName.trim(), initialPassword, departmentId: Number(departmentId) });
      setUsername("");
      setDisplayName("");
      setInitialPassword("");
    }, "部门账号已创建，请将初始密码安全交给部门负责人");
  };

  const copyInitialCredentials = async () => {
    if (!username.trim() || !initialPassword) {
      setError("请先填写登录用户名和初始密码");
      return;
    }
    const credentials = `后台登录用户名：${username.trim()}\n初始密码：${initialPassword}`;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard-unavailable");
      await navigator.clipboard.writeText(credentials);
      setError("");
      setNotice("初始账号信息已复制，请通过安全渠道交给部门负责人");
    } catch {
      setError("浏览器未允许自动复制，请手动保存初始账号信息");
    }
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
    const nextPassword = window.prompt(`请输入“${item.username}”的新初始密码（至少 8 位）：`);
    if (nextPassword === null) return;
    if (nextPassword.length < 8) {
      setError("新初始密码至少需要 8 位");
      return;
    }
    if (!window.confirm(`重置后账号“${item.username}”的现有会话会失效，并要求下次登录修改密码，确认继续？`)) return;
    void run(async () => {
      await updateAdminUser(item.id, { initialPassword: nextPassword });
    }, "密码已重置，请通过安全渠道交给部门负责人");
  };

  return (
    <section className="admin-panel department-admin-panel">
      <div className="panel-title">
        <div>
          <h2>部门与账号管理</h2>
          <p>每个部门绑定一个后台共享账号；部门账号首次登录必须修改初始密码。</p>
        </div>
      </div>
      {error && <div className="warning-box"><b>操作失败</b><span>{error}</span></div>}
      {notice && <div className="import-completed-banner"><span className="success-icon">✓</span><p><b>{notice}</b><small>数据权限由后端按部门强制校验。</small></p></div>}

      <div className="department-form-card department-create-card">
        <div className="department-card-heading">
          <div>
            <h3>新建部门</h3>
            <p>填写部门名称后由系统生成唯一编码；创建成功后编码永久固定。</p>
          </div>
        </div>
        <div className="department-form-grid department-create-grid">
          <label className="department-form-field">
            <span>部门名称 <em>必填</em></span>
            <input value={departmentName} maxLength={100} onChange={(event) => setDepartmentName(event.target.value)} placeholder="例如 华东业务部" />
          </label>
          <div className="department-code-preview">
            <span>部门编码（系统生成）</span>
            <b>{departmentCodePreview || "填写部门名称后生成"}</b>
            <small>预计编码仅供预览，提交时由后端再次生成并校验唯一性；部门名称修改后编码不会变化。</small>
          </div>
        </div>
        <div className="department-form-actions">
          <button type="button" className="admin-primary" disabled={busy} onClick={createDepartment}>创建部门</button>
        </div>
      </div>

      <div className="department-form-card">
        <div className="department-card-heading">
          <div>
            <h3>创建部门账号</h3>
            <p>每个部门只能绑定一个部门账号；默认部门只是预选，不会自动创建账号。</p>
          </div>
        </div>
        <div className="department-form-grid">
          <label className="department-form-field">
            <span>所属部门 <em>必填</em></span>
            <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
              <option value="">请选择部门</option>
              {availableDepartments.map((item) => <option key={item.id} value={item.id}>{item.name}（{item.code}）</option>)}
            </select>
          </label>
          <label className="department-form-field">
            <span>登录用户名 <em>必填</em></span>
            <input value={username} maxLength={64} autoComplete="off" onChange={(event) => setUsername(event.target.value)} placeholder="例如 east_admin" />
          </label>
          <label className="department-form-field">
            <span>账号显示名 <em>必填</em></span>
            <input value={displayName} maxLength={100} onChange={(event) => setDisplayName(event.target.value)} placeholder="例如 华东业务部" />
          </label>
          <label className="department-form-field">
            <span>初始密码（至少 8 位） <em>必填</em></span>
            <input type="password" value={initialPassword} maxLength={100} autoComplete="new-password" onChange={(event) => setInitialPassword(event.target.value)} placeholder="首次登录后必须修改" />
          </label>
        </div>
        <div className="department-form-actions">
          <div className="inline-actions">
            <button type="button" className="admin-primary" disabled={busy || availableDepartments.length === 0} onClick={createUser}>创建账号</button>
            <button type="button" className="secondary-button" disabled={busy || !username.trim() || !initialPassword} onClick={() => void copyInitialCredentials()}>复制账号信息</button>
          </div>
        </div>
        {availableDepartments.length === 0 && <small className="department-empty-note">当前没有可绑定账号的启用部门。</small>}
      </div>

      <div className="data-section-title"><div><b>部门列表</b><span>停用部门会立即撤销其账号会话；有未结束活动的部门不能停用。</span></div></div>
      <div className="table-scroll department-table department-list-table">
        <div className="table-row table-head"><b>部门</b><b>账号</b><b>活动数</b><b>状态</b><b>操作</b></div>
        {departments.map((item) => <div className="table-row" key={item.id}>
          <span>{item.name}<small>编码：{item.code}</small></span>
          <span>{item.accountUsername || "未创建"}</span>
          <span>{item.activityCount}</span>
          <span>{item.status === "ACTIVE" ? "启用" : "停用"}</span>
          <div className="department-table-actions"><button type="button" onClick={() => toggleDepartment(item)} disabled={busy || (item.code === "DEFAULT" && item.status === "ACTIVE")}>{item.status === "ACTIVE" ? "停用" : "启用"}</button></div>
        </div>)}
      </div>

      <div className="data-section-title"><div><b>账号列表</b><span>重置密码会让账号下次登录时修改密码。</span></div></div>
      <div className="table-scroll department-table department-account-table">
        <div className="table-row table-head"><b>用户名</b><b>部门</b><b>状态</b><b>最后登录</b><b>操作</b></div>
        {users.map((item) => <div className="table-row" key={item.id}>
          <span>{item.username}<small>{item.displayName}</small></span>
          <span>{item.departmentName || "总部"}</span>
          <span>{item.status === "ACTIVE" ? "启用" : "停用"}</span>
          <span>{item.lastLoginAt ? new Date(item.lastLoginAt).toLocaleString("zh-CN", { hour12: false }) : "未登录"}</span>
          <div className="department-table-actions">{item.roleCode === "DEPARTMENT_ADMIN" && <div className="inline-actions"><button type="button" onClick={() => resetUserPassword(item)} disabled={busy}>重置密码</button><button type="button" onClick={() => toggleUser(item)} disabled={busy}>{item.status === "ACTIVE" ? "停用" : "启用"}</button></div>}</div>
        </div>)}
      </div>
    </section>
  );
}
