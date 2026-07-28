"use client";

import { useEffect, useMemo, useState } from "react";

type Surface = "h5" | "ranking" | "report" | "lottery" | "admin";
type H5Step = "verify" | "order" | "confirm" | "success";
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
  const [step, setStep] = useState<H5Step>("verify");
  const [phone, setPhone] = useState("13800138000");
  const [rebate, setRebate] = useState(true);
  const [line, setLine] = useState("全部");
  const [search, setSearch] = useState("");
  const [quantities, setQuantities] = useState<Record<number, number>>({ 1: 2, 3: 1 });
  const visibleProducts = products.filter(
    (p) => p.rebate === rebate && (line === "全部" || p.line === line) && p.name.includes(search),
  );
  const selected = products.filter((p) => (quantities[p.id] || 0) > 0);
  const totalBoxes = selected.reduce((sum, p) => sum + quantities[p.id], 0);
  const totalAmount = selected.reduce((sum, p) => sum + quantities[p.id] * p.price, 0);

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
        <div className="phone-status"><span>14:30</span><b>2026 中秋订货会</b><span>5G  ▰</span></div>
        <div className="phone-screen">
          <FestivalDecor />
          {step === "verify" && (
            <section className="h5-page verify-page">
              <div className="mini-brand"><b>金龙鱼</b><span>调味品事业部</span></div>
              <div className="h5-hero-copy">
                <span className="eyebrow">2026 年中秋订货会</span>
                <h1>月满家圆<br /><em>味启新程</em></h1>
                <p>新品发布及中秋旺季动员会</p>
              </div>
              <div className="verify-card">
                <span className="step-tag">经销商身份验证</span>
                <h2>输入白名单手机号</h2>
                <p>验证通过后，将为您展示对应渠道的订货商品。</p>
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
                <div><b>2026 中秋订货会</b><span>特渠专业客户</span></div>
                <button className="round-btn" aria-label="更多">•••</button>
              </header>
              <div className="dealer-card">
                <span>已识别经销商</span>
                <b>上海爱尚真贸易有限公司</b>
                <small>联系人 王女士 · 138****8000</small>
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
                          <button onClick={() => changeQty(product.id, -1)} disabled={!quantities[product.id]}>−</button>
                          <input value={quantities[product.id] || 0} onChange={(e) => setQuantities({ ...quantities, [product.id]: Math.max(0, Number(e.target.value) || 0) })} />
                          <button onClick={() => changeQty(product.id, 1)}>＋</button>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
                {visibleProducts.length === 0 && <div className="empty-state">没有符合条件的商品</div>}
              </div>
              <div className="order-bar">
                <div><span>已选 {selected.length} 种 · {totalBoxes} 箱</span><b>¥{money(totalAmount)}</b></div>
                <button disabled={!totalBoxes} onClick={() => setStep("confirm")}>确认订单</button>
              </div>
            </section>
          )}

          {step === "confirm" && (
            <section className="h5-page confirm-page">
              <header className="simple-header"><button onClick={() => setStep("order")}>‹</button><b>确认订单</b><span /></header>
              <div className="confirm-hero"><span>请核对订货信息</span><h2>上海爱尚真</h2><small>特渠专业客户 · 上海分</small></div>
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
                <p><span>商品种类</span><b>{selected.length} 种</b></p>
                <p><span>订货总箱数</span><b>{totalBoxes} 箱</b></p>
                <p><span>预计订货吨数</span><b>0.012 吨</b></p>
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
              <button className="ghost-btn" onClick={() => setStep("verify")}>返回活动首页</button>
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
        <div><span>订单金额</span><strong>19,457,005.28<small>元</small></strong></div>
        <h1><span>2026 中秋订货会</span>{channel}商品信息</h1>
        <div><span>累计订货</span><strong>1,316.0<small>吨</small></strong></div>
      </header>
      <div className="screen-switcher">
        {["特渠专业客户", "综合东区", "综合南区", "综合北1区", "综合北2区"].map((item) => (
          <button key={item} className={channel === item ? "active" : ""} onClick={() => setChannel(item)}>{item}</button>
        ))}
      </div>
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

function LotteryBoard() {
  const [status, setStatus] = useState<"ready" | "rolling" | "done">("ready");
  const [round, setRound] = useState("第二轮");
  const [ticker, setTicker] = useState(0);
  useEffect(() => {
    if (status !== "rolling") return;
    const timer = window.setInterval(() => setTicker((n) => n + 1), 90);
    return () => window.clearInterval(timer);
  }, [status]);
  const winners = Array.from({ length: 15 }, (_, i) => dealerNames[(ticker + i * 3) % dealerNames.length]);
  return (
    <section className="screen-board lottery-board">
      <FestivalDecor />
      <header className="lottery-brand"><span>金龙鱼调味品事业部</span><h1>月满家圆 · 味启新程</h1><small>2026 年中秋订货会幸运抽奖</small></header>
      <div className="lottery-controls">
        <label>客户类型<select><option>特渠专业客户</option><option>综合客户</option></select></label>
        <label>抽奖轮次<select value={round} onChange={(e) => { setRound(e.target.value); setStatus("ready"); }}><option>第一轮</option><option>第二轮</option><option>第三轮</option></select></label>
        <span>候选客户 486 人</span>
      </div>
      <div className="lottery-title"><b>{round} 幸运抽奖</b><span>实物奖品：蜀绣双面绣熊猫摆件</span></div>
      {status === "ready" ? (
        <div className="lottery-ready"><div className="lucky-seal">福</div><h2>好运即将揭晓</h2><p>本轮将抽取 15 名幸运客户</p></div>
      ) : (
        <div className={`winner-grid ${status}`}>
          {winners.map((name, index) => <div key={index}><span>{String(index + 1).padStart(2, "0")}</span><b>{name}</b></div>)}
        </div>
      )}
      <button className={`lottery-action ${status}`} onClick={() => setStatus(status === "ready" ? "rolling" : status === "rolling" ? "done" : "ready")}>
        {status === "ready" ? "开始抽奖" : status === "rolling" ? "停止并揭晓" : "进入下一轮"}
      </button>
    </section>
  );
}

function AdminPrototype() {
  const [tab, setTab] = useState("活动概览");
  const [imported, setImported] = useState(false);
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
            {imported ? (
              <div className="import-result"><div className="import-summary"><span className="success-icon">✓</span><p><b>文件解析完成</b><small>【特渠】26年中秋订货会单品明细表7-1.xlsx</small></p><strong>50 条商品</strong></div><div className="warning-box"><b>发现 7 项需要确认</b><span>2 条商品缺少元/箱价格，5 个物料代码为占位值。异常商品将以“待完善”状态导入。</span></div><TablePreview type="product" /><button className="admin-primary wide">确认导入 43 条有效商品</button></div>
            ) : <div className="upload-zone"><span>XL</span><h3>拖拽或点击上传商品明细表</h3><p>系统将读取“参与订货会返利产品”和“不参与订货会返利产品”两个 Sheet</p><button onClick={() => setImported(true)}>选择 Excel 文件</button></div>}
          </div>
        )}
        {tab === "白名单" && (
          <div className="admin-panel">
            <div className="panel-title"><div><h2>客户白名单</h2><p>共 1,680 名客户 · 手机号用于 H5 身份验证</p></div><button className="admin-primary">导入白名单</button></div>
            <div className="warning-box"><b>数据校验提醒</b><span>发现 59 个跨客户类型重复手机号、9 个手机号格式异常，请在活动发布前处理。</span></div>
            <TablePreview type="customer" />
          </div>
        )}
        {tab === "订单管理" && <div className="admin-panel"><div className="panel-title"><div><h2>订单管理</h2><p>查询、锁定、作废和导出客户订单</p></div><button className="admin-primary">导出订单</button></div><div className="filter-row"><button className="active">全部 1,146</button><button>已提交 1,104</button><button>已锁定 42</button><button>已作废 3</button><input placeholder="搜索经销商" /></div><TablePreview type="order" /></div>}
        {tab === "看板配置" && <SettingsPanel title="数据看板配置" items={["默认展示：特渠专业客户", "TOP120 自动轮播：开启", "轮播间隔：20 秒", "大屏实时刷新：开启"]} />}
        {tab === "抽奖规则" && <SettingsPanel title="抽奖规则配置" items={["特渠专业客户：1 轮，每轮 15 人", "综合客户：3 轮，每轮 15 人", "重复中奖：不允许", "最低订单金额：0 元"]} />}
        {tab === "主题装修" && <SettingsPanel title="活动主题装修" items={["H5 背景：中秋红金主题", "看板背景：月满家圆", "抽奖背景：幸运红金", "主按钮颜色：#D12B27"]} />}
      </main>
    </section>
  );
}

