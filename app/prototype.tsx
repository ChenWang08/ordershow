"use client";

import { useEffect, useMemo, useState } from "react";

type Surface = "h5" | "ranking" | "report" | "lottery" | "admin";
type H5Step = "channel" | "region" | "verify" | "order" | "confirm" | "success";
type H5Channel = "综合客户" | "特渠专业客户" | "";
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

const products: Product[] = [
  { id: 1, name: "金芝御礼芝麻油礼盒", line: "调味油", spec: "225mL×4 / 5盒", price: 172.5, rebate: true, gift: true, atlas: 3 },
  { id: 2, name: "福运添香芝麻油", line: "调味油", spec: "225mL×20瓶", price: 144, rebate: true, gift: false, atlas: 0 },
  { id: 3, name: "小磨芝麻香油", line: "调味油", spec: "221mL×20瓶", price: 210, rebate: true, gift: false, atlas: 0 },
  { id: 4, name: "金标生抽酱油", line: "酱油", spec: "500mL×12瓶", price: 66, rebate: true, gift: false, atlas: 1 },
  { id: 5, name: "零添加特级味极鲜", line: "酱油", spec: "500mL×12瓶", price: 78, rebate: true, gift: false, atlas: 1 },
  { id: 6, name: "纯粮香醋", line: "食醋", spec: "500mL×12瓶", price: 82.8, rebate: false, gift: false, atlas: 2 },
  { id: 7, name: "鲜香花椒油", line: "调味油", spec: "225mL×20瓶", price: 236, rebate: false, gift: false, atlas: 0 },
  { id: 8, name: "中秋团圆调味礼盒", line: "礼盒", spec: "4瓶×6盒", price: 420, rebate: false, gift: true, atlas: 3 },
];

const dealerNames = [
  "上海爱尚真", "江苏徐工电子公司", "江苏四合商贸发展", "北京智享云采经贸", "北京惠通达行商贸",
  "农膳坊健康公司", "北京谷力供应链管理", "湖北中合誉品", "上海高顿", "北京金箔永和贸易",
  "河北金源粮油", "上海迦新", "青岛奥德", "河北惊钰", "石家庄德众",
  "天津益食满城", "山东有机有缘", "山东鲸桥裕", "上海赞畅", "唐山红星",
  "青岛大优供应链", "青岛超祥", "汇德丰贸易", "上海安食记", "河南百企助农",
  "湖北省诚新物流", "北京金联创科贸", "深圳曹销分", "河南满粮商贸", "益丰万立",
];

const branches = ["上海分", "青岛分", "北京分", "徐州分", "秦皇岛分", "天津分", "郑州分", "石家庄分", "南京分", "武汉分"];
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
  { id: 1, name: "第一轮", prize: "御品中秋礼盒", winnerCount: 15, customerType: "特渠专业客户", scope: "attended", minAmount: 0, cutoff: "2026-07-30T18:00", excludeWinners: true, status: "completed", candidateCount: 286 },
  { id: 2, name: "第二轮", prize: "蜀绣双面绣熊猫摆件", winnerCount: 15, customerType: "综合客户", scope: "ordered", minAmount: 5000, cutoff: "2026-07-30T18:00", excludeWinners: true, status: "published", candidateCount: 418 },
  { id: 3, name: "第三轮", prize: "中秋尊享礼盒", winnerCount: 10, customerType: "全部客户", scope: "all", minAmount: 0, cutoff: "2026-07-30T18:00", excludeWinners: true, status: "draft", candidateCount: 1665 },
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

