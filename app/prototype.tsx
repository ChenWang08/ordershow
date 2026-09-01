"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getActiveActivityCode,
  ApiError,
  type RuntimeActivity,
  adminLogin,
  adminMe,
  changeAdminPassword,
  loadActivity,
  loadPublicLottery,
} from "./api";
import { H5Prototype } from "./features/h5/H5Prototype";
import { AdminPrototype } from "./features/admin/AdminPrototype";
import { initialLotteryRounds, LotteryBoard, mapLotteryRule, type LotteryRound } from "./features/lottery/Lottery";
import type { ActivityStatus } from "./features/shared/types";
import { runtimeActivityStatus, toDateTimeLocal } from "./features/shared/utils";
import { OrderDashboard, RankingBoard, ReportBoard } from "./features/screens/ScreenBoards";
import {
  type AttendanceRow,
  type ProductImportRow,
  type WhitelistRow,
} from "./domain/import-domain";

type Surface = "h5" | "dashboard" | "ranking" | "report" | "lottery" | "admin";
function AdminGateway({ children }: { children: React.ReactNode }) {
  const [admin, setAdmin] = useState<{ username: string; displayName: string; mustChangePassword: boolean } | null>(null);
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
    <section className="admin-shell"><main className="admin-main"><div className="admin-panel">
      <div className="panel-title"><div><h2>{admin ? "首次登录修改密码" : "管理后台登录"}</h2><p>{admin ? "修改初始密码后才可以导入数据和修改活动配置" : "请输入运营管理员账号"}</p></div></div>
      <div className="activity-form-grid">
        {!admin && <label><span>用户名</span><input value={username} onChange={(event) => setUsername(event.target.value)} /></label>}
        <label><span>{admin ? "当前密码" : "密码"}</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {admin && <label><span>新密码（至少 10 位）</span><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>}
      </div>
      {error && <div className="warning-box"><b>操作失败</b><span>{error}</span></div>}
      <button className="admin-primary" disabled={loading || !password || (Boolean(admin) && newPassword.length < 10)} onClick={() => void (admin ? changePassword() : login())}>{loading ? "正在处理…" : admin ? "修改密码并进入后台" : "登录"}</button>
    </div></main></section>
  );
  return <>{children}</>;
}

type PrototypeProps = {
  initialSurface?: Surface;
  showSurfaceTabs?: boolean;
};

