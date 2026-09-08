"use client";

import type { H5OrderModel } from "./useH5OrderFlow";

export function H5EntryPages({ model }: { model: H5OrderModel }) {
  const { activityStatus, runtimeActivity, activityClosed, activityNotStarted, unspecifiedWhitelist, runtimeBusy, runtimeMessage, setStep, channel, setChannel, setRegion, setVerifiedBranch, setVerifiedIdentity, phone, setPhone, verifyError, setVerifyError, orderStatus, visibleStep, regionOptions, regionalized, selectedRegionName, identityLabel, verifyIdentity } = model;
  return <>
          {visibleStep === "channel" && !unspecifiedWhitelist && (
            <section className="h5-page verify-page entry-page">
              <div className="mini-brand"><b>金龙鱼</b></div>
              <div className="h5-hero-copy entry-hero">
                <span className="eyebrow">订货会</span>
              </div>
              <div className="verify-card entry-card">
                <span className="step-tag">订货通道</span>
                <h2>选择您的订货通道</h2>
                <p>请选择白名单中登记的客户类型，进入对应订货专区。</p>
                <div className="channel-options">
                  <button onClick={() => { setChannel("综合客户"); setRegion(""); setVerifiedBranch(""); setVerifiedIdentity(null); setStep(regionalized ? "region" : "verify"); }}>
                    <i className="channel-icon">综</i>
                    <span><b>综合客户订货</b><small>{regionalized ? "综合经销商 · 进入后选择所属片区" : "综合经销商 · 手机号验证身份"}</small></span>
                    <em>›</em>
                  </button>
                  <button onClick={() => { setChannel("特渠专业客户"); setRegion(""); setVerifiedBranch(""); setVerifiedIdentity(null); setStep("verify"); }}>
                    <i className="channel-icon special">特</i>
                    <span><b>特渠专业客户订货</b><small>专业渠道经销商 · 手机号验证身份</small></span>
                    <em>›</em>
                  </button>
                </div>
                <small>通道选择不会改变白名单中的客户身份</small>
              </div>
            </section>
          )}

          {visibleStep === "region" && (
            <section className="h5-page verify-page entry-page">
              <div className="entry-nav"><button onClick={() => setStep("channel")}>‹</button><span>综合客户订货</span></div>
              <div className="mini-brand"><b>金龙鱼</b></div>
              <div className="h5-hero-copy region-hero">
                <span className="eyebrow">订货会</span>
                <h1>选择所属<br /><em>经营大区</em></h1>
                <p>请按白名单登记信息选择</p>
              </div>
              <div className="verify-card entry-card region-card">
                <span className="step-tag">综合客户</span>
                <h2>请选择所属大区</h2>
                <p>验证手机号时，系统会再次核对客户类型和经营区域。</p>
                <div className="region-options">
                {regionOptions.map((item) => (
                    <button key={item.value} onClick={() => { setRegion(item.value); setStep("verify"); }}>
                      <i>{item.name.slice(0, 1)}</i><b>{item.name}</b><small>{item.detail}</small>
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}

          {visibleStep === "verify" && (
            <section className="h5-page verify-page">
              <div className="entry-nav">{!unspecifiedWhitelist && <button onClick={() => setStep(channel === "综合客户" && regionalized ? "region" : "channel")}>‹</button>}<span>{identityLabel}</span></div>
              <div className="mini-brand"><b>金龙鱼</b></div>
              <div className="h5-hero-copy">
                <span className="eyebrow">订货会</span>
              </div>
              <div className="verify-card">
                <div className="verify-context"><span className="step-tag">{identityLabel}</span>{!unspecifiedWhitelist && <button onClick={() => setStep("channel")}>重新选择</button>}</div>
                <h2>输入白名单手机号</h2>
                <p>验证通过后，将为您展示{unspecifiedWhitelist ? "本次白名单客户" : channel === "综合客户" ? `${selectedRegionName ? `${selectedRegionName}综合客户` : "综合客户"}` : "特渠专业客户"}的订货商品。</p>
                <label>
                  <span>手机号</span>
                  <input value={phone} onChange={(e) => { setPhone(e.target.value); setVerifyError(""); }} inputMode="tel" />
                </label>
                {verifyError && <div className="verify-error" role="alert">{verifyError}</div>}
                <button className="primary-btn" disabled={runtimeBusy || !phone.trim() || activityNotStarted} onClick={() => void verifyIdentity()}>{runtimeBusy ? "正在验证…" : activityStatus === "draft" ? "活动尚未发布" : activityStatus === "scheduled" ? "订货尚未开始" : activityClosed ? "验证并查看订单" : orderStatus === "none" ? "验证并进入订货" : "验证并查看订单"}</button>
                {runtimeMessage && <div className="verify-error" role="status">{runtimeMessage}</div>}
                <small>{activityStatus === "draft" ? "当前活动仍在准备中" : activityStatus === "scheduled" ? `将于 ${runtimeActivity ? new Date(runtimeActivity.startsAt).toLocaleString("zh-CN", { hour12: false }) : "设定时间"} 开放订货` : activityClosed ? "订货已截止，验证后可查看历史订单" : "仅用于本次订货会身份识别"}</small>
              </div>
            </section>
          )}

  </>;
}