function H5Prototype() {
  const [step, setStep] = useState<H5Step>("channel");
  const [channel, setChannel] = useState<H5Channel>("");
  const [region, setRegion] = useState("");
  const [phone, setPhone] = useState("13800138000");
  const [rebate, setRebate] = useState(true);
  const [line, setLine] = useState("全部");
  const [search, setSearch] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [quantities, setQuantities] = useState<Record<number, number>>({ 1: 2, 3: 1 });
  const visibleProducts = products.filter(
    (p) => p.rebate === rebate && (line === "全部" || p.line === line) && p.name.includes(search),
  );
  const selected = products.filter((p) => (quantities[p.id] || 0) > 0);
  const totalBoxes = selected.reduce((sum, p) => sum + quantities[p.id], 0);
  const totalAmount = selected.reduce((sum, p) => sum + quantities[p.id] * p.price, 0);
  const identityLabel = channel === "综合客户" ? `综合客户 · ${region}` : "特渠专业客户";
  const dealerName = channel === "综合客户" ? "上海爱尚真贸易有限公司" : "北京智享云采经贸有限公司";

  const changeQty = (id: number, delta: number) => {
    setQuantities((old) => ({ ...old, [id]: Math.max(0, (old[id] || 0) + delta) }));
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
                <span className="eyebrow">2026 年中秋订货会</span>
                <h1>月满家圆<br /><em>味启新程</em></h1>
                <p>新品发布及中秋旺季动员会</p>
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
                <span className="eyebrow">2026 年中秋订货会</span>
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
                <button className="entry-back" onClick={() => setStep("channel")}>返回选择客户类型</button>
              </div>
            </section>
          )}

          {step === "verify" && (
            <section className="h5-page verify-page">
              <div className="entry-nav"><button onClick={() => setStep(channel === "综合客户" ? "region" : "channel")}>‹</button><span>{identityLabel}</span></div>
              <div className="mini-brand"><b>金龙鱼</b><span>调味品事业部</span></div>
              <div className="h5-hero-copy">
                <span className="eyebrow">2026 年中秋订货会</span>
                <h1>月满家圆<br /><em>味启新程</em></h1>
                <p>新品发布及中秋旺季动员会</p>
              </div>
              <div className="verify-card">
                <div className="verify-context"><span className="step-tag">{identityLabel}</span><button onClick={() => setStep("channel")}>重新选择</button></div>
                <h2>输入白名单手机号</h2>
                <p>验证通过后，将为您展示{channel === "综合客户" ? `${region}综合客户` : "特渠专业客户"}的订货商品。</p>
                <label>
                  <span>手机号</span>
                  <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))} inputMode="numeric" />
                </label>
                <button className="primary-btn" disabled={phone.length !== 11} onClick={() => setStep("order")}>验证并进入订货</button>
                <small>仅用于本次订货会身份识别</small>
              </div>
            </section>
          )}

          {step === "order" && (
            <section className="h5-page order-page">
              <header className="order-header">
                <button className="text-btn" onClick={() => setStep("verify")}>‹</button>
                <div><b>2026 中秋订货会</b><span>{identityLabel}</span></div>
                <button className="round-btn" aria-label="更多">•••</button>
              </header>
              <div className="dealer-card">
                <span>已识别经销商</span>
                <b>{dealerName}</b>
                <small>{identityLabel} · 联系人王女士 · 138****8000</small>
              </div>
              <div className="policy-note"><b>订货提示</b><span>所有商品按箱订购，提交后可在截止时间前修改。</span></div>
              <div className="product-toolbar">
                <div className="segment">
                  <button className={rebate ? "active" : ""} onClick={() => setRebate(true)}>返利产品</button>
                  <button className={!rebate ? "active" : ""} onClick={() => setRebate(false)}>非返利产品</button>
                </div>
                <label className="search-box">⌕<input placeholder="搜索商品" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
              </div>
              <div className="line-tabs">
                {["全部", "调味油", "酱油", "食醋", "礼盒"].map((item) => (
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
                          <button aria-label={`${product.name}减少一箱`} onClick={() => changeQty(product.id, -1)} disabled={!quantities[product.id]}>−</button>
                          <input aria-label={`${product.name}订货箱数`} inputMode="numeric" type="number" min="0" max="9999" value={quantities[product.id] || 0} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setQuantities({ ...quantities, [product.id]: Math.min(9999, Math.max(0, Math.floor(Number(e.target.value) || 0))) })} />
                          <button aria-label={`${product.name}增加一箱`} onClick={() => changeQty(product.id, 1)}>＋</button>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
                {visibleProducts.length === 0 && <div className="empty-state">没有符合条件的商品</div>}
              </div>
              <div className="order-bar">
                <button className="cart-summary" disabled={!totalBoxes} onClick={() => setCartOpen(true)}>
                  <span>已选 {selected.length} 种 · {totalBoxes} 箱 <em>查看明细⌃</em></span><b>¥{money(totalAmount)}</b>
                </button>
                <button className="confirm-cart-btn" disabled={!totalBoxes} onClick={() => setStep("confirm")}>确认订单</button>
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
                        <button className="remove-item" onClick={() => setQuantities((old) => ({ ...old, [product.id]: 0 }))}>删除</button>
                        <div className="stepper">
                          <button aria-label={`${product.name}减少一箱`} onClick={() => changeQty(product.id, -1)}>−</button>
                          <input aria-label={`${product.name}订货箱数`} inputMode="numeric" type="number" min="0" max="9999" value={quantities[product.id]} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setQuantities({ ...quantities, [product.id]: Math.min(9999, Math.max(0, Math.floor(Number(e.target.value) || 0))) })} />
                          <button aria-label={`${product.name}增加一箱`} onClick={() => changeQty(product.id, 1)}>＋</button>
                        </div>
                      </div>
                    </article>
                  ))}
                  {!selected.length && <div className="cart-empty">还没有选择商品</div>}
                </div>
                <footer><div><span>合计</span><b>¥{money(totalAmount)}</b><small>共 {totalBoxes} 箱</small></div><button disabled={!totalBoxes} onClick={() => { setCartOpen(false); setStep("confirm"); }}>去确认订单</button></footer>
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
              <button className="submit-order" onClick={() => setStep("success")}>确认提交订单</button>
            </section>
          )}

          {step === "success" && (
            <section className="h5-page success-page">
              <div className="success-mark">✓</div>
              <span>提交成功</span>
              <h2>您的订货已成功提交</h2>
              <p>订单编号：ZY202607280018</p>
              <div className="success-amount"><span>订单总金额</span><b>¥{money(totalAmount)}</b><small>{totalBoxes} 箱 · {selected.length} 种商品</small></div>
              <div className="success-note">订货截止前，您可以再次进入并修改订单。看板将在数秒内同步最新数据。</div>
              <button className="primary-btn" onClick={() => setStep("order")}>查看并修改订单</button>
              <button className="ghost-btn" onClick={() => { setChannel(""); setRegion(""); setStep("channel"); }}>返回活动首页</button>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function RankingBoard() {
  const [channel, setChannel] = useState("特渠专业客户");
  const ranking = useMemo(() => Array.from({ length: 120 }, (_, index) => ({
    rank: index + 1,
    name: dealerNames[index % dealerNames.length] + (index >= dealerNames.length ? `${Math.floor(index / dealerNames.length) + 1}` : ""),
    value: Math.max(22612, 832017 - index * 6827 + (index % 4) * 931),
  })), []);

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
          {[0, 30, 60, 90].map((start) => (
            <div className="rank-column" key={start}>
              <h2>公司订单金额排行 {start + 1}–{start + 30}<small>单位：元</small></h2>
              {ranking.slice(start, start + 30).map((item) => (
                <div className="rank-row" key={item.rank}>
                  <span className={item.rank <= 3 ? "crown" : ""}>{item.rank <= 3 ? "♛" : ""} {item.rank}</span>
                  <b>{item.name}</b>
                  <strong>{item.value.toLocaleString()}元</strong>
                </div>
              ))}
            </div>
          ))}
        </div>
        <aside className="branch-rank">
          <h2>分公司订货榜</h2>
          {branches.map((branch, index) => (
            <div key={branch}><span className={index < 5 ? "crown" : ""}>{index < 5 ? "♛" : ""} {index + 1}</span><b>{branch}</b><strong>{(3104358 - index * 226543).toLocaleString()}元</strong></div>
          ))}
        </aside>
      </div>
    </section>
  );
}

function MetricTable({ title, labels, values }: { title: string; labels: string[]; values: number[] }) {
  return (
    <div className="metric-table">
      <h2>{title}</h2>
      <div className="metric-head"><span>分类</span><span>金额（元）</span></div>
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
  return (
    <section className="screen-board report-board">
      <FestivalDecor />
      <header className="report-header">
        <span>2026 年调味品事业部新品发布及中秋旺季动员会</span>
        <h1>月满家圆 · 味启新程</h1>
        <label>当前看板：
          <select value={report} onChange={(e) => setReport(e.target.value)}>
            {reports.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
      </header>
      <div className={`report-content ${isDual ? "dual" : ""}`}>
        {isTotal ? (
          <div className="total-performance"><span>总战绩</span><strong>1.56<small>亿</small></strong><p>实时汇聚特渠专业客户与综合客户有效订单</p></div>
        ) : isTop ? (
          <div className="top-five">
            <h2>{report}</h2>
            {dealerNames.slice(0, 5).map((name, index) => <div key={name}><span>{index + 1}</span><b>{name}</b><strong>{(832017 - index * 36017).toLocaleString()} 元</strong></div>)}
          </div>
        ) : isDual ? (
          <>
            <MetricTable title="综合客户 · 区域" labels={["东区", "南区", "北1区", "北2区"]} values={[44979349, 29342256, 63086424, 18270000]} />
            <MetricTable title="综合客户 · 产品线" labels={["调味油", "酱油", "食醋", "料酒", "礼盒"]} values={[103445585, 24615018, 6624881, 1781348, 931195]} />
          </>
        ) : report.includes("产品线") ? (
          <MetricTable title={report} labels={["调味油", "酱油", "食醋", "料酒", "蚝油", "礼盒"]} values={[103445585, 24615018, 6624881, 1781348, 1435672, 931195]} />
        ) : report.includes("东、南") ? (
          <MetricTable title="综合客户" labels={["东区", "南区", "北1区", "北2区"]} values={[44979349, 29342256, 63086424, 18270000]} />
        ) : (
          <MetricTable title={report} labels={report.includes("礼盒") ? ["特渠专业客户", "综合客户"] : ["特渠专业客户", "综合客户"]} values={report.includes("礼盒") ? [9789094, 11811559] : [19462405, 137408029]} />
        )}
      </div>
    </section>
  );
}

function LotteryBoard({ rounds, onComplete }: { rounds: LotteryRound[]; onComplete: (id: number) => void }) {
  const [status, setStatus] = useState<"ready" | "rolling" | "done">("ready");
  const [ticker, setTicker] = useState(0);
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
  const scopeLabel = currentRound.scope === "all" ? "活动白名单客户" : currentRound.scope === "attended" ? "现场已到场客户" : "已下有效订单客户";
  const handleAction = () => {
    if (status === "ready") setStatus("rolling");
    else if (status === "rolling") {
      setStatus("done");
      onComplete(currentRound.id);
    } else {
      const next = availableRounds.find((item) => item.id > currentRound.id && item.status !== "completed");
      if (next) {
        setRoundId(next.id);
        setStatus("ready");
      }
    }
  };
  return (
    <section className="screen-board lottery-board">
      <FestivalDecor />
      <div className="lottery-controls">
        <label>抽奖轮次<select value={roundId} onChange={(e) => { setRoundId(Number(e.target.value)); setStatus("ready"); }}>{availableRounds.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.status === "completed" ? "已完成" : "待抽取"}</option>)}</select></label>
        <span>{currentRound.customerType} · 候选 {currentRound.candidateCount} 人</span>
      </div>
      <div className="lottery-title"><b>{currentRound.name} 幸运抽奖</b><span>实物奖品：{currentRound.prize}</span></div>
      {status === "ready" ? (
        <div className="lottery-ready"><div className="lucky-seal">福</div><h2>好运即将揭晓</h2><p>本轮将从 {scopeLabel} 中抽取 {currentRound.winnerCount} 名幸运客户</p><div className="lottery-rule-summary"><span>{currentRound.scope === "all" ? "活动白名单" : currentRound.scope === "attended" ? "现场已到场" : "有效订单"}</span>{currentRound.scope === "ordered" && currentRound.minAmount > 0 && <span>订单满 ¥{currentRound.minAmount.toLocaleString()}</span>}{currentRound.excludeWinners && <span>排除已中奖</span>}</div></div>
      ) : (
        <div className={`winner-grid ${status}`}>
          {winners.map((name, index) => <div key={index}><span>{String(index + 1).padStart(2, "0")}</span><b>{name}</b></div>)}
        </div>
      )}
      <button className={`lottery-action ${status}`} onClick={handleAction} disabled={currentRound.status === "completed" && status === "ready"}>
        {currentRound.status === "completed" && status === "ready" ? "本轮已完成" : status === "ready" ? "确认规则并开始抽奖" : status === "rolling" ? "停止并揭晓" : "进入下一轮"}
      </button>
    </section>
  );
}

const orderRecords = [
  { no: "ZY202607280018", dealer: "上海爱尚真", company: "上海分公司", type: "特渠", amount: "¥2,281.50", boxes: 13, tons: "0.012", createdAt: "07-28 14:36", submittedAt: "07-28 14:52", updatedAt: "07-28 14:52", lockedAt: "—", status: "已提交" },
  { no: "ZY202607280017", dealer: "长沙久茂", company: "长沙分公司", type: "综合", amount: "¥82,017.00", boxes: 286, tons: "0.244", createdAt: "07-28 14:31", submittedAt: "07-28 14:47", updatedAt: "07-28 15:06", lockedAt: "07-28 15:10", status: "已锁定" },
  { no: "ZY202607280016", dealer: "青岛大优供应链", company: "青岛分公司", type: "综合", amount: "¥65,424.00", boxes: 194, tons: "0.176", createdAt: "07-28 14:29", submittedAt: "07-28 14:43", updatedAt: "07-28 14:58", lockedAt: "—", status: "已提交" },
];

function OrderManagement() {
  const [selected, setSelected] = useState<(typeof orderRecords)[number] | null>(null);
  return (
    <div className="admin-panel">
      <div className="panel-title"><div><h2>订单管理</h2><p>点击订单行可查看商品明细、金额和操作记录</p></div><button className="admin-primary">导出订单</button></div>
      <div className="filter-row"><button className="active">全部 1,146</button><button>已提交 1,104</button><button>已锁定 42</button><button>已作废 3</button><input placeholder="搜索经销商" /></div>
      <div className="data-table order-table">
        <div className="table-row table-head">{["订单编号", "经销商", "类型", "金额", "创建时间", "最后修改", "状态"].map((x) => <b key={x}>{x}</b>)}</div>
        {orderRecords.map((order) => (
          <button className="table-row clickable-row" key={order.no} onClick={() => setSelected(order)}>
            <span>{order.no}</span><span>{order.dealer}</span><span>{order.type}</span><span>{order.amount}</span><span>{order.createdAt}</span><span>{order.updatedAt}</span><span className="status-cell">{order.status}</span>
          </button>
        ))}
      </div>
      {selected && (
        <div className="order-drawer-backdrop" onClick={() => setSelected(null)}>
          <aside className="order-drawer" onClick={(e) => e.stopPropagation()}>
            <header><div><span>订单详情</span><h2>{selected.no}</h2></div><button onClick={() => setSelected(null)}>×</button></header>
            <div className="order-summary-grid">
              <p><span>经销商</span><b>{selected.dealer}</b><small>{selected.company}</small></p>
              <p><span>客户类型</span><b>{selected.type}</b><small>{selected.status}</small></p>
              <p><span>订货箱数</span><b>{selected.boxes} 箱</b><small>{selected.tons} 吨</small></p>
              <p><span>订单金额</span><b className="red">{selected.amount}</b><small>含税经销价</small></p>
              <p><span>创建 / 首次提交</span><b>{selected.createdAt}</b><small>{selected.submittedAt}</small></p>
              <p><span>最后修改 / 锁定</span><b>{selected.updatedAt}</b><small>{selected.lockedAt}</small></p>
            </div>
            <section className="drawer-section">
              <h3>商品明细</h3>
              <div className="drawer-items">
                <div><span>7245-0002307</span><b>金芝御礼芝麻油礼盒</b><em>¥172.50 × 5 箱</em><strong>¥862.50</strong></div>
                <div><span>7245-0000003</span><b>小磨芝麻香油</b><em>¥210.00 × 6 箱</em><strong>¥1,260.00</strong></div>
                <div><span>7245-0000005</span><b>零添加特级味极鲜</b><em>¥78.00 × 2 箱</em><strong>¥156.00</strong></div>
              </div>
            </section>
            <section className="drawer-section"><h3>操作记录</h3><div className="order-timeline"><p><b>14:52 已提交订单</b><span>经销商手机端提交 · 当前版本 V2</span></p><p><b>14:41 修改订货数量</b><span>订单金额由 ¥2,071.50 调整为 ¥2,281.50</span></p></div></section>
            <footer><button>作废订单</button><button>锁定订单</button><button className="admin-primary" onClick={() => setSelected(null)}>关闭详情</button></footer>
          </aside>
        </div>
      )}
    </div>
  );
}

type ImportMode = "append" | "update" | "replace";

function ImportModeSelector({ value, onChange }: { value: ImportMode; onChange: (mode: ImportMode) => void }) {
  const details: Record<ImportMode, string> = {
    append: "仅新增不存在的数据；发现相同唯一标识时跳过并提示。",
    update: "新增数据，同时按唯一标识覆盖更新已有数据。",
    replace: "清空当前活动对应数据后重新导入；已有订单时禁止执行。",
  };
  return (
    <div className={`import-mode ${value === "replace" ? "danger" : ""}`}>
      <div><b>本次导入方式</b><span>{details[value]}</span></div>
      <div className="import-mode-buttons">
        <button className={value === "append" ? "active" : ""} onClick={() => onChange("append")}>追加导入</button>
        <button className={value === "update" ? "active" : ""} onClick={() => onChange("update")}>覆盖更新</button>
        <button className={value === "replace" ? "active danger" : ""} onClick={() => onChange("replace")}>清空重导</button>
      </div>
    </div>
  );
}

function ProductImportTable() {
  const [customerType, setCustomerType] = useState("全部");
  const [rebate, setRebate] = useState("全部");
  const heads = ["客户类型", "是否返利", "产品大类", "产品线", "物料代码", "物料名称", "品牌", "品种", "规格", "箱规", "元/瓶", "元/箱", "吨箱转换系数", "是否礼盒", "状态"];
  const rows = [
    ["特渠", "参与", "油脂", "调味油", "7245-0002307", "金芝御礼芝麻油礼盒", "金龙鱼", "芝麻油", "225mL×4/5盒", "5盒/箱", "34.50", "172.50", "0.00092", "是", "有效"],
    ["特渠", "不参与", "组合装", "礼盒", "待出", "中秋团圆调味礼盒", "", "", "", "", "", "", "", "是", "待完善"],
    ["综合", "参与", "调味品", "酱油", "7217-0001957", "四海祯享礼盒", "金龙鱼", "酱油", "500mL×6瓶", "6瓶/箱", "19.50", "117.00", "0.00076", "是", "有效"],
    ["综合", "不参与", "调味品", "食醋", "7218-0002086", "零添加糯米香醋", "金龙鱼", "香醋", "500mL×12瓶", "12瓶/箱", "6.50", "78.00", "0.00118", "否", "有效"],
  ];
  const visibleRows = rows.filter((row) => (customerType === "全部" || row[0] === customerType) && (rebate === "全部" || row[1] === rebate));
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
          {visibleRows.map((row, i) => <div className="table-row" key={`${row[4]}-${i}`}>{row.map((x, j) => <span key={j} className={j === 14 ? "status-cell" : ""}>{x || "—"}</span>)}</div>)}
        </div>
      </div>
    </>
  );
}

