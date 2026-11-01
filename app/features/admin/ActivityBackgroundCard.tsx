"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, loadAdminActivity, saveActivityBackground, type RuntimeActivity } from "../../api";
import { backgroundFileError, useBackgroundImage } from "../shared/activity-background";

function BackgroundPreview({ path, kind }: { path?: string | null; kind: "h5" | "desktop" }) {
  const image = useBackgroundImage(path);
  return <div className={`activity-background-preview ${kind}`} style={image ? { backgroundImage: image } : undefined}
    role="img" aria-label={kind === "h5" ? "H5 背景预览" : "电脑端背景预览"}>
    <span>{path ? image ? "已配置背景" : "背景加载中或暂不可用，展示页将使用默认背景" : kind === "h5" ? "默认 H5 背景" : "各页面使用原有默认背景"}</span>
  </div>;
}

export function ActivityBackgroundCard({ activityId, editable, initialActivity }: { activityId: number; editable: boolean; initialActivity?: RuntimeActivity | null }) {
  const [activity, setActivity] = useState<RuntimeActivity | null>(initialActivity ?? null);
  const [source, setSource] = useState(initialActivity);
  if (source !== initialActivity) {
    setSource(initialActivity);
    if (initialActivity) setActivity(initialActivity);
  }
  const [busy, setBusy] = useState<"h5" | "desktop" | null>(null);
  const [notice, setNotice] = useState("");
  const saving = useRef(false);
  useEffect(() => {
    if (initialActivity) return;
    let active = true;
    loadAdminActivity(activityId).then(value => { if (active) setActivity(value); })
      .catch(() => { if (active) setNotice("背景配置加载失败，请刷新页面重试。"); });
    return () => { active = false; };
  }, [activityId, initialActivity]);

  async function save(kind: "h5" | "desktop", file: File | null) {
    if (saving.current || !activity || !editable) return;
    if (file) {
      const error = backgroundFileError(file, kind);
      if (error) { setNotice(error); return; }
    }
    saving.current = true;
    setBusy(kind); setNotice("");
    try {
      if (file) {
        const url = URL.createObjectURL(file);
        try {
          await new Promise<void>((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve();
            image.onerror = () => reject(new Error("图片无法打开，请选择有效的 JPG、PNG 或 WebP 图片。"));
            image.src = url;
          });
        } finally { URL.revokeObjectURL(url); }
      }
      setActivity(await saveActivityBackground(activityId, kind, file));
      setNotice(`${kind === "h5" ? "H5" : "电脑端"}背景${file ? "已保存" : "已恢复默认"}，仅影响本场活动；刷新展示页即可查看。`);
    } catch (error) {
      setNotice(error instanceof ApiError || error instanceof Error ? error.message : "保存失败，请稍后重试。");
    } finally { saving.current = false; setBusy(null); }
  }

  return <article className="activity-card activity-background-card">
    <h2>页面背景设置</h2>
    <p>每场活动独立配置。上传成功后自动保存；未配置时使用默认背景。</p>
    <div className="activity-background-grid">
      {(["h5", "desktop"] as const).map(kind => {
        const path = kind === "h5" ? activity?.h5BackgroundUrl : activity?.desktopBackgroundUrl;
        return <section key={kind}>
          <h3>{kind === "h5" ? "H5 背景" : "电脑端背景"}</h3>
          <p>{kind === "h5" ? "用于手机端通道选择、大区选择和身份验证页" : "订单排行、专题战报、幸运抽奖共用"}</p>
          <BackgroundPreview path={path} kind={kind} />
          <p>{kind === "h5" ? "推荐 750 × 1500 px，单张不超过 5 MB" : "推荐 1920 × 1080 px，单张不超过 10 MB"}<br />支持 JPG、PNG、WebP；等比例铺满，边缘可能裁切。</p>
          {editable && <div className="activity-background-actions">
            <label>{busy === kind ? "保存中…" : path ? "替换图片" : "上传图片"}
              <input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                aria-label={kind === "h5" ? "上传 H5 背景" : "上传电脑端背景"}
                disabled={!activity || busy !== null} onChange={event => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void save(kind, file);
                }} />
            </label>
            <button type="button" disabled={!path || busy !== null} onClick={() => void save(kind, null)}>恢复默认</button>
          </div>}
        </section>;
      })}
    </div>
    <p>建议将重要文字、二维码保留为页面内容，背景边缘预留裁切空间。图片越大，首次加载时间可能越长。</p>
    {notice && <p role="status">{notice}</p>}
  </article>;
}
