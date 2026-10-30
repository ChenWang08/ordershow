"use client";

import { useEffect, useRef } from "react";
import { formatBeijingTime } from "../shared/time";
import type { H5OrderModel } from "./useH5OrderFlow";

function IdentityChoice({ model }: { model: H5OrderModel }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { identityChoice, cancelIdentityChoice, runtimeBusy, verifyError, verifyIdentity } = model;
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} className="h5-modal h5-identity-dialog" aria-labelledby="h5-identity-title"
    aria-describedby="h5-identity-description" aria-busy={runtimeBusy}
    onCancel={event => { event.preventDefault(); cancelIdentityChoice(); }}>
    <h3 id="h5-identity-title">请选择客户类型</h3>
    <p id="h5-identity-description">该手机号对应两种客户类型，请选择本次订货身份。</p>
    <div>{identityChoice?.types.map(type => <button key={type} type="button" className="primary-btn"
      disabled={runtimeBusy} onClick={() => void verifyIdentity(type)}>{type === "GENERAL" ? "综合" : "特渠"}</button>)}</div>
    {verifyError && <p className="verify-error" role="alert">{verifyError}</p>}
    {runtimeBusy && <p role="status">正在验证…</p>}
    <button type="button" className="ghost-btn identity-choice-cancel" disabled={runtimeBusy} onClick={cancelIdentityChoice}>取消</button>
  </dialog>;
}

export function H5EntryPages({ model }: { model: H5OrderModel }) {
  const { activityStatus, runtimeActivity, activityClosed, activityNotStarted, runtimeBusy, runtimeMessage,
    phone, setPhone, verifyError, orderStatus, visibleStep, verifyIdentity, identityChoice } = model;
  return <>
    {(visibleStep === "loading" || visibleStep === "empty") && <section className="h5-page verify-page entry-page">
      <div className="mini-brand"><b>金龙鱼</b></div>
      <div className="h5-hero-copy entry-hero"><span className="eyebrow">订货会</span></div>
      <div className="verify-card entry-card" role="status"><h2>{visibleStep === "loading" ? "正在加载活动入口…" : "暂无可验证客户"}</h2>
        <p>{visibleStep === "loading" ? "请稍候；若长时间未显示，请检查网络后刷新页面。" : "当前活动暂无已发布的有效白名单，请联系活动工作人员。"}</p></div>
    </section>}
    {visibleStep === "verify" && <section className="h5-page verify-page">
      <div className="entry-nav"><span>手机号验证</span></div>
      <div className="mini-brand"><b>金龙鱼</b></div>
      <div className="h5-hero-copy"><span className="eyebrow">订货会</span></div>
      <form className="verify-card" onSubmit={event => { event.preventDefault(); void verifyIdentity(); }}>
        <h2>输入白名单手机号</h2>
        <p>系统将自动识别您的客户身份，验证通过后进入订货页面。</p>
        <label><span>手机号</span><input value={phone} disabled={runtimeBusy || !!identityChoice}
          onChange={event => setPhone(event.target.value)} type="tel" inputMode="tel" autoComplete="tel" enterKeyHint="go" /></label>
        {verifyError && !identityChoice && <div className="verify-error" role="alert">{verifyError}</div>}
        <button type="submit" className="primary-btn" disabled={runtimeBusy || !!identityChoice || !phone.trim() || activityNotStarted}>
          {runtimeBusy ? "正在验证…" : activityStatus === "draft" ? "活动尚未发布" : activityStatus === "scheduled" ? "订货尚未开始" : activityClosed || orderStatus !== "none" ? "验证并查看订单" : "验证并进入订货"}
        </button>
        {runtimeMessage && <div className="verify-error" role="status">{runtimeMessage}</div>}
        <small>{activityStatus === "draft" ? "当前活动仍在准备中" : activityStatus === "scheduled" ? "将于 " + (runtimeActivity ? formatBeijingTime(runtimeActivity.startsAt) : "设定时间") + " 开放订货" : activityClosed ? "订货已截止，验证后可查看历史订单" : "仅用于本次订货会身份识别"}</small>
      </form>
    </section>}
    {identityChoice && visibleStep === "verify" && <IdentityChoice model={model} />}
  </>;
}