function CustomerWhitelistTable() {
  const [customerType, setCustomerType] = useState("全部");
  const heads = ["序号", "大区", "分公司名称简", "分公司名称全", "经销商类型", "经销商姓名", "经销商电话", "分公司确认人姓名", "分公司确认人电话"];
  const rows = [
    ["1", "东区", "上海分", "益海嘉里食品营销有限公司上海分公司", "特渠专业客户", "上海爱尚真贸易有限公司", "138****8000", "王敏", "139****6021"],
    ["2", "南区", "长沙分", "益海嘉里食品营销有限公司长沙分公司", "综合客户", "长沙久茂商贸有限公司", "147****1979", "李娟", "186****3148"],
    ["3", "南区", "厦门分", "益海嘉里食品营销有限公司厦门分公司", "特渠专业客户", "泉州乐食光商贸有限公司", "152****7241", "陈华", "135****5280"],
    ["4", "北区", "青岛分", "益海嘉里食品营销有限公司青岛分公司", "综合客户", "青岛大优供应链有限公司", "186****5036", "张磊", "158****9166"],
  ];
  const visibleRows = rows.filter((row) => customerType === "全部" || row[4] === customerType);
  return (
    <>
      <div className="data-filters">
        <label><span>客户类型</span><select value={customerType} onChange={(e) => setCustomerType(e.target.value)}><option>全部</option><option>综合客户</option><option>特渠专业客户</option></select></label>
        <small>当前显示 {visibleRows.length} 名客户</small>
      </div>
      <div className="table-scroll">
        <div className="data-table whitelist-table">
          <div className="table-row table-head">{heads.map((x) => <b key={x}>{x}</b>)}</div>
          {visibleRows.map((row) => <div className="table-row" key={row[0]}>{row.map((x, j) => <span key={j}>{x}</span>)}</div>)}
        </div>
      </div>
    </>
  );
}

