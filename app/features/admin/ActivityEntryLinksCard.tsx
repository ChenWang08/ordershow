"use client";

/* eslint-disable @next/next/no-img-element -- QR previews are generated data URLs. */
import { useMemo, useState } from "react";
import QRCode from "qrcode";
import type { ActivityStatus } from "../shared/types";

type EntryLink = {
  key: "h5" | "dashboard" | "ranking" | "report" | "lottery";
  label: string;
  description: string;
  path: string;
};

type QrPreview = {
  label: string;
  url: string;
  dataUrl: string;
};

const linkDefinitions: Array<Omit<EntryLink, "path"> & { suffix: string }> = [
  { key: "h5", label: "订货 H5", description: "客户手机端订货入口", suffix: "" },
  { key: "dashboard", label: "订单看板", description: "订单总览与实时数据", suffix: "/dashboard" },
  { key: "ranking", label: "订货排行", description: "经销商与分公司排行大屏", suffix: "/ranking" },
  { key: "report", label: "专题战报", description: "主题数据展示大屏", suffix: "/report" },
  { key: "lottery", label: "幸运抽奖", description: "现场抽奖展示页面", suffix: "/lottery" },
];

const statusMeta: Record<ActivityStatus, { label: string; note: string }> = {
  draft: { label: "草稿", note: "活动发布后才能使用这些入口" },
  scheduled: { label: "待开始", note: "H5 将在订货开始时间开放下单" },
  running: { label: "订货中", note: "H5、看板和现场页面均可按活动编号访问" },
  closed: { label: "订货已截止", note: "H5 停止下单，看板、战报和抽奖仍可继续使用" },
  finished: { label: "活动已结束", note: "页面保留为历史回看，不能再写入活动数据" },
};

function safeFilePart(value: string) {
  return value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "activity";
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "true");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("clipboard-unavailable");
}

export function ActivityEntryLinksCard({ activityCode, activityName, activityStatus, departmentName }: {
  activityCode: string;
  activityName: string;
  activityStatus: ActivityStatus;
  departmentName?: string;
}) {
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [qrLoading, setQrLoading] = useState(false);
  const [qrPreview, setQrPreview] = useState<QrPreview | null>(null);
  const code = activityCode.trim();
  const status = statusMeta[activityStatus];
  const available = Boolean(code) && activityStatus !== "draft";
  const links = useMemo<EntryLink[]>(() => {
    if (!code) return [];
    const encodedCode = encodeURIComponent(code);
    return linkDefinitions.map(({ suffix, ...definition }) => ({
      ...definition,
      path: definition.key === "h5" ? `/h5/${encodedCode}` : `/screen/${encodedCode}${suffix}`,
    }));
  }, [code]);

  const fullUrl = (link: EntryLink) => `${window.location.origin}${link.path}`;

  const openLink = (link: EntryLink) => {
    if (!available) return;
    const popup = window.open(fullUrl(link), "_blank", "noopener,noreferrer");
    if (!popup) setError("浏览器拦截了新窗口，请允许弹窗后重试");
  };

  const copyLink = async (link: EntryLink) => {
    if (!available) return;
    setError("");
    try {
      await copyText(fullUrl(link));
      setNotice(`${link.label}链接已复制`);
    } catch {
      setError("浏览器未允许自动复制，请手动复制页面地址");
    }
  };

  const copyAll = async () => {
    if (!available) return;
    setError("");
    try {
      await copyText(links.map((link) => `${link.label}：${fullUrl(link)}`).join("\n"));
      setNotice("当前活动全部页面链接已复制");
    } catch {
      setError("浏览器未允许自动复制，请逐条复制页面地址");
    }
  };

  const showQr = async (link: EntryLink) => {
    if (!available) return;
    setError("");
    setQrLoading(true);
    try {
      const url = fullUrl(link);
      const dataUrl = await QRCode.toDataURL(url, {
        width: 320,
        margin: 2,
        errorCorrectionLevel: "M",
        color: { dark: "#3f1715", light: "#fffdf9" },
      });
      setQrPreview({ label: link.label, url, dataUrl });
    } catch {
      setError("二维码生成失败，请稍后重试");
    } finally {
      setQrLoading(false);
    }
  };

  return (
    <article className="activity-entry-card">
      <header className="activity-entry-header">
        <div>
          <h2>运营入口</h2>
          <p>把当前活动的 H5、看板和现场页面直接复制或打开，所有地址都绑定当前活动编号。</p>
        </div>
        <div className="activity-entry-summary">
          <span className={`activity-entry-status ${activityStatus}`}>{status.label}</span>
          <small>{departmentName || "当前授权部门"} · {code || "活动编号加载中"}</small>
        </div>
      </header>

      <div className="activity-entry-note"><b>{activityName || "当前活动"}</b><span>{status.note}</span></div>

      <div className="activity-entry-list">
        {links.map((link) => (
          <div className="activity-entry-row" key={link.key}>
            <div className="activity-entry-info">
              <span className={`activity-entry-icon ${link.key}`}>{link.key === "h5" ? "H5" : link.key === "lottery" ? "抽" : "屏"}</span>
              <div>
                <b>{link.label}</b>
                <small>{link.description}</small>
                <code title={link.path}>当前站点{link.path}</code>
              </div>
            </div>
            <div className="activity-entry-actions">
              <button type="button" disabled={!available} onClick={() => openLink(link)}>打开</button>
              <button type="button" disabled={!available} onClick={() => void copyLink(link)}>复制</button>
              <button type="button" disabled={!available || qrLoading} onClick={() => void showQr(link)}>二维码</button>
            </div>
          </div>
        ))}
        {!code && <div className="activity-entry-empty">正在读取当前活动编号…</div>}
      </div>

      <footer className="activity-entry-footer">
        <small>活动编号固定后，切换活动会自动更新以上全部入口；不要使用不带活动编号的通用地址。</small>
        <button type="button" disabled={!available} onClick={() => void copyAll()}>复制全部链接</button>
      </footer>
      {notice && <p className="activity-entry-feedback success" role="status">✓ {notice}</p>}
      {error && <p className="activity-entry-feedback error" role="alert">{error}</p>}

      {qrPreview && (
        <div className="activity-entry-qr-backdrop" role="presentation" onClick={() => setQrPreview(null)}>
          <section className="activity-entry-qr-dialog" role="dialog" aria-modal="true" aria-labelledby="activity-entry-qr-title" onClick={(event) => event.stopPropagation()}>
            <header>
              <div><b id="activity-entry-qr-title">{qrPreview.label}二维码</b><small>{activityName}</small></div>
              <button type="button" aria-label="关闭二维码" onClick={() => setQrPreview(null)}>×</button>
            </header>
            <div className="activity-entry-qr-content">
              <img src={qrPreview.dataUrl} alt={`${qrPreview.label}二维码`} />
              <code title={qrPreview.url}>{qrPreview.url}</code>
            </div>
            <footer>
              <button type="button" onClick={() => void copyText(qrPreview.url).then(() => setNotice("二维码地址已复制")).catch(() => setError("浏览器未允许自动复制，请手动复制页面地址"))}>复制地址</button>
              <a href={qrPreview.dataUrl} download={`${safeFilePart(activityName)}-${qrPreview.label}-二维码.png`}>下载二维码</a>
            </footer>
          </section>
        </div>
      )}
    </article>
  );
}
