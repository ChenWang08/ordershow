"use client";

import { useEffect, useMemo, useState } from "react";

type Surface = "h5" | "ranking" | "report" | "lottery" | "admin";
type H5Step = "channel" | "region" | "verify" | "order" | "confirm" | "success" | "submitted";
type H5OrderStatus = "none" | "submitted" | "withdrawn";
type H5Channel = "综合客户" | "特渠专业客户" | "";
type MockWhitelistIdentity = { phone: string; channel: Exclude<H5Channel, "">; region: string };
type CandidateScope = "all" | "attended" | "ordered";
type LotteryRoundStatus = "draft" | "published" | "completed";
type LotteryRound = {
  id: number;
  name: string;
  prize: string;
  winnerCount: number;
  customerType: "全部客户" | "特渠专业客户" | "综合客户";
  scope: CandidateScope;
  minAmount: number;
  cutoff: string;
  excludeWinners: boolean;
  status: LotteryRoundStatus;
  candidateCount: number;
};
type Product = {
  id: number;
  name: string;
  line: string;
  spec: string;
  price: number;
  rebate: boolean;
  gift: boolean;
  atlas: number;
};

const mockWhitelistIdentities: MockWhitelistIdentity[] = [
  { phone: "13800138000", channel: "特渠专业客户", region: "" },
  { phone: "13812348000", channel: "特渠专业客户", region: "" },
  { phone: "14712341979", channel: "综合客户", region: "南区" },
  { phone: "18612345036", channel: "综合客户", region: "北区" },
];

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

const products: Product[] = [
  { id: 1, name: "金芝御礼芝麻油礼盒", line: "调味油", spec: "225mL×4 / 5盒", price: 172.5, rebate: true, gift: true, atlas: 3 },
  { id: 2, name: "福运添香芝麻油", line: "调味油", spec: "225mL×20瓶", price: 144, rebate: true, gift: false, atlas: 0 },
  { id: 3, name: "小磨芝麻香油", line: "调味油", spec: "221mL×20瓶", price: 210, rebate: true, gift: false, atlas: 0 },
  { id: 4, name: "金标生抽酱油", line: "酱油", spec: "500mL×12瓶", price: 66, rebate: true, gift: false, atlas: 1 },
  { id: 5, name: "零添加特级味极鲜", line: "酱油", spec: "500mL×12瓶", price: 78, rebate: true, gift: false, atlas: 1 },
  { id: 6, name: "纯粮香醋", line: "食醋", spec: "500mL×12瓶", price: 82.8, rebate: false, gift: false, atlas: 2 },
  { id: 7, name: "鲜香花椒油", line: "调味油", spec: "225mL×20瓶", price: 236, rebate: false, gift: false, atlas: 0 },
  { id: 8, name: "经典调味礼盒", line: "酱油", spec: "4瓶×6盒", price: 420, rebate: false, gift: true, atlas: 3 },
 ];

const dealerNames = [
  "上海爱尚真", "江苏徐工电子公司", "江苏四合商贸发展", "北京智享云采经贸", "北京惠通达行商贸",
  "农膳坊健康公司", "北京谷力供应链管理", "湖北中合誉品", "上海高顿", "北京金箔永和贸易",
  "河北金源粮油", "上海迦新", "青岛奥德", "河北惊钰", "石家庄德众",
  "天津益食满城", "山东有机有缘", "山东鲸桥裕", "上海赞畅", "唐山红星",
  "青岛大优供应链", "青岛超祥", "汇德丰贸易", "上海安食记", "河南百企助农",
  "湖北省诚新物流", "北京金联创科贸", "深圳曹销分", "河南满粮商贸", "益丰万立",
];

const branches = [
  "上海分", "青岛分", "北京分", "徐州分", "秦皇岛分", "天津分", "郑州分", "石家庄分", "南京分", "武汉分",
  "济南分", "杭州分", "宁波分", "合肥分", "福州分", "厦门分", "广州分", "深圳分", "南宁分", "长沙分",
  "成都分", "重庆分", "昆明分", "西安分", "太原分", "沈阳分", "大连分", "哈尔滨分", "长春分", "乌鲁木齐分",
  "兰州分", "贵阳分", "海口分", "南昌分", "珠海分", "东莞分",
];
const branchPageSize = 30;
const reports = [
  "特渠专业客户 TOP5",
  "综合客户 TOP5",
  "总战绩",
  "特渠专业客户金额、综合客户金额及合计",
  "综合客户东、南、北1、北2区金额及合计",
  "礼盒：特渠专业客户金额、综合客户金额及合计",
  "综合客户各产品线金额及合计",
  "特渠专业客户与综合客户各产品线金额及合计",
  "综合客户区域金额与产品线金额同屏展示",
];

const initialLotteryRounds: LotteryRound[] = [
  { id: 1, name: "第一轮", prize: "御品礼盒", winnerCount: 15, customerType: "特渠专业客户", scope: "attended", minAmount: 0, cutoff: "2030-07-30T18:00", excludeWinners: true, status: "completed", candidateCount: 286 },
  { id: 2, name: "第二轮", prize: "蜀绣双面绣熊猫摆件", winnerCount: 15, customerType: "综合客户", scope: "ordered", minAmount: 5000, cutoff: "2030-07-30T18:00", excludeWinners: true, status: "published", candidateCount: 418 },
  { id: 3, name: "第三轮", prize: "尊享礼盒", winnerCount: 10, customerType: "全部客户", scope: "all", minAmount: 0, cutoff: "2030-07-30T18:00", excludeWinners: true, status: "draft", candidateCount: 1665 },
];