function ThemePanel() {
  const [images, setImages] = useState<Record<string, string>>({});
  const themes = [
    ["h5", "H5 页面背景", "建议尺寸 750 × 1624 px", "linear-gradient(145deg,#a91519,#e75c35)"],
    ["board", "数据看板背景", "建议尺寸 1920 × 1080 px", "linear-gradient(145deg,#380406,#811316)"],
    ["lottery", "抽奖页面背景", "建议尺寸 1920 × 1080 px", "radial-gradient(circle,#b62323,#520b0e)"],
  ];
  return (
    <div className="admin-panel theme-panel">
      <div className="panel-title"><div><h2>活动主题装修</h2><p>三类终端可分别上传背景图，保存后立即用于对应页面</p></div><button className="admin-primary">保存并发布</button></div>
      <div className="theme-grid">
        {themes.map(([key, title, hint, fallback]) => (
          <article key={key}>
            <div className="theme-preview" style={{ backgroundImage: images[key] ? `url(${images[key]})` : fallback }}><span>{images[key] ? "自定义图片预览" : "当前默认主题"}</span></div>
            <div><h3>{title}</h3><p>{hint} · JPG/PNG，建议小于 5MB</p></div>
            <label className="upload-button"><input type="file" accept="image/png,image/jpeg" onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) setImages((current) => ({ ...current, [key]: URL.createObjectURL(file) }));
            }} />{images[key] ? "更换图片" : "上传图片"}</label>
          </article>
        ))}
      </div>
      <div className="theme-options"><label><span>主按钮颜色</span><input defaultValue="#D12B27" /></label><label><span>背景显示方式</span><select defaultValue="cover"><option value="cover">铺满裁切</option><option value="contain">完整显示</option><option value="repeat">平铺</option></select></label></div>
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
    { key: "ordered", title: "有效下单客户", detail: "已提交或已锁定订单" },
  ];
  const updateSelected = (patch: Partial<LotteryRound>) => onChange(rounds.map((item) => item.id === selected.id ? { ...item, ...patch } : item));
  const addRound = () => {
    const id = Math.max(...rounds.map((item) => item.id)) + 1;
    const next: LotteryRound = { id, name: `第${rounds.length + 1}轮`, prize: "待配置奖品", winnerCount: 10, customerType: "全部客户", scope: "all", minAmount: 0, cutoff: "2026-07-30T18:00", excludeWinners: true, status: "draft", candidateCount: 1665 };
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

function AdminPrototype({ lotteryRounds, onLotteryChange }: { lotteryRounds: LotteryRound[]; onLotteryChange: (rounds: LotteryRound[]) => void }) {
  const [tab, setTab] = useState("活动概览");
  const [imported, setImported] = useState(false);
  const [productImportMode, setProductImportMode] = useState<ImportMode>("append");
  const [customerImportMode, setCustomerImportMode] = useState<ImportMode>("append");
  const nav = ["活动概览", "商品导入", "白名单", "订单管理", "看板配置", "抽奖规则", "主题装修"];
  return (
    <section className="admin-app">
      <aside className="admin-sidebar">
        <div className="admin-logo"><span>金</span><b>订购会管理平台</b></div>
        <nav>{nav.map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}><i>{item.slice(0, 1)}</i>{item}</button>)}</nav>
        <div className="admin-user"><span>陈</span><p><b>运营管理员</b><small>调味品事业部</small></p></div>
      </aside>
      <main className="admin-main">
        <header><div><span>2026 年中秋订货会</span><b>{tab}</b></div><div className="admin-actions"><button>操作日志</button><span>进行中</span></div></header>
        {tab === "活动概览" && (
          <>
            <div className="admin-stats">
              {[["订单总金额", "¥19,457,005.28", "+12.8%"], ["已提交客户", "1,146", "68.2%"], ["订货总箱数", "38,620", "+2,841"], ["订货总吨数", "1,316.0", "+98.2"]].map((item) => <article key={item[0]}><span>{item[0]}</span><strong>{item[1]}</strong><small>{item[2]} 较1小时前</small></article>)}
            </div>
            <div className="admin-grid">
              <article className="progress-card"><h2>客户提交进度</h2>{[["综合客户", 1073, 826], ["特渠专业客户", 607, 320]].map((x) => <div key={x[0] as string}><p><b>{x[0]}</b><span>{x[2]} / {x[1]}</span></p><i><em style={{ width: `${Number(x[2]) / Number(x[1]) * 100}%` }} /></i></div>)}</article>
              <article className="activity-card"><h2>活动信息</h2><p><span>活动状态</span><b className="green">进行中</b></p><p><span>订货开始</span><b>2026-07-28 14:30</b></p><p><span>订货截止</span><b>2026-07-30 18:30</b></p><button>编辑活动设置</button></article>
            </div>
          </>
        )}
        {tab === "商品导入" && (
          <div className="admin-panel">
            <div className="panel-title"><div><h2>活动商品导入</h2><p>分别导入特渠与综合客户商品明细表</p></div><button className="admin-primary" onClick={() => setImported(true)}>上传 Excel</button></div>
            <ImportModeSelector value={productImportMode} onChange={setProductImportMode} />
            {imported ? (
              <div className="import-result"><div className="import-summary"><span className="success-icon">✓</span><p><b>文件解析完成 · {productImportMode === "append" ? "追加导入" : productImportMode === "update" ? "覆盖更新" : "清空重导"}</b><small>【特渠】26年中秋订货会单品明细表7-1.xlsx</small></p><strong>50 条商品</strong></div><div className="warning-box"><b>发现 7 项需要确认</b><span>缺失字段暂时留空；商品名称含“礼盒”时自动标记为礼盒。异常商品将以“待完善”状态导入。</span></div><ProductImportTable /><button className="admin-primary wide">确认执行本次导入</button></div>
            ) : <div className="upload-zone"><span>XL</span><h3>拖拽或点击上传商品明细表</h3><p>系统将读取“参与订货会返利产品”和“不参与订货会返利产品”两个 Sheet</p><button onClick={() => setImported(true)}>选择 Excel 文件</button></div>}
          </div>
        )}
        {tab === "白名单" && (
          <div className="admin-panel">
            <div className="panel-title"><div><h2>客户白名单</h2><p>共 1,680 名客户 · 手机号用于 H5 身份验证</p></div><button className="admin-primary">导入白名单</button></div>
            <ImportModeSelector value={customerImportMode} onChange={setCustomerImportMode} />
            <div className="warning-box"><b>数据校验提醒</b><span>发现 59 个跨客户类型重复手机号、9 个手机号格式异常，请在活动发布前处理。</span></div>
            <CustomerWhitelistTable />
          </div>
        )}
        {tab === "订单管理" && <OrderManagement />}
        {tab === "看板配置" && <SettingsPanel title="数据看板配置" items={["默认展示：特渠专业客户", "TOP120 自动轮播：开启", "轮播间隔：20 秒", "大屏实时刷新：开启"]} />}
        {tab === "抽奖规则" && <LotterySettings rounds={lotteryRounds} onChange={onLotteryChange} />}
        {tab === "主题装修" && <ThemePanel />}
      </main>
    </section>
  );
}