function TablePreview({ type }: { type: "product" | "customer" | "order" }) {
  const data = type === "product"
    ? [["7245-0002307", "金芝御礼芝麻油礼盒", "调味油", "172.50", "有效"], ["待出", "中秋团圆调味礼盒", "礼盒", "—", "待完善"], ["7217-0001957", "四海祯享礼盒", "酱油", "117.00", "有效"]]
    : type === "customer"
      ? [["南区", "长沙分", "长沙久茂", "综合经销商", "147****1979"], ["南区", "厦门分", "泉州乐食光", "特渠专业", "152****7241"], ["东区", "上海分", "上海爱尚真", "特渠专业", "138****8000"]]
      : [["ZY202607280018", "上海爱尚真", "特渠", "¥2,281.50", "已提交"], ["ZY202607280017", "长沙久茂", "综合", "¥82,017.00", "已锁定"], ["ZY202607280016", "青岛大优供应链", "综合", "¥65,424.00", "已提交"]];
  const heads = type === "product" ? ["物料代码", "商品名称", "产品线", "元/箱", "状态"] : type === "customer" ? ["大区", "分公司", "经销商简称", "类型", "验证手机"] : ["订单编号", "经销商", "类型", "金额", "状态"];
  return <div className="data-table"><div className="table-row table-head">{heads.map((x) => <b key={x}>{x}</b>)}</div>{data.map((row, i) => <div className="table-row" key={i}>{row.map((x, j) => <span key={j} className={j === 4 ? "status-cell" : ""}>{x}</span>)}</div>)}</div>;
}

function SettingsPanel({ title, items }: { title: string; items: string[] }) {
  return <div className="admin-panel settings-panel"><div className="panel-title"><div><h2>{title}</h2><p>此处为可点击原型配置预览</p></div><button className="admin-primary">保存配置</button></div><div className="settings-list">{items.map((item, i) => <label key={item}><span>{item.split("：")[0]}</span><input defaultValue={item.split("：")[1]} /><i className={i % 2 ? "" : "on"} /></label>)}</div></div>;
}

export function Prototype() {
  const [surface, setSurface] = useState<Surface>("h5");
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
        {surface === "lottery" && <LotteryBoard />}
        {surface === "admin" && <AdminPrototype />}
      </div>
    </main>
  );
}