export function Prototype({ initialSurface = "h5", showSurfaceTabs = true }: PrototypeProps = {}) {
  const [surface, setSurface] = useState<Surface>(initialSurface);
  const [lotteryRounds, setLotteryRounds] = useState<LotteryRound[]>(initialLotteryRounds);
  const [activityName, setActivityName] = useState("2026年中秋订货会");
  const [activityId, setActivityId] = useState("1");
  const [activityStatus, setActivityStatus] = useState<ActivityStatus>("scheduled");
  const [activityStartAt, setActivityStartAt] = useState("2030-07-28T14:30");
  const [activityEndAt, setActivityEndAt] = useState("2030-07-30T18:30");
  const [activityEventEndAt, setActivityEventEndAt] = useState("2030-07-30T22:30");
  const [productRows, setProductRows] = useState<ProductImportRow[]>([]);
  const [productImportCompleted, setProductImportCompleted] = useState(false);
  const [productImportHasRun, setProductImportHasRun] = useState(false);
  const [whitelistRows, setWhitelistRows] = useState<WhitelistRow[]>([]);
  const [whitelistImportCompleted, setWhitelistImportCompleted] = useState(false);
  const [whitelistImportHasRun, setWhitelistImportHasRun] = useState(false);
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRow[]>([]);
  const [attendanceFileName, setAttendanceFileName] = useState("");
  const [attendanceWarnings, setAttendanceWarnings] = useState<string[]>([]);
  const [attendanceSheetCounts, setAttendanceSheetCounts] = useState<Array<{ name: string; count: number }>>([]);
  const [attendanceImportError, setAttendanceImportError] = useState("");
  const [runtimeActivity, setRuntimeActivity] = useState<RuntimeActivity | null>(null);
  const [runtimeConnected, setRuntimeConnected] = useState(false);
  const markProductImportCommitted = useCallback(() => setProductImportHasRun(true), []);
  const markWhitelistImportCommitted = useCallback(() => setWhitelistImportHasRun(true), []);
  useEffect(() => {
    void Promise.all([loadActivity(), loadPublicLottery()]).then(([activity, lottery]) => {
      setRuntimeActivity(activity); setRuntimeConnected(true); setActivityName(activity.name); setActivityId(String(activity.id));
      setActivityStartAt(toDateTimeLocal(activity.startsAt)); setActivityEndAt(toDateTimeLocal(activity.endsAt));
      setActivityEventEndAt(toDateTimeLocal(activity.eventEndsAt || new Date(new Date(activity.endsAt).getTime() + 4 * 60 * 60 * 1000).toISOString()));
      setActivityStatus(runtimeActivityStatus(activity.status));
      const rule = lottery.rules.find((item) => item.status === "PUBLISHED") ?? lottery.rules[0];
      if (rule) setLotteryRounds(mapLotteryRule(rule));
    }).catch(() => setRuntimeConnected(false));
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadActivity().then((activity) => {
        setRuntimeActivity(activity);
        setActivityStatus(runtimeActivityStatus(activity.status));
      }).catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, []);
  const surfaces: { key: Surface; label: string; sub: string }[] = [
    { key: "h5", label: "订货 H5", sub: "手机端" },
    { key: "dashboard", label: "订单看板", sub: "大屏总览" },
    { key: "ranking", label: "订货排行", sub: "大屏 A" },
    { key: "report", label: "专题战报", sub: "大屏 B" },
    { key: "lottery", label: "幸运抽奖", sub: "现场" },
    { key: "admin", label: "管理后台", sub: "运营端" },
  ];
  return (
    <main className={`prototype-root surface-${surface}`}>
      <nav className="prototype-nav">
        <div className="prototype-title"><span>金</span><p><b>{surface === "admin" ? "订购会管理平台" : activityName}</b><small>{surface === "admin" ? (runtimeConnected ? "多活动运营 · 实时数据" : "多活动运营 · 服务连接中") : runtimeConnected ? "业务系统 · 实时数据" : "业务服务连接中"}</small></p></div>
        {showSurfaceTabs && <div className="surface-tabs">{surfaces.map((item) => <button key={item.key} className={surface === item.key ? "active" : ""} onClick={() => setSurface(item.key)}><b>{item.label}</b><small>{item.sub}</small></button>)}</div>}
        <div className="prototype-status"><i /> {runtimeConnected ? "服务已连接" : "服务未连接"}</div>
      </nav>
      <div className="prototype-canvas">
        {showSurfaceTabs ? <>
          <div className={surface === "h5" ? "surface-slot" : "surface-slot surface-hidden"}><H5Prototype activityStatus={activityStatus} importedRows={productImportCompleted ? productRows : null} importedWhitelistRows={whitelistImportCompleted ? whitelistRows : null} runtimeActivity={runtimeActivity} /></div>
          {surface === "dashboard" && <OrderDashboard activity={runtimeActivity} />}
          {surface === "ranking" && <RankingBoard activity={runtimeActivity} />}
          {surface === "report" && <ReportBoard activity={runtimeActivity} />}
          {surface === "lottery" && <LotteryBoard rounds={lotteryRounds} attendanceRows={attendanceRows} activityId={Number(activityId)} activityFinished={activityStatus === "finished"} onComplete={(id) => setLotteryRounds((items) => items.map((item) => item.id === id ? { ...item, status: "completed", serverStatus: "COMPLETED" } : item))} />}
          {surface === "admin" && <AdminGateway><AdminPrototype key={`${activityId}-${activityStartAt}-${activityEndAt}-${activityEventEndAt}`} lotteryRounds={lotteryRounds} onLotteryChange={setLotteryRounds} activityCode={runtimeActivity?.code || getActiveActivityCode()} activityName={activityName} onActivityNameChange={setActivityName} activityId={runtimeActivity ? String(runtimeActivity.id) : activityId} activityStatus={activityStatus} onActivityStatusChange={setActivityStatus} activityStartAt={activityStartAt} onActivityStartAtChange={setActivityStartAt} activityEndAt={activityEndAt} onActivityEndAtChange={setActivityEndAt} activityEventEndAt={activityEventEndAt} onActivityEventEndAtChange={setActivityEventEndAt} productRows={productRows} onProductRowsChange={setProductRows} productImportCompleted={productImportCompleted} onProductImportCompleted={setProductImportCompleted} onProductImportCommitted={markProductImportCommitted} productImportHasRun={productImportHasRun} whitelistRows={whitelistRows} onWhitelistRowsChange={setWhitelistRows} whitelistImportCompleted={whitelistImportCompleted} onWhitelistImportCompleted={setWhitelistImportCompleted} onWhitelistImportCommitted={markWhitelistImportCommitted} whitelistImportHasRun={whitelistImportHasRun} attendanceRows={attendanceRows} onAttendanceRowsChange={setAttendanceRows} attendanceFileName={attendanceFileName} onAttendanceFileNameChange={setAttendanceFileName} attendanceWarnings={attendanceWarnings} onAttendanceWarningsChange={setAttendanceWarnings} attendanceSheetCounts={attendanceSheetCounts} onAttendanceSheetCountsChange={setAttendanceSheetCounts} attendanceImportError={attendanceImportError} onAttendanceImportErrorChange={setAttendanceImportError} /></AdminGateway>}
        </> : <>
          {surface === "h5" && <H5Prototype activityStatus={activityStatus} importedRows={productImportCompleted ? productRows : null} importedWhitelistRows={whitelistImportCompleted ? whitelistRows : null} runtimeActivity={runtimeActivity} />}
          {surface === "dashboard" && <OrderDashboard activity={runtimeActivity} />}
          {surface === "ranking" && <RankingBoard activity={runtimeActivity} />}
          {surface === "report" && <ReportBoard activity={runtimeActivity} />}
          {surface === "lottery" && <LotteryBoard rounds={lotteryRounds} attendanceRows={attendanceRows} activityId={Number(activityId)} activityFinished={activityStatus === "finished"} onComplete={(id) => setLotteryRounds((items) => items.map((item) => item.id === id ? { ...item, status: "completed", serverStatus: "COMPLETED" } : item))} />}
          {surface === "admin" && <AdminGateway><AdminPrototype key={`${activityId}-${activityStartAt}-${activityEndAt}-${activityEventEndAt}`} lotteryRounds={lotteryRounds} onLotteryChange={setLotteryRounds} activityCode={runtimeActivity?.code || getActiveActivityCode()} activityName={activityName} onActivityNameChange={setActivityName} activityId={runtimeActivity ? String(runtimeActivity.id) : activityId} activityStatus={activityStatus} onActivityStatusChange={setActivityStatus} activityStartAt={activityStartAt} onActivityStartAtChange={setActivityStartAt} activityEndAt={activityEndAt} onActivityEndAtChange={setActivityEndAt} activityEventEndAt={activityEventEndAt} onActivityEventEndAtChange={setActivityEventEndAt} productRows={productRows} onProductRowsChange={setProductRows} productImportCompleted={productImportCompleted} onProductImportCompleted={setProductImportCompleted} onProductImportCommitted={markProductImportCommitted} productImportHasRun={productImportHasRun} whitelistRows={whitelistRows} onWhitelistRowsChange={setWhitelistRows} whitelistImportCompleted={whitelistImportCompleted} onWhitelistImportCompleted={setWhitelistImportCompleted} onWhitelistImportCommitted={markWhitelistImportCommitted} whitelistImportHasRun={whitelistImportHasRun} attendanceRows={attendanceRows} onAttendanceRowsChange={setAttendanceRows} attendanceFileName={attendanceFileName} onAttendanceFileNameChange={setAttendanceFileName} attendanceWarnings={attendanceWarnings} onAttendanceWarningsChange={setAttendanceWarnings} attendanceSheetCounts={attendanceSheetCounts} onAttendanceSheetCountsChange={setAttendanceSheetCounts} attendanceImportError={attendanceImportError} onAttendanceImportErrorChange={setAttendanceImportError} /></AdminGateway>}
        </>}
      </div>
    </main>
  );
}