function SettingsPanel({ title, items }: { title: string; items: string[] }) {
  return <div className="admin-panel settings-panel"><div className="panel-title"><div><h2>{title}</h2><p>此处为可点击原型配置预览</p></div><button className="admin-primary">保存配置</button></div><div className="settings-list">{items.map((item, i) => <label key={item}><span>{item.split("：")[0]}</span><input defaultValue={item.split("：")[1]} /><i className={i % 2 ? "" : "on"} /></label>)}</div></div>;
}

export function Prototype() {
  const [surface, setSurface] = useState<Surface>("h5");
  const [lotteryRounds, setLotteryRounds] = useState<LotteryRound[]>(initialLotteryRounds);
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
        <div className="prototype-title"><span>金</span><p><b>2026 中秋订货会</b><small>交互原型 · Mock Data</small></p></div>
        <div className="surface-tabs">{surfaces.map((item) => <button key={item.key} className={surface === item.key ? "active" : ""} onClick={() => setSurface(item.key)}><b>{item.label}</b><small>{item.sub}</small></button>)}</div>
        <div className="prototype-status"><i /> 原型预览</div>
      </nav>
      <div className="prototype-canvas">
        {surface === "h5" && <H5Prototype />}
        {surface === "ranking" && <RankingBoard />}
        {surface === "report" && <ReportBoard />}
        {surface === "lottery" && <LotteryBoard rounds={lotteryRounds} onComplete={(id) => setLotteryRounds((items) => items.map((item) => item.id === id ? { ...item, status: "completed" } : item))} />}
        {surface === "admin" && <AdminPrototype lotteryRounds={lotteryRounds} onLotteryChange={setLotteryRounds} />}
      </div>
    </main>
  );
}