function money(value: number) {
  return value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function FestivalDecor() {
  return (
    <>
      <div className="festival-moon" aria-hidden="true"><i /><i /><i /></div>
      <div className="festival-cloud cloud-a" aria-hidden="true" />
      <div className="festival-cloud cloud-b" aria-hidden="true" />
      <div className="festival-mountains" aria-hidden="true"><i /><i /><i /><i /></div>
    </>
  );
}

function ProductArt({ atlas }: { atlas: number }) {
  return <span className={`product-art atlas-${atlas}`} role="img" aria-label="临时商品图" />;
}

function H5Prototype({ activityClosed }: { activityClosed: boolean }) {
  const [step, setStep] = useState<H5Step>("channel");
  const [channel, setChannel] = useState<H5Channel>("");
  const [region, setRegion] = useState("");
  const [phone, setPhone] = useState("13800138000");
  const [verifyError, setVerifyError] = useState("");
  const [rebate, setRebate] = useState(true);
  const [line, setLine] = useState("全部");
  const [search, setSearch] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [orderStatus, setOrderStatus] = useState<H5OrderStatus>("none");
  const [submitMode, setSubmitMode] = useState<"first" | "update">("first");
  const [orderVersion, setOrderVersion] = useState(0);
  const [orderUpdatedAt, setOrderUpdatedAt] = useState("07-28 14:52");
  const [orderWithdrawnAt, setOrderWithdrawnAt] = useState("");
  const [orderEvents, setOrderEvents] = useState<Array<{ time: string; title: string; detail: string }>>([]);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [submittedQuantities, setSubmittedQuantities] = useState<Record<number, number>>({});
  const [quantities, setQuantities] = useState<Record<number, number>>({ 1: 2, 3: 1 });
  const visibleProducts = products.filter(
    (p) => p.rebate === rebate && (line === "全部" || p.line === line) && p.name.includes(search),
  );
  const selected = products.filter((p) => (quantities[p.id] || 0) > 0);
  const totalBoxes = selected.reduce((sum, p) => sum + quantities[p.id], 0);
  const totalAmount = selected.reduce((sum, p) => sum + quantities[p.id] * p.price, 0);
  const orderViewQuantities = orderStatus === "withdrawn" ? submittedQuantities : quantities;
  const orderViewSelected = products.filter((p) => (orderViewQuantities[p.id] || 0) > 0);
  const orderViewBoxes = orderViewSelected.reduce((sum, p) => sum + orderViewQuantities[p.id], 0);
  const orderViewAmount = orderViewSelected.reduce((sum, p) => sum + orderViewQuantities[p.id] * p.price, 0);
  const identityLabel = channel === "综合客户" ? `综合客户 · ${region}` : "特渠专业客户";
  const dealerName = channel === "综合客户" ? "上海爱尚真贸易有限公司" : "北京智享云采经贸有限公司";

  const changeQty = (id: number, delta: number) => {
    setQuantities((old) => ({ ...old, [id]: Math.max(0, (old[id] || 0) + delta) }));
  };

  const startEditingOrder = () => {
    if (orderStatus === "withdrawn") setQuantities({ ...submittedQuantities });
    setStep("order");
  };

  const verifyIdentity = () => {
    if (activityClosed && orderStatus === "none") return;
    const normalizedPhone = normalizePhone(phone);
    const identity = mockWhitelistIdentities.find((item) => item.phone === normalizedPhone);
    if (!identity) {
      setVerifyError("该手机号不在本次活动白名单中，请核对后重新输入。");
      return;
    }
    if (identity.channel !== channel || (channel === "综合客户" && identity.region !== region)) {
      setVerifyError(`该手机号登记为${identity.channel}${identity.region ? ` · ${identity.region}` : ""}，请重新选择订货入口。`);
      return;
    }
    setVerifyError("");
    setStep(orderStatus === "none" ? "order" : "submitted");
  };

  return (
    <div className="h5-stage">
      <div className="device-caption">
        <span>客户订货 H5</span>
        <small>手机端 · 可点击演示</small>
      </div>
      <div className="phone-shell">
        <div className="phone-screen">
          <FestivalDecor />
          {step === "channel" && (
            <section className="h5-page verify-page entry-page">
              <div className="mini-brand"><b>金龙鱼</b><span>调味品事业部</span></div>
              <div className="h5-hero-copy entry-hero">
                <span className="eyebrow">订货会</span>
                <h1>月满家圆<br /><em>味启新程</em></h1>
                <p>新品发布及旺季动员会</p>
              </div>
              <div className="verify-card entry-card">
                <span className="step-tag">订货通道</span>
                <h2>选择您的订货通道</h2>
                <p>请选择白名单中登记的客户类型，进入对应订货专区。</p>
                <div className="channel-options">
                  <button onClick={() => { setChannel("综合客户"); setRegion(""); setStep("region"); }}>
                    <i className="channel-icon">综</i>
                    <span><b>综合客户订货</b><small>综合经销商 · 进入后选择所属大区</small></span>
                    <em>›</em>
                  </button>
                  <button onClick={() => { setChannel("特渠专业客户"); setRegion(""); setStep("verify"); }}>
                    <i className="channel-icon special">特</i>
                    <span><b>特渠专业客户订货</b><small>专业渠道经销商 · 手机号验证身份</small></span>
                    <em>›</em>
                  </button>
                </div>
                <small>通道选择不会改变白名单中的客户身份</small>
              </div>
            </section>
          )}

          {step === "region" && (
            <section className="h5-page verify-page entry-page">
              <div className="entry-nav"><button onClick={() => setStep("channel")}>‹</button><span>综合客户订货</span></div>
              <div className="mini-brand"><b>金龙鱼</b><span>调味品事业部</span></div>
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
                  {[
                    ["东区", "华东区域综合经销商"],
                    ["南区", "华南区域综合经销商"],
                    ["北1区", "华北一部综合经销商"],
                    ["北2区", "华北二部综合经销商"],
                  ].map(([name, detail], index) => (
                    <button key={name} onClick={() => { setRegion(name); setStep("verify"); }}>
                      <i>{["东", "南", "北", "北"][index]}</i><b>{name}</b><small>{detail}</small>
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}

          {step === "verify" && (
            <section className="h5-page verify-page">
              <div className="entry-nav"><button onClick={() => setStep(channel === "综合客户" ? "region" : "channel")}>‹</button><span>{identityLabel}</span></div>
              <div className="mini-brand"><b>金龙鱼</b><span>调味品事业部</span></div>
              <div className="h5-hero-copy">
                <span className="eyebrow">订货会</span>
                <h1>月满家圆<br /><em>味启新程</em></h1>
                <p>新品发布及旺季动员会</p>
              </div>
              <div className="verify-card">
                <div className="verify-context"><span className="step-tag">{identityLabel}</span><button onClick={() => setStep("channel")}>重新选择</button></div>
                <h2>输入白名单手机号</h2>
                <p>验证通过后，将为您展示{channel === "综合客户" ? `${region}综合客户` : "特渠专业客户"}的订货商品。</p>
                <label>
                  <span>手机号</span>
                  <input value={phone} onChange={(e) => { setPhone(e.target.value); setVerifyError(""); }} inputMode="tel" />
                </label>
                {verifyError && <div className="verify-error" role="alert">{verifyError}</div>}
                <button className="primary-btn" disabled={!phone.trim() || (activityClosed && orderStatus === "none")} onClick={verifyIdentity}>{activityClosed && orderStatus === "none" ? "活动已截止" : orderStatus === "none" ? "验证并进入订货" : "验证并查看订单"}</button>
                <small>{activityClosed && orderStatus === "none" ? "订货活动已截止，暂不接受新订单" : "仅用于本次订货会身份识别"}</small>
              </div>
            </section>
          )}

          {step === "order" && (
            <section className="h5-page order-page">
              <header className="order-header">
                <button className="text-btn" onClick={() => setStep(orderStatus === "none" ? "verify" : "submitted")}>‹</button>
                <div><b>订货会</b><span>{identityLabel}</span></div>
                <button className="round-btn" aria-label="更多">•••</button>
              </header>
              <div className="dealer-card">
                <span>已识别经销商</span>
                <b>{dealerName}</b>
                <small>{identityLabel} · 联系人王女士 · 138****8000</small>
              </div>
              <div className="policy-note"><b>订货提示</b><span>{activityClosed ? "活动已截止，当前订单仅可查看。" : "所有商品按箱订购，提交后可在截止时间前修改或取消本次订货。"}</span></div>
              <div className="product-toolbar">
                <div className="segment">
                  <button className={rebate ? "active" : ""} onClick={() => setRebate(true)}>返利产品</button>
                  <button className={!rebate ? "active" : ""} onClick={() => setRebate(false)}>非返利产品</button>
                </div>
                <label className="search-box">⌕<input placeholder="搜索商品" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
              </div>
              <div className="line-tabs">
                {["全部", "调味油", "酱油", "食醋"].map((item) => (
                  <button key={item} className={line === item ? "active" : ""} onClick={() => setLine(item)}>{item}</button>
                ))}
              </div>
              <div className="product-list">
                {visibleProducts.map((product) => (
                  <article className="product-card" key={product.id}>
                    <div className="product-image"><ProductArt atlas={product.atlas} />{product.gift && <span className="gift-badge">礼盒</span>}</div>
                    <div className="product-info">
                      <span className="material-code">物料 {String(7245000000 + product.id)}</span>
                      <h3>{product.name}</h3>
                      <p>{product.spec}</p>
                      <div className="product-action">
                        <strong>¥{money(product.price)}<small>/箱</small></strong>
                        <div className="stepper">
                          <button aria-label={`${product.name}减少一箱`} onClick={() => changeQty(product.id, -1)} disabled={activityClosed || !quantities[product.id]}>−</button>
                          <input aria-label={`${product.name}订货箱数`} disabled={activityClosed} inputMode="numeric" type="number" min="0" max="9999" value={quantities[product.id] || 0} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setQuantities({ ...quantities, [product.id]: Math.min(9999, Math.max(0, Math.floor(Number(e.target.value) || 0))) })} />
                          <button aria-label={`${product.name}增加一箱`} onClick={() => changeQty(product.id, 1)} disabled={activityClosed}>＋</button>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
                {visibleProducts.length === 0 && <div className="empty-state">没有符合条件的商品</div>}
              </div>
              <div className="order-bar">
                <button className="cart-summary" disabled={activityClosed || !totalBoxes} onClick={() => setCartOpen(true)}>
                  <span>已选 {selected.length} 种 · {totalBoxes} 箱 <em>查看明细⌃</em></span><b>¥{money(totalAmount)}</b>
                </button>
                <button className="confirm-cart-btn" disabled={activityClosed || (!totalBoxes && orderStatus === "none")} onClick={() => totalBoxes ? setStep("confirm") : setCancelConfirmOpen(true)}>{totalBoxes ? "确认订单" : "取消本次订货"}</button>
              </div>
            </section>
          )}

          {step === "order" && cartOpen && (
            <div className="cart-sheet-layer">
              <button className="cart-sheet-backdrop" aria-label="关闭购物明细" onClick={() => setCartOpen(false)} />
              <section className="cart-sheet" aria-label="已选商品明细">
                <header><div><b>已选商品</b><span>{selected.length} 种 · {totalBoxes} 箱</span></div><button disabled={!selected.length} onClick={() => setQuantities({})}>清空</button></header>
                <div className="cart-sheet-list">
                  {selected.map((product) => (
                    <article key={product.id}>
                      <ProductArt atlas={product.atlas} />
                      <div className="cart-item-info">
                        <b>{product.name}</b>
                        <span>{product.spec} · ¥{money(product.price)}/箱</span>
                        <strong>小计 ¥{money(product.price * quantities[product.id])}</strong>
                      </div>
                      <div className="cart-item-actions">
                        <button className="remove-item" disabled={activityClosed} onClick={() => setQuantities((old) => ({ ...old, [product.id]: 0 }))}>删除</button>
                        <div className="stepper">
                          <button aria-label={`${product.name}减少一箱`} onClick={() => changeQty(product.id, -1)} disabled={activityClosed}>−</button>
                          <input aria-label={`${product.name}订货箱数`} disabled={activityClosed} inputMode="numeric" type="number" min="0" max="9999" value={quantities[product.id]} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setQuantities({ ...quantities, [product.id]: Math.min(9999, Math.max(0, Math.floor(Number(e.target.value) || 0))) })} />
                          <button aria-label={`${product.name}增加一箱`} onClick={() => changeQty(product.id, 1)} disabled={activityClosed}>＋</button>
                        </div>
                      </div>
                    </article>
                  ))}
                  {!selected.length && <div className="cart-empty">还没有选择商品</div>}
                </div>
                <footer><div><span>合计</span><b>¥{money(totalAmount)}</b><small>共 {totalBoxes} 箱</small></div><button disabled={activityClosed || (!totalBoxes && orderStatus === "none")} onClick={() => { setCartOpen(false); totalBoxes ? setStep("confirm") : setCancelConfirmOpen(true); }}>{totalBoxes ? "去确认订单" : "取消本次订货"}</button></footer>
              </section>
            </div>
          )}

          {step === "confirm" && (
            <section className="h5-page confirm-page">
              <header className="simple-header"><button onClick={() => setStep("order")}>‹</button><b>确认订单</b><span /></header>
              <div className="confirm-hero"><span>请核对订货信息</span><h2>{dealerName}</h2><small>{identityLabel}{channel === "特渠专业客户" ? " · 北京分" : ""}</small></div>
              <div className="confirm-list">
                {selected.map((product) => (
                  <div key={product.id}>
                    <ProductArt atlas={product.atlas} />
                    <p><b>{product.name}</b><span>{product.spec} · ¥{money(product.price)}/箱</span></p>
                    <strong>× {quantities[product.id]}</strong>
                  </div>
                ))}
              </div>
              <div className="summary-card">
                <p className="grand-total"><span>订单总金额</span><b>¥{money(totalAmount)}</b></p>
              </div>
              <label className="agreement"><input type="checkbox" defaultChecked /> 我已核对商品与订货数量</label>
              <button className="submit-order" disabled={activityClosed} onClick={() => {
                const isFirstSubmit = orderStatus === "none";
                const actionTime = isFirstSubmit ? "07-28 14:52" : orderStatus === "withdrawn" ? "07-28 15:18" : "07-28 15:08";
                const nextVersion = orderVersion + 1;
                setSubmitMode(isFirstSubmit ? "first" : "update");
                setOrderVersion(nextVersion);
                setOrderStatus("submitted");
                setSubmittedQuantities({ ...quantities });
                setOrderWithdrawnAt("");
                setOrderUpdatedAt(actionTime);
                setOrderEvents((events) => [{ time: actionTime, title: isFirstSubmit ? "已提交订单" : "重新提交订单", detail: isFirstSubmit ? "经销商手机端提交 · 当前版本 V1" : `经销商修改后重新提交 · 当前版本 V${nextVersion} · 订单号不变` }, ...events]);
                setStep("success");
              }}>{orderStatus === "none" ? "确认提交订单" : orderStatus === "withdrawn" ? "重新提交订单" : "确认修改并提交"}</button>
            </section>
          )}

          {step === "submitted" && (
            <section className="h5-page submitted-page">
              <header className="simple-header"><button onClick={() => setStep("verify")}>‹</button><b>我的订单</b><span /></header>
              <div className={`submitted-state-card ${orderStatus === "withdrawn" ? "withdrawn" : ""}`}>
                <span className="submitted-status">{orderStatus === "withdrawn" ? "已撤回" : "已提交"}</span>
                <h2>{orderStatus === "withdrawn" ? "当前订单已撤回" : "您的订货已成功提交"}</h2>
                <p>{orderStatus === "withdrawn" ? "商品明细和订单号已保留，截止前可继续订货并重新提交。" : "订单截止前可修改或取消本次订货，修改后将以最新提交内容为准。"}</p>
              </div>
              <div className="submitted-meta">
                <p><span>订单编号</span><b>ZYORDER280018</b></p>
                <p><span>最后提交时间</span><b>{orderUpdatedAt}</b></p>
                <p><span>当前版本</span><b>V{orderVersion}</b></p>
                <p><span>编辑权限</span><b className={activityClosed ? "muted" : ""}>{activityClosed ? "已截止" : orderStatus === "withdrawn" ? "可重新提交" : "可修改或取消"}</b></p>
                {orderStatus === "withdrawn" && orderWithdrawnAt && <p><span>取消时间</span><b>{orderWithdrawnAt}</b></p>}
                <p><span>经销商</span><b>{dealerName}</b></p>
              </div>
              <div className="confirm-list submitted-list">
                {orderViewSelected.map((product) => (
                  <div key={product.id}>
                    <ProductArt atlas={product.atlas} />
                    <p><b>{product.name}</b><span>{product.spec} · ¥{money(product.price)}/箱</span></p>
                    <strong>× {orderViewQuantities[product.id]}</strong>
                  </div>
                ))}
              </div>
              <div className="summary-card">
                <p className="grand-total"><span>订单总金额</span><b>¥{money(orderViewAmount)}</b></p>
                <p><span>订货数量</span><b>{orderViewBoxes} 箱 · {orderViewSelected.length} 种商品</b></p>
              </div>
              <div className="submitted-note">{activityClosed ? "活动已截止，当前订单仅可查看，不能修改、取消或重新提交。" : orderStatus === "withdrawn" ? "该订单当前不计入有效订单、金额统计和抽奖资格；截止前可点击“继续订货”恢复提交。" : "订单状态会同步至管理后台和活动看板；如需调整商品或数量，请点击“修改订单”。"}</div>
              {orderEvents.length > 0 && <section className="submitted-events"><h3>操作记录</h3>{orderEvents.map((event, index) => <p key={`${event.time}-${index}`}><b>{event.time.slice(11)} {event.title}</b><span>{event.detail}</span></p>)}</section>}
              <div className="submitted-actions">
                {!activityClosed && (orderStatus === "withdrawn" ? <button className="primary-btn" onClick={startEditingOrder}>继续订货</button> : <button className="primary-btn" onClick={startEditingOrder}>修改订单</button>)}
                <button className="ghost-btn" onClick={() => setStep("channel")}>返回活动首页</button>
              </div>
            </section>
          )}

          {step === "success" && (
            <section className="h5-page success-page">
              <div className="success-mark">✓</div>
              <span>{submitMode === "first" ? "提交成功" : "修改成功"}</span>
              <h2>{submitMode === "first" ? "您的订货已成功提交" : "订单修改已重新提交"}</h2>
              <p>订单编号：ZYORDER280018</p>
              <div className="success-amount"><span>订单总金额</span><b>¥{money(totalAmount)}</b><small>{totalBoxes} 箱 · {selected.length} 种商品</small></div>
              <div className="success-note">订单号保持不变，截止前您可以再次进入并修改或取消本次订货。看板将在数秒内同步最新数据。</div>
              <button className="primary-btn" onClick={() => setStep("submitted")}>查看订单</button>
              <button className="ghost-btn" onClick={() => { setChannel(""); setRegion(""); setStep("channel"); }}>返回活动首页</button>
            </section>
          )}
          {cancelConfirmOpen && (
            <div className="h5-modal-layer" role="dialog" aria-modal="true" aria-label="取消本次订货确认">
              <div className="h5-modal">
                <h3>确认取消本次订货？</h3>
                <p>取消后不会生成空订单，系统会保留最近一次非空提交的商品、金额和订单号，并将当前订单标记为已撤回。</p>
                <div><button className="ghost-btn" onClick={() => setCancelConfirmOpen(false)}>继续修改</button><button className="primary-btn" onClick={() => {
                  const actionTime = "07-28 15:12";
                  setOrderStatus("withdrawn");
                  setOrderWithdrawnAt(actionTime);
                  setQuantities({});
                  setOrderEvents((events) => [{ time: actionTime, title: "取消本次订货", detail: `取消当前订单版本 V${orderVersion} · 最近一次非空明细保留` }, ...events]);
                  setCancelConfirmOpen(false);
                  setCartOpen(false);
                  setStep("submitted");
                }}>确认取消</button></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RankingBoard() {
  const [channel, setChannel] = useState("特渠专业客户");
  const ranking = useMemo(() => Array.from({ length: 90 }, (_, index) => ({
    rank: index + 1,
    name: dealerNames[index % dealerNames.length] + (index >= dealerNames.length ? `${Math.floor(index / dealerNames.length) + 1}` : ""),
    value: Math.max(22612, 832017 - index * 6827 + (index % 4) * 931),
  })), []);
  const isBranchOverflowing = branches.length > branchPageSize;

  return (
    <section className="screen-board ranking-board">
      <FestivalDecor />
      <header className="screen-title">
        <div className="screen-metric"><span>订单金额</span><strong>19,457,005.28<small>元</small></strong></div>
        <div className="ranking-heading">
          <h1>{channel}商品信息</h1>
          <label>当前看板
            <select value={channel} onChange={(e) => setChannel(e.target.value)}>
              {["特渠专业客户", "综合东区", "综合南区", "综合北1区", "综合北2区"].map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
        </div>
        <div className="screen-metric"><span>累计订货</span><strong>1,316.0<small>吨</small></strong></div>
      </header>
      <div className="ranking-layout">
        <div className="ranking-columns">
          {[0, 30, 60].map((start) => (
            <div className="rank-column" key={start}>
              <h2>公司订单金额排行 {start + 1}–{Math.min(start + 30, ranking.length)}<small>单位：元</small></h2>
              {ranking.slice(start, start + 30).map((item) => (
                <div className={`rank-row ${item.rank <= 3 ? "top-three" : ""}`} key={item.rank}>
                  <span className={item.rank <= 6 ? "crown" : ""}><i aria-hidden="true">{item.rank <= 6 ? "♛" : ""}</i> {item.rank}</span>
                  <b>{item.name}</b>
                  <strong>{item.value.toLocaleString()}元</strong>
                </div>
              ))}
            </div>
          ))}
        </div>
        <aside className={`branch-rank${isBranchOverflowing ? " branch-rank-scrollable" : ""}`}>
          <h2>分公司订货榜</h2>
          {branches.map((branch, index) => (
            <div className={index < 5 ? "branch-top-five" : ""} key={branch}><span className={index < 5 ? "crown" : ""}><i aria-hidden="true">{index < 5 ? "♛" : ""}</i> {index + 1}</span><b>{branch}</b><strong>{Math.max(320000, 3104358 - index * 98000).toLocaleString()}元</strong></div>
          ))}
        </aside>
      </div>
    </section>
  );
}

function MetricTable({ title, labels, values, kind = "category" }: { title: string; labels: string[]; values: number[]; kind?: "area" | "product" | "category" }) {
  return (
    <div className={`metric-table metric-table-${kind}`}>
      <i className="metric-frame-corner corner-tl" aria-hidden="true" /><i className="metric-frame-corner corner-tr" aria-hidden="true" /><i className="metric-frame-corner corner-bl" aria-hidden="true" /><i className="metric-frame-corner corner-br" aria-hidden="true" />
      <h2><span className="metric-table-title">{title}</span></h2>
      <div className="metric-head"><span><i className="metric-column-icon" aria-hidden="true" />分类</span><span><i className="metric-amount-icon" aria-hidden="true" />金额（元）</span></div>
      {labels.map((label, index) => <div key={label}><span>{label}</span><b>{values[index].toLocaleString()}</b></div>)}
      <div className="metric-total"><span>合计</span><b>{values.reduce((a, b) => a + b, 0).toLocaleString()}</b></div>
    </div>
  );
}

function ReportBoard() {
  const [report, setReport] = useState(reports[2]);
  const isTop = report.includes("TOP5");
  const isTotal = report === "总战绩";
  const isDual = report === reports[8];
  const displayTitles: Record<string, string> = {
    "特渠专业客户金额、综合客户金额及合计": "特渠专业客户+综合客户",
    "礼盒：特渠专业客户金额、综合客户金额及合计": "礼盒",
    "综合客户各产品线金额及合计": "综合客户",
    "特渠专业客户与综合客户各产品线金额及合计": "特渠专业客户+综合客户",
  };
  const displayTitle = displayTitles[report] ?? report;
  return (
    <section className="screen-board report-board">
      <FestivalDecor />
      <header className="report-header">
        <span>调味品事业部新品发布及旺季动员会</span>
        <h1>月满家圆 · 味启新程</h1>
        <label>当前看板：
          <select value={report} onChange={(e) => setReport(e.target.value)}>
            {reports.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
      </header>
      <div className={`report-content ${isDual ? "dual" : ""}`}>
        {isTotal ? (
          <div className="total-performance"><span>总战绩</span><strong>1.56<small>亿</small></strong></div>
        ) : isTop ? (
          <div className="top-five">
            <i className="metric-frame-corner corner-tl" aria-hidden="true" /><i className="metric-frame-corner corner-tr" aria-hidden="true" /><i className="metric-frame-corner corner-bl" aria-hidden="true" /><i className="metric-frame-corner corner-br" aria-hidden="true" />
            <h2>{report}</h2>
            {dealerNames.slice(0, 5).map((name, index) => <div key={name}><span>{index + 1}</span><b>{name}</b></div>)}
          </div>
        ) : isDual ? (
          <>
            <MetricTable kind="area" title="综合客户 · 区域" labels={["东区", "南区", "北1区", "北2区"]} values={[44979349, 29342256, 63086424, 18270000]} />
            <MetricTable kind="product" title="综合客户 · 产品线" labels={["调味油", "酱油", "食醋", "料酒", "礼盒"]} values={[103445585, 24615018, 6624881, 1781348, 931195]} />
          </>
        ) : report.includes("产品线") ? (
          <MetricTable kind="product" title={displayTitle} labels={["调味油", "酱油", "食醋", "料酒", "蚝油", "礼盒"]} values={[103445585, 24615018, 6624881, 1781348, 1435672, 931195]} />
        ) : report.includes("东、南") ? (
          <MetricTable kind="area" title="综合客户" labels={["东区", "南区", "北1区", "北2区"]} values={[44979349, 29342256, 63086424, 18270000]} />
        ) : (
          <MetricTable title={displayTitle} labels={["特渠专业客户", "综合客户"]} values={report.includes("礼盒") ? [9789094, 11811559] : [19462405, 137408029]} />
        )}
      </div>
    </section>
  );
}

function LotteryBoard({ rounds, onComplete }: { rounds: LotteryRound[]; onComplete: (id: number) => void }) {
  const [status, setStatus] = useState<"ready" | "rolling" | "done" | "finished">("ready");
  const [ticker, setTicker] = useState(0);
  const [sessionFinished, setSessionFinished] = useState(false);
  const availableRounds = rounds.filter((item) => item.status !== "draft");
  const [roundId, setRoundId] = useState(availableRounds.find((item) => item.status === "published")?.id ?? availableRounds[0]?.id ?? 0);
  const currentRound = availableRounds.find((item) => item.id === roundId) ?? availableRounds[0];
  useEffect(() => {
    if (status !== "rolling") return;
    const timer = window.setInterval(() => setTicker((n) => n + 1), 90);
    return () => window.clearInterval(timer);
  }, [status]);
  const winners = Array.from({ length: currentRound?.winnerCount ?? 0 }, (_, i) => dealerNames[(ticker + i * 3) % dealerNames.length]);
  if (!currentRound) return <section className="screen-board lottery-board"><div className="lottery-ready"><h2>暂无已发布抽奖轮次</h2></div></section>;
  const handleAction = () => {
    if (sessionFinished) return;
    if (status === "ready") setStatus("rolling");
    else if (status === "rolling") {
      setStatus("done");
    } else if (status === "done") {
      onComplete(currentRound.id);
      const next = availableRounds.find((item) => item.id > currentRound.id && item.status !== "completed");
      if (next) {
        setRoundId(next.id);
        setStatus("ready");
      } else setSessionFinished(true);
    }
  };
  return (
    <section className="screen-board lottery-board">
      <FestivalDecor />
      <div className="lottery-controls">
        <label>抽奖轮次<select value={roundId} onChange={(e) => { setRoundId(Number(e.target.value)); setStatus("ready"); setSessionFinished(false); }}>{availableRounds.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </div>
      <div className="lottery-title"><b>{currentRound.name} 幸运抽奖</b><span>实物奖品：{currentRound.prize}</span></div>
      {status === "ready" ? (
        <div className="lottery-ready"><div className="lucky-seal">福</div><h2>好运即将揭晓</h2></div>
      ) : (
        <div className={`winner-grid ${status}`}>
          {winners.map((name, index) => <div key={index}><span>{String(index + 1).padStart(2, "0")}</span><b>{name}</b></div>)}
        </div>
      )}
      <button className={`lottery-action ${status}`} onClick={handleAction} disabled={sessionFinished || (currentRound.status === "completed" && status === "ready")}>
        {sessionFinished ? "本场抽奖已完成" : currentRound.status === "completed" && status === "ready" ? "本轮已完成" : status === "ready" ? "开始抽奖" : status === "rolling" ? "停止并揭晓" : "完成本轮抽奖"}
      </button>
    </section>
  );
}

type AdminOrderStatus = "已提交" | "已撤回";
type AdminOrderVersionItem = {
  materialCode: string;
  name: string;
  spec: string;
  quantity: number;
  unitPrice: string;
  subtotal: string;
};
type AdminOrderVersion = {
  version: string;
  action: string;
  at: string;
  amount: string;
  detail: string;
  operator: string;
  items: AdminOrderVersionItem[];
};
type AdminOrderRecord = {
  no: string;
  dealer: string;
  dealerPhone: string;
  company: string;
  type: string;
  amount: string;
  boxes: number;
  tons: string;
  createdAt: string;
  submittedAt: string;
  updatedAt: string;
  withdrawnAt: string;
  withdrawReason: string;
  versions: AdminOrderVersion[];
  permission: "可修改" | "可重新提交" | "已截止";
  status: AdminOrderStatus;
};

const orderRecords: AdminOrderRecord[] = [
  { no: "ZYORDER280018", dealer: "上海爱尚真", dealerPhone: "13812348000", company: "上海分公司", type: "特渠", amount: "¥2,281.50", boxes: 13, tons: "0.012", createdAt: "07-28 14:36", submittedAt: "07-28 14:52", updatedAt: "07-28 14:52", withdrawnAt: "—", withdrawReason: "—", permission: "可修改", status: "已提交", versions: [{ version: "V1", action: "首次提交", at: "07-28 14:52", amount: "¥2,281.50", detail: "5 箱礼盒、6 箱芝麻香油、2 箱味极鲜", operator: "经销商手机端", items: [{ materialCode: "7245-0002307", name: "金芝御礼芝麻油礼盒", spec: "225mL×4 / 5盒", quantity: 5, unitPrice: "172.50", subtotal: "862.50" }, { materialCode: "7245-0000003", name: "小磨芝麻香油", spec: "221mL×20瓶", quantity: 6, unitPrice: "210.00", subtotal: "1,260.00" }, { materialCode: "7245-0000005", name: "零添加特级味极鲜", spec: "500mL×12瓶", quantity: 2, unitPrice: "78.00", subtotal: "156.00" }] }] },
  { no: "ZYORDER280017", dealer: "长沙久茂", dealerPhone: "14712341979", company: "长沙分公司", type: "综合", amount: "¥82,017.00", boxes: 286, tons: "0.244", createdAt: "07-28 14:31", submittedAt: "07-28 14:47", updatedAt: "07-28 15:02", withdrawnAt: "07-28 15:06", withdrawReason: "经销商主动撤回", permission: "可重新提交", status: "已撤回", versions: [{ version: "V1", action: "首次提交", at: "07-28 14:47", amount: "¥80,860.00", detail: "当前订单初次提交", operator: "经销商手机端", items: [{ materialCode: "7245-0002307", name: "金芝御礼芝麻油礼盒", spec: "225mL×4 / 5盒", quantity: 120, unitPrice: "250.00", subtotal: "30,000.00" }, { materialCode: "7245-0000003", name: "小磨芝麻香油", spec: "221mL×20瓶", quantity: 96, unitPrice: "300.00", subtotal: "28,800.00" }, { materialCode: "7245-0000005", name: "零添加特级味极鲜", spec: "500mL×12瓶", quantity: 70, unitPrice: "315.14", subtotal: "22,060.00" }] }, { version: "V2", action: "修改后提交", at: "07-28 15:02", amount: "¥82,017.00", detail: "调整商品数量后重新提交", operator: "经销商手机端", items: [{ materialCode: "7245-0002307", name: "金芝御礼芝麻油礼盒", spec: "225mL×4 / 5盒", quantity: 120, unitPrice: "250.00", subtotal: "30,000.00" }, { materialCode: "7245-0000003", name: "小磨芝麻香油", spec: "221mL×20瓶", quantity: 100, unitPrice: "315.00", subtotal: "31,500.00" }, { materialCode: "7245-0000005", name: "零添加特级味极鲜", spec: "500mL×12瓶", quantity: 66, unitPrice: "310.86", subtotal: "20,517.00" }] }] },
  { no: "ZYORDER280016", dealer: "青岛大优供应链", dealerPhone: "18612345036", company: "青岛分公司", type: "综合", amount: "¥65,424.00", boxes: 194, tons: "0.176", createdAt: "07-28 14:29", submittedAt: "07-28 14:43", updatedAt: "07-28 14:58", withdrawnAt: "—", withdrawReason: "—", permission: "已截止", status: "已提交", versions: [{ version: "V1", action: "首次提交", at: "07-28 14:43", amount: "¥64,850.00", detail: "当前订单初次提交", operator: "经销商手机端", items: [{ materialCode: "7455-02F003", name: "金龙鱼芝麻香油礼盒", spec: "145mL×4", quantity: 80, unitPrice: "420.00", subtotal: "33,600.00" }, { materialCode: "7217-0001957", name: "四海祯享礼盒", spec: "500mL×2+500mL+530g", quantity: 54, unitPrice: "320.00", subtotal: "17,280.00" }, { materialCode: "7455-01P702", name: "香满园芝麻油", spec: "245mL×12", quantity: 60, unitPrice: "232.83", subtotal: "13,970.00" }] }, { version: "V2", action: "修改后提交", at: "07-28 14:58", amount: "¥65,424.00", detail: "调整 2 个商品的订货箱数", operator: "经销商手机端", items: [{ materialCode: "7455-02F003", name: "金龙鱼芝麻香油礼盒", spec: "145mL×4", quantity: 80, unitPrice: "420.00", subtotal: "33,600.00" }, { materialCode: "7217-0001957", name: "四海祯享礼盒", spec: "500mL×2+500mL+530g", quantity: 56, unitPrice: "320.00", subtotal: "17,920.00" }, { materialCode: "7455-01P702", name: "香满园芝麻油", spec: "245mL×12", quantity: 58, unitPrice: "239.72", subtotal: "13,904.00" }] }] },
];

const maskPhone = (phone: string) => phone.replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2");

function OrderManagement({ activityClosed }: { activityClosed: boolean }) {
  const [orders, setOrders] = useState(orderRecords);
  const [orderFilter, setOrderFilter] = useState<"全部" | AdminOrderStatus>("全部");
  const [orderCustomerType, setOrderCustomerType] = useState<"全部" | "综合" | "特渠">("全部");
  const [orderSearch, setOrderSearch] = useState("");
  const [selectedNo, setSelectedNo] = useState<string | null>(null);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);
  const [adminWithdrawConfirm, setAdminWithdrawConfirm] = useState(false);
  const [adminWithdrawReason, setAdminWithdrawReason] = useState("");
  const selected = orders.find((order) => order.no === selectedNo) ?? null;
  const selectedPermission = selected && activityClosed ? "已截止" : selected?.permission;
  const currentVersionId = selected?.versions[selected.versions.length - 1]?.version;
  const modifiedVersion = selected?.versions.find((version) => version.action.includes("修改"));
  const operationRecords = selected ? [
    ...(selected.status === "已撤回" ? [{ time: selected.withdrawnAt, title: "撤回订单", detail: `${selected.withdrawReason} · 商品明细保留` }] : []),
    { time: selected.submittedAt, title: "已提交订单", detail: "经销商手机端提交 · 当前订单号不变" },
    ...(modifiedVersion ? [{ time: modifiedVersion.at, title: modifiedVersion.action, detail: `${modifiedVersion.detail} · 当前版本 ${modifiedVersion.version}` }] : []),
  ].sort((a, b) => b.time.localeCompare(a.time)) : [];
  const filteredOrders = orders.filter((order) => {
    const matchesFilter = orderFilter === "全部" || order.status === orderFilter;
    const matchesCustomerType = orderCustomerType === "全部" || order.type === orderCustomerType;
    const keyword = orderSearch.trim();
    const normalizedKeyword = keyword.replace(/\D/g, "");
    const matchesPhone = Boolean(keyword) && (order.dealerPhone.includes(keyword) || (normalizedKeyword.length > 0 && order.dealerPhone.includes(normalizedKeyword)));
    return matchesFilter && matchesCustomerType && (!keyword || order.dealer.includes(keyword) || matchesPhone);
  });
  const withdrawSelectedOrder = () => {
    if (!selected || activityClosed || selected.permission !== "可修改" || !adminWithdrawReason.trim()) return;
    setOrders((current) => current.map((order) => order.no === selected.no ? { ...order, status: "已撤回", permission: "可重新提交", withdrawnAt: "07-28 15:20", updatedAt: order.updatedAt, withdrawReason: adminWithdrawReason.trim() } : order));
    setAdminWithdrawConfirm(false);
    setAdminWithdrawReason("");
  };
  return (
    <div className="admin-panel">
      <div className="panel-title"><div><h2>订单管理</h2><p>点击订单行可查看商品明细、金额和操作记录</p></div><button className="admin-primary">导出订单</button></div>
      {activityClosed && <div className="activity-closed-banner"><b>活动已截止</b><span>所有订单进入只读状态，当前仅可查看商品明细和版本记录。</span></div>}
      <div className="filter-row">
        {([["全部", "全部 1,146"], ["已提交", "已提交 1,104"], ["已撤回", "已撤回 42"]] as const).map(([value, label]) => <button key={value} className={orderFilter === value ? "active" : ""} onClick={() => setOrderFilter(value)}>{label}</button>)}
        <label className="order-type-filter"><span>客户类型</span><select value={orderCustomerType} onChange={(event) => setOrderCustomerType(event.target.value as typeof orderCustomerType)}><option>全部</option><option>综合</option><option>特渠</option></select></label>
        <input placeholder="搜索经销商名称或电话" value={orderSearch} onChange={(event) => setOrderSearch(event.target.value)} />
      </div>
      <div className="data-table order-table">
        <div className="table-row table-head">{["订单编号", "经销商", "经销商电话", "类型", "金额", "创建时间", "最后修改", "状态 / 编辑权限"].map((x) => <b key={x}>{x}</b>)}</div>
        {filteredOrders.map((order) => (
          <button className="table-row clickable-row" key={order.no} onClick={() => { setSelectedNo(order.no); setExpandedVersion(null); }}>
            <span>{order.no}</span><span>{order.dealer}</span><span>{maskPhone(order.dealerPhone)}</span><span>{order.type}</span><span>{order.amount}</span><span>{order.createdAt}</span><span>{order.updatedAt}</span><span className={`status-cell ${order.status === "已撤回" ? "withdrawn" : ""}`}><b>{order.status}</b><small>{activityClosed ? "已截止" : order.permission}</small></span>
          </button>
        ))}
        {filteredOrders.length === 0 && <div className="order-empty-row">没有符合条件的订单</div>}
      </div>
      {selected && (
        <div className="order-drawer-backdrop" onClick={() => { setSelectedNo(null); setExpandedVersion(null); setAdminWithdrawConfirm(false); }}>
          <aside className="order-drawer" onClick={(e) => e.stopPropagation()}>
            <header><div><span>订单详情 · {selected.status}</span><h2>{selected.no}</h2></div><button onClick={() => { setSelectedNo(null); setExpandedVersion(null); }}>×</button></header>
            <div className="order-summary-grid">
              <p><span>经销商</span><b>{selected.dealer}</b><small>{selected.company} · {maskPhone(selected.dealerPhone)}</small></p>
              <p><span>客户类型</span><b>{selected.type}</b><small>{selected.status}</small></p>
              <p><span>订货箱数</span><b>{selected.boxes} 箱</b><small>{selected.tons} 吨</small></p>
              <p><span>订单金额</span><b className="red">{selected.amount}</b><small>含税经销价</small></p>
              <p><span>创建 / 首次提交</span><b>{selected.createdAt}</b><small>{selected.submittedAt}</small></p>
              <p><span>最后修改 / 编辑权限</span><b>{selected.updatedAt}</b><small>{selectedPermission}</small></p>
              {selected.status === "已撤回" && <p><span>撤回时间</span><b>{selected.withdrawnAt}</b><small>{selected.withdrawReason} · 明细和订单号保留</small></p>}
            </div>
            <section className="drawer-section">
              <h3>商品明细</h3>
              <div className="drawer-items">
                <div><span>7245-0002307</span><b>金芝御礼芝麻油礼盒</b><em>¥172.50 × 5 箱</em><strong>¥862.50</strong></div>
                <div><span>7245-0000003</span><b>小磨芝麻香油</b><em>¥210.00 × 6 箱</em><strong>¥1,260.00</strong></div>
                <div><span>7245-0000005</span><b>零添加特级味极鲜</b><em>¥78.00 × 2 箱</em><strong>¥156.00</strong></div>
              </div>
            </section>
            <section className="drawer-section"><h3>版本记录 <small>共 {selected.versions.length} 个版本</small></h3><div className="order-version-list">{selected.versions.map((version) => { const isCurrentVersion = version.version === currentVersionId; return <div className="order-version-record" key={`${selected.no}-${version.version}`}><div className="order-version-summary"><span>{version.version}</span><div><b>{version.action}{isCurrentVersion && <em className="version-current-badge">当前版本</em>}</b><small>{version.at} · {version.operator}</small><p>{version.detail}</p></div><strong>{version.amount}</strong>{isCurrentVersion ? <span className="version-current-note">商品明细见上方</span> : <button type="button" onClick={() => setExpandedVersion(expandedVersion === version.version ? null : version.version)}>{expandedVersion === version.version ? "收起明细" : "查看商品明细"}</button>}</div>{expandedVersion === version.version && !isCurrentVersion && <div className="order-version-detail"><div className="order-version-detail-head"><b>{version.version} 商品快照</b><span>{version.items.length} 种商品 · {version.amount}</span></div><div className="order-version-items"><div className="order-version-item-head"><span>物料代码</span><b>商品名称</b><span>规格</span><span>数量</span><span>元/箱</span><strong>小计</strong></div>{version.items.map((item) => <div key={`${version.version}-${item.materialCode}`}><span>{item.materialCode}</span><b>{item.name}</b><span>{item.spec}</span><span>{item.quantity} 箱</span><span>¥{item.unitPrice}</span><strong>¥{item.subtotal}</strong></div>)}</div></div>}</div>; })}</div></section>
            <section className="drawer-section"><h3>操作记录</h3><div className="order-timeline">{operationRecords.map((record, index) => <p key={`${record.time}-${record.title}-${index}`}><b>{record.time} {record.title}</b><span>{record.detail}</span></p>)}</div></section>
            <footer>
              {selected.status === "已提交" && selected.permission === "可修改" && !activityClosed && <button className="admin-danger-outline" onClick={() => { setAdminWithdrawReason(""); setAdminWithdrawConfirm(true); }}>撤回订单</button>}
              <button className="admin-primary" onClick={() => setSelectedNo(null)}>关闭详情</button>
            </footer>
            {adminWithdrawConfirm && <div className="drawer-confirm" role="dialog" aria-modal="true" aria-label="后台撤回订单确认"><div><h3>确认撤回订单？</h3><p>撤回后订单不会删除，商品明细和订单号会保留，并从有效订单统计中排除。</p><input value={adminWithdrawReason} onChange={(event) => setAdminWithdrawReason(event.target.value)} placeholder="请输入撤回原因（必填）" /><div><button onClick={() => setAdminWithdrawConfirm(false)}>取消</button><button className="admin-primary" disabled={!adminWithdrawReason.trim()} onClick={withdrawSelectedOrder}>确认撤回</button></div></div></div>}
          </aside>
        </div>
      )}
    </div>
  );
}

type ProductImportRow = {
  id: string;
  sequence: number;
  customerType: "特渠" | "综合";
  rebate: "参与" | "不参与";
  category: string;
  line: string;
  materialCode: string;
  materialName: string;
  brand: string;
  variety: string;
  spec: string;
  casePack: string;
  unitPrice: string;
  casePrice: string;
  conversion: string;
  gift: "是" | "否";
  status: "有效" | "待完善" | "停用";
  manuallyEdited?: boolean;
};

type WhitelistRow = {
  id: string;
  sequence: number;
  customerType: "综合客户" | "特渠专业客户";
  region: string;
  branch: string;
  dealerShort: string;
  dealerFull: string;
  dealerType: string;
  dealerName: string;
  dealerPhone: string;
  confirmerName: string;
  confirmerPhone: string;
  manuallyEdited?: boolean;
};

let localImportRowId = 0;
const createImportRowId = (prefix: string) => {
  localImportRowId += 1;
  return `${prefix}-${localImportRowId}`;
};

const initialProductImportRows: ProductImportRow[] = [
  { id: "product-1", sequence: 1, customerType: "特渠", rebate: "参与", category: "特渠定制产品", line: "调味油", materialCode: "7245-0002307", materialName: "金芝御礼225ML×4礼盒", brand: "金龙鱼", variety: "芝麻油", spec: "225mL×5", casePack: "5盒/箱", unitPrice: "34.50", casePrice: "172.50", conversion: "0.00092", gift: "是", status: "有效" },
  { id: "product-2", sequence: 1, customerType: "特渠", rebate: "不参与", category: "特渠定制品", line: "酱油", materialCode: "7217-0001957", materialName: "四海祯享礼盒", brand: "金龙鱼", variety: "礼盒", spec: "500mL×2+500mL+530g", casePack: "6盒/箱", unitPrice: "19.30", casePrice: "117.00", conversion: "", gift: "是", status: "待完善" },
  { id: "product-3", sequence: 1, customerType: "综合", rebate: "参与", category: "全渠道适用通品", line: "调味油", materialCode: "7455-02F003", materialName: "金龙鱼芝麻香油礼盒", brand: "金龙鱼", variety: "芝麻油", spec: "145mL×4", casePack: "15盒/箱", unitPrice: "28.00", casePrice: "420.00", conversion: "0.00125", gift: "是", status: "有效" },
  { id: "product-4", sequence: 1, customerType: "综合", rebate: "不参与", category: "通用品调味油", line: "调味油", materialCode: "7455-01P702", materialName: "香满园芝麻油245mL×12", brand: "香满园", variety: "芝麻油", spec: "245mL", casePack: "12瓶/箱", unitPrice: "6.90", casePrice: "82.80", conversion: "0.00270", gift: "否", status: "有效" },
];

const initialWhitelistRows: WhitelistRow[] = [
  { id: "whitelist-1", sequence: 1, customerType: "综合客户", region: "南区", branch: "长沙分", dealerShort: "长沙久茂", dealerFull: "长沙久茂食品有限公司", dealerType: "综合经销商", dealerName: "王惠", dealerPhone: "147****1979", confirmerName: "张学文", confirmerPhone: "139****6386" },
  { id: "whitelist-2", sequence: 2, customerType: "综合客户", region: "南区", branch: "长沙分", dealerShort: "湘潭餐乐", dealerFull: "湘潭餐乐商贸有限公司", dealerType: "综合经销商", dealerName: "刘宇剑", dealerPhone: "137****0822", confirmerName: "张学文", confirmerPhone: "139****6386" },
  { id: "whitelist-3", sequence: 1, customerType: "特渠专业客户", region: "南区", branch: "长沙分", dealerShort: "深圳市智臻云采", dealerFull: "深圳市智臻云采科技有限公司", dealerType: "特渠专业经销商", dealerName: "王凡", dealerPhone: "188****4733", confirmerName: "官国梁", confirmerPhone: "159****6519" },
  { id: "whitelist-4", sequence: 2, customerType: "特渠专业客户", region: "南区", branch: "厦门分", dealerShort: "泉州乐食光", dealerFull: "泉州乐食光商贸有限公司", dealerType: "特渠专业经销商", dealerName: "郑总", dealerPhone: "152****7241", confirmerName: "窦任重", confirmerPhone: "186****2331" },
];

function ProductImportTable({ rows, onEdit }: { rows: ProductImportRow[]; onEdit: (row: ProductImportRow) => void }) {
  const [customerType, setCustomerType] = useState("全部");
  const [rebate, setRebate] = useState("全部");
  const heads = ["序号", "客户类型", "是否返利", "产品大类", "产品线", "物料代码", "物料名称", "品牌", "品种", "规格", "箱规", "元/瓶", "元/箱", "吨箱转换系数", "是否礼盒", "状态", "操作"];
  const visibleRows = rows.filter((row) => (customerType === "全部" || row.customerType === customerType) && (rebate === "全部" || row.rebate === rebate));
  return (
    <>
      <div className="data-filters">
        <label><span>客户类型</span><select value={customerType} onChange={(e) => setCustomerType(e.target.value)}><option>全部</option><option>特渠</option><option>综合</option></select></label>
        <label><span>是否参与返利</span><select value={rebate} onChange={(e) => setRebate(e.target.value)}><option>全部</option><option>参与</option><option>不参与</option></select></label>
        <small>当前显示 {visibleRows.length} 条商品</small>
      </div>
      <div className="table-scroll">
        <div className="data-table product-import-table">
          <div className="table-row table-head">{heads.map((x) => <b key={x}>{x}</b>)}</div>
          {visibleRows.map((row) => {
            const values = [row.sequence, row.customerType, row.rebate, row.category, row.line, row.materialCode, row.materialName, row.brand, row.variety, row.spec, row.casePack, row.unitPrice, row.casePrice, row.conversion, row.gift, row.status];
            return <div className={`table-row ${row.manuallyEdited ? "manually-edited-row" : ""}`} key={row.id}>{values.map((value, index) => <span key={index} className={index === 15 ? `status-cell ${row.status === "待完善" ? "pending" : ""}` : ""}>{value || "—"}</span>)}<span className="table-row-actions"><button type="button" onClick={() => onEdit(row)}>编辑</button>{row.manuallyEdited && <small>已修正</small>}</span></div>;
          })}
        </div>
      </div>
    </>
  );
}

function CustomerWhitelistTable({ rows, onEdit }: { rows: WhitelistRow[]; onEdit: (row: WhitelistRow) => void }) {
  const [customerType, setCustomerType] = useState("全部");
  const heads = ["序号", "客户类型", "大区", "分公司名称", "经销商名称（简）", "经销商名称（全）", "经销商类型", "经销商姓名", "经销商电话", "分公司确认人姓名", "分公司确认人电话", "操作"];
  const visibleRows = rows.filter((row) => customerType === "全部" || row.customerType === customerType);
  return (
    <>
      <div className="data-filters">
        <label><span>客户类型</span><select value={customerType} onChange={(e) => setCustomerType(e.target.value)}><option>全部</option><option>综合客户</option><option>特渠专业客户</option></select></label>
        <small>当前显示 {visibleRows.length} 名客户</small>
      </div>
      <div className="table-scroll">
        <div className="data-table whitelist-table">
          <div className="table-row table-head">{heads.map((x) => <b key={x}>{x}</b>)}</div>
          {visibleRows.map((row) => {
            const values = [row.sequence, row.customerType, row.region, row.branch, row.dealerShort, row.dealerFull, row.dealerType, row.dealerName, row.dealerPhone, row.confirmerName, row.confirmerPhone];
            return <div className={`table-row ${row.manuallyEdited ? "manually-edited-row" : ""}`} key={row.id}>{values.map((value, index) => <span key={index}>{value}</span>)}<span className="table-row-actions"><button type="button" onClick={() => onEdit(row)}>编辑</button>{row.manuallyEdited && <small>已修正</small>}</span></div>;
          })}
        </div>
      </div>
    </>
  );
}

function ProductFormDrawer({ rows, initialRow, onClose, onSave }: { rows: ProductImportRow[]; initialRow?: ProductImportRow; onClose: () => void; onSave: (row: ProductImportRow) => void }) {
  const isEditing = Boolean(initialRow);
  const [form, setForm] = useState<ProductImportRow>(() => initialRow ? { ...initialRow } : { id: createImportRowId("product"), sequence: 0, customerType: "特渠", rebate: "参与", category: "", line: "", materialCode: "", materialName: "", brand: "", variety: "", spec: "", casePack: "", unitPrice: "", casePrice: "", conversion: "", gift: "否", status: "有效" });
  useEffect(() => {
    if (initialRow) setForm({ ...initialRow });
  }, [initialRow]);
  const update = (field: keyof ProductImportRow, value: string | number) => setForm((current) => ({ ...current, [field]: value }));
  const nextSequence = isEditing ? form.sequence : Math.max(0, ...rows.filter((row) => row.customerType === form.customerType && row.rebate === form.rebate).map((row) => row.sequence)) + 1;
  const duplicateMaterialCode = form.materialCode.trim() !== "" && rows.some((row) => row.id !== form.id && row.materialCode.trim().toLowerCase() === form.materialCode.trim().toLowerCase());
  const canSave = form.materialCode.trim() !== "" && form.materialName.trim() !== "" && form.casePrice.trim() !== "" && !duplicateMaterialCode;
  return (
    <div className="order-drawer-backdrop" onClick={onClose}>
      <aside className="order-drawer form-drawer" onClick={(event) => event.stopPropagation()}>
        <header><div><span>活动商品</span><h2>{isEditing ? "编辑商品" : "手动添加商品"}</h2></div><button aria-label="关闭" onClick={onClose}>×</button></header>
        <div className="auto-sequence-note"><span>{isEditing ? "当前商品" : "序号自动生成"}</span><b>{isEditing ? `原序号：${form.sequence}` : `保存后编号：${nextSequence}`}</b><small>{form.customerType} · {form.rebate}返利分组</small></div>
        <div className="drawer-form-body"><div className="drawer-form-grid">
          <label><span>客户类型</span><select value={form.customerType} onChange={(e) => update("customerType", e.target.value)}><option>特渠</option><option>综合</option></select></label>
          <label><span>是否参与返利</span><select value={form.rebate} onChange={(e) => update("rebate", e.target.value)}><option>参与</option><option>不参与</option></select></label>
          <label><span>产品大类</span><input value={form.category} onChange={(e) => update("category", e.target.value)} placeholder="例如：特渠定制产品" /></label>
          <label><span>产品线</span><input value={form.line} onChange={(e) => update("line", e.target.value)} placeholder="例如：调味油" /></label>
          <label><span>物料代码 *</span><input value={form.materialCode} onChange={(e) => update("materialCode", e.target.value)} /><small className={duplicateMaterialCode ? "field-error" : ""}>{duplicateMaterialCode ? "物料代码已存在，请检查解析结果" : "用于匹配同一商品"}</small></label>
          <label className="wide-field"><span>物料名称 *</span><input value={form.materialName} onChange={(e) => update("materialName", e.target.value)} /></label>
          <label><span>品牌</span><input value={form.brand} onChange={(e) => update("brand", e.target.value)} /></label>
          <label><span>品种</span><input value={form.variety} onChange={(e) => update("variety", e.target.value)} /></label>
          <label><span>规格</span><input value={form.spec} onChange={(e) => update("spec", e.target.value)} /></label>
          <label><span>箱规</span><input value={form.casePack} onChange={(e) => update("casePack", e.target.value)} /></label>
          <label><span>元/瓶</span><input inputMode="decimal" value={form.unitPrice} onChange={(e) => update("unitPrice", e.target.value)} /></label>
          <label><span>元/箱 *</span><input inputMode="decimal" value={form.casePrice} onChange={(e) => update("casePrice", e.target.value)} /></label>
          <label><span>吨箱转换系数</span><input inputMode="decimal" value={form.conversion} onChange={(e) => update("conversion", e.target.value)} /></label>
          <label><span>是否礼盒</span><select value={form.gift} onChange={(e) => update("gift", e.target.value)}><option>否</option><option>是</option></select></label>
          <label><span>状态</span><select value={form.status} onChange={(e) => update("status", e.target.value)}><option>有效</option><option>待完善</option><option>停用</option></select></label>
        </div>
        <p className="drawer-form-note">带 * 的字段为必填项；{isEditing ? "保存后会覆盖当前解析行，并标记为人工修正。" : "此处为前端原型，保存结果仅在当前页面有效。"}</p></div>
        <footer><button onClick={onClose}>取消</button><button className="admin-primary" disabled={!canSave} onClick={() => { onSave({ ...form, sequence: nextSequence, manuallyEdited: isEditing || form.manuallyEdited }); onClose(); }}>{isEditing ? "保存修改" : "保存商品"}</button></footer>
      </aside>
    </div>
  );
}

function WhitelistFormDrawer({ rows, initialRow, onClose, onSave }: { rows: WhitelistRow[]; initialRow?: WhitelistRow; onClose: () => void; onSave: (row: WhitelistRow) => void }) {
  const isEditing = Boolean(initialRow);
  const [form, setForm] = useState<WhitelistRow>(() => initialRow ? { ...initialRow } : { id: createImportRowId("whitelist"), sequence: 0, customerType: "综合客户", region: "", branch: "", dealerShort: "", dealerFull: "", dealerType: "综合经销商", dealerName: "", dealerPhone: "", confirmerName: "", confirmerPhone: "" });
  useEffect(() => {
    if (initialRow) setForm({ ...initialRow });
  }, [initialRow]);
  const update = (field: keyof WhitelistRow, value: string | number) => setForm((current) => ({ ...current, [field]: value }));
  const nextSequence = isEditing ? form.sequence : Math.max(0, ...rows.filter((row) => row.customerType === form.customerType).map((row) => row.sequence)) + 1;
  const phoneValid = /^1\d{10}$/.test(form.dealerPhone) || /^\d{3}\*{4}\d{4}$/.test(form.dealerPhone);
  const duplicateDealerPhone = form.dealerPhone.trim() !== "" && rows.some((row) => row.id !== form.id && row.dealerPhone === form.dealerPhone);
  const canSave = form.region.trim() !== "" && form.branch.trim() !== "" && form.dealerShort.trim() !== "" && form.dealerFull.trim() !== "" && phoneValid && !duplicateDealerPhone;
  return (
    <div className="order-drawer-backdrop" onClick={onClose}>
      <aside className="order-drawer form-drawer" onClick={(event) => event.stopPropagation()}>
        <header><div><span>客户身份</span><h2>{isEditing ? "编辑白名单" : "手动添加白名单"}</h2></div><button aria-label="关闭" onClick={onClose}>×</button></header>
        <div className="auto-sequence-note"><span>{isEditing ? "当前客户" : "序号自动生成"}</span><b>{isEditing ? `原序号：${form.sequence}` : `保存后编号：${nextSequence}`}</b><small>{form.customerType}分组</small></div>
        <div className="drawer-form-body"><div className="drawer-form-grid">
          <label><span>客户类型</span><select value={form.customerType} onChange={(e) => { const type = e.target.value as WhitelistRow["customerType"]; setForm((current) => ({ ...current, customerType: type, dealerType: type === "综合客户" ? "综合经销商" : "特渠专业经销商" })); }}><option>综合客户</option><option>特渠专业客户</option></select></label>
          <label><span>大区 *</span><select value={form.region} onChange={(e) => update("region", e.target.value)}><option value="">请选择</option><option>东区</option><option>南区</option><option>北区</option><option>西区</option></select></label>
          <label><span>分公司名称 *</span><input value={form.branch} onChange={(e) => update("branch", e.target.value)} placeholder="例如：长沙分" /></label>
          <label><span>经销商名称（简）*</span><input value={form.dealerShort} onChange={(e) => update("dealerShort", e.target.value)} /><small>{form.dealerShort.length}/10 字</small></label>
          <label className="wide-field"><span>经销商名称（全）*</span><input value={form.dealerFull} onChange={(e) => update("dealerFull", e.target.value)} /></label>
          <label><span>经销商类型</span><input value={form.dealerType} onChange={(e) => update("dealerType", e.target.value)} /></label>
          <label><span>经销商姓名</span><input value={form.dealerName} onChange={(e) => update("dealerName", e.target.value)} /></label>
          <label><span>经销商电话 *</span><input inputMode="tel" maxLength={11} value={form.dealerPhone} onChange={(e) => update("dealerPhone", e.target.value.replace(/\D/g, ""))} placeholder="11 位手机号" /><small className={duplicateDealerPhone || (form.dealerPhone !== "" && !phoneValid) ? "field-error" : ""}>{duplicateDealerPhone ? "手机号已存在，请检查解析结果" : form.dealerPhone && !phoneValid ? "请输入正确的 11 位手机号" : "用于 H5 身份验证；已脱敏号码可直接覆盖"}</small></label>
          <label><span>分公司确认人姓名</span><input value={form.confirmerName} onChange={(e) => update("confirmerName", e.target.value)} /></label>
          <label><span>分公司确认人电话</span><input inputMode="tel" maxLength={11} value={form.confirmerPhone} onChange={(e) => update("confirmerPhone", e.target.value.replace(/\D/g, ""))} /></label>
        </div>
        <p className="drawer-form-note">客户类型在 Excel 导入时由 Sheet 自动确定；{isEditing ? "保存后会覆盖当前解析行，并标记为人工修正。" : "手动添加时由管理员选择。"}</p></div>
        <footer><button onClick={onClose}>取消</button><button className="admin-primary" disabled={!canSave} onClick={() => { onSave({ ...form, sequence: nextSequence, manuallyEdited: isEditing || form.manuallyEdited }); onClose(); }}>{isEditing ? "保存修改" : "保存白名单"}</button></footer>
      </aside>
    </div>
  );
}

function LotterySettings({ rounds, onChange }: { rounds: LotteryRound[]; onChange: (rounds: LotteryRound[]) => void }) {
  const [selectedId, setSelectedId] = useState(rounds.find((item) => item.status === "published")?.id ?? rounds[0].id);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [attendanceImported, setAttendanceImported] = useState(false);
  const selected = rounds.find((item) => item.id === selectedId) ?? rounds[0];
  const statusLabel = { draft: "草稿", published: "已发布", completed: "已完成" } as const;
  const scopeOptions: { key: CandidateScope; title: string; detail: string }[] = [
    { key: "all", title: "所有活动客户", detail: "当前活动有效白名单" },
    { key: "attended", title: "现场到场客户", detail: "按签到或导入结果筛选" },
    { key: "ordered", title: "有效下单客户", detail: "当前已提交订单" },
  ];
  const updateSelected = (patch: Partial<LotteryRound>) => onChange(rounds.map((item) => item.id === selected.id ? { ...item, ...patch } : item));
  const addRound = () => {
    const id = Math.max(...rounds.map((item) => item.id)) + 1;
    const next: LotteryRound = { id, name: `第${rounds.length + 1}轮`, prize: "待配置奖品", winnerCount: 10, customerType: "全部客户", scope: "all", minAmount: 0, cutoff: "2030-07-30T18:00", excludeWinners: true, status: "draft", candidateCount: 1665 };
    onChange([...rounds, next]);
    setSelectedId(id);
  };
  const duplicateRound = () => {
    const id = Math.max(...rounds.map((item) => item.id)) + 1;
    onChange([...rounds, { ...selected, id, name: `${selected.name}副本`, status: "draft" }]);
    setSelectedId(id);
  };
  const removeRound = () => {
    if (selected.status !== "draft" || rounds.length === 1) return;
    const rest = rounds.filter((item) => item.id !== selected.id);
    onChange(rest);
    setSelectedId(rest[0].id);
  };
  const ruleSummary = `${selected.customerType} · ${selected.scope === "all" ? "活动白名单" : selected.scope === "attended" ? "现场已到场" : "有效下单"}${selected.scope === "ordered" && selected.minAmount > 0 ? ` · 订单满 ¥${selected.minAmount.toLocaleString()}` : ""} · ${selected.excludeWinners ? "排除已中奖" : "允许重复中奖"}`;
  const candidateSteps: [string, number][] = selected.scope === "all"
    ? [["活动白名单", 1680], ["客户类型匹配", selected.customerType === "全部客户" ? 1680 : 1073], ["排除已中奖", selected.candidateCount]]
    : selected.scope === "attended"
      ? [["活动白名单", 1680], ["客户类型匹配", selected.customerType === "全部客户" ? 1680 : 607], ["现场到场匹配", selected.candidateCount + 15], ["排除已中奖", selected.candidateCount]]
      : [["活动白名单", 1680], ["客户类型匹配", selected.customerType === "全部客户" ? 1680 : 1073], ["有效订单匹配", selected.minAmount > 0 ? 612 : selected.candidateCount + 15], ...(selected.minAmount > 0 ? [["金额门槛匹配", selected.candidateCount + 15] as [string, number]] : []), ["排除已中奖", selected.candidateCount]];
  const candidateMeta = selected.scope === "all" ? "白名单有效" : selected.scope === "attended" ? "现场已到场" : "有效订单";
  return (
    <div className="admin-panel lottery-settings">
      <div className="panel-title"><div><h2>抽奖规则工作台</h2><p>配置轮次、候选资格与现场执行顺序；已完成轮次自动锁定</p></div><div className="panel-actions"><button className="secondary-button" onClick={() => setAttendanceImported(true)}>导入到场名单</button><button className="admin-primary" onClick={() => updateSelected({ status: "published" })}>保存并发布</button></div></div>
      <div className="lottery-overview">
        <article><span>抽奖轮次</span><strong>{rounds.length}</strong><small>{rounds.filter((x) => x.status === "completed").length} 轮已完成</small></article>
        <article><span>活动客户</span><strong>1,680</strong><small>白名单有效客户</small></article>
        <article><span>现场到场</span><strong>{attendanceImported ? "1,246" : "1,204"}</strong><small>{attendanceImported ? "刚刚更新 · 匹配成功" : "最后更新 15:42"}</small></article>
        <article><span>已中奖客户</span><strong>15</strong><small>全场默认不重复</small></article>
      </div>
      {attendanceImported && <div className="import-toast"><b>✓ 到场名单导入完成</b><span>读取 1,268 条，成功匹配 1,246 条，22 条待人工确认。</span><button onClick={() => setAttendanceImported(false)}>×</button></div>}
      <div className="lottery-config-grid">
        <section className="round-list"><div className="section-heading"><h3>抽奖轮次</h3><span>按顺序执行</span></div>{rounds.map((item) => <button key={item.id} className={selected.id === item.id ? "active" : ""} onClick={() => setSelectedId(item.id)}><i>{String(item.id).padStart(2, "0")}</i><span><b>{item.name}</b><small>{item.prize}</small></span><em><small className={`round-status ${item.status}`}>{statusLabel[item.status]}</small>{item.winnerCount} 人</em></button>)}<button className="add-round" onClick={addRound}>＋ 新增抽奖轮次</button></section>
        <section className="round-form">
          <div className="round-form-heading"><div><h3>{selected.name}</h3><span className={`round-status ${selected.status}`}>{statusLabel[selected.status]}</span></div><div><button onClick={duplicateRound}>复制</button><button onClick={removeRound} disabled={selected.status !== "draft"}>删除</button></div></div>
          <label><span>轮次名称</span><input value={selected.name} disabled={selected.status === "completed"} onChange={(e) => updateSelected({ name: e.target.value })} /></label>
          <label><span>奖品名称</span><input value={selected.prize} disabled={selected.status === "completed"} onChange={(e) => updateSelected({ prize: e.target.value })} /></label>
          <label><span>中奖人数</span><input type="number" min="1" value={selected.winnerCount} disabled={selected.status === "completed"} onChange={(e) => updateSelected({ winnerCount: Number(e.target.value) })} /></label>
          <label><span>客户类型</span><select value={selected.customerType} disabled={selected.status === "completed"} onChange={(e) => updateSelected({ customerType: e.target.value as LotteryRound["customerType"] })}>{["全部客户", "特渠专业客户", "综合客户"].map((x) => <option key={x}>{x}</option>)}</select></label>
          <fieldset className="candidate-scope"><legend>候选客户范围</legend>{scopeOptions.map((option) => <button type="button" key={option.key} className={selected.scope === option.key ? "active" : ""} disabled={selected.status === "completed"} onClick={() => updateSelected({ scope: option.key, minAmount: option.key === "ordered" ? selected.minAmount : 0, candidateCount: option.key === "all" ? 1665 : option.key === "attended" ? 592 : 518 })}><i>{selected.scope === option.key ? "✓" : ""}</i><span><b>{option.title}</b><small>{option.detail}</small></span></button>)}</fieldset>
          {selected.scope === "ordered" && <label><span>最低订单金额</span><div className="amount-input"><b>¥</b><input type="number" min="0" value={selected.minAmount} disabled={selected.status === "completed"} onChange={(e) => updateSelected({ minAmount: Number(e.target.value), candidateCount: Number(e.target.value) > 0 ? 418 : 518 })} /></div><small className="field-help">填写 0 表示不限制订单金额</small></label>}
          <label className={selected.scope === "ordered" ? "" : "wide-field"}><span>资格截止时间</span><input type="datetime-local" value={selected.cutoff} disabled={selected.status === "completed"} onChange={(e) => updateSelected({ cutoff: e.target.value })} /></label>
          <label className="check-setting repeat-setting"><input type="checkbox" checked={selected.excludeWinners} disabled={selected.status === "completed"} onChange={(e) => updateSelected({ excludeWinners: e.target.checked })} /><span><b>排除本活动已中奖客户</b><small>避免客户跨轮次重复中奖</small></span></label>
          <div className="rule-summary"><span>当前规则</span><p>{ruleSummary}</p></div>
          <div className="candidate-preview"><div><span>预计候选池</span><strong>{selected.candidateCount}<small> 人</small></strong><p>白名单 1,680 · 条件排除 {1680 - selected.candidateCount} · 已中奖排除 15</p></div><button onClick={() => setPreviewOpen(true)}>查看候选名单</button></div>
        </section>
      </div>
      {previewOpen && <div className="order-drawer-backdrop" onClick={() => setPreviewOpen(false)}><aside className="order-drawer candidate-drawer" onClick={(e) => e.stopPropagation()}><header><div><span>候选池预览</span><h2>{selected.name} · {selected.candidateCount} 人</h2></div><button onClick={() => setPreviewOpen(false)}>×</button></header><div className="candidate-funnel">{candidateSteps.map(([label, count]) => <div key={label}><span>{label}</span><b>{count}</b></div>)}</div><div className="candidate-table">{dealerNames.slice(0, 12).map((name, index) => <div key={name}><span>{String(index + 1).padStart(3, "0")}</span><b>{name}</b><em>{index % 3 === 0 ? "特渠" : "综合"}</em><small>{candidateMeta}{selected.scope === "ordered" ? ` · ¥${(8200 + index * 1680).toLocaleString()}` : ""}</small></div>)}</div><footer><button>导出候选名单</button><button className="admin-primary" onClick={() => setPreviewOpen(false)}>确认候选池</button></footer></aside></div>}
    </div>
  );
}

function AdminPrototype({ lotteryRounds, onLotteryChange, activityClosed, onActivityStatusChange }: { lotteryRounds: LotteryRound[]; onLotteryChange: (rounds: LotteryRound[]) => void; activityClosed: boolean; onActivityStatusChange: (closed: boolean) => void }) {
  const [tab, setTab] = useState("活动概览");
  const [productRows, setProductRows] = useState<ProductImportRow[]>(initialProductImportRows);
  const [whitelistRows, setWhitelistRows] = useState<WhitelistRow[]>(initialWhitelistRows);
  const [productImportCompleted, setProductImportCompleted] = useState(false);
  const [whitelistImportCompleted, setWhitelistImportCompleted] = useState(false);
  const [productFormOpen, setProductFormOpen] = useState(false);
  const [whitelistFormOpen, setWhitelistFormOpen] = useState(false);
  const [editingProductRow, setEditingProductRow] = useState<ProductImportRow | null>(null);
  const [editingWhitelistRow, setEditingWhitelistRow] = useState<WhitelistRow | null>(null);
  const [actionNotice, setActionNotice] = useState("");
  const [productFiles, setProductFiles] = useState({
    special: "【特渠】商品明细表（示例）.xlsx",
    general: "【分公司综合经销商】商品明细表（示例）.xlsx",
  });
  const [whitelistFile, setWhitelistFile] = useState("【白名单】经销商白名单（示例）.xlsx");
  const nav = ["活动概览", "商品导入", "白名单", "订单管理", "抽奖规则"];
  const parsedProductCount = (productFiles.special ? 50 : 0) + (productFiles.general ? 192 : 0);
  const parsedProductFileCount = (productFiles.special ? 1 : 0) + (productFiles.general ? 1 : 0);
  const productUpdatedCount = Math.min(4, parsedProductCount);
  const productNewCount = Math.max(0, parsedProductCount - productUpdatedCount);
  const productRetiredCount = parsedProductCount > 0 ? (parsedProductCount === 242 ? 42 : Math.max(1, Math.round(parsedProductCount * 0.1))) : 0;
  return (
    <section className="admin-app">
      <aside className="admin-sidebar">
        <div className="admin-logo"><span>金</span><b>订购会管理平台</b></div>
        <nav>{nav.map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}><i>{item.slice(0, 1)}</i>{item}</button>)}</nav>
        <div className="admin-user"><span>陈</span><p><b>运营管理员</b><small>调味品事业部</small></p></div>
      </aside>
      <main className="admin-main">
        <header><div><span>通用订货会</span><b>{tab}</b></div><div className="admin-actions"><button>操作日志</button><span className={activityClosed ? "closed" : ""}>{activityClosed ? "已截止" : "进行中"}</span></div></header>
        {tab === "活动概览" && (
          <>
            <div className="admin-stats">
              {[["订单总金额", "¥19,457,005.28", "+12.8%"], ["已提交客户", "1,146", "68.2%"], ["订货总箱数", "38,620", "+2,841"], ["订货总吨数", "1,316.0", "+98.2"]].map((item) => <article key={item[0]}><span>{item[0]}</span><strong>{item[1]}</strong><small>{item[2]} 较1小时前</small></article>)}
            </div>
            <div className="admin-grid">
              <article className="progress-card"><h2>客户提交进度</h2>{[["综合客户", 1073, 826], ["特渠专业客户", 607, 320]].map((x) => <div key={x[0] as string}><p><b>{x[0]}</b><span>{x[2]} / {x[1]}</span></p><i><em style={{ width: `${Number(x[2]) / Number(x[1]) * 100}%` }} /></i></div>)}</article>
              <article className="activity-card"><h2>活动信息</h2><p><span>活动状态</span><b className={activityClosed ? "closed-text" : "green"}>{activityClosed ? "已截止" : "进行中"}</b></p><p><span>订货开始</span><b>07-28 14:30</b></p><p><span>订货截止</span><b>07-30 18:30</b></p><button onClick={() => onActivityStatusChange(!activityClosed)}>{activityClosed ? "恢复进行中" : "模拟活动截止"}</button></article>
            </div>
          </>
        )}
        {tab === "商品导入" && (
          <div className="admin-panel">
            <div className="panel-title"><div><h2>{productImportCompleted ? "当前活动商品" : "活动商品导入"}</h2><p>{productImportCompleted ? "商品已进入当前活动，可继续导入文件或手动添加" : "解析特渠、综合客户商品文件，确认后进入当前活动商品"}</p></div><div className="panel-actions"><button className="secondary-button" onClick={() => setProductFormOpen(true)}>＋ 手动添加商品</button>{productImportCompleted && <button className="admin-primary" onClick={() => { setProductImportCompleted(false); setProductFiles({ special: "", general: "" }); }}>继续导入 Excel</button>}</div></div>
            {!productImportCompleted && <div className="import-rule-hint"><b>Excel 覆盖规则</b><span>本次上传文件会覆盖对应客户类型的上一次 Excel 导入结果；相同商品自动更新，旧 Excel 中不再存在的商品将停用，手动添加的数据保留。</span></div>}
            {!productImportCompleted && <div className="dual-upload-grid">
              {([
                ["special", "特渠商品文件", "特渠", "50", productFiles.special],
                ["general", "综合商品文件", "综合", "192", productFiles.general],
              ] as const).map(([key, title, type, count, fileName]) => (
                <article className={`file-upload-card ${fileName ? "ready" : ""}`} key={key}>
                  <div className="file-card-heading"><span>XL</span><div><b>{title}</b><small>文件客户类型：{type}</small></div><em>{fileName ? "解析完成" : "待上传"}</em></div>
                  {fileName ? <p title={fileName}>{fileName}</p> : <p>请选择对应的商品明细 Excel</p>}
                  <div className="sheet-tags"><span>参与订货会返利产品</span><span>不参与订货会返利产品</span></div>
                  <footer><small>{fileName ? `识别 ${count} 条商品` : "仅识别上述两个 Sheet"}</small><div>{fileName && <button onClick={() => setProductFiles((current) => ({ ...current, [key]: "" }))}>移除</button>}<label><input type="file" accept=".xlsx,.xls" onChange={(event) => { const file = event.target.files?.[0]; if (file) { setProductFiles((current) => ({ ...current, [key]: file.name })); setProductImportCompleted(false); } }} />{fileName ? "替换文件" : "选择文件"}</label></div></footer>
                </article>
              ))}
            </div>}
            {!productImportCompleted && (productFiles.special || productFiles.general) && <div className="import-result"><div className="import-summary"><span className="success-icon">✓</span><p><b>{parsedProductFileCount} 个文件解析完成 · 等待确认</b><small>客户类型由文件确定，返利状态由 Sheet 自动确定</small></p><strong>{parsedProductCount} 条商品</strong></div><div className="warning-box"><b>确认后将覆盖对应客户类型的上次 Excel 导入结果</b><span>预计新增 {productNewCount} 条、更新 {productUpdatedCount} 条、停用旧数据 {productRetiredCount} 条；手动添加的数据保留。缺少吨箱转换系数等信息的商品标记为“待完善”。表格中的解析结果可先编辑修正。</span></div><ProductImportTable rows={productRows} onEdit={setEditingProductRow} /><button className="admin-primary wide" onClick={() => { setProductImportCompleted(true); setActionNotice("商品导入完成，已覆盖对应 Excel 数据；手动添加的数据已保留。当前原型不会写入后端。"); }}>确认导入 {parsedProductCount} 条商品</button></div>}
            {productImportCompleted && <><div className="import-completed-banner"><span className="success-icon">✓</span><p><b>本次商品导入完成</b><small>对应客户类型的上次 Excel 数据已覆盖；手动添加的数据保留，7 条信息不完整的商品待完善。</small></p><div><strong>{parsedProductCount}</strong><small>本次导入</small></div><div><strong>{productNewCount}</strong><small>新增</small></div><div><strong>{productUpdatedCount}</strong><small>更新</small></div><div><strong>{productRetiredCount}</strong><small>停用旧数据</small></div></div><div className="data-section-title"><div><b>当前活动商品</b><span>最近导入：特渠 50 条 · 综合 192 条 · 手动添加数据已保留</span></div><button onClick={() => setProductImportCompleted(false)}>查看本次导入结果</button></div><ProductImportTable rows={productRows} onEdit={setEditingProductRow} /></>}
          </div>
        )}
        {tab === "白名单" && (
          <div className="admin-panel">
            <div className="panel-title"><div><h2>{whitelistImportCompleted ? "当前客户白名单" : "客户白名单导入"}</h2><p>共 1,680 名有效客户 · 手机号用于 H5 身份验证</p></div><div className="panel-actions"><button className="secondary-button" onClick={() => setWhitelistFormOpen(true)}>＋ 手动添加白名单</button>{whitelistImportCompleted ? <button className="admin-primary" onClick={() => { setWhitelistImportCompleted(false); setWhitelistFile(""); }}>继续导入 Excel</button> : <label className="admin-primary file-button"><input type="file" accept=".xlsx,.xls" onChange={(event) => { const file = event.target.files?.[0]; if (file) { setWhitelistFile(file.name); setWhitelistImportCompleted(false); } }} />导入白名单</label>}</div></div>
            {!whitelistImportCompleted && <div className="import-rule-hint"><b>Excel 覆盖规则</b><span>本次上传会覆盖综合客户白名单和特渠客户白名单的上一次 Excel 导入结果；相同手机号自动更新，旧名单中不再存在的客户将停用，手动添加的数据保留。</span></div>}
            {!whitelistImportCompleted && whitelistFile && <><div className="whitelist-file-summary"><span className="success-icon">✓</span><p><b>{whitelistFile}</b><small>只读取“综合客户白名单”和“特渠客户白名单”，其他 Sheet 自动忽略</small></p><div className="sheet-tags"><span>综合客户白名单</span><span>特渠客户白名单</span></div></div><div className="warning-box"><b>确认后将覆盖上次 Excel 白名单</b><span>预计新增 1,676 条、更新 4 条、停用旧数据 9 条；手动添加的数据保留。另有 9 个手机号格式异常，请在活动发布前处理。表格中的解析结果可先编辑修正。</span></div><CustomerWhitelistTable rows={whitelistRows} onEdit={setEditingWhitelistRow} /><button className="admin-primary wide" onClick={() => { setWhitelistImportCompleted(true); setActionNotice("白名单导入完成，已覆盖 Excel 数据；手动添加的数据已保留。当前原型不会写入后端。"); }}>确认导入 1,689 条白名单</button></>}
            {!whitelistImportCompleted && !whitelistFile && <div className="upload-zone compact-upload"><span>XL</span><h3>选择白名单 Excel</h3><p>仅解析“综合客户白名单”和“特渠客户白名单”两个 Sheet</p><label className="secondary-button file-button"><input type="file" accept=".xlsx,.xls" onChange={(event) => { const file = event.target.files?.[0]; if (file) setWhitelistFile(file.name); }} />选择 Excel 文件</label></div>}
            {whitelistImportCompleted && <><div className="import-completed-banner"><span className="success-icon">✓</span><p><b>本次白名单导入完成</b><small>两个白名单 Sheet 已覆盖上次 Excel 数据；手动添加的数据保留，9 条手机号异常数据待处理。</small></p><div><strong>1,689</strong><small>本次导入</small></div><div><strong>1,676</strong><small>新增</small></div><div><strong>4</strong><small>更新</small></div><div><strong>9</strong><small>停用/待处理</small></div></div><div className="data-section-title"><div><b>当前客户白名单</b><span>综合客户 1,073 名 · 特渠专业客户 607 名 · 手动添加数据已保留</span></div><button onClick={() => setWhitelistImportCompleted(false)}>查看本次导入结果</button></div><CustomerWhitelistTable rows={whitelistRows} onEdit={setEditingWhitelistRow} /></>}
          </div>
        )}
        {tab === "订单管理" && <OrderManagement activityClosed={activityClosed} />}
        {tab === "抽奖规则" && <LotterySettings rounds={lotteryRounds} onChange={onLotteryChange} />}
      </main>
      {(productFormOpen || editingProductRow) && <ProductFormDrawer rows={productRows} initialRow={editingProductRow ?? undefined} onClose={() => { setProductFormOpen(false); setEditingProductRow(null); }} onSave={(row) => { if (editingProductRow) { setProductRows((current) => current.map((item) => item.id === row.id ? row : item)); setActionNotice(`已保存商品修改：${row.materialName}`); } else { setProductRows((current) => [...current, row]); setActionNotice(`已自动编号 ${row.sequence}，并添加商品：${row.materialName}`); } }} />}
      {(whitelistFormOpen || editingWhitelistRow) && <WhitelistFormDrawer rows={whitelistRows} initialRow={editingWhitelistRow ?? undefined} onClose={() => { setWhitelistFormOpen(false); setEditingWhitelistRow(null); }} onSave={(row) => { if (editingWhitelistRow) { setWhitelistRows((current) => current.map((item) => item.id === row.id ? row : item)); setActionNotice(`已保存白名单修改：${row.dealerShort}`); } else { setWhitelistRows((current) => [...current, row]); setActionNotice(`已自动编号 ${row.sequence}，并添加白名单：${row.dealerShort}`); } }} />}
      {actionNotice && <div className="admin-toast" role="status"><span>✓</span>{actionNotice}<button aria-label="关闭提示" onClick={() => setActionNotice("")}>×</button></div>}
    </section>
  );
}

export function Prototype() {
  const [surface, setSurface] = useState<Surface>("h5");
  const [lotteryRounds, setLotteryRounds] = useState<LotteryRound[]>(initialLotteryRounds);
  const [activityClosed, setActivityClosed] = useState(false);
  const surfaces: { key: Surface; label: string; sub: string }[] = [
    { key: "h5", label: "订货 H5", sub: "手机端" },
    { key: "ranking", label: "订货排行", sub: "大屏 A" },
    { key: "report", label: "专题战报", sub: "大屏 B" },
    { key: "lottery", label: "幸运抽奖", sub: "现场" },
    { key: "admin", label: "管理后台", sub: "运营端" },
  ];
  return (
    <main className={`prototype-root surface-${surface}`}>
      <nav className="prototype-nav">
        <div className="prototype-title"><span>金</span><p><b>通用订货会</b><small>交互原型 · Mock Data</small></p></div>
        <div className="surface-tabs">{surfaces.map((item) => <button key={item.key} className={surface === item.key ? "active" : ""} onClick={() => setSurface(item.key)}><b>{item.label}</b><small>{item.sub}</small></button>)}</div>
        <div className="prototype-status"><i /> 原型预览</div>
      </nav>
      <div className="prototype-canvas">
        <div className={surface === "h5" ? "surface-slot" : "surface-slot surface-hidden"}><H5Prototype activityClosed={activityClosed} /></div>
        {surface === "ranking" && <RankingBoard />}
        {surface === "report" && <ReportBoard />}
        {surface === "lottery" && <LotteryBoard rounds={lotteryRounds} onComplete={(id) => setLotteryRounds((items) => items.map((item) => item.id === id ? { ...item, status: "completed" } : item))} />}
        {surface === "admin" && <AdminPrototype lotteryRounds={lotteryRounds} onLotteryChange={setLotteryRounds} activityClosed={activityClosed} onActivityStatusChange={setActivityClosed} />}
      </div>
    </main>
  );
}
