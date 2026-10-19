"use client";

import { formatBeijingTime } from "../shared/time";


import { useEffect, useState } from "react";
import { ApiError, createMember, loadAdminDepartments, loadMembers, updateMember, type AdminDepartment, type DepartmentMember } from "../../api";
import { useAdminIdentity } from "../../admin-context";
import { memberModules, type MemberPermission } from "./permissions";

export function MemberAdminPanel() {
  const identity = useAdminIdentity();
  const [members, setMembers] = useState<DepartmentMember[]>([]);
  const [departments, setDepartments] = useState<AdminDepartment[]>([]);
  const [filter, setFilter] = useState("");
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<{ member?: DepartmentMember; username: string; displayName: string; departmentId: string; password: string; permissions: MemberPermission[] } | null>(null);
  const [resetTarget, setResetTarget] = useState<DepartmentMember | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  useEffect(() => {
    let active = true;
    void Promise.all([loadMembers(filter ? Number(filter) : undefined), identity?.roleCode === "SUPER_ADMIN" ? loadAdminDepartments() : Promise.resolve([])]).then(([rows, depts]) => {
      if (active) { setMembers(rows); setDepartments(depts); setError(""); }
    }).catch(e => { if (active) setError(e instanceof ApiError ? e.message : "成员加载失败"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filter, reload, identity?.roleCode]);
  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true); setError(""); setNotice("");
    try { await action(); setReload(n => n + 1); setEditor(null); setResetTarget(null); setResetPassword(""); setNotice(message); }
    catch (e) { setError(e instanceof ApiError ? e.message : "操作失败，请稍后重试"); }
    finally { setBusy(false); }
  };
  const save = () => {
    if (!editor) return;
    if (editor.member) void run(() => updateMember(editor.member!.id, { lockVersion: editor.member!.lockVersion, displayName: editor.displayName, permissions: editor.permissions }), "成员权限已更新，后续请求立即生效");
    else void run(() => createMember({ username: editor.username, displayName: editor.displayName, password: editor.password, permissions: editor.permissions,
      ...(identity?.roleCode === "SUPER_ADMIN" ? { departmentId: Number(editor.departmentId) } : {}) }), "成员已创建，密码由管理员统一管理");
  };
  return <section className="admin-panel member-panel">
    <div className="panel-title"><div><h2>成员管理</h2><p>功能权限适用于所属部门的全部活动；成员不能创建活动或管理账号。</p></div>
      <button className="admin-primary" disabled={busy} onClick={() => { setError(""); setEditor({ username: "", displayName: "", departmentId: filter || String(identity?.departmentId || ""), password: "", permissions: [] }); }}>新增成员</button></div>
    {identity?.roleCode === "SUPER_ADMIN" && <label>按部门筛选 <select value={filter} onChange={e => { setLoading(true); setFilter(e.target.value); }}><option value="">全部部门</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
    {error && <p className="warning-box" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {loading ? <p role="status">正在加载成员…</p> : <div className="member-table-scroll"><table className="member-table"><thead><tr><th>成员 / 账号</th><th>部门</th><th>功能权限</th><th>状态</th><th>最后登录</th><th>操作</th></tr></thead><tbody>
      {members.map(member => <tr key={member.id}><td><b>{member.displayName}</b><br />{member.username}</td><td>{member.departmentName}</td>
        <td>{memberModules.filter(m => member.permissions.includes(m.code)).map(m => m.label).join("、") || "暂无权限"}</td><td>{member.status === "ACTIVE" ? "启用" : "停用"}</td><td>{member.lastLoginAt ? formatBeijingTime(member.lastLoginAt) : "未登录"}</td>
        <td><div className="member-row-actions"><button disabled={busy} onClick={() => { setError(""); setEditor({ member, username: member.username, displayName: member.displayName, departmentId: String(member.departmentId), password: "", permissions: [...member.permissions] }); }}>编辑权限</button>
          <button disabled={busy} onClick={() => { setError(""); setResetPassword(""); setResetTarget(member); }}>重置密码</button>
          <button disabled={busy} onClick={() => { const status = member.status === "ACTIVE" ? "DISABLED" : "ACTIVE"; if (window.confirm(`确认${status === "DISABLED" ? "停用" : "启用"}成员 ${member.displayName}（${member.username}）？${status === "DISABLED" ? "其已有登录会话将立即失效。" : ""}`)) void run(() => updateMember(member.id, { lockVersion: member.lockVersion, status }), "成员状态已更新"); }}>{member.status === "ACTIVE" ? "停用" : "启用"}</button></div></td></tr>)}
      {members.length === 0 && <tr><td colSpan={6}>暂无成员，可新增成员并分配功能权限。</td></tr>}
    </tbody></table></div>}
    {editor && <div className="member-modal-backdrop"><section className="member-modal" role="dialog" aria-modal="true" aria-labelledby="member-editor-title">
      <h2 id="member-editor-title">{editor.member ? "编辑成员与权限" : "新增成员"}</h2>
      <form onSubmit={e => { e.preventDefault(); save(); }}>
        <label>姓名<input required maxLength={100} value={editor.displayName} onChange={e => setEditor({ ...editor, displayName: e.target.value })} /></label>
        <label>登录用户名<input required pattern="[A-Za-z0-9][A-Za-z0-9_.@\-]{2,63}" maxLength={64} disabled={Boolean(editor.member)} value={editor.username} onChange={e => setEditor({ ...editor, username: e.target.value })} /></label>
        {identity?.roleCode === "SUPER_ADMIN" && <label>所属部门<select required disabled={Boolean(editor.member)} value={editor.departmentId} onChange={e => setEditor({ ...editor, departmentId: e.target.value })}><option value="">请选择部门</option>{departments.filter(d => d.status === "ACTIVE" || String(d.id) === editor.departmentId).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
        {!editor.member && <label>登录密码<input type="password" required minLength={8} maxLength={100} autoComplete="new-password" value={editor.password} onChange={e => setEditor({ ...editor, password: e.target.value })} /><small>8–100 位，由管理员设置和重置，成员不能自行修改。</small></label>}
        <fieldset><legend>功能权限</legend><div className="member-permissions">{memberModules.map(module => <label key={module.code}><input type="checkbox" checked={editor.permissions.includes(module.code)} onChange={e => setEditor({ ...editor, permissions: e.target.checked ? [...editor.permissions, module.code] : editor.permissions.filter(p => p !== module.code) })} />{module.label}</label>)}</div></fieldset>
        <p>勾选即开放该模块全部业务操作；活动设置、发布和结束仅限管理员。</p>
        {error && <p role="alert">{error}</p>}<div className="member-row-actions"><button type="button" disabled={busy} onClick={() => setEditor(null)}>取消</button><button className="admin-primary" disabled={busy}>{busy ? "保存中…" : "保存"}</button></div>
      </form></section></div>}
    {resetTarget && <div className="member-modal-backdrop"><section className="member-modal" role="dialog" aria-modal="true" aria-labelledby="member-reset-title"><h2 id="member-reset-title">重置成员密码</h2><p>{resetTarget.displayName}（{resetTarget.username}）的原登录会话将立即失效。</p><form onSubmit={e => { e.preventDefault(); void run(() => updateMember(resetTarget.id, { lockVersion: resetTarget.lockVersion, password: resetPassword }), "密码已重置，原登录会话已失效"); }}><label>新密码<input required type="password" minLength={8} maxLength={100} autoComplete="new-password" value={resetPassword} onChange={e => setResetPassword(e.target.value)} /></label>{error && <p role="alert">{error}</p>}<div className="member-row-actions"><button type="button" disabled={busy} onClick={() => { setResetTarget(null); setResetPassword(""); }}>取消</button><button className="admin-primary" disabled={busy}>确认重置</button></div></form></section></div>}
  </section>;
}
