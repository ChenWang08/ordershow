"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import * as XLSX from "xlsx";

type Surface = "h5" | "ranking" | "report" | "lottery" | "admin";
type ActivityStatus = "draft" | "scheduled" | "running" | "ended";
type H5Step = "channel" | "region" | "verify" | "order" | "confirm" | "success" | "submitted";
type H5OrderStatus = "none" | "submitted" | "withdrawn";
type H5Channel = "综合客户" | "特渠专业客户" | "";
type MockWhitelistIdentity = { phone: string; channel: Exclude<H5Channel, "">; region: string; branch: string };
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
  id: string;
  name: string;
  line: string;
  spec: string;
  price: number;
  rebate: boolean;
  gift: boolean;
  atlas: number;
  customerType: "综合" | "特渠" | "全部";
  branchScope: string[];
  status: "有效" | "待完善" | "停用";
  materialCode?: string;
  casePack?: string;
  imageUrl?: string;
  imageUrls?: string[];
};

const mockWhitelistIdentities: MockWhitelistIdentity[] = [
  { phone: "13800138000", channel: "特渠专业客户", region: "", branch: "武汉分" },
  { phone: "13812348000", channel: "特渠专业客户", region: "", branch: "北京分" },
  { phone: "14712341979", channel: "综合客户", region: "南区", branch: "长沙分" },
  { phone: "18612345036", channel: "综合客户", region: "北区", branch: "成都分" },
];

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

function normalizeSearchText(value: string) {
  return value.trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, "");
}

function normalizeMaterialCode(value: string) {
  return normalizeSearchText(value).replace(/[-_]/g, "");
}

const products: Product[] = [
  { id: "1", name: "金芝御礼芝麻油礼盒", line: "调味油", spec: "225mL×4 / 5盒", price: 172.5, rebate: true, gift: true, atlas: 3, customerType: "全部", branchScope: [], status: "有效" },
  { id: "2", name: "福运添香芝麻油", line: "调味油", spec: "225mL×20瓶", price: 144, rebate: true, gift: false, atlas: 0, customerType: "全部", branchScope: [], status: "有效" },
  { id: "3", name: "小磨芝麻香油", line: "调味油", spec: "221mL×20瓶", price: 210, rebate: true, gift: false, atlas: 0, customerType: "全部", branchScope: [], status: "有效" },
  { id: "4", name: "金标生抽酱油", line: "酱油", spec: "500mL×12瓶", price: 66, rebate: true, gift: false, atlas: 1, customerType: "全部", branchScope: [], status: "有效" },
  { id: "5", name: "零添加特级味极鲜", line: "酱油", spec: "500mL×12瓶", price: 78, rebate: true, gift: false, atlas: 1, customerType: "全部", branchScope: [], status: "有效" },
  { id: "6", name: "纯粮香醋", line: "食醋", spec: "500mL×12瓶", price: 82.8, rebate: false, gift: false, atlas: 2, customerType: "全部", branchScope: [], status: "有效" },
  { id: "7", name: "鲜香花椒油", line: "调味油", spec: "225mL×20瓶", price: 236, rebate: false, gift: false, atlas: 0, customerType: "全部", branchScope: [], status: "有效" },
  { id: "8", name: "经典调味礼盒", line: "酱油", spec: "4瓶×6盒", price: 420, rebate: false, gift: true, atlas: 3, customerType: "全部", branchScope: [], status: "有效" },
];

function splitBranchScope(value: string) {
  return value.split(/[，,、]/).map((item) => item.trim()).filter(Boolean);
}

function productRowToProduct(row: ProductImportRow): Product {
  const lineAtlas = row.line === "酱油" ? 1 : row.line === "食醋" ? 2 : row.gift === "是" ? 3 : 0;
  const imageUrls = row.imageStatus === "已匹配" || row.imageStatus === "手动维护" ? row.images?.map((image) => image.url) : [];
  return {
    id: row.id,
    name: row.materialName,
    line: row.line,
    spec: row.spec,
    price: Number(row.casePrice) || 0,
    rebate: row.rebate === "参与",
    gift: row.gift === "是",
    atlas: lineAtlas,
    customerType: row.customerType,
    branchScope: splitBranchScope(row.branchScope),
    status: row.status,
    materialCode: row.materialCode,
    casePack: row.casePack,
    imageUrl: imageUrls?.[0],
    imageUrls,
  };
}

const productSheetConfig = [
  { name: "综合参与返利", customerType: "综合" as const, rebate: "参与" as const },
  { name: "综合不参与返利", customerType: "综合" as const, rebate: "不参与" as const },
  { name: "特渠参与返利", customerType: "特渠" as const, rebate: "参与" as const },
  { name: "特渠不参与返利", customerType: "特渠" as const, rebate: "不参与" as const },
];

const whitelistSheetConfig = [
  { name: "综合客户白名单", customerType: "综合客户" as const },
  { name: "特渠客户白名单", customerType: "特渠专业客户" as const },
];

type ProductImportParseResult = {
  rows: ProductImportRow[];
  warnings: string[];
  sheetCounts: Array<{ name: string; count: number }>;
};

function textCell(value: unknown) {
  return String(value ?? "").replace(/\u00a0/g, " ").trim();
}

async function parseProductWorkbook(file: File): Promise<ProductImportParseResult> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", raw: false });
  const warnings: string[] = [];
  const rows: ProductImportRow[] = [];
  const sheetCounts: Array<{ name: string; count: number }> = [];
  const expectedHeaders = ["产品大类", "产品线", "物料代码", "物料名称", "品牌", "品种", "规格", "箱规", "元/瓶", "元/箱", "吨箱转换系数", "是否为标品礼盒", "分公司定制品"];
  const unknownSheets = workbook.SheetNames.filter((name) => !productSheetConfig.some((item) => item.name === name));
  if (unknownSheets.length > 0) warnings.push(`已忽略未识别的 Sheet：${unknownSheets.join("、")}`);

  for (const config of productSheetConfig) {
    const sheet = workbook.Sheets[config.name];
    if (!sheet) throw new Error(`缺少必要的 Sheet：${config.name}`);
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
    const header = (matrix[0] ?? []).map(textCell);
    const missingHeaders = expectedHeaders.filter((name) => !header.includes(name));
    if (missingHeaders.length > 0) throw new Error(`${config.name} 缺少字段：${missingHeaders.join("、")}`);
    const indexes = Object.fromEntries(expectedHeaders.map((name) => [name, header.indexOf(name)]));
    let sequence = 0;
    let blankCodeCount = 0;
    const codeRows = new Map<string, number[]>();
    for (let index = 1; index < matrix.length; index += 1) {
      const values = matrix[index] ?? [];
      if (values.every((value) => textCell(value) === "")) continue;
      const get = (name: string) => textCell(values[indexes[name]]);
      const materialCode = get("物料代码");
      const conversion = get("吨箱转换系数");
      const casePrice = get("元/箱");
      sequence += 1;
      if (!materialCode) blankCodeCount += 1;
      if (materialCode) {
        const key = materialCode.replace(/\s+/g, "").toUpperCase();
        codeRows.set(key, [...(codeRows.get(key) ?? []), index + 1]);
      }
      rows.push({
        id: createImportRowId("product"),
        sequence,
        customerType: config.customerType,
        rebate: config.rebate,
        category: get("产品大类"),
        line: get("产品线"),
        materialCode,
        materialName: get("物料名称"),
        brand: get("品牌"),
        variety: get("品种"),
        spec: get("规格"),
        casePack: get("箱规"),
        unitPrice: get("元/瓶"),
        casePrice,
        conversion,
        gift: get("是否为标品礼盒") === "是" ? "是" : "否",
        branchScope: get("分公司定制品"),
        source: "excel",
        sourceSheet: config.name,
        status: !materialCode || !casePrice || !conversion ? "待完善" : "有效",
      });
    }
    const duplicateGroups = [...codeRows.values()].filter((rowNumbers) => rowNumbers.length > 1);
    if (duplicateGroups.length > 0) warnings.push(`${config.name} 有 ${duplicateGroups.length} 组重复物料代码，请在确认导入前检查。`);
    if (blankCodeCount > 0) warnings.push(`${config.name} 有 ${blankCodeCount} 条商品没有物料代码，已标记为待完善。`);
    sheetCounts.push({ name: config.name, count: sequence });
  }
  return { rows, warnings, sheetCounts };
}

type WhitelistImportParseResult = {
  rows: WhitelistRow[];
  warnings: string[];
  sheetCounts: Array<{ name: string; count: number }>;
  crossSheetPhoneCount: number;
};

function normalizedHeader(value: unknown) {
  return textCell(value).replace(/\s+/g, "");
}

function findHeaderIndex(header: string[], aliases: readonly string[]) {
  const normalized = header.map(normalizedHeader);
  return aliases.map(normalizedHeader).map((alias) => normalized.findIndex((item) => item === alias || item.includes(alias))).find((index) => index >= 0) ?? -1;
}

async function parseWhitelistWorkbook(file: File): Promise<WhitelistImportParseResult> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", raw: false });
  const warnings: string[] = [];
  const rows: WhitelistRow[] = [];
  const sheetCounts: Array<{ name: string; count: number }> = [];
  const unknownSheets = workbook.SheetNames.filter((name) => !whitelistSheetConfig.some((item) => item.name === name));
  if (unknownSheets.length > 0) warnings.push(`已忽略未识别的 Sheet：${unknownSheets.join("、")}`);

  const requiredColumns = [
    ["序号", ["序号"]],
    ["大区", ["大区"]],
    ["分公司名称", ["分公司名称", "分公司"]],
    ["经销商名称（简）", ["经销商名称（简）", "经销商简称"]],
    ["经销商名称（全）", ["经销商名称（全）", "经销商全称"]],
    ["经销商类型", ["经销商类型", "综合经销商特渠专业经销商"]],
    ["经销商姓名", ["经销商姓名"]],
    ["经销商电话", ["经销商电话"]],
    ["分公司确认人姓名", ["分公司确认人姓名"]],
    ["分公司确认人电话", ["分公司确认人电话"]],
  ] as const;

  for (const config of whitelistSheetConfig) {
    const sheet = workbook.Sheets[config.name];
    if (!sheet) throw new Error(`缺少必要的 Sheet：${config.name}`);
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
    const headerIndex = matrix.findIndex((row) => row.some((value) => normalizedHeader(value).includes("经销商电话")));
    if (headerIndex < 0) throw new Error(`${config.name} 未找到包含“经销商电话”的表头行`);
    const header = (matrix[headerIndex] ?? []).map(textCell);
    const indexes = Object.fromEntries(requiredColumns.map(([label, aliases]) => [label, findHeaderIndex(header, aliases)]));
    const missingHeaders = requiredColumns.filter(([label]) => indexes[label] < 0).map(([label]) => label);
    if (missingHeaders.length > 0) throw new Error(`${config.name} 缺少字段：${missingHeaders.join("、")}`);
    const get = (values: unknown[], label: string) => textCell(values[indexes[label]]);
    const sourceRows = matrix.slice(headerIndex + 1).filter((values) => values.some((value) => textCell(value) !== ""));
    const phoneRows = new Map<string, number[]>();
    const parsedRows = sourceRows.map((values, offset) => {
      const dealerPhone = normalizePhone(get(values, "经销商电话"));
      const rowNumber = headerIndex + offset + 2;
      if (dealerPhone) phoneRows.set(dealerPhone, [...(phoneRows.get(dealerPhone) ?? []), rowNumber]);
      return { values, dealerPhone, rowNumber };
    });
    const duplicatePhones = new Set([...phoneRows.entries()].filter(([, rowNumbers]) => rowNumbers.length > 1).map(([phone]) => phone));
    if (duplicatePhones.size > 0) warnings.push(`${config.name} 有 ${duplicatePhones.size} 个手机号重复，已标记为待处理。`);

    for (const { values, dealerPhone } of parsedRows) {
      const phoneValid = /^1\d{10}$/.test(dealerPhone);
      const status: WhitelistRow["status"] = phoneValid && !duplicatePhones.has(dealerPhone) ? "有效" : "待处理";
      rows.push({
        id: createImportRowId("whitelist"),
        sequence: Number(get(values, "序号")) || rows.length + 1,
        customerType: config.customerType,
        region: get(values, "大区"),
        branch: get(values, "分公司名称"),
        dealerShort: get(values, "经销商名称（简）"),
        dealerFull: get(values, "经销商名称（全）"),
        dealerType: get(values, "经销商类型"),
        dealerName: get(values, "经销商姓名"),
        dealerPhone,
        confirmerName: get(values, "分公司确认人姓名"),
        confirmerPhone: normalizePhone(get(values, "分公司确认人电话")),
        status,
        source: "excel",
        sourceSheet: config.name,
        identityKey: `${config.customerType}:${normalizeWhitelistName(get(values, "经销商名称（全）"))}`,
      });
    }
    const blankOrInvalidCount = parsedRows.filter(({ dealerPhone }) => !/^1\d{10}$/.test(dealerPhone)).length;
    if (blankOrInvalidCount > 0) warnings.push(`${config.name} 有 ${blankOrInvalidCount} 条手机号为空或格式异常，已标记为待处理。`);
    sheetCounts.push({ name: config.name, count: sourceRows.length });
  }

  const phonesByType = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.status !== "有效" || !row.dealerPhone) continue;
    const phones = phonesByType.get(row.dealerPhone) ?? new Set<string>();
    phones.add(row.customerType);
    phonesByType.set(row.dealerPhone, phones);
  }
  const crossSheetPhoneCount = [...phonesByType.values()].filter((types) => types.size > 1).length;
  if (crossSheetPhoneCount > 0) warnings.push(`检测到 ${crossSheetPhoneCount} 个手机号同时存在于综合和特渠白名单，已按客户类型分别保留。`);
  return { rows, warnings, sheetCounts, crossSheetPhoneCount };
}

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

function ProductArt({ atlas, imageUrl, alt = "商品图片" }: { atlas: number; imageUrl?: string; alt?: string }) {
  return imageUrl ? <img className="product-art product-photo" src={imageUrl} alt={alt} /> : <span className={`product-art atlas-${atlas}`} role="img" aria-label="临时商品图" />;
}

type PreviewImage = { url: string; fileName?: string };

function ProductImageViewer({ productName, images, initialIndex = 0, status, onClose }: { productName: string; images: PreviewImage[]; initialIndex?: number; status?: string; onClose: () => void }) {
  const [activeIndex, setActiveIndex] = useState(Math.min(Math.max(initialIndex, 0), Math.max(images.length - 1, 0)));
  const [zoomed, setZoomed] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const currentImage = images[activeIndex];
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (images.length > 1 && event.key === "ArrowLeft") setActiveIndex((index) => (index - 1 + images.length) % images.length);
      if (images.length > 1 && event.key === "ArrowRight") setActiveIndex((index) => (index + 1) % images.length);
    };
    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [images.length, onClose]);
  if (!currentImage) return null;
  const goTo = (index: number) => {
    setActiveIndex((index + images.length) % images.length);
    setZoomed(false);
  };
  const handleTouchEnd = (event: React.TouchEvent) => {
    if (touchStartX.current === null || images.length < 2) return;
    const distance = event.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(distance) > 45) goTo(activeIndex + (distance < 0 ? 1 : -1));
    touchStartX.current = null;
  };
  return (
    <div className="product-image-viewer" role="dialog" aria-modal="true" aria-label={`${productName}图片预览`} onClick={onClose}>
      <div className="product-image-viewer-panel" onClick={(event) => event.stopPropagation()}>
        <header><div><b>{productName}</b><small>{images.length > 1 ? `${activeIndex + 1} / ${images.length}` : "商品图片"}{status ? ` · ${status}` : ""}</small></div><button type="button" aria-label="关闭图片预览" onClick={onClose}>×</button></header>
        <div className={`product-image-viewer-stage ${zoomed ? "zoomed" : ""}`} onTouchStart={(event) => { touchStartX.current = event.touches[0].clientX; }} onTouchEnd={handleTouchEnd}>
          {images.length > 1 && <button type="button" className="product-image-viewer-arrow prev" aria-label="上一张图片" onClick={() => goTo(activeIndex - 1)}>‹</button>}
          <img src={currentImage.url} alt={`${productName} ${activeIndex + 1}`} onClick={() => setZoomed((value) => !value)} />
          {images.length > 1 && <button type="button" className="product-image-viewer-arrow next" aria-label="下一张图片" onClick={() => goTo(activeIndex + 1)}>›</button>}
        </div>
        <footer><span>{currentImage.fileName || `${activeIndex + 1} / ${images.length}`}</span><button type="button" className="product-image-viewer-zoom" onClick={() => setZoomed((value) => !value)}>{zoomed ? "还原大小" : "放大图片"}</button></footer>
        {images.length > 1 && <div className="product-image-viewer-thumbs" aria-label="图片缩略图列表">{images.map((image, index) => <button type="button" key={`${image.url}-${index}`} className={index === activeIndex ? "active" : ""} aria-label={`查看第 ${index + 1} 张图片`} onClick={() => goTo(index)}><img src={image.url} alt="" /></button>)}</div>}
      </div>
    </div>
  );
}

type SubmittedOrderItem = { product: Product; quantity: number };

function H5Prototype({ activityClosed, importedRows, importedWhitelistRows }: { activityClosed: boolean; importedRows: ProductImportRow[] | null; importedWhitelistRows: WhitelistRow[] | null }) {
  const catalog = useMemo(() => importedRows ? importedRows.map(productRowToProduct) : products, [importedRows]);
  const [step, setStep] = useState<H5Step>("channel");
  const [channel, setChannel] = useState<H5Channel>("");
  const [region, setRegion] = useState("");
  const [verifiedBranch, setVerifiedBranch] = useState("");
  const [verifiedIdentity, setVerifiedIdentity] = useState<WhitelistRow | null>(null);
  const [submittedIdentity, setSubmittedIdentity] = useState<WhitelistRow | null>(null);
  const [phone, setPhone] = useState("13800138000");
  const [verifyError, setVerifyError] = useState("");
  const [rebate, setRebate] = useState(true);
  const [line, setLine] = useState("全部");
  const [search, setSearch] = useState("");
  const [previewProduct, setPreviewProduct] = useState<Product | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [orderStatus, setOrderStatus] = useState<H5OrderStatus>("none");
  const [submitMode, setSubmitMode] = useState<"first" | "update">("first");
  const [orderVersion, setOrderVersion] = useState(0);
  const [orderUpdatedAt, setOrderUpdatedAt] = useState("07-28 14:52");
  const [orderWithdrawnAt, setOrderWithdrawnAt] = useState("");
  const [orderEvents, setOrderEvents] = useState<Array<{ time: string; title: string; detail: string }>>([]);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [submittedQuantities, setSubmittedQuantities] = useState<Record<string, number>>({});
  const [submittedItems, setSubmittedItems] = useState<SubmittedOrderItem[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({ "1": 2, "3": 1 });
  const lineOptions = useMemo(() => ["全部", ...Array.from(new Set(catalog.map((product) => product.line).filter(Boolean)))], [catalog]);
  const effectiveLine = lineOptions.includes(line) ? line : "全部";
  const h5CustomerType = channel === "综合客户" ? "综合" : "特渠";
  const visibleProducts = catalog.filter(
    (p) => p.status === "有效"
      && (p.customerType === "全部" || p.customerType === h5CustomerType)
      && p.rebate === rebate
      && (p.branchScope.length === 0 || p.branchScope.includes(verifiedBranch))
      && (effectiveLine === "全部" || p.line === effectiveLine)
      && p.name.includes(search),
  );
  const selected = catalog.filter((p) => (quantities[p.id] || 0) > 0);
  const totalBoxes = selected.reduce((sum, p) => sum + quantities[p.id], 0);
  const totalAmount = selected.reduce((sum, p) => sum + quantities[p.id] * p.price, 0);
  const orderViewQuantities = submittedQuantities;
  const orderViewSelected = submittedItems.map((item) => item.product);
  const orderViewBoxes = orderViewSelected.reduce((sum, p) => sum + orderViewQuantities[p.id], 0);
  const orderViewAmount = orderViewSelected.reduce((sum, p) => sum + orderViewQuantities[p.id] * p.price, 0);
  const importedIdentity = verifiedIdentity ?? submittedIdentity;
  const identityRegion = importedIdentity?.region || region;
  const identityBranch = importedIdentity?.branch || verifiedBranch;
  const identityLabel = importedIdentity ? `${importedIdentity.customerType}${identityRegion ? ` · ${identityRegion}` : ""}` : channel === "综合客户" ? `综合客户 · ${region}` : "特渠专业客户";
  const dealerName = importedIdentity?.dealerFull || (channel === "综合客户" ? "上海爱尚真贸易有限公司" : "北京智享云采经贸有限公司");

  const changeQty = (id: string, delta: number) => {
    setQuantities((old) => ({ ...old, [id]: Math.max(0, (old[id] || 0) + delta) }));
  };

  const startEditingOrder = () => {
    if (orderStatus === "withdrawn") setQuantities({ ...submittedQuantities });
    setStep("order");
  };

  const verifyIdentity = () => {
    if (activityClosed && orderStatus === "none") return;
    const normalizedPhone = normalizePhone(phone);
    if (importedWhitelistRows) {
      const expectedType: WhitelistRow["customerType"] = channel === "综合客户" ? "综合客户" : "特渠专业客户";
      const identity = importedWhitelistRows.find((item) => item.status === "有效" && item.customerType === expectedType && normalizePhone(item.dealerPhone) === normalizedPhone);
      if (!identity) {
        const otherChannelIdentity = importedWhitelistRows.find((item) => item.status === "有效" && normalizePhone(item.dealerPhone) === normalizedPhone);
        setVerifyError(otherChannelIdentity ? `该手机号登记在${otherChannelIdentity.customerType}白名单中，请返回选择对应订货通道。` : "该手机号不在本次活动白名单中，请核对后重新输入。");
        return;
      }
      if (expectedType === "综合客户" && identity.region !== region) {
        setVerifyError(`该手机号登记为综合客户 · ${identity.region}，请重新选择订货大区。`);
        return;
      }
      setVerifyError("");
      setVerifiedIdentity(identity);
      setVerifiedBranch(identity.branch);
      setStep(orderStatus === "none" ? "order" : "submitted");
      return;
    }
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
    setVerifiedIdentity(null);
    setVerifiedBranch(identity.branch);
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
                  <button onClick={() => { setChannel("综合客户"); setRegion(""); setVerifiedBranch(""); setVerifiedIdentity(null); setStep("region"); }}>
                    <i className="channel-icon">综</i>
                    <span><b>综合客户订货</b><small>综合经销商 · 进入后选择所属大区</small></span>
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
                <small>{identityLabel} · {identityBranch || "未标注分公司"} · {importedIdentity?.dealerName || "联系人王女士"} · {importedIdentity ? `手机 ${maskPhone(importedIdentity.dealerPhone)}` : "138****8000"}</small>
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
                {lineOptions.map((item) => (
                  <button key={item} className={line === item ? "active" : ""} onClick={() => setLine(item)}>{item}</button>
                ))}
              </div>
              <div className="product-list">
                {visibleProducts.map((product) => (
                  <article className="product-card" key={product.id}>
                    <button type="button" className="product-image product-image-button" disabled={!product.imageUrls?.length} aria-label={`查看${product.name}商品图片`} onClick={() => product.imageUrls?.length && setPreviewProduct(product)}><ProductArt atlas={product.atlas} imageUrl={product.imageUrl} alt={product.name} />{product.gift && <span className="gift-badge">礼盒</span>}</button>
                    <div className="product-info">
                      <span className="material-code">物料 {product.materialCode || `原型-${product.id}`}</span>
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
                      <ProductArt atlas={product.atlas} imageUrl={product.imageUrl} alt={product.name} />
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
              <div className="confirm-hero"><span>请核对订货信息</span><h2>{dealerName}</h2><small>{identityLabel}{identityBranch ? ` · ${identityBranch}` : ""}</small></div>
              <div className="confirm-list">
                {selected.map((product) => (
                  <div key={product.id}>
                    <ProductArt atlas={product.atlas} imageUrl={product.imageUrl} alt={product.name} />
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
                setSubmittedItems(selected.map((product) => ({ product: { ...product, branchScope: [...product.branchScope] }, quantity: quantities[product.id] })));
                setSubmittedIdentity(verifiedIdentity ? { ...verifiedIdentity } : null);
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
                    <ProductArt atlas={product.atlas} imageUrl={product.imageUrl} alt={product.name} />
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
              <button className="ghost-btn" onClick={() => { setChannel(""); setRegion(""); setVerifiedBranch(""); setVerifiedIdentity(null); setStep("channel"); }}>返回活动首页</button>
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
      {previewProduct && <ProductImageViewer productName={previewProduct.name} images={(previewProduct.imageUrls ?? []).map((url, index) => ({ url, fileName: `${previewProduct.name} · 第 ${index + 1} 张` }))} onClose={() => setPreviewProduct(null)} />}
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

type LotteryDisplayCandidate = {
  id: string;
  displayName: string;
  attendeeName: string;
  customerType: AttendanceCustomerType | "";
};

function attendanceCompanyKey(value: string) {
  return normalizeSearchText(value).replace(/[()（）\[\]【】{}：:，,。·\-_/\\]/g, "");
}

function getAttendanceCandidates(rows: AttendanceRow[], customerType: LotteryRound["customerType"]): LotteryDisplayCandidate[] {
  const seenCompanies = new Set<string>();
  return [...rows]
    .filter((row) => row.dealerCompany.trim() && attendancePhoneIsValid(row.contactPhone) && (customerType === "全部客户" || row.customerType === customerType))
    .sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id))
    .filter((row) => {
      const key = attendanceCompanyKey(row.dealerCompany);
      if (!key || seenCompanies.has(key)) return false;
      seenCompanies.add(key);
      return true;
    })
    .map((row) => ({ id: row.id, displayName: row.dealerCompany.trim(), attendeeName: row.dealerName.trim(), customerType: row.customerType }));
}

function LotteryBoard({ rounds, attendanceRows, onComplete }: { rounds: LotteryRound[]; attendanceRows: AttendanceRow[]; onComplete: (id: number) => void }) {
  const [status, setStatus] = useState<"ready" | "rolling" | "done" | "finished">("ready");
  const [ticker, setTicker] = useState(0);
  const [sessionFinished, setSessionFinished] = useState(false);
  const [drawnCandidateNames, setDrawnCandidateNames] = useState<string[]>([]);
  const availableRounds = rounds.filter((item) => item.status !== "draft");
  const [roundId, setRoundId] = useState(availableRounds.find((item) => item.status === "published")?.id ?? availableRounds[0]?.id ?? 0);
  const currentRound = availableRounds.find((item) => item.id === roundId) ?? availableRounds[0];
  useEffect(() => {
    if (status !== "rolling") return;
    const timer = window.setInterval(() => setTicker((n) => n + 1), 90);
    return () => window.clearInterval(timer);
  }, [status]);
  const attendanceCandidates = currentRound?.scope === "attended" ? getAttendanceCandidates(attendanceRows, currentRound.customerType) : [];
  const candidateNames = currentRound?.scope === "attended" ? attendanceCandidates.map((candidate) => candidate.displayName) : dealerNames;
  const availableCandidateNames = currentRound?.excludeWinners ? candidateNames.filter((name) => !drawnCandidateNames.includes(name)) : candidateNames;
  const winners = Array.from({ length: Math.min(currentRound?.winnerCount ?? 0, availableCandidateNames.length) }, (_, i) => availableCandidateNames[(ticker + i * 3) % availableCandidateNames.length]);
  const noCandidates = currentRound?.scope === "attended" && availableCandidateNames.length === 0;
  if (!currentRound) return <section className="screen-board lottery-board"><div className="lottery-ready"><h2>暂无已发布抽奖轮次</h2></div></section>;
  const handleAction = () => {
    if (sessionFinished || noCandidates) return;
    if (status === "ready") setStatus("rolling");
    else if (status === "rolling") {
      setStatus("done");
    } else if (status === "done") {
      setDrawnCandidateNames((current) => [...new Set([...current, ...winners])]);
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
        <div className="lottery-ready"><div className="lucky-seal">福</div><h2>{noCandidates ? "暂无符合条件的现场到场客户" : "好运即将揭晓"}</h2><p>{currentRound.scope === "attended" ? `当前候选池：${availableCandidateNames.length} 家经销商` : "现场抽奖准备就绪"}</p></div>
      ) : (
        <div className={`winner-grid ${status}`}>
          {winners.map((name, index) => <div key={`${name}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><b>{name}</b></div>)}
        </div>
      )}
      <button className={`lottery-action ${status}`} onClick={handleAction} disabled={sessionFinished || noCandidates || (currentRound.status === "completed" && status === "ready")}>
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
  branchScope: string;
  status: "有效" | "待完善" | "停用";
  manuallyEdited?: boolean;
  source?: "excel" | "manual";
  sourceSheet?: string;
  images?: ProductImageAsset[];
  imageStatus?: ProductImageStatus;
  importAction?: ProductImportAction;
};

type ProductImportAction = "新增" | "更新" | "未变更" | "疑似重复" | "待确认";

type ProductImportStats = {
  added: number;
  updated: number;
  unchanged: number;
  suspected: number;
  pending: number;
  removed: number;
};

const emptyProductImportStats: ProductImportStats = { added: 0, updated: 0, unchanged: 0, suspected: 0, pending: 0, removed: 0 };

type ProductImageStatus = "未上传" | "已匹配" | "待确认" | "未匹配" | "手动维护";

type ProductImageSource = "zip" | "manual";

type ProductImageAsset = {
  id: string;
  fileName: string;
  url: string;
  normalizedName: string;
  source?: ProductImageSource;
};

type ProductImageStats = {
  totalImages: number;
  matchedProducts: number;
  pendingProducts: number;
  unmatchedProducts: number;
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
  status: "有效" | "待处理";
  identityKey?: string;
  source?: "excel" | "manual";
  sourceSheet?: string;
  manuallyEdited?: boolean;
  importAction?: WhitelistImportAction;
};

type WhitelistImportAction = "新增" | "电话已更新" | "信息已更新" | "未变更" | "名称重复" | "电话待处理" | "名称待处理";

type WhitelistImportStats = {
  added: number;
  phoneUpdated: number;
  updated: number;
  unchanged: number;
  duplicateName: number;
  pendingPhone: number;
  pendingName: number;
  removed: number;
};

const emptyWhitelistImportStats: WhitelistImportStats = { added: 0, phoneUpdated: 0, updated: 0, unchanged: 0, duplicateName: 0, pendingPhone: 0, pendingName: 0, removed: 0 };

type AttendanceRow = {
  id: string;
  sequence: number;
  dealerName: string;
  gender: string;
  contactPhone: string;
  branch: string;
  dealerCompany: string;
  participantType: string;
  customerType: AttendanceCustomerType | "";
  sourceSheet?: string;
  manuallyEdited?: boolean;
};

type AttendanceCustomerType = "综合客户" | "特渠专业客户";

function normalizeWhitelistName(value: string) {
  return normalizeSearchText(value).replace(/[\s\-_/\\()[\]【】{}：:，,。·]/g, "");
}

function whitelistIdentityKey(row: WhitelistRow) {
  const name = normalizeWhitelistName(row.dealerFull);
  return name ? `${row.customerType}:${name}` : "";
}

function whitelistPhoneIsValid(value: string) {
  return /^1\d{10}$/.test(normalizePhone(value));
}

function whitelistProfileEqual(a: WhitelistRow, b: WhitelistRow) {
  const fields: Array<keyof WhitelistRow> = ["customerType", "region", "branch", "dealerShort", "dealerFull", "dealerType", "dealerName", "confirmerName", "confirmerPhone"];
  return fields.every((field) => String(a[field] ?? "").trim() === String(b[field] ?? "").trim());
}

function whitelistRowsEqual(a: WhitelistRow, b: WhitelistRow) {
  return whitelistProfileEqual(a, b) && normalizePhone(a.dealerPhone) === normalizePhone(b.dealerPhone) && a.status === b.status;
}

function cloneWhitelistRows(rows: WhitelistRow[]) {
  return rows.map((row) => ({ ...row }));
}

function replaceWhitelistImportRows(existingRows: WhitelistRow[], incomingRows: WhitelistRow[]) {
  const rows: WhitelistRow[] = [];
  const stats: WhitelistImportStats = { ...emptyWhitelistImportStats };
  const warnings: string[] = [];
  const usedExistingIds = new Set<string>();
  const incomingNameCounts = new Map<string, number>();
  incomingRows.forEach((row) => {
    const key = whitelistIdentityKey(row);
    if (key) incomingNameCounts.set(key, (incomingNameCounts.get(key) ?? 0) + 1);
  });

  incomingRows.forEach((incomingRow) => {
    const identityKey = whitelistIdentityKey(incomingRow);
    const incomingPhoneValid = whitelistPhoneIsValid(incomingRow.dealerPhone);
    const incomingPhonePending = !incomingPhoneValid || incomingRow.status !== "有效";
    const nameIsMissing = !identityKey;
    const nameIsDuplicated = Boolean(identityKey && (incomingNameCounts.get(identityKey) ?? 0) > 1);

    if (nameIsMissing || nameIsDuplicated) {
      rows.push({ ...incomingRow, source: "excel", status: "待处理", identityKey: identityKey || undefined, importAction: nameIsMissing ? "名称待处理" : "名称重复" });
      stats.added += 1;
      if (nameIsMissing) stats.pendingName += 1;
      else stats.duplicateName += 1;
      if (incomingPhonePending) stats.pendingPhone += 1;
      return;
    }

    const candidates = existingRows.filter((row) => !usedExistingIds.has(row.id) && whitelistIdentityKey(row) === identityKey);
    if (candidates.length > 1) {
      rows.push({ ...incomingRow, source: "excel", status: "待处理", identityKey, importAction: "名称重复" });
      stats.added += 1;
      stats.duplicateName += 1;
      if (incomingPhonePending) stats.pendingPhone += 1;
      return;
    }

    if (candidates.length === 1) {
      const current = candidates[0];
      usedExistingIds.add(current.id);
      const nextStatus: WhitelistRow["status"] = incomingPhonePending ? "待处理" : "有效";
      const nextRow: WhitelistRow = {
        ...incomingRow,
        id: current.id,
        source: "excel",
        sourceSheet: incomingRow.sourceSheet,
        identityKey,
        status: nextStatus,
        importAction: undefined,
        manuallyEdited: undefined,
      };
      if (incomingPhonePending) {
        nextRow.importAction = "电话待处理";
        stats.pendingPhone += 1;
      } else if (normalizePhone(current.dealerPhone) !== normalizePhone(incomingRow.dealerPhone)) {
        nextRow.importAction = "电话已更新";
        stats.phoneUpdated += 1;
      } else if (whitelistRowsEqual(current, nextRow)) {
        nextRow.importAction = "未变更";
        stats.unchanged += 1;
      } else {
        nextRow.importAction = "信息已更新";
        stats.updated += 1;
      }
      rows.push(nextRow);
      return;
    }

    const nextRow: WhitelistRow = { ...incomingRow, source: "excel", identityKey, status: incomingPhonePending ? "待处理" : "有效", importAction: incomingPhonePending ? "电话待处理" : "新增" };
    rows.push(nextRow);
    stats.added += 1;
    if (incomingPhonePending) stats.pendingPhone += 1;
  });

  stats.removed = existingRows.filter((row) => !usedExistingIds.has(row.id)).length;

  if (stats.duplicateName > 0) warnings.push(`有 ${stats.duplicateName} 条白名单客户在同一客户类型下名称全称重复，已标记为“名称重复”。`);
  if (stats.pendingName > 0) warnings.push(`有 ${stats.pendingName} 条白名单客户缺少经销商名称全称，已标记为“名称待处理”。`);
  if (stats.pendingPhone > 0) warnings.push(`有 ${stats.pendingPhone} 条白名单客户电话为空、格式异常或存在重复，已标记为“电话待处理”。`);
  if (stats.removed > 0) warnings.push(`本次 Excel 未包含上次的 ${stats.removed} 名客户，确认后将从当前有效白名单中移除；已有订单不会被删除。`);
  return { rows, stats, warnings };
}

function clearWhitelistImportAction(row: WhitelistRow) {
  const cleanRow = { ...row };
  delete cleanRow.importAction;
  return cleanRow;
}

type AttendanceFieldKey = "dealerName" | "gender" | "contactPhone" | "branch" | "participantType" | "dealerCompany";

type AttendanceImportParseResult = {
  rows: AttendanceRow[];
  warnings: string[];
  sheetCounts: Array<{ name: string; count: number }>;
};

type AttendanceImportDraft = AttendanceImportParseResult & { fileName: string };

let localImportRowId = 0;
const createImportRowId = (prefix: string) => {
  localImportRowId += 1;
  return `${prefix}-${localImportRowId}`;
};

function normalizeProductIdentityText(value: string) {
  return normalizeSearchText(value).replace(/[\s\-_/\\()[\]【】{}：:，,。·×xX*]/g, "");
}

function productChannelKey(row: ProductImportRow) {
  return `${row.customerType}|${row.rebate}`;
}

function productCodeKey(row: ProductImportRow) {
  const code = normalizeMaterialCode(row.materialCode);
  return code ? `${productChannelKey(row)}|${code}` : "";
}

function productNoCodeKey(row: ProductImportRow) {
  return `${productChannelKey(row)}|${normalizeProductIdentityText(row.materialName)}|${normalizeProductIdentityText(row.spec)}|${normalizeProductIdentityText(row.casePack)}`;
}

function productNameKey(row: ProductImportRow) {
  return `${productChannelKey(row)}|${normalizeProductIdentityText(row.materialName)}`;
}

function productRowsEqual(a: ProductImportRow, b: ProductImportRow) {
  const fields: Array<keyof ProductImportRow> = ["customerType", "rebate", "category", "line", "materialCode", "materialName", "brand", "variety", "spec", "casePack", "unitPrice", "casePrice", "conversion", "gift", "branchScope", "status"];
  return fields.every((field) => String(a[field] ?? "").trim() === String(b[field] ?? "").trim());
}

function replaceProductImportRows(existingRows: ProductImportRow[], incomingRows: ProductImportRow[]) {
  const rows: ProductImportRow[] = [];
  const stats: ProductImportStats = { ...emptyProductImportStats };
  const warnings: string[] = [];
  const usedExistingIds = new Set<string>();

  incomingRows.forEach((incomingRow) => {
    const code = productCodeKey(incomingRow);
    const legacyKey = productNoCodeKey(incomingRow);
    const incomingKeyRows = incomingRows.filter((row) => code ? productCodeKey(row) === code : !row.materialCode.trim() && productNoCodeKey(row) === legacyKey);
    let candidates = existingRows.filter((row) => !usedExistingIds.has(row.id) && (code ? productCodeKey(row) === code : !row.materialCode.trim() && productNoCodeKey(row) === legacyKey));

    // 首次没有物料代码、后续补上物料代码时，允许唯一的无代码旧记录被识别为同一商品。
    if (candidates.length === 0 && code) {
      candidates = existingRows.filter((row) => !usedExistingIds.has(row.id) && !row.materialCode.trim() && productNoCodeKey(row) === legacyKey);
    }

    if (incomingKeyRows.length > 1 || candidates.length > 1) {
      stats.pending += 1;
      rows.push({ ...incomingRow, source: "excel", importAction: "待确认" });
      return;
    }

    if (candidates.length === 1) {
      const current = candidates[0];
      usedExistingIds.add(current.id);
      const manualImages = current.images?.filter((image) => image.source === "manual") ?? [];
      const same = productRowsEqual(current, incomingRow);
      rows.push({
        ...incomingRow,
        id: current.id,
        source: "excel",
        images: manualImages.length > 0 ? manualImages : incomingRow.images,
        imageStatus: manualImages.length > 0 ? "手动维护" : incomingRow.imageStatus,
        manuallyEdited: undefined,
        importAction: same ? "未变更" : "更新",
      });
      if (same) stats.unchanged += 1;
      else stats.updated += 1;
      return;
    }

    const sameNameExists = rows.some((row) => productNameKey(row) === productNameKey(incomingRow));
    const importAction: ProductImportAction = sameNameExists ? "疑似重复" : "新增";
    rows.push({ ...incomingRow, source: "excel", importAction });
    if (importAction === "疑似重复") stats.suspected += 1;
    else stats.added += 1;
  });

  stats.removed = existingRows.filter((row) => !usedExistingIds.has(row.id)).length;

  if (stats.suspected > 0) warnings.push(`有 ${stats.suspected} 条商品名称相同但未能按物料代码唯一匹配，已标记为“疑似重复”，请确认后再导入。`);
  if (stats.pending > 0) warnings.push(`有 ${stats.pending} 条商品存在多个候选匹配，已标记为“待确认”，请编辑或删除异常行。`);
  if (stats.removed > 0) warnings.push(`本次 Excel 未包含上次的 ${stats.removed} 条商品，确认后将从当前有效商品中移除；已有订单不会被删除。`);
  return { rows, stats, warnings };
}

function clearProductImportAction(row: ProductImportRow) {
  const cleanRow = { ...row };
  delete cleanRow.importAction;
  return cleanRow;
}

function cloneProductRows(rows: ProductImportRow[]) {
  return rows.map((row) => ({ ...row, images: row.images ? [...row.images] : undefined }));
}

const initialAttendanceRows: AttendanceRow[] = [
  { id: "attendance-demo-1", sequence: 1, dealerName: "王惠", gender: "女", contactPhone: "13800000001", branch: "长沙分", dealerCompany: "长沙久茂食品有限公司", participantType: "综合经销商", customerType: "综合客户" },
  { id: "attendance-demo-2", sequence: 2, dealerName: "刘宇剑", gender: "男", contactPhone: "13800000002", branch: "长沙分", dealerCompany: "湘潭餐乐商贸有限公司", participantType: "综合经销商", customerType: "综合客户" },
  { id: "attendance-demo-3", sequence: 3, dealerName: "赵敏", gender: "女", contactPhone: "13800000003", branch: "北京分", dealerCompany: "北京惠通达行商贸有限公司", participantType: "综合经销商", customerType: "综合客户" },
  { id: "attendance-demo-4", sequence: 4, dealerName: "陈涛", gender: "男", contactPhone: "13800000004", branch: "武汉分", dealerCompany: "湖北中合誉品商贸有限公司", participantType: "综合经销商", customerType: "综合客户" },
  { id: "attendance-demo-5", sequence: 5, dealerName: "王凡", gender: "男", contactPhone: "13800000005", branch: "长沙分", dealerCompany: "深圳市智臻云采科技有限公司", participantType: "特渠专业经销商", customerType: "特渠专业客户" },
  { id: "attendance-demo-6", sequence: 6, dealerName: "郑总", gender: "男", contactPhone: "13800000006", branch: "厦门分", dealerCompany: "泉州乐食光商贸有限公司", participantType: "特渠专业经销商", customerType: "特渠专业客户" },
  { id: "attendance-demo-7", sequence: 7, dealerName: "李想", gender: "女", contactPhone: "13800000007", branch: "北京分", dealerCompany: "北京谷力供应链管理有限公司", participantType: "特渠专业经销商", customerType: "特渠专业客户" },
  { id: "attendance-demo-8", sequence: 8, dealerName: "周宁", gender: "男", contactPhone: "13800000008", branch: "上海分", dealerCompany: "上海爱尚真贸易有限公司", participantType: "综合经销商", customerType: "综合客户" },
];

const initialProductImportRows: ProductImportRow[] = [
  { id: "product-1", sequence: 1, customerType: "特渠", rebate: "参与", category: "特渠定制产品", line: "调味油", materialCode: "7245-0002307", materialName: "金芝御礼225ML×4礼盒", brand: "金龙鱼", variety: "芝麻油", spec: "225mL×5", casePack: "5盒/箱", unitPrice: "34.50", casePrice: "172.50", conversion: "0.00092", gift: "是", branchScope: "", status: "有效", source: "excel", sourceSheet: "特渠参与返利" },
  { id: "product-2", sequence: 1, customerType: "特渠", rebate: "不参与", category: "特渠定制品", line: "酱油", materialCode: "7217-0001957", materialName: "四海祯享礼盒", brand: "金龙鱼", variety: "礼盒", spec: "500mL×2+500mL+530g", casePack: "6盒/箱", unitPrice: "19.30", casePrice: "117.00", conversion: "", gift: "是", branchScope: "", status: "待完善", source: "excel", sourceSheet: "特渠不参与返利" },
  { id: "product-3", sequence: 1, customerType: "综合", rebate: "参与", category: "全渠道适用通品", line: "调味油", materialCode: "7455-02F003", materialName: "金龙鱼芝麻香油礼盒", brand: "金龙鱼", variety: "芝麻油", spec: "145mL×4", casePack: "15盒/箱", unitPrice: "28.00", casePrice: "420.00", conversion: "0.00125", gift: "是", branchScope: "", status: "有效", source: "excel", sourceSheet: "综合参与返利" },
  { id: "product-4", sequence: 1, customerType: "综合", rebate: "不参与", category: "通用品调味油", line: "调味油", materialCode: "7455-01P702", materialName: "香满园芝麻油245mL×12", brand: "香满园", variety: "芝麻油", spec: "245mL", casePack: "12瓶/箱", unitPrice: "6.90", casePrice: "82.80", conversion: "0.00270", gift: "否", branchScope: "", status: "有效", source: "excel", sourceSheet: "综合不参与返利" },
];

const initialWhitelistRows: WhitelistRow[] = [
  { id: "whitelist-1", sequence: 1, customerType: "综合客户", region: "南区", branch: "长沙分", dealerShort: "长沙久茂", dealerFull: "长沙久茂食品有限公司", dealerType: "综合经销商", dealerName: "王惠", dealerPhone: "14712341979", confirmerName: "张学文", confirmerPhone: "13912346386", status: "有效", source: "excel" },
  { id: "whitelist-2", sequence: 2, customerType: "综合客户", region: "南区", branch: "长沙分", dealerShort: "湘潭餐乐", dealerFull: "湘潭餐乐商贸有限公司", dealerType: "综合经销商", dealerName: "刘宇剑", dealerPhone: "13712340822", confirmerName: "张学文", confirmerPhone: "13912346386", status: "有效", source: "excel" },
  { id: "whitelist-3", sequence: 1, customerType: "特渠专业客户", region: "南区", branch: "长沙分", dealerShort: "深圳市智臻云采", dealerFull: "深圳市智臻云采科技有限公司", dealerType: "特渠专业经销商", dealerName: "王凡", dealerPhone: "18812344733", confirmerName: "官国梁", confirmerPhone: "15912346519", status: "有效", source: "excel" },
  { id: "whitelist-4", sequence: 2, customerType: "特渠专业客户", region: "南区", branch: "厦门分", dealerShort: "泉州乐食光", dealerFull: "泉州乐食光商贸有限公司", dealerType: "特渠专业经销商", dealerName: "郑总", dealerPhone: "15212347241", confirmerName: "窦任重", confirmerPhone: "18612342331", status: "有效", source: "excel" },
];

const attendanceFieldConfig: Array<{ key: AttendanceFieldKey; label: string; aliases: string[] }> = [
  { key: "branch", label: "分公司", aliases: ["分公司", "分公司名称", "所属分公司"] },
  { key: "dealerName", label: "参会人姓名", aliases: ["参会人姓名", "经销商姓名", "联系人姓名", "客户姓名", "姓名"] },
  { key: "gender", label: "性别", aliases: ["性别"] },
  { key: "contactPhone", label: "参会人电话", aliases: ["参会人电话", "联系电话", "经销商电话", "手机号", "手机号码", "电话"] },
  { key: "participantType", label: "参会人员类型", aliases: ["参会人员类型", "客户类型", "客户类别", "订货通道", "渠道类型"] },
  { key: "dealerCompany", label: "经销商名称", aliases: ["经销商名称", "经销商名称（全）", "经销商全称", "客户名称", "单位名称"] },
];

function attendanceCustomerType(participantType: string): AttendanceCustomerType | "" {
  const normalized = normalizeSearchText(participantType);
  if (normalized.includes("特渠")) return "特渠专业客户";
  if (normalized.includes("综合")) return "综合客户";
  return "";
}

function attendancePhoneIsValid(value: string) {
  return /^1\d{10}$/.test(normalizePhone(value));
}

function findAttendanceFieldIndex(header: string[], aliases: string[]) {
  const normalized = header.map(normalizedHeader);
  const normalizedAliases = aliases.map(normalizedHeader);
  const exactIndex = normalized.findIndex((value) => normalizedAliases.includes(value));
  if (exactIndex >= 0) return exactIndex;
  return normalized.findIndex((value) => normalizedAliases.some((alias) => value.includes(alias)));
}

async function parseAttendanceWorkbook(file: File): Promise<AttendanceImportParseResult> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", raw: false });
  const rows: AttendanceRow[] = [];
  const warnings: string[] = [];
  const sheetCounts: Array<{ name: string; count: number }> = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
    const headerIndex = matrix.findIndex((values) => values.filter((value) => textCell(value) !== "").length >= 2);
    if (headerIndex < 0) {
      warnings.push(`${sheetName} 没有识别到表头，已跳过。`);
      continue;
    }
    const header = (matrix[headerIndex] ?? []).map((value) => textCell(value));
    const indexes = Object.fromEntries(attendanceFieldConfig.map((field) => [field.key, findAttendanceFieldIndex(header, field.aliases)])) as Record<AttendanceFieldKey, number>;
    const missingFields = attendanceFieldConfig.filter((field) => indexes[field.key] < 0).map((field) => field.label);
    if (missingFields.length > 0) throw new Error(`${sheetName} 缺少必需字段：${missingFields.join("、")}。请按“现场参会名单.xlsx”模板整理后重新导入。`);
    let sheetCount = 0;
    for (let index = headerIndex + 1; index < matrix.length; index += 1) {
      const values = matrix[index] ?? [];
      if (values.every((value) => textCell(value) === "")) continue;
      const get = (field: AttendanceFieldKey) => indexes[field] >= 0 ? textCell(values[indexes[field]]) : "";
      const participantType = get("participantType");
      const contactPhone = get("contactPhone");
      const dealerCompany = get("dealerCompany");
      if (!contactPhone) warnings.push(`${sheetName} 第 ${index + 1} 行未填写参会人电话，该行不会进入现场抽奖候选池。`);
      else if (!attendancePhoneIsValid(contactPhone)) warnings.push(`${sheetName} 第 ${index + 1} 行参会人电话格式异常：${contactPhone}，该行不会进入现场抽奖候选池。`);
      if (!dealerCompany) warnings.push(`${sheetName} 第 ${index + 1} 行未填写经销商名称，该行不会进入现场抽奖候选池。`);
      if (participantType && !attendanceCustomerType(participantType)) warnings.push(`${sheetName} 第 ${index + 1} 行参会人员类型“${participantType}”未识别客户类型，请人工确认。`);
      rows.push({
        id: createImportRowId("attendance"),
        sequence: rows.length + 1,
        dealerName: get("dealerName"),
        gender: get("gender"),
        contactPhone,
        branch: get("branch"),
        dealerCompany,
        participantType,
        customerType: attendanceCustomerType(participantType),
        sourceSheet: sheetName,
      });
      sheetCount += 1;
    }
    sheetCounts.push({ name: sheetName, count: sheetCount });
  }
  if (rows.length === 0) throw new Error("Excel 中没有找到可展示的数据行，请检查文件内容。" );
  const duplicatePhones = Array.from(new Set(rows.map((row) => normalizePhone(row.contactPhone)).filter(Boolean).filter((phone, index, phones) => phones.indexOf(phone) !== index)));
  if (duplicatePhones.length > 0) warnings.push(`发现 ${duplicatePhones.length} 个重复参会人电话，请确认是否应保留多条记录；抽奖候选将按经销商名称去重。`);
  const duplicateCompanies = rows.map((row) => attendanceCompanyKey(row.dealerCompany)).filter(Boolean).filter((key, index, keys) => keys.indexOf(key) !== index);
  if (duplicateCompanies.length > 0) warnings.push(`发现 ${new Set(duplicateCompanies).size} 个重复经销商名称；抽奖候选将按经销商名称合并为一家。`);
  return { rows, warnings, sheetCounts };
}

const productImageExtensions = /\.(jpg|jpeg|png|webp|gif|bmp)$/i;

function productImageBaseName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

function normalizeProductImageName(value: string) {
  return productImageBaseName(value)
    .replace(productImageExtensions, "")
    .replace(/^20\d{6,8}/, "")
    .replace(/[-_](?:o|ok)$/i, "")
    .replace(/(?:主图|正面|背面|侧面|清晰图|清)\d*$/g, "")
    .replace(/(?:主图|正面|背面|侧面|清晰图|清)\d*$/g, "")
    .replace(/毫升/g, "ml")
    .replace(/[＊xX*]/g, "×")
    .replace(/\s+/g, "")
    .replace(/[-_，,。·／/\\()[\]【】{}：:]/g, "")
    .toLocaleLowerCase("zh-CN");
}

function productImageNameVariants(value: string) {
  const normalized = normalizeProductImageName(value);
  const withoutPackCount = normalized.replace(/×\d+$/, "");
  const withoutPackaging = normalized.replace(/玻璃瓶|纸箱|塑料袋|pe瓶|pet|葫芦瓶|礼盒随货|组装好发货|天津定制|河南定制|北京定制|武汉分特渠/g, "");
  const variants = [
    normalized,
    withoutPackCount,
    withoutPackaging,
    withoutPackaging.replace(/×\d+$/, ""),
    normalized.replace(/×/g, ""),
    withoutPackaging.replace(/×/g, ""),
  ];
  return [...new Set(variants)].filter((item) => item.length >= 6);
}

function productImageTextKey(value: string) {
  return normalizeProductImageName(value).replace(/[0-9.×]/g, "");
}

function productImageNumberTokens(value: string) {
  return new Set(normalizeProductImageName(value).match(/\d+(?:\.\d+)?/g) ?? []);
}

function productImageSimilarity(a: string, b: string) {
  const first = [...new Set(Array.from(a).map((_, index) => a.slice(index, index + 2)).filter((item) => item.length === 2))];
  const second = new Set(Array.from(b).map((_, index) => b.slice(index, index + 2)).filter((item) => item.length === 2));
  if (first.length === 0 || second.size === 0) return a === b ? 1 : 0;
  const common = first.filter((item) => second.has(item)).length;
  return (2 * common) / (first.length + second.size);
}

function scoreProductImageMatch(materialName: string, fileName: string) {
  const productVariants = productImageNameVariants(materialName);
  const imageVariants = productImageNameVariants(fileName);
  const strictMatch = productVariants.some((productVariant) => imageVariants.some((imageVariant) => imageVariant.includes(productVariant)));
  if (strictMatch) return 1;
  const productText = productImageTextKey(materialName);
  const imageText = productImageTextKey(fileName);
  const productNumbers = productImageNumberTokens(materialName);
  const imageNumbers = productImageNumberTokens(fileName);
  const commonNumbers = [...productNumbers].filter((item) => imageNumbers.has(item)).length;
  if (productText.length < 6 || commonNumbers === 0) return 0;
  const similarity = productImageSimilarity(productText, imageText);
  return similarity >= 0.5 && commonNumbers / productNumbers.size >= 0.5 ? similarity * 0.8 + commonNumbers / productNumbers.size * 0.2 : 0;
}

function matchProductImages(rows: ProductImportRow[], assets: ProductImageAsset[]) {
  const nextRows = rows.map((row) => {
    const manualImages = row.images?.filter((asset) => asset.source === "manual") ?? [];
    if (manualImages.length > 0 && row.imageStatus === "手动维护") return { ...row, images: manualImages, imageStatus: "手动维护" as const };
    if (assets.length === 0) return { ...row, images: undefined, imageStatus: "未上传" as const };
    const scored = assets.map((asset) => ({ asset, score: scoreProductImageMatch(row.materialName, asset.fileName) })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
    if (scored.length === 0) return { ...row, images: undefined, imageStatus: "未匹配" as const };
    if (scored[0].score === 1) {
      const exactAssets = scored.filter((item) => item.score === 1).map((item) => item.asset);
      return { ...row, images: exactAssets, imageStatus: "已匹配" as const };
    }
    const best = scored[0];
    const nextBest = scored[1];
    const isUnique = best.score >= 0.6 && (!nextBest || best.score - nextBest.score >= 0.08);
    return isUnique
      ? { ...row, images: [best.asset], imageStatus: "已匹配" as const }
      : { ...row, images: scored.slice(0, 4).map((item) => item.asset), imageStatus: "待确认" as const };
  });
  return {
    rows: nextRows,
    stats: {
      totalImages: assets.length,
      matchedProducts: nextRows.filter((row) => row.imageStatus === "已匹配").length,
      pendingProducts: nextRows.filter((row) => row.imageStatus === "待确认").length,
      unmatchedProducts: nextRows.filter((row) => row.imageStatus === "未匹配").length,
    } satisfies ProductImageStats,
  };
}

async function parseProductImageZip(file: File) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entries = Object.values(zip.files).filter((entry) => !entry.dir && productImageExtensions.test(entry.name));
  if (entries.length === 0) throw new Error("ZIP 中没有找到 JPG、PNG、WEBP、GIF 或 BMP 图片。");
  const assets = await Promise.all(entries.map(async (entry, index) => {
    const blob = await entry.async("blob");
    return { id: `product-image-${Date.now()}-${index}`, fileName: productImageBaseName(entry.name), url: URL.createObjectURL(blob), normalizedName: normalizeProductImageName(entry.name), source: "zip" } satisfies ProductImageAsset;
  }));
  return assets;
}

function revokeProductImageAssets(assets: ProductImageAsset[]) {
  assets.filter((asset) => asset.source !== "manual").forEach((asset) => URL.revokeObjectURL(asset.url));
}

const maxManualProductImageSize = 10 * 1024 * 1024;

function readManualProductImage(file: File) {
  return new Promise<ProductImageAsset>((resolve, reject) => {
    if (!productImageExtensions.test(file.name)) {
      reject(new Error(`${file.name} 不是支持的图片格式，请选择 JPG、PNG、WEBP、GIF 或 BMP。`));
      return;
    }
    if (file.size > maxManualProductImageSize) {
      reject(new Error(`${file.name} 超过 10MB，请压缩图片后再上传。`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`${file.name} 读取失败，请重新选择。`));
        return;
      }
      resolve({
        id: createImportRowId("product-image-manual"),
        fileName: file.name,
        url: reader.result,
        normalizedName: normalizeProductImageName(file.name),
        source: "manual",
      });
    };
    reader.onerror = () => reject(new Error(`${file.name} 读取失败，请重新选择。`));
    reader.readAsDataURL(file);
  });
}

async function createManualProductImageAssets(files: File[]) {
  return Promise.all(files.map((file) => readManualProductImage(file)));
}

function productImageStatusForAssets(images: ProductImageAsset[] | undefined, previousStatus: ProductImageStatus = "未上传") {
  if (!images?.length) return "未上传" as const;
  if (images.some((asset) => asset.source === "manual")) return "手动维护" as const;
  return previousStatus === "待确认" ? "待确认" as const : "已匹配" as const;
}

type DeleteTarget = {
  ids: string[];
  labels: string[];
  kind: "商品" | "白名单客户" | "现场到场客户";
  label?: string;
  description?: string;
  summary?: string;
};

const productSheetOrder = new Map(productSheetConfig.map((item, index) => [item.name, index]));
const whitelistSheetOrder = new Map(whitelistSheetConfig.map((item, index) => [item.name, index]));

function compareProductRows(a: ProductImportRow, b: ProductImportRow) {
  return (productSheetOrder.get(a.sourceSheet ?? "") ?? 99) - (productSheetOrder.get(b.sourceSheet ?? "") ?? 99)
    || a.sequence - b.sequence
    || a.customerType.localeCompare(b.customerType, "zh-CN")
    || a.rebate.localeCompare(b.rebate, "zh-CN")
    || a.id.localeCompare(b.id);
}

function compareWhitelistRows(a: WhitelistRow, b: WhitelistRow) {
  return (whitelistSheetOrder.get(a.sourceSheet ?? "") ?? 99) - (whitelistSheetOrder.get(b.sourceSheet ?? "") ?? 99)
    || a.sequence - b.sequence
    || a.id.localeCompare(b.id);
}

function DeleteConfirmDialog({ target, onCancel, onConfirm }: { target: DeleteTarget; onCancel: () => void; onConfirm: () => void }) {
  const labelPreview = target.labels.slice(0, 3).join("、");
  const extraCount = target.labels.length - 3;
  const countLabel = target.label ?? (target.ids.length === 1 ? target.kind : `${target.ids.length} 条${target.kind}`);
  return (
    <div className="delete-confirm" role="dialog" aria-modal="true" aria-label={`删除${target.kind}确认`} onClick={onCancel}>
      <div onClick={(event) => event.stopPropagation()}>
        <span className="delete-confirm-eyebrow">删除{target.kind}</span>
        <h3>确认删除{countLabel}？</h3>
        <p>{target.description ?? "删除后将从当前活动的可下单或身份验证列表中移除，已有订单不会被删除，订单明细和金额保持不变。"}</p>
        <div className="delete-confirm-items">
          <b>{labelPreview || countLabel}{extraCount > 0 ? ` 等 ${extraCount} 条` : ""}</b>
          <small>{target.summary ?? `已选择 ${target.ids.length} 条`}</small>
        </div>
        <div className="delete-confirm-actions">
          <button type="button" onClick={onCancel}>取消</button>
          <button type="button" className="delete-confirm-danger" onClick={onConfirm}>确认删除</button>
        </div>
      </div>
    </div>
  );
}

function ProductImageEditor({ materialName, images, imageStatus, onChange }: { materialName: string; images?: ProductImageAsset[]; imageStatus?: ProductImageStatus; onChange: (images: ProductImageAsset[] | undefined, status: ProductImageStatus) => void }) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const currentImages = images ?? [];
  const handleFiles = async (files: File[], replace: boolean) => {
    if (files.length === 0) return;
    setError("");
    setUploading(true);
    try {
      const uploadedImages = await createManualProductImageAssets(files);
      const nextImages = replace ? uploadedImages : [...currentImages, ...uploadedImages];
      onChange(nextImages, "手动维护");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "图片上传失败，请重新选择。" );
    } finally {
      setUploading(false);
    }
  };
  const removeImage = (id: string) => {
    const nextImages = currentImages.filter((image) => image.id !== id);
    onChange(nextImages.length > 0 ? nextImages : undefined, productImageStatusForAssets(nextImages, imageStatus));
    setPreviewIndex((current) => current === null ? null : Math.min(current, Math.max(0, nextImages.length - 1)));
  };
  const setPrimary = (index: number) => {
    if (index <= 0 || index >= currentImages.length) return;
    onChange([currentImages[index], ...currentImages.slice(0, index), ...currentImages.slice(index + 1)], imageStatus ?? "已匹配");
  };
  return (
    <div className="product-image-editor">
      {currentImages.length > 0 ? <div className="product-image-gallery">
        {currentImages.map((image, index) => <div className={`product-image-tile ${index === 0 ? "primary" : ""}`} key={`${image.id}-${index}`}>
          <button type="button" className="product-image-tile-preview" disabled={uploading} onClick={() => setPreviewIndex(index)}>
            <img src={image.url} alt={`${materialName} ${index + 1}`} />
            <span>{index === 0 ? "主图" : `第 ${index + 1} 张`}</span>
          </button>
          <div className="product-image-tile-actions">
            {index > 0 && <button type="button" disabled={uploading} onClick={() => setPrimary(index)}>设为主图</button>}
            <button type="button" className="danger" disabled={uploading} onClick={() => removeImage(image.id)}>删除</button>
          </div>
        </div>)}
      </div> : <div className="product-image-editor-empty"><i>暂无图片</i><span>可以上传一张或多张商品图片</span></div>}
      <div className="product-image-editor-actions">
        <label className="product-image-upload-button"><input type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.bmp" multiple disabled={uploading} onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void handleFiles(files, false); }} />{uploading ? "读取中…" : "添加图片"}</label>
        {currentImages.length > 0 && <label className="product-image-upload-button secondary"><input type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.bmp" multiple disabled={uploading} onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void handleFiles(files, true); }} />替换全部</label>}
      </div>
      <small className="product-image-editor-hint">{imageStatus ?? "未上传"}{currentImages.length > 0 ? ` · ${currentImages.length} 张 · 第一张为主图` : ""} · 单张图片不超过 10MB</small>
      {error && <small className="product-image-editor-error">{error}</small>}
      {previewIndex !== null && currentImages.length > 0 && <ProductImageViewer productName={materialName} images={currentImages} initialIndex={previewIndex} status={imageStatus} onClose={() => setPreviewIndex(null)} />}
    </div>
  );
}

function ProductImportTable({ rows, onEdit, onDelete, allowDelete = false, allowDeleteAll = false, readOnly = false }: { rows: ProductImportRow[]; onEdit: (row: ProductImportRow) => void; onDelete?: (ids: string[]) => void; allowDelete?: boolean; allowDeleteAll?: boolean; readOnly?: boolean }) {
  const [customerType, setCustomerType] = useState("全部");
  const [rebate, setRebate] = useState("全部");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [imagePreview, setImagePreview] = useState<{ productName: string; images: ProductImageAsset[]; status: ProductImageStatus } | null>(null);
  const heads = ["序号", "客户类型", "是否返利", "产品大类", "产品线", "物料代码", "物料名称", "商品图片", "品牌", "品种", "规格", "箱规", "元/瓶", "元/箱", "吨箱转换系数", "是否礼盒", "分公司限制", "状态", "操作"];
  const filteredRows = useMemo(() => {
    const normalizedKeyword = normalizeSearchText(searchKeyword);
    const normalizedCodeKeyword = normalizeMaterialCode(searchKeyword);
    return rows.filter((row) => {
      const matchesFilters = (customerType === "全部" || row.customerType === customerType) && (rebate === "全部" || row.rebate === rebate);
      const matchesSearch = !normalizedKeyword
        || normalizeSearchText(row.materialName).includes(normalizedKeyword)
        || normalizeMaterialCode(row.materialCode).includes(normalizedCodeKeyword);
      return matchesFilters && matchesSearch;
    });
  }, [rows, customerType, rebate, searchKeyword]);
  const sortedRows = useMemo(() => [...filteredRows].sort(compareProductRows), [filteredRows]);
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = sortedRows.slice(pageStart, pageStart + pageSize);
  const pageIds = useMemo(() => pageRows.map((row) => row.id), [pageRows]);
  const filteredIds = useMemo(() => sortedRows.map((row) => row.id), [sortedRows]);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id));
  const openDelete = (ids: string[]) => {
    const targetRows = rows.filter((row) => ids.includes(row.id));
    setDeleteTarget({ ids, labels: targetRows.map((row) => row.materialName || row.materialCode), kind: "商品" });
  };
  const openClearAll = () => {
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return;
    setDeleteTarget({
      ids,
      labels: rows.map((row) => row.materialName || row.materialCode),
      kind: "商品",
      label: "全部当前商品",
      description: "将从当前有效商品列表移除全部商品；已有订单不会被删除，订单明细和金额保持不变。",
      summary: `当前共有 ${ids.length} 条商品`,
    });
  };
  const togglePageRows = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return [...next];
    });
  };
  const selectFilteredRows = () => {
    setSelectedIds((current) => [...new Set([...current, ...filteredIds])]);
  };
  const clearFilteredRows = () => {
    setSelectedIds((current) => current.filter((id) => !filteredIds.includes(id)));
  };
  const confirmDelete = () => {
    if (!deleteTarget) return;
    onDelete?.(deleteTarget.ids);
    setSelectedIds((current) => current.filter((id) => !deleteTarget.ids.includes(id)));
    setDeleteTarget(null);
  };
  return (
    <>
      <div className="data-filters">
        <label><span>客户类型</span><select value={customerType} onChange={(e) => { setCustomerType(e.target.value); setPage(1); setSelectedIds([]); }}><option>全部</option><option>特渠</option><option>综合</option></select></label>
        <label><span>是否参与返利</span><select value={rebate} onChange={(e) => { setRebate(e.target.value); setPage(1); setSelectedIds([]); }}><option>全部</option><option>参与</option><option>不参与</option></select></label>
        <label className="data-filter-search"><span>搜索商品</span><input type="search" value={searchKeyword} onChange={(e) => { setSearchKeyword(e.target.value); setPage(1); setSelectedIds([]); }} placeholder="物料代码 / 物料名称" aria-label="搜索物料代码或物料名称" /></label>
        <small>当前显示 {sortedRows.length} 条商品 · 第 {currentPage}/{totalPages} 页{readOnly ? "，活动已截止只读" : allowDelete ? "，可勾选删除" : "，可编辑"}</small>
      </div>
      {allowDelete && allowDeleteAll && rows.length > 0 && <div className="selection-toolbar selection-toolbar-all"><span>当前商品 <b>{rows.length}</b> 条</span><button type="button" className="selection-delete" onClick={openClearAll}>清空当前商品</button></div>}
      {allowDelete && selectedIds.length > 0 && <div className="selection-toolbar"><span>已选择 <b>{selectedIds.length}</b> 条商品{allFilteredSelected ? "（当前筛选结果）" : ""}</span><div>{!allFilteredSelected && filteredIds.length > pageIds.length && <button type="button" className="selection-select-all" onClick={selectFilteredRows}>选择全部 {filteredIds.length} 条</button>}{allFilteredSelected && <button type="button" className="selection-select-all" onClick={clearFilteredRows}>取消全选结果</button>}<button type="button" className="selection-clear" onClick={() => setSelectedIds([])}>取消选择</button><button type="button" className="selection-delete" onClick={() => openDelete(selectedIds)}>删除所选</button></div></div>}
      <div className="table-scroll">
        <div className={`data-table product-import-table ${allowDelete ? "with-selection" : ""}`}>
          <div className="table-row table-head">{allowDelete && <b className="select-cell"><input type="checkbox" aria-label="全选当前页商品" checked={allPageSelected} onChange={togglePageRows} /></b>}{heads.map((x) => <b key={x}>{x}</b>)}</div>
          {pageRows.map((row, index) => {
            const values = [pageStart + index + 1, row.customerType, row.rebate, row.category, row.line, row.materialCode, row.materialName, null, row.brand, row.variety, row.spec, row.casePack, row.unitPrice, row.casePrice, row.conversion, row.gift, row.branchScope || "全部分公司", row.importAction ? `${row.importAction} · ${row.status}` : row.status];
            const imageStatus = row.imageStatus ?? "未上传";
            return <div className={`table-row ${row.manuallyEdited ? "manually-edited-row" : ""}`} key={row.id}>{allowDelete && <span className="select-cell"><input type="checkbox" aria-label={`选择商品 ${row.materialName}`} checked={selectedIds.includes(row.id)} onChange={() => setSelectedIds((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id])} /></span>}{values.map((value, index) => index === 7 ? <button type="button" key={index} className={`product-image-cell product-image-button-cell ${imageStatus === "待确认" ? "pending" : imageStatus === "已匹配" || imageStatus === "手动维护" ? "matched" : "unmatched"}`} disabled={!row.images?.length} aria-label={`查看${row.materialName}商品图片`} onClick={() => row.images?.length && setImagePreview({ productName: row.materialName, images: row.images, status: imageStatus })}>{row.images?.[0]?.url ? <img src={row.images[0].url} alt={row.materialName} /> : <i>—</i>}<small>{imageStatus}{row.images && row.images.length > 1 ? ` · ${row.images.length} 张` : ""}</small></button> : <span key={index} className={index === 17 ? `status-cell ${row.status === "待完善" || row.importAction === "疑似重复" || row.importAction === "待确认" ? "pending" : ""}` : ""}>{value || "—"}</span>)}<span className="table-row-actions"><button type="button" disabled={readOnly} onClick={() => onEdit(row)}>编辑</button>{allowDelete && <button type="button" onClick={() => openDelete([row.id])}>删除</button>}{row.manuallyEdited && <small>已修正</small>}</span></div>;
          })}
          {sortedRows.length === 0 && <div className="table-empty">{searchKeyword.trim() ? "当前搜索和筛选条件下没有商品" : "当前筛选条件下没有商品"}</div>}
        </div>
      </div>
      <div className="table-pagination"><span>共 {sortedRows.length} 条</span><div><label>每页<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select>条</label><button type="button" disabled={currentPage <= 1} onClick={() => setPage(1)}>首页</button><button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button><b>{currentPage} / {totalPages}</b><button type="button" disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</button><button type="button" disabled={currentPage >= totalPages} onClick={() => setPage(totalPages)}>末页</button></div></div>
      {deleteTarget && <DeleteConfirmDialog target={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDelete} />}
      {imagePreview && <ProductImageViewer productName={imagePreview.productName} images={imagePreview.images} status={imagePreview.status} onClose={() => setImagePreview(null)} />}
    </>
  );
}

function ProductImageUploadCard({ fileName, stats, error, disabled = false, disabledMessage = "请先上传商品 Excel", onFile, onRemove }: { fileName: string; stats: ProductImageStats; error: string; disabled?: boolean; disabledMessage?: string; onFile: (file: File) => void | Promise<void>; onRemove: () => void }) {
  const ready = Boolean(fileName && !error);
  return (
    <article className={`file-upload-card image-upload-card ${ready ? "ready" : ""}`}>
      <div className="file-card-heading"><span>图</span><div><b>商品图片 ZIP</b><small>按商品物料名称匹配图片</small></div><em>{error ? "解析失败" : fileName ? "解析完成" : "待上传"}</em></div>
      {fileName ? <p title={fileName}>{fileName}</p> : <p>请选择：产品图片6月30日-OK(1).zip</p>}
      <div className="image-import-stats"><span>图片<b>{stats.totalImages}</b></span><span>已匹配商品<b>{stats.matchedProducts}</b></span><span>待确认<b>{stats.pendingProducts}</b></span><span>未匹配<b>{stats.unmatchedProducts}</b></span></div>
      {error && <small className="image-upload-error">{error}</small>}
      <footer><small>{disabled ? disabledMessage : ready ? `已读取 ${stats.totalImages} 张图片，匹配结果已写入商品表` : "支持 JPG、PNG、WEBP、GIF、BMP"}</small><div>{fileName && <button type="button" disabled={disabled} onClick={onRemove}>移除</button>}<label className={disabled ? "disabled" : ""}><input type="file" accept=".zip,application/zip" disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; if (file) void onFile(file); event.currentTarget.value = ""; }} />{fileName ? "替换 ZIP" : "选择 ZIP"}</label></div></footer>
    </article>
  );
}

function CustomerWhitelistTable({ rows, onEdit, onDelete, allowDelete = false, allowDeleteAll = false, readOnly = false }: { rows: WhitelistRow[]; onEdit: (row: WhitelistRow) => void; onDelete?: (ids: string[]) => void; allowDelete?: boolean; allowDeleteAll?: boolean; readOnly?: boolean }) {
  const [customerType, setCustomerType] = useState("全部");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const heads = ["序号", "客户类型", "大区", "分公司名称", "经销商名称（简）", "经销商名称（全）", "经销商类型", "经销商姓名", "经销商电话", "分公司确认人姓名", "分公司确认人电话", "状态", "操作"];
  const filteredRows = useMemo(() => {
    const normalizedKeyword = normalizeSearchText(searchKeyword);
    const phoneKeyword = normalizePhone(searchKeyword);
    return rows.filter((row) => {
      const matchesType = customerType === "全部" || row.customerType === customerType;
      const matchesSearch = !normalizedKeyword
        || [row.dealerShort, row.dealerFull, row.dealerName].some((value) => normalizeSearchText(value).includes(normalizedKeyword))
        || (phoneKeyword.length > 0 && normalizePhone(row.dealerPhone).includes(phoneKeyword));
      return matchesType && matchesSearch;
    });
  }, [rows, customerType, searchKeyword]);
  const sortedRows = useMemo(() => [...filteredRows].sort(compareWhitelistRows), [filteredRows]);
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = sortedRows.slice(pageStart, pageStart + pageSize);
  const pageIds = useMemo(() => pageRows.map((row) => row.id), [pageRows]);
  const filteredIds = useMemo(() => sortedRows.map((row) => row.id), [sortedRows]);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id));
  const openDelete = (ids: string[]) => {
    const targetRows = rows.filter((row) => ids.includes(row.id));
    setDeleteTarget({ ids, labels: targetRows.map((row) => row.dealerShort || row.dealerFull), kind: "白名单客户" });
  };
  const openClearAll = () => {
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return;
    setDeleteTarget({
      ids,
      labels: rows.map((row) => row.dealerShort || row.dealerFull),
      kind: "白名单客户",
      label: "全部当前白名单",
      description: "将从当前有效白名单中移除全部客户；已有订单不会被删除。",
      summary: `当前共有 ${ids.length} 名白名单客户`,
    });
  };
  const togglePageRows = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return [...next];
    });
  };
  const selectFilteredRows = () => {
    setSelectedIds((current) => [...new Set([...current, ...filteredIds])]);
  };
  const clearFilteredRows = () => {
    setSelectedIds((current) => current.filter((id) => !filteredIds.includes(id)));
  };
  const confirmDelete = () => {
    if (!deleteTarget) return;
    onDelete?.(deleteTarget.ids);
    setSelectedIds((current) => current.filter((id) => !deleteTarget.ids.includes(id)));
    setDeleteTarget(null);
  };
  return (
    <>
      <div className="data-filters">
        <label><span>客户类型</span><select value={customerType} onChange={(e) => { setCustomerType(e.target.value); setPage(1); setSelectedIds([]); }}><option>全部</option><option>综合客户</option><option>特渠专业客户</option></select></label>
        <label className="data-filter-search"><span>搜索白名单</span><input type="search" value={searchKeyword} onChange={(e) => { setSearchKeyword(e.target.value); setPage(1); setSelectedIds([]); }} placeholder="经销商名称 / 姓名 / 电话" aria-label="搜索经销商名称、经销商姓名或电话" /></label>
        <small>当前显示 {sortedRows.length} 名客户 · 第 {currentPage}/{totalPages} 页{readOnly ? "，活动已截止只读" : allowDelete ? "，可勾选删除" : "，可编辑"}</small>
      </div>
      {allowDelete && allowDeleteAll && rows.length > 0 && <div className="selection-toolbar selection-toolbar-all"><span>当前白名单 <b>{rows.length}</b> 名</span><button type="button" className="selection-delete" onClick={openClearAll}>清空当前白名单</button></div>}
      {allowDelete && selectedIds.length > 0 && <div className="selection-toolbar"><span>已选择 <b>{selectedIds.length}</b> 名客户{allFilteredSelected ? "（当前筛选结果）" : ""}</span><div>{!allFilteredSelected && filteredIds.length > pageIds.length && <button type="button" className="selection-select-all" onClick={selectFilteredRows}>选择全部 {filteredIds.length} 名</button>}{allFilteredSelected && <button type="button" className="selection-select-all" onClick={clearFilteredRows}>取消全选结果</button>}<button type="button" className="selection-clear" onClick={() => setSelectedIds([])}>取消选择</button><button type="button" className="selection-delete" onClick={() => openDelete(selectedIds)}>删除所选</button></div></div>}
      <div className="table-scroll">
        <div className={`data-table whitelist-table ${allowDelete ? "with-selection" : ""}`}>
          <div className="table-row table-head">{allowDelete && <b className="select-cell"><input type="checkbox" aria-label="全选当前页白名单" checked={allPageSelected} onChange={togglePageRows} /></b>}{heads.map((x) => <b key={x}>{x}</b>)}</div>
          {pageRows.map((row, index) => {
            const importStatus = row.importAction ? `${row.importAction} · ${row.status}` : row.status;
            const values = [pageStart + index + 1, row.customerType, row.region, row.branch, row.dealerShort, row.dealerFull, row.dealerType, row.dealerName, row.dealerPhone, row.confirmerName, row.confirmerPhone, importStatus];
            const importPending = row.importAction === "名称重复" || row.importAction === "名称待处理" || row.importAction === "电话待处理";
            return <div className={`table-row ${row.manuallyEdited ? "manually-edited-row" : ""}`} key={row.id}>{allowDelete && <span className="select-cell"><input type="checkbox" aria-label={`选择白名单客户 ${row.dealerShort}`} checked={selectedIds.includes(row.id)} onChange={() => setSelectedIds((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id])} /></span>}{values.map((value, index) => <span key={index} className={index === 11 ? `status-cell ${row.status === "待处理" || importPending ? "pending" : ""}` : ""}>{value || "—"}</span>)}<span className="table-row-actions"><button type="button" disabled={readOnly} onClick={() => onEdit(row)}>编辑</button>{allowDelete && <button type="button" onClick={() => openDelete([row.id])}>删除</button>}{row.manuallyEdited && <small>已修正</small>}</span></div>;
          })}
          {sortedRows.length === 0 && <div className="table-empty">{searchKeyword.trim() ? "当前搜索和筛选条件下没有白名单客户" : "当前筛选条件下没有白名单客户"}</div>}
        </div>
      </div>
      <div className="table-pagination"><span>共 {sortedRows.length} 名</span><div><label>每页<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select>名</label><button type="button" disabled={currentPage <= 1} onClick={() => setPage(1)}>首页</button><button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button><b>{currentPage} / {totalPages}</b><button type="button" disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</button><button type="button" disabled={currentPage >= totalPages} onClick={() => setPage(totalPages)}>末页</button></div></div>
      {deleteTarget && <DeleteConfirmDialog target={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDelete} />}
    </>
  );
}

function ProductFormDrawer({ rows, initialRow, activityStarted = false, onClose, onSave }: { rows: ProductImportRow[]; initialRow?: ProductImportRow; activityStarted?: boolean; onClose: () => void; onSave: (row: ProductImportRow, reason?: string) => void }) {
  const isEditing = Boolean(initialRow);
  const [form, setForm] = useState<ProductImportRow>(() => initialRow ? { ...initialRow } : { id: createImportRowId("product"), sequence: 0, customerType: "特渠", rebate: "参与", category: "", line: "", materialCode: "", materialName: "", brand: "", variety: "", spec: "", casePack: "", unitPrice: "", casePrice: "", conversion: "", gift: "否", branchScope: "", status: "有效", source: "manual" });
  const [editReason, setEditReason] = useState("");
  const update = (field: keyof ProductImportRow, value: string | number) => setForm((current) => ({ ...current, [field]: value }));
  const nextSequence = isEditing ? form.sequence : Math.max(0, ...rows.filter((row) => row.customerType === form.customerType && row.rebate === form.rebate).map((row) => row.sequence)) + 1;
  const duplicateMaterialCode = form.materialCode.trim() !== "" && rows.some((row) => row.id !== form.id && row.customerType === form.customerType && row.rebate === form.rebate && row.materialCode.trim().toLowerCase() === form.materialCode.trim().toLowerCase());
  const canSave = form.materialCode.trim() !== "" && form.materialName.trim() !== "" && form.casePrice.trim() !== "" && !duplicateMaterialCode && (!activityStarted || editReason.trim() !== "");
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
          <label><span>物料代码 *</span><input value={form.materialCode} onChange={(e) => update("materialCode", e.target.value)} /><small className={duplicateMaterialCode ? "field-error" : ""}>{duplicateMaterialCode ? "同客户类型、同返利分组内已存在，请检查解析结果" : "跨 Sheet 可重复；用于识别同一商品"}</small></label>
          <label className="wide-field"><span>物料名称 *</span><input value={form.materialName} onChange={(e) => update("materialName", e.target.value)} /></label>
          <div className="product-form-image-field wide-field"><span>商品图片</span><ProductImageEditor materialName={form.materialName} images={form.images} imageStatus={form.imageStatus} onChange={(images, status) => setForm((current) => ({ ...current, images, imageStatus: status }))} /></div>
          <label><span>品牌</span><input value={form.brand} onChange={(e) => update("brand", e.target.value)} /></label>
          <label><span>品种</span><input value={form.variety} onChange={(e) => update("variety", e.target.value)} /></label>
          <label><span>规格</span><input value={form.spec} onChange={(e) => update("spec", e.target.value)} /></label>
          <label><span>箱规</span><input value={form.casePack} onChange={(e) => update("casePack", e.target.value)} /></label>
          <label><span>元/瓶</span><input inputMode="decimal" value={form.unitPrice} onChange={(e) => update("unitPrice", e.target.value)} /></label>
          <label><span>元/箱 *</span><input inputMode="decimal" value={form.casePrice} onChange={(e) => update("casePrice", e.target.value)} /></label>
          <label><span>吨箱转换系数</span><input inputMode="decimal" value={form.conversion} onChange={(e) => update("conversion", e.target.value)} /></label>
          <label><span>是否礼盒</span><select value={form.gift} onChange={(e) => update("gift", e.target.value)}><option>否</option><option>是</option></select></label>
          <label><span>分公司限制</span><input value={form.branchScope} onChange={(e) => update("branchScope", e.target.value)} placeholder="留空表示全部分公司" /><small>多个分公司用顿号或逗号分隔</small></label>
          <label><span>状态</span><select value={form.status} onChange={(e) => update("status", e.target.value)}><option>有效</option><option>待完善</option><option>停用</option></select></label>
          {activityStarted && <label className="wide-field"><span>紧急修改原因 *</span><input value={editReason} onChange={(e) => setEditReason(e.target.value)} placeholder="请填写本次改单原因，保存后写入操作日志" /></label>}
        </div>
        <p className="drawer-form-note">带 * 的字段为必填项；{activityStarted ? "活动已开始，本次手动调整会记录操作日志。" : "手动新增或修改仅对当前数据版本生效，重新导入 Excel 后以新文件为准。"}</p></div>
        <footer><button onClick={onClose}>取消</button><button className="admin-primary" disabled={!canSave} onClick={() => { onSave({ ...form, sequence: nextSequence, manuallyEdited: true }, editReason.trim()); onClose(); }}>{isEditing ? "保存修改" : "添加商品"}</button></footer>
      </aside>
    </div>
  );
}

function WhitelistFormDrawer({ rows, initialRow, activityStarted = false, onClose, onSave }: { rows: WhitelistRow[]; initialRow?: WhitelistRow; activityStarted?: boolean; onClose: () => void; onSave: (row: WhitelistRow, reason?: string) => void }) {
  const isEditing = Boolean(initialRow);
  const [form, setForm] = useState<WhitelistRow>(() => initialRow ? { ...initialRow } : { id: createImportRowId("whitelist"), sequence: 0, customerType: "综合客户", region: "", branch: "", dealerShort: "", dealerFull: "", dealerType: "综合经销商", dealerName: "", dealerPhone: "", confirmerName: "", confirmerPhone: "", status: "有效", source: "manual" });
  const [editReason, setEditReason] = useState("");
  const update = (field: keyof WhitelistRow, value: string | number) => setForm((current) => ({ ...current, [field]: value }));
  const nextSequence = isEditing ? form.sequence : Math.max(0, ...rows.filter((row) => row.customerType === form.customerType).map((row) => row.sequence)) + 1;
  const phoneValid = whitelistPhoneIsValid(form.dealerPhone);
  const duplicateDealerName = normalizeWhitelistName(form.dealerFull) !== "" && rows.some((row) => row.id !== form.id && row.customerType === form.customerType && whitelistIdentityKey(row) === whitelistIdentityKey(form));
  const duplicateDealerPhone = form.dealerPhone.trim() !== "" && rows.some((row) => row.id !== form.id && row.customerType === form.customerType && normalizePhone(row.dealerPhone) === normalizePhone(form.dealerPhone));
  const canSave = form.region.trim() !== "" && form.branch.trim() !== "" && form.dealerShort.trim() !== "" && form.dealerFull.trim() !== "" && phoneValid && !duplicateDealerName && !duplicateDealerPhone && (!activityStarted || editReason.trim() !== "");
  return (
    <div className="order-drawer-backdrop" onClick={onClose}>
      <aside className="order-drawer form-drawer" onClick={(event) => event.stopPropagation()}>
        <header><div><span>客户身份</span><h2>{isEditing ? "编辑白名单" : "手动添加白名单客户"}</h2></div><button aria-label="关闭" onClick={onClose}>×</button></header>
        <div className="auto-sequence-note"><span>{isEditing ? "当前客户" : "序号自动生成"}</span><b>{isEditing ? `原序号：${form.sequence}` : `保存后编号：${nextSequence}`}</b><small>{form.customerType}分组</small></div>
        <div className="drawer-form-body"><div className="drawer-form-grid">
          <label><span>客户类型</span><select value={form.customerType} onChange={(e) => { const type = e.target.value as WhitelistRow["customerType"]; setForm((current) => ({ ...current, customerType: type, dealerType: type === "综合客户" ? "综合经销商" : "特渠专业经销商" })); }}><option>综合客户</option><option>特渠专业客户</option></select></label>
          <label><span>大区 *</span><select value={form.region} onChange={(e) => update("region", e.target.value)}><option value="">请选择</option><option>东区</option><option>南区</option><option>北区</option><option>西区</option></select></label>
          <label><span>分公司名称 *</span><input value={form.branch} onChange={(e) => update("branch", e.target.value)} placeholder="例如：长沙分" /></label>
          <label><span>经销商名称（简）*</span><input value={form.dealerShort} onChange={(e) => update("dealerShort", e.target.value)} /><small>{form.dealerShort.length}/10 字</small></label>
          <label className="wide-field"><span>经销商名称（全）*</span><input value={form.dealerFull} onChange={(e) => update("dealerFull", e.target.value)} /><small className={duplicateDealerName ? "field-error" : ""}>{duplicateDealerName ? "同客户类型下已存在，请直接编辑原客户" : "客户身份匹配使用客户类型 + 名称全称；电话变化时会更新原客户"}</small></label>
          <label><span>经销商类型</span><input value={form.dealerType} onChange={(e) => update("dealerType", e.target.value)} /></label>
          <label><span>经销商姓名</span><input value={form.dealerName} onChange={(e) => update("dealerName", e.target.value)} /></label>
          <label><span>经销商电话 *</span><input inputMode="tel" maxLength={11} value={form.dealerPhone} onChange={(e) => update("dealerPhone", e.target.value.replace(/\D/g, ""))} placeholder="11 位手机号" /><small className={duplicateDealerPhone || (form.dealerPhone !== "" && !phoneValid) ? "field-error" : ""}>{duplicateDealerPhone ? "同客户类型内手机号已存在；综合和特渠可以同号" : form.dealerPhone && !phoneValid ? "请输入正确的 11 位手机号" : "用于 H5 身份验证；请输入完整的 11 位手机号"}</small></label>
          <label><span>分公司确认人姓名</span><input value={form.confirmerName} onChange={(e) => update("confirmerName", e.target.value)} /></label>
          <label><span>分公司确认人电话</span><input inputMode="tel" maxLength={11} value={form.confirmerPhone} onChange={(e) => update("confirmerPhone", e.target.value.replace(/\D/g, ""))} /></label>
          {activityStarted && <label className="wide-field"><span>紧急修改原因 *</span><input value={editReason} onChange={(e) => setEditReason(e.target.value)} placeholder="请填写本次改单原因，保存后写入操作日志" /></label>}
        </div>
        <p className="drawer-form-note">客户类型在 Excel 导入时由 Sheet 自动确定；{activityStarted ? "活动已开始，本次手动调整会记录操作日志。" : "手动新增或修改仅对当前数据版本生效，重新导入 Excel 后以新文件为准。"}</p></div>
        <footer><button onClick={onClose}>取消</button><button className="admin-primary" disabled={!canSave} onClick={() => { onSave({ ...form, sequence: nextSequence, status: "有效", source: isEditing ? form.source ?? "excel" : "manual", identityKey: whitelistIdentityKey(form), importAction: undefined, manuallyEdited: true }, editReason.trim()); onClose(); }}>{isEditing ? "保存修改" : "添加客户"}</button></footer>
      </aside>
    </div>
  );
}

function LotterySettings({ rounds, attendanceRows, onChange }: { rounds: LotteryRound[]; attendanceRows: AttendanceRow[]; onChange: (rounds: LotteryRound[]) => void }) {
  const [selectedId, setSelectedId] = useState(rounds.find((item) => item.status === "published")?.id ?? rounds[0].id);
  const [previewOpen, setPreviewOpen] = useState(false);
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
  const attendanceCandidateCount = getAttendanceCandidates(attendanceRows, selected.customerType).length;
  const resolvedCandidateCount = selected.scope === "attended" ? attendanceCandidateCount : selected.candidateCount;
  const previewNames = selected.scope === "attended" ? getAttendanceCandidates(attendanceRows, selected.customerType).map((candidate) => candidate.displayName) : dealerNames;
  const candidateSteps: [string, number][] = selected.scope === "all"
    ? [["活动白名单", 1680], ["客户类型匹配", selected.customerType === "全部客户" ? 1680 : 1073], ["排除已中奖", selected.candidateCount]]
    : selected.scope === "attended"
      ? [["现场名单", attendanceRows.length], ["客户类型匹配", selected.customerType === "全部客户" ? attendanceRows.length : attendanceRows.filter((row) => row.customerType === selected.customerType).length], ["有效电话和经销商名称", resolvedCandidateCount], ["排除已中奖", resolvedCandidateCount]]
      : [["活动白名单", 1680], ["客户类型匹配", selected.customerType === "全部客户" ? 1680 : 1073], ["有效订单匹配", selected.minAmount > 0 ? 612 : selected.candidateCount + 15], ...(selected.minAmount > 0 ? [["金额门槛匹配", selected.candidateCount + 15] as [string, number]] : []), ["排除已中奖", selected.candidateCount]];
  const candidateMeta = selected.scope === "all" ? "白名单有效" : selected.scope === "attended" ? "现场已到场" : "有效订单";
  return (
    <div className="admin-panel lottery-settings">
      <div className="panel-title"><div><h2>抽奖规则工作台</h2><p>配置轮次、候选资格与现场执行顺序；已完成轮次自动锁定</p></div><div className="panel-actions"><span className="attendance-not-linked">现场名单已同步 {attendanceRows.length} 名</span><button className="admin-primary" onClick={() => updateSelected({ status: "published" })}>保存并发布</button></div></div>
      <div className="lottery-overview">
        <article><span>抽奖轮次</span><strong>{rounds.length}</strong><small>{rounds.filter((x) => x.status === "completed").length} 轮已完成</small></article>
        <article><span>活动客户</span><strong>1,680</strong><small>白名单有效客户</small></article>
        <article><span>现场到场</span><strong>{attendanceRows.length}</strong><small>当前到场名单</small></article>
        <article><span>已中奖客户</span><strong>15</strong><small>全场默认不重复</small></article>
      </div>
      <div className="lottery-config-grid">
        <section className="round-list"><div className="section-heading"><h3>抽奖轮次</h3><span>按顺序执行</span></div>{rounds.map((item) => <button key={item.id} className={selected.id === item.id ? "active" : ""} onClick={() => setSelectedId(item.id)}><i>{String(item.id).padStart(2, "0")}</i><span><b>{item.name}</b><small>{item.prize}</small></span><em><small className={`round-status ${item.status}`}>{statusLabel[item.status]}</small>{item.winnerCount} 人</em></button>)}<button className="add-round" onClick={addRound}>＋ 新增抽奖轮次</button></section>
        <section className="round-form">
          <div className="round-form-heading"><div><h3>{selected.name}</h3><span className={`round-status ${selected.status}`}>{statusLabel[selected.status]}</span></div><div><button onClick={duplicateRound}>复制</button><button onClick={removeRound} disabled={selected.status !== "draft"}>删除</button></div></div>
          <label><span>轮次名称</span><input value={selected.name} disabled={selected.status === "completed"} onChange={(e) => updateSelected({ name: e.target.value })} /></label>
          <label><span>奖品名称</span><input value={selected.prize} disabled={selected.status === "completed"} onChange={(e) => updateSelected({ prize: e.target.value })} /></label>
          <label><span>中奖人数</span><input type="number" min="1" value={selected.winnerCount} disabled={selected.status === "completed"} onChange={(e) => updateSelected({ winnerCount: Number(e.target.value) })} /></label>
          <label><span>客户类型</span><select value={selected.customerType} disabled={selected.status === "completed"} onChange={(e) => updateSelected({ customerType: e.target.value as LotteryRound["customerType"] })}>{["全部客户", "特渠专业客户", "综合客户"].map((x) => <option key={x}>{x}</option>)}</select></label>
          <fieldset className="candidate-scope"><legend>候选客户范围</legend>{scopeOptions.map((option) => <button type="button" key={option.key} className={selected.scope === option.key ? "active" : ""} disabled={selected.status === "completed"} onClick={() => updateSelected({ scope: option.key, minAmount: option.key === "ordered" ? selected.minAmount : 0, candidateCount: option.key === "all" ? 1665 : option.key === "attended" ? getAttendanceCandidates(attendanceRows, selected.customerType).length : 518 })}><i>{selected.scope === option.key ? "✓" : ""}</i><span><b>{option.title}</b><small>{option.detail}</small></span></button>)}</fieldset>
          {selected.scope === "ordered" && <label><span>最低订单金额</span><div className="amount-input"><b>¥</b><input type="number" min="0" value={selected.minAmount} disabled={selected.status === "completed"} onChange={(e) => updateSelected({ minAmount: Number(e.target.value), candidateCount: Number(e.target.value) > 0 ? 418 : 518 })} /></div><small className="field-help">填写 0 表示不限制订单金额</small></label>}
          <label className={selected.scope === "ordered" ? "" : "wide-field"}><span>资格截止时间</span><input type="datetime-local" value={selected.cutoff} disabled={selected.status === "completed"} onChange={(e) => updateSelected({ cutoff: e.target.value })} /></label>
          <label className="check-setting repeat-setting"><input type="checkbox" checked={selected.excludeWinners} disabled={selected.status === "completed"} onChange={(e) => updateSelected({ excludeWinners: e.target.checked })} /><span><b>排除本活动已中奖客户</b><small>避免客户跨轮次重复中奖</small></span></label>
          <div className="rule-summary"><span>当前规则</span><p>{ruleSummary}</p></div>
          <div className="candidate-preview"><div><span>预计候选池</span><strong>{resolvedCandidateCount}<small> 人</small></strong><p>{selected.scope === "attended" ? `现场名单 ${attendanceRows.length} · 按经销商名称去重` : `白名单 1,680 · 条件排除 ${1680 - resolvedCandidateCount} · 已中奖排除 15`}</p></div><button onClick={() => setPreviewOpen(true)}>查看候选名单</button></div>
        </section>
      </div>
      {previewOpen && <div className="order-drawer-backdrop" onClick={() => setPreviewOpen(false)}><aside className="order-drawer candidate-drawer" onClick={(e) => e.stopPropagation()}><header><div><span>候选池预览</span><h2>{selected.name} · {resolvedCandidateCount} 人</h2></div><button onClick={() => setPreviewOpen(false)}>×</button></header><div className="candidate-funnel">{candidateSteps.map(([label, count]) => <div key={label}><span>{label}</span><b>{count}</b></div>)}</div><div className="candidate-table">{previewNames.slice(0, 12).map((name, index) => <div key={name}><span>{String(index + 1).padStart(3, "0")}</span><b>{name}</b><em>{selected.scope === "attended" ? "到场" : index % 3 === 0 ? "特渠" : "综合"}</em><small>{candidateMeta}{selected.scope === "ordered" ? ` · ¥${(8200 + index * 1680).toLocaleString()}` : ""}</small></div>)}</div><footer><button>导出候选名单</button><button className="admin-primary" onClick={() => setPreviewOpen(false)}>确认候选池</button></footer></aside></div>}
    </div>
  );
}

function cloneAttendanceRows(rows: AttendanceRow[]) {
  return rows.map((row) => ({ ...row }));
}

function AttendanceFormDrawer({ rows, initialRow, onClose, onSave }: { rows: AttendanceRow[]; initialRow?: AttendanceRow; onClose: () => void; onSave: (row: AttendanceRow) => void }) {
  const isEditing = Boolean(initialRow);
  const [form, setForm] = useState<AttendanceRow>(() => initialRow ? { ...initialRow } : { id: createImportRowId("attendance-manual"), sequence: 0, dealerName: "", gender: "", contactPhone: "", branch: "", dealerCompany: "", participantType: "", customerType: "" });
  const nextSequence = isEditing ? form.sequence : Math.max(0, ...rows.map((row) => row.sequence)) + 1;
  const update = (field: AttendanceFieldKey, value: string) => setForm((current) => ({ ...current, [field]: value, ...(field === "participantType" ? { customerType: attendanceCustomerType(value) } : {}) }));
  return (
    <div className="order-drawer-backdrop" onClick={onClose}>
      <aside className="order-drawer form-drawer attendance-form-drawer" onClick={(event) => event.stopPropagation()}>
        <header><div><span>现场到场客户</span><h2>{isEditing ? "编辑到场客户" : "手动添加到场客户"}</h2></div><button type="button" aria-label="关闭" onClick={onClose}>×</button></header>
        <div className="auto-sequence-note"><span>{isEditing ? "当前记录" : "序号自动生成"}</span><b>{isEditing ? `原序号：${form.sequence}` : `保存后编号：${nextSequence}`}</b><small>当前仅用于到场名单页面展示</small></div>
        <div className="drawer-form-body"><div className="drawer-form-grid">
          <label><span>分公司</span><input value={form.branch} onChange={(event) => update("branch", event.target.value)} placeholder="请输入分公司" /></label>
          <label><span>参会人姓名</span><input value={form.dealerName} onChange={(event) => update("dealerName", event.target.value)} placeholder="请输入参会人姓名" /></label>
          <label><span>性别</span><select value={form.gender} onChange={(event) => update("gender", event.target.value)}><option value="">请选择</option><option>男</option><option>女</option></select></label>
          <label><span>参会人电话</span><input inputMode="tel" value={form.contactPhone} onChange={(event) => update("contactPhone", event.target.value)} placeholder="请输入参会人电话" /></label>
          <label className="wide-field"><span>经销商名称</span><input value={form.dealerCompany} onChange={(event) => update("dealerCompany", event.target.value)} placeholder="请输入经销商名称" /></label>
          <label className="wide-field"><span>参会人员类型</span><input value={form.participantType} onChange={(event) => update("participantType", event.target.value)} placeholder="例如：综合经销商 / 特渠专业经销商" /></label>
        </div><p className="drawer-form-note">抽奖大屏只显示经销商名称；客户类型由参会人员类型自动识别。</p></div>
        <footer><button type="button" onClick={onClose}>取消</button><button type="button" className="admin-primary" onClick={() => { onSave({ ...form, sequence: nextSequence, manuallyEdited: true }); onClose(); }}>{isEditing ? "保存修改" : "保存到场客户"}</button></footer>
      </aside>
    </div>
  );
}

function AttendanceTable({ rows, onEdit, onDelete, allowDelete = false, allowDeleteAll = false, readOnly = false }: { rows: AttendanceRow[]; onEdit: (row: AttendanceRow) => void; onDelete?: (ids: string[]) => void; allowDelete?: boolean; allowDeleteAll?: boolean; readOnly?: boolean }) {
  const [customerType, setCustomerType] = useState("全部");
  const [branch, setBranch] = useState("全部");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const branchOptions = useMemo(() => ["全部", ...Array.from(new Set(rows.map((row) => row.branch).filter(Boolean)))], [rows]);
  const customerTypeOptions = useMemo(() => ["全部", ...Array.from(new Set(rows.map((row) => row.customerType).filter(Boolean)))], [rows]);
  const filteredRows = useMemo(() => {
    const keyword = normalizeSearchText(searchKeyword);
    return rows.filter((row) => {
      const values = [row.dealerName, row.gender, row.contactPhone, row.branch, row.dealerCompany, row.participantType, row.customerType];
      const matchesSearch = !keyword || values.some((value) => normalizeSearchText(value).includes(keyword));
      return (customerType === "全部" || row.customerType === customerType) && (branch === "全部" || row.branch === branch) && matchesSearch;
    });
  }, [rows, customerType, branch, searchKeyword]);
  const sortedRows = useMemo(() => [...filteredRows].sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id)), [filteredRows]);
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = sortedRows.slice(pageStart, pageStart + pageSize);
  const pageIds = useMemo(() => pageRows.map((row) => row.id), [pageRows]);
  const filteredIds = useMemo(() => sortedRows.map((row) => row.id), [sortedRows]);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id));
  const openDelete = (ids: string[]) => {
    const targetRows = rows.filter((row) => ids.includes(row.id));
    setDeleteTarget({
      ids,
      labels: targetRows.map((row) => row.dealerCompany || row.dealerName || row.contactPhone),
      kind: "现场到场客户",
      description: "删除后将从当前现场到场名单和抽奖候选池中移除，不会删除原 Excel 文件。",
    });
  };
  const openClearAll = () => {
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return;
    setDeleteTarget({
      ids,
      labels: rows.map((row) => row.dealerCompany || row.dealerName || row.contactPhone),
      kind: "现场到场客户",
      label: "全部当前到场名单",
      description: "将从当前现场到场名单和抽奖候选池中移除全部客户，不会删除原 Excel 文件。",
      summary: `当前共有 ${ids.length} 名到场客户`,
    });
  };
  const togglePageRows = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return [...next];
    });
  };
  const selectFilteredRows = () => {
    setSelectedIds((current) => [...new Set([...current, ...filteredIds])]);
  };
  const clearFilteredRows = () => {
    setSelectedIds((current) => current.filter((id) => !filteredIds.includes(id)));
  };
  const confirmDelete = () => {
    if (!deleteTarget) return;
    onDelete?.(deleteTarget.ids);
    setSelectedIds((current) => current.filter((id) => !deleteTarget.ids.includes(id)));
    setDeleteTarget(null);
  };
  return (
    <>
      <div className="data-filters attendance-filters">
        <label><span>客户类型</span><select value={customerType} onChange={(event) => { setCustomerType(event.target.value); setPage(1); setSelectedIds([]); }}><option>全部</option>{customerTypeOptions.filter((value) => value !== "全部").map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>分公司</span><select value={branch} onChange={(event) => { setBranch(event.target.value); setPage(1); setSelectedIds([]); }}><option>全部</option>{branchOptions.filter((value) => value !== "全部").map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="data-filter-search"><span>搜索到场客户</span><input type="search" value={searchKeyword} onChange={(event) => { setSearchKeyword(event.target.value); setPage(1); setSelectedIds([]); }} placeholder="姓名 / 联系电话 / 经销商名称" aria-label="搜索现场到场客户" /></label>
        <small>当前显示 {sortedRows.length} 名 · 第 {currentPage}/{totalPages}{readOnly ? "，活动已截止只读" : allowDelete ? "，可勾选删除" : "，可编辑"}</small>
      </div>
      {allowDelete && allowDeleteAll && rows.length > 0 && <div className="selection-toolbar selection-toolbar-all"><span>当前到场名单 <b>{rows.length}</b> 名</span><button type="button" className="selection-delete" onClick={openClearAll}>清空当前名单</button></div>}
      {allowDelete && selectedIds.length > 0 && <div className="selection-toolbar"><span>已选择 <b>{selectedIds.length}</b> 名客户{allFilteredSelected ? "（当前筛选结果）" : ""}</span><div>{!allFilteredSelected && filteredIds.length > pageIds.length && <button type="button" className="selection-select-all" onClick={selectFilteredRows}>选择全部 {filteredIds.length} 名</button>}{allFilteredSelected && <button type="button" className="selection-select-all" onClick={clearFilteredRows}>取消全选结果</button>}<button type="button" className="selection-clear" onClick={() => setSelectedIds([])}>取消选择</button><button type="button" className="selection-delete" onClick={() => openDelete(selectedIds)}>删除所选</button></div></div>}
      <div className="table-scroll">
        <div className={`data-table attendance-table ${allowDelete ? "with-selection" : ""}`}>
          <div className="table-row table-head">{allowDelete && <b className="select-cell"><input type="checkbox" aria-label="全选当前页到场客户" checked={allPageSelected} onChange={togglePageRows} /></b>}<b>序号</b><b>分公司</b><b>参会人姓名</b><b>性别</b><b>参会人电话</b><b>参会人员类型</b><b>经销商名称</b><b>操作</b></div>
          {pageRows.map((row, index) => <div className="table-row" key={row.id}>
            {allowDelete && <span className="select-cell"><input type="checkbox" aria-label={`选择到场客户 ${row.dealerCompany || row.dealerName || row.contactPhone}`} checked={selectedIds.includes(row.id)} onChange={() => setSelectedIds((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id])} /></span>}<span>{pageStart + index + 1}</span><span>{row.branch || "—"}</span><span>{row.dealerName || "—"}</span><span>{row.gender || "—"}</span><span>{row.contactPhone || "—"}</span><span>{row.participantType || "—"}</span><span>{row.dealerCompany || "—"}</span><span className="table-row-actions"><button type="button" disabled={readOnly} onClick={() => onEdit(row)}>编辑</button>{allowDelete && <button type="button" onClick={() => openDelete([row.id])}>删除</button>}</span>
          </div>)}
          {sortedRows.length === 0 && <div className="table-empty">当前条件下没有到场客户</div>}
        </div>
      </div>
      <div className="table-pagination"><span>共 {sortedRows.length} 名</span><div><label>每页<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select>名</label><button type="button" disabled={currentPage <= 1} onClick={() => setPage(1)}>首页</button><button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button><b>{currentPage} / {totalPages}</b><button type="button" disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</button><button type="button" disabled={currentPage >= totalPages} onClick={() => setPage(totalPages)}>末页</button></div></div>
      {deleteTarget && <DeleteConfirmDialog target={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDelete} />}
    </>
  );
}

function AttendancePage({ rows, fileName, isDemo, warnings, sheetCounts, error, activityStarted, activityClosed, pendingImport, importAttemptName, onFile, onRestoreDemo, onAdd, onEdit, onDelete, onConfirmImport, onCancelImport }: { rows: AttendanceRow[]; fileName: string; isDemo: boolean; warnings: string[]; sheetCounts: Array<{ name: string; count: number }>; error: string; activityStarted: boolean; activityClosed: boolean; pendingImport: AttendanceImportDraft | null; importAttemptName: string; onFile: (file: File) => void | Promise<void>; onRestoreDemo: () => void; onAdd: () => void; onEdit: (row: AttendanceRow) => void; onDelete: (ids: string[]) => void; onConfirmImport: () => void; onCancelImport: () => void }) {
  const previewRows = pendingImport?.rows ?? rows;
  const displayWarnings = pendingImport?.warnings ?? warnings;
  const displaySheetCounts = pendingImport?.sheetCounts ?? sheetCounts;
  const displayFileName = pendingImport?.fileName || (error ? importAttemptName : fileName);
  const displayIsDemo = pendingImport ? false : isDemo;
  const isPending = Boolean(pendingImport);
  const comprehensiveCount = previewRows.filter((row) => row.customerType.includes("综合")).length;
  const specialCount = previewRows.filter((row) => row.customerType.includes("特渠")).length;
  const blankTypeCount = previewRows.filter((row) => !row.customerType).length;
  const phoneCount = previewRows.filter((row) => row.contactPhone).length;
  return (
    <div className="admin-panel attendance-panel">
      <div className="panel-title"><div><h2>现场到场客户</h2><p>按现场参会名单模板导入；抽奖选择现场到场客户时，现场大屏显示经销商名称。</p></div><div className="panel-actions"><button className="secondary-button" disabled={activityClosed} onClick={onAdd}>＋ 手动添加到场客户</button><button className="secondary-button" disabled={activityStarted} onClick={onRestoreDemo}>恢复演示数据</button></div></div>
      <div className="import-rule-hint"><b>{isPending ? "待确认导入" : activityClosed ? "活动已截止" : activityStarted ? "活动已开始" : "导入规则"}</b><span>{isPending ? "Excel 已解析，下面显示的是待导入预览；确认后才会替换当前名单并更新抽奖候选池，可先编辑或删除异常记录。" : activityClosed ? "活动已截止，现场到场名单只读。" : activityStarted ? "活动已开始，现场到场 Excel 导入和批量替换已锁定；如需补录，请手动添加或编辑单条记录。" : "活动开始前允许导入完整现场到场 Excel；分公司、参会人姓名、性别、参会人电话、参会人员类型、经销商名称会按表头识别。"}</span></div>
      <div className="attendance-upload-grid">
        <article className={`file-upload-card attendance-upload-card ${isPending ? "pending" : displayIsDemo ? "demo" : displayFileName && !error ? "ready" : ""}`}>
          <div className="file-card-heading"><span>XL</span><div><b>现场到场客户 Excel</b><small>选择文件后先预览，确认后替换当前名单</small></div><em>{isPending ? "待确认" : displayIsDemo ? "演示数据" : error ? "解析失败" : displayFileName ? "解析完成" : "待上传"}</em></div>
          <p title={displayFileName}>{displayFileName || "尚未选择真实 Excel 文件"}</p>
          <div className="sheet-counts">{displaySheetCounts.length > 0 ? displaySheetCounts.map((item) => <span key={item.name}>{item.name}<b>{item.count}</b></span>) : <span>{isPending ? "待导入名单" : "演示名单"}<b>{previewRows.length}</b></span>}</div>
          {error && <div className="warning-box"><b>文件无法导入</b><span>{error}</span></div>}
          <footer><small>{isPending ? "已解析，确认后才会更新当前名单" : activityClosed ? "活动已截止，名单只读" : activityStarted ? "活动已开始，Excel 导入已锁定" : error ? "文件解析失败，请修正后重试" : displayIsDemo ? "演示数据，仅用于原型抽奖候选池" : displayFileName ? `已读取 ${previewRows.length} 名客户` : "支持 .xlsx、.xls 文件"}</small><div>{isPending && <button type="button" onClick={onCancelImport}>取消导入</button>}{error && !isPending && <button type="button" onClick={onCancelImport}>清除错误</button>}<label className={`file-button ${activityStarted ? "disabled" : ""}`}><input type="file" accept=".xlsx,.xls" disabled={activityStarted} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void onFile(file); }} />{isPending || (displayFileName && !displayIsDemo) ? "重新选择文件" : "选择真实 Excel"}</label>{isPending && <button type="button" className="admin-primary" disabled={activityStarted || activityClosed} onClick={onConfirmImport}>确认导入</button>}</div></footer>
        </article>
        <div className="attendance-overview-card"><div><span>{isPending ? "待导入名单" : "当前名单"}</span><strong>{previewRows.length}<small> 名</small></strong><em>{isPending ? "待确认" : displayIsDemo ? "演示数据" : "当前导入批次"}</em></div><div><span>综合客户</span><b>{comprehensiveCount}</b></div><div><span>特渠客户</span><b>{specialCount}</b></div><div><span>已填写电话</span><b>{phoneCount}</b></div><div><span>未填客户类型</span><b>{blankTypeCount}</b></div><p>{isPending ? "当前为导入预览，确认后才会进入抽奖候选池。" : "现场抽奖候选按有效电话和经销商名称生成，并按经销商名称去重。"}</p></div>
      </div>
      {displayWarnings.length > 0 && <div className="warning-box attendance-warning"><b>导入提示</b>{displayWarnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}
      <div className="data-section-title"><div><b>{isPending ? "待导入到场客户预览" : "到场客户名单"}</b><span>{isPending ? `${pendingImport?.fileName} · 尚未确认` : displayIsDemo ? "演示数据 · 后续可上传真实 Excel 替换" : `${fileName} · 当前导入结果`}</span></div><span className={`attendance-not-linked ${isPending ? "pending" : ""}`}>{isPending ? "确认后接入候选池" : "已接入抽奖候选池"}</span></div>
      <AttendanceTable rows={previewRows} onEdit={onEdit} onDelete={onDelete} allowDelete={!activityStarted} allowDeleteAll={!activityStarted} readOnly={activityClosed} />
    </div>
  );
}

type ProductRowsSetter = (value: ProductImportRow[] | ((current: ProductImportRow[]) => ProductImportRow[])) => void;
type WhitelistRowsSetter = (value: WhitelistRow[] | ((current: WhitelistRow[]) => WhitelistRow[])) => void;
type AttendanceRowsSetter = (value: AttendanceRow[] | ((current: AttendanceRow[]) => AttendanceRow[])) => void;
type OperationLogEntry = { id: string; action: string; target: string; detail: string; operator: string; time: string };

function AdminPrototype({ lotteryRounds, onLotteryChange, activityName, onActivityNameChange, activityId, activityStatus, onActivityStatusChange, activityStartAt, onActivityStartAtChange, activityEndAt, onActivityEndAtChange, productRows, onProductRowsChange, productImportCompleted, onProductImportCompleted, onProductImportCommitted, productImportHasRun, whitelistRows, onWhitelistRowsChange, whitelistImportCompleted, onWhitelistImportCompleted, onWhitelistImportCommitted, whitelistImportHasRun, attendanceRows, onAttendanceRowsChange, attendanceFileName, onAttendanceFileNameChange, attendanceIsDemo, onAttendanceIsDemoChange, attendanceWarnings, onAttendanceWarningsChange, attendanceSheetCounts, onAttendanceSheetCountsChange, attendanceImportError, onAttendanceImportErrorChange }: { lotteryRounds: LotteryRound[]; onLotteryChange: (rounds: LotteryRound[]) => void; activityName: string; onActivityNameChange: (value: string) => void; activityId: string; activityStatus: ActivityStatus; onActivityStatusChange: (status: ActivityStatus) => void; activityStartAt: string; onActivityStartAtChange: (value: string) => void; activityEndAt: string; onActivityEndAtChange: (value: string) => void; productRows: ProductImportRow[]; onProductRowsChange: ProductRowsSetter; productImportCompleted: boolean; onProductImportCompleted: (completed: boolean) => void; onProductImportCommitted: () => void; productImportHasRun: boolean; whitelistRows: WhitelistRow[]; onWhitelistRowsChange: WhitelistRowsSetter; whitelistImportCompleted: boolean; onWhitelistImportCompleted: (completed: boolean) => void; onWhitelistImportCommitted: () => void; whitelistImportHasRun: boolean; attendanceRows: AttendanceRow[]; onAttendanceRowsChange: AttendanceRowsSetter; attendanceFileName: string; onAttendanceFileNameChange: (value: string) => void; attendanceIsDemo: boolean; onAttendanceIsDemoChange: (value: boolean) => void; attendanceWarnings: string[]; onAttendanceWarningsChange: (value: string[]) => void; attendanceSheetCounts: Array<{ name: string; count: number }>; onAttendanceSheetCountsChange: (value: Array<{ name: string; count: number }>) => void; attendanceImportError: string; onAttendanceImportErrorChange: (value: string) => void }) {
  const activityStarted = activityStatus === "running" || activityStatus === "ended";
  const activityClosed = activityStatus === "ended";
  const [tab, setTab] = useState("活动概览");
  const setProductRows = onProductRowsChange;
  const setWhitelistRows = onWhitelistRowsChange;
  const setProductImportCompleted = onProductImportCompleted;
  const setWhitelistImportCompleted = onWhitelistImportCompleted;
  const [editingProductRow, setEditingProductRow] = useState<ProductImportRow | null>(null);
  const [productFormOpen, setProductFormOpen] = useState(false);
  const [editingWhitelistRow, setEditingWhitelistRow] = useState<WhitelistRow | null>(null);
  const [whitelistFormOpen, setWhitelistFormOpen] = useState(false);
  const [actionNotice, setActionNotice] = useState("");
  const [operationLogs, setOperationLogs] = useState<OperationLogEntry[]>([]);
  const [operationLogOpen, setOperationLogOpen] = useState(false);
  const [activityStartDraft, setActivityStartDraft] = useState(activityStartAt);
  const [activityEndDraft, setActivityEndDraft] = useState(activityEndAt);
  const [activityNameDraft, setActivityNameDraft] = useState(activityName);
  const [productFileName, setProductFileName] = useState("");
  const [productImportWarnings, setProductImportWarnings] = useState<string[]>([]);
  const [productImportError, setProductImportError] = useState("");
  const [productSheetCounts, setProductSheetCounts] = useState<Array<{ name: string; count: number }>>([]);
  const [productImportInputCount, setProductImportInputCount] = useState(0);
  const [productImportStats, setProductImportStats] = useState<ProductImportStats>(emptyProductImportStats);
  const [pendingProductBaseRows, setPendingProductBaseRows] = useState<ProductImportRow[] | null>(null);
  const [pendingProductRollbackRows, setPendingProductRollbackRows] = useState<ProductImportRow[] | null>(null);
  const [productImageAssets, setProductImageAssets] = useState<ProductImageAsset[]>([]);
  const [productImageFileName, setProductImageFileName] = useState("");
  const [productImageStats, setProductImageStats] = useState<ProductImageStats>({ totalImages: 0, matchedProducts: 0, pendingProducts: 0, unmatchedProducts: 0 });
  const [productImageError, setProductImageError] = useState("");
  const [whitelistFileName, setWhitelistFileName] = useState("");
  const [whitelistImportWarnings, setWhitelistImportWarnings] = useState<string[]>([]);
  const [whitelistImportError, setWhitelistImportError] = useState("");
  const [whitelistSheetCounts, setWhitelistSheetCounts] = useState<Array<{ name: string; count: number }>>([]);
  const [whitelistImportInputCount, setWhitelistImportInputCount] = useState(0);
  const [whitelistImportStats, setWhitelistImportStats] = useState<WhitelistImportStats>(emptyWhitelistImportStats);
  const [pendingWhitelistBaseRows, setPendingWhitelistBaseRows] = useState<WhitelistRow[] | null>(null);
  const [pendingWhitelistRollbackRows, setPendingWhitelistRollbackRows] = useState<WhitelistRow[] | null>(null);
  const setAttendanceRows = onAttendanceRowsChange;
  const [attendanceFormOpen, setAttendanceFormOpen] = useState(false);
  const [editingAttendanceRow, setEditingAttendanceRow] = useState<AttendanceRow | null>(null);
  const [pendingAttendanceImport, setPendingAttendanceImport] = useState<AttendanceImportDraft | null>(null);
  const [attendanceImportAttemptName, setAttendanceImportAttemptName] = useState("");
  const nav = ["活动概览", "商品导入", "白名单", "现场到场", "订单管理", "抽奖规则"];
  const parsedProductCount = productFileName ? productImportInputCount : 0;
  const parsedWhitelistCount = whitelistFileName ? whitelistImportInputCount : 0;
  const recordOperation = (action: string, target: string, detail: string) => {
    setOperationLogs((current) => [{ id: createImportRowId("operation"), action, target, detail, operator: "运营管理员", time: new Date().toLocaleString("zh-CN", { hour12: false }) }, ...current]);
  };
  const changeActivityStatus = (nextStatus: ActivityStatus) => {
    const nextStarted = nextStatus === "running" || nextStatus === "ended";
    if (nextStatus === "ended" && !activityClosed) {
      setActionNotice("活动已截止，基础数据已锁定并进入只读状态。" );
      recordOperation("截止活动并锁定基础数据", "活动及基础数据", "活动截止后订单和基础数据进入只读状态。" );
    } else if (nextStarted && !activityStarted) {
      if (!productImportCompleted && productFileName) cancelProductImport();
      if (!whitelistImportCompleted && whitelistFileName) cancelWhitelistImport();
      if (pendingAttendanceImport) cancelAttendanceImport();
      setActionNotice(nextStatus === "ended" ? "活动已截止，基础数据已锁定并进入只读状态。" : "活动已开始，商品、白名单和现场到场 Excel 导入已锁定；如需调整只能改单条。");
      recordOperation(nextStatus === "ended" ? "截止活动并锁定基础数据" : "开始活动并锁定基础数据", "活动及基础数据", nextStatus === "ended" ? "活动截止后订单和基础数据进入只读状态。" : "活动开始后禁止 Excel、批量图片导入和批量删除。" );
    } else if (!nextStarted && activityStarted) {
      setActionNotice("活动已恢复为准备状态，当前可重新导入完整 Excel。");
      recordOperation("恢复活动准备状态", "活动及基础数据", "解除活动开始后的导入锁定，可重新导入完整商品、白名单和现场到场 Excel。" );
    } else {
      setActionNotice(`活动状态已切换为${nextStatus === "draft" ? "草稿" : nextStatus === "scheduled" ? "待开始" : nextStatus === "running" ? "进行中" : "已截止"}。`);
      recordOperation("调整活动状态", "活动状态", `状态调整为${nextStatus === "draft" ? "草稿" : nextStatus === "scheduled" ? "待开始" : nextStatus === "running" ? "进行中" : "已截止"}。`);
    }
    onActivityStatusChange(nextStatus);
  };
  const saveActivityConfig = () => {
    if (!activityNameDraft.trim()) {
      setActionNotice("请填写活动名称。" );
      return;
    }
    if (!activityStartDraft || !activityEndDraft) {
      setActionNotice("请填写活动开始时间和截止时间。" );
      return;
    }
    if (new Date(activityStartDraft).getTime() >= new Date(activityEndDraft).getTime()) {
      setActionNotice("活动开始时间必须早于截止时间。" );
      return;
    }
    onActivityNameChange(activityNameDraft.trim());
    onActivityStartAtChange(activityStartDraft);
    onActivityEndAtChange(activityEndDraft);
    recordOperation("保存活动配置", activityId, `活动名称：${activityNameDraft.trim()}；活动编号：${activityId}；开始：${activityStartDraft.replace("T", " ")}；截止：${activityEndDraft.replace("T", " ")}。`);
    setActionNotice("活动名称、编号和时间配置已保存。" );
  };
  const beginProductImport = () => {
    if (activityStarted) {
      setActionNotice("活动已开始，禁止重新导入商品 Excel。");
      return;
    }
    setProductImportCompleted(false);
    setProductFileName("");
    setProductSheetCounts([]);
    setProductImportWarnings([]);
    setProductImportError("");
    setProductImportInputCount(0);
    setProductImportStats(emptyProductImportStats);
    setPendingProductBaseRows(null);
    setPendingProductRollbackRows(null);
  };
  const cancelProductImport = () => {
    const hadConfirmedImport = productImportHasRun;
    if (pendingProductRollbackRows) setProductRows(cloneProductRows(pendingProductRollbackRows));
    setPendingProductBaseRows(null);
    setPendingProductRollbackRows(null);
    setProductFileName("");
    setProductSheetCounts([]);
    setProductImportWarnings([]);
    setProductImportError("");
    setProductImportInputCount(0);
    setProductImportStats(emptyProductImportStats);
    setProductImportCompleted(hadConfirmedImport);
    setActionNotice("已取消本次商品替换，当前商品目录保持不变。" );
  };
  const confirmProductImport = () => {
    if (activityStarted) {
      setActionNotice("活动已开始，禁止确认商品 Excel 导入。");
      return;
    }
    const cleanRows = productRows.map(clearProductImportAction);
    setProductRows(cleanRows);
    setPendingProductBaseRows(null);
    setPendingProductRollbackRows(null);
    setProductImportCompleted(true);
    onProductImportCommitted();
    recordOperation("替换商品 Excel", productFileName || "商品信息 Excel", `新增 ${productImportStats.added} 条，更新 ${productImportStats.updated} 条，移除 ${productImportStats.removed} 条。`);
    setActionNotice(`商品 Excel 替换完成：新增 ${productImportStats.added} 条、更新 ${productImportStats.updated} 条、移除 ${productImportStats.removed} 条；当前原型不会写入后端。`);
  };
  const handleProductFile = async (file: File) => {
    if (activityStarted) {
      setProductImportError("活动已开始，禁止重新导入商品 Excel。");
      setActionNotice("活动已开始，禁止重新导入商品 Excel。");
      return;
    }
    setProductImportError("");
    try {
      const result = await parseProductWorkbook(file);
      const imageResult = matchProductImages(result.rows, productImageAssets);
      const currentCatalogRows = productImportHasRun ? productRows : [];
      const baseRows = pendingProductBaseRows ? cloneProductRows(pendingProductBaseRows) : cloneProductRows(currentCatalogRows);
      const replaceResult = replaceProductImportRows(baseRows, imageResult.rows);
      setPendingProductBaseRows(pendingProductBaseRows ? pendingProductBaseRows : cloneProductRows(currentCatalogRows));
      setPendingProductRollbackRows(pendingProductRollbackRows ? pendingProductRollbackRows : cloneProductRows(productRows));
      setProductRows(replaceResult.rows);
      setProductFileName(file.name);
      setProductSheetCounts(result.sheetCounts);
      setProductImportInputCount(result.rows.length);
      setProductImportStats(replaceResult.stats);
      setProductImportWarnings([...result.warnings, ...replaceResult.warnings]);
      setProductImageStats(imageResult.stats);
      setProductImportCompleted(false);
      setActionNotice(`已解析 ${result.rows.length} 条商品：新增 ${replaceResult.stats.added} 条、更新 ${replaceResult.stats.updated} 条、移除 ${replaceResult.stats.removed} 条，请检查后确认替换。`);
    } catch (error) {
      setProductFileName(file.name);
      setProductSheetCounts([]);
      setProductImportInputCount(0);
      setProductImportStats(emptyProductImportStats);
      setProductImportWarnings([]);
      setProductImportError(error instanceof Error ? error.message : "文件解析失败，请检查 Excel 格式。");
      setProductImportCompleted(false);
    }
  };
  const handleProductImageFile = async (file: File) => {
    if (activityStarted) {
      setProductImageError("活动已开始，禁止批量导入商品图片。");
      setActionNotice("活动已开始，禁止批量导入商品图片；如需修改请编辑单条商品。");
      return;
    }
    setProductImageError("");
    try {
      const assets = await parseProductImageZip(file);
      const imageResult = matchProductImages(productRows, assets);
      revokeProductImageAssets(productImageAssets);
      setProductImageAssets(assets);
      setProductImageFileName(file.name);
      setProductRows(imageResult.rows);
      setProductImageStats(imageResult.stats);
      setActionNotice(`已读取 ${assets.length} 张商品图片，已匹配 ${imageResult.stats.matchedProducts} 条商品。`);
    } catch (error) {
      setProductImageError(error instanceof Error ? error.message : "图片 ZIP 解析失败，请检查文件。");
    }
  };
  const removeProductImages = () => {
    if (activityStarted) {
      setActionNotice("活动已开始，禁止批量移除商品图片；如需修改请编辑单条商品。");
      return;
    }
    revokeProductImageAssets(productImageAssets);
    setProductImageAssets([]);
    setProductImageFileName("");
    setProductImageStats({ totalImages: 0, matchedProducts: 0, pendingProducts: 0, unmatchedProducts: 0 });
    setProductImageError("");
    setProductRows((current) => current.map((row) => {
      const manualImages = row.images?.filter((image) => image.source === "manual") ?? [];
      return manualImages.length > 0 ? { ...row, images: manualImages, imageStatus: "手动维护" } : { ...row, images: undefined, imageStatus: "未上传" };
    }));
    setActionNotice("已移除 ZIP 商品图片，手动维护图片已保留；商品信息和订单数据不受影响。");
  };
  const openProductForm = () => {
    if (activityClosed) {
      setActionNotice("活动已截止，商品数据只读。" );
      return;
    }
    if (!productImportCompleted && (!productFileName || productImportError)) {
      setActionNotice("请先完成一次商品 Excel 解析，再手动添加商品。" );
      return;
    }
    setEditingProductRow(null);
    setProductFormOpen(true);
  };
  const saveProductRow = (row: ProductImportRow, reason = "") => {
    if (activityClosed) {
      setActionNotice("活动已截止，商品数据只读。" );
      return;
    }
    const hasManualImages = row.images?.some((image) => image.source === "manual") || row.imageStatus === "手动维护";
    const nextRow = hasManualImages ? { ...row, imageStatus: "手动维护" as const } : productImageAssets.length > 0 ? matchProductImages([row], productImageAssets).rows[0] : row;
    if (editingProductRow) {
      setProductRows((current) => current.map((item) => item.id === nextRow.id ? { ...nextRow, manuallyEdited: true } : item));
      if (activityStarted) recordOperation("活动开始后改单条商品", nextRow.materialName, `修改前：物料代码 ${editingProductRow.materialCode || "—"}、名称 ${editingProductRow.materialName || "—"}、元/箱 ${editingProductRow.casePrice || "—"}、分公司 ${editingProductRow.branchScope || "全部"}、状态 ${editingProductRow.status}；修改后：物料代码 ${nextRow.materialCode || "—"}、名称 ${nextRow.materialName || "—"}、元/箱 ${nextRow.casePrice || "—"}、分公司 ${nextRow.branchScope || "全部"}、状态 ${nextRow.status}；原因：${reason || "—"}。`);
      setActionNotice(`${activityStarted ? "已记录并保存" : "已保存"}商品修改：${nextRow.materialName}`);
      return;
    }
    const manualRow: ProductImportRow = { ...nextRow, source: "manual", importAction: undefined, manuallyEdited: true };
    setProductRows((current) => [...current, manualRow]);
    if (!productImportCompleted && productFileName) {
      setProductImportInputCount((current) => current + 1);
      setProductImportStats((current) => ({ ...current, added: current.added + 1 }));
    }
    recordOperation(activityStarted ? "活动开始后手动新增商品" : "手动添加商品", manualRow.materialName, `物料代码：${manualRow.materialCode || "—"}；客户类型：${manualRow.customerType}；返利：${manualRow.rebate}；${activityStarted ? `原因：${reason || "—"}。` : ""}`);
    setActionNotice(`${activityStarted ? "已记录并添加" : "已添加"}商品：${manualRow.materialName}`);
  };
  const beginWhitelistImport = () => {
    if (activityStarted) {
      setActionNotice("活动已开始，禁止重新导入白名单 Excel。");
      return;
    }
    setWhitelistImportCompleted(false);
    setWhitelistFileName("");
    setWhitelistSheetCounts([]);
    setWhitelistImportWarnings([]);
    setWhitelistImportError("");
    setWhitelistImportInputCount(0);
    setWhitelistImportStats(emptyWhitelistImportStats);
    setPendingWhitelistBaseRows(null);
    setPendingWhitelistRollbackRows(null);
  };
  const cancelWhitelistImport = () => {
    const hadConfirmedImport = whitelistImportHasRun;
    const rollbackRows = pendingWhitelistRollbackRows ? cloneWhitelistRows(pendingWhitelistRollbackRows) : whitelistRows;
    if (pendingWhitelistRollbackRows) setWhitelistRows(rollbackRows);
    setPendingWhitelistBaseRows(null);
    setPendingWhitelistRollbackRows(null);
    setWhitelistFileName("");
    setWhitelistSheetCounts([]);
    setWhitelistImportWarnings([]);
    setWhitelistImportError("");
    setWhitelistImportInputCount(0);
    setWhitelistImportStats(emptyWhitelistImportStats);
    setWhitelistImportCompleted(hadConfirmedImport);
    setActionNotice("已取消本次白名单替换，当前白名单保持不变。" );
  };
  const confirmWhitelistImport = () => {
    if (activityStarted) {
      setActionNotice("活动已开始，禁止确认白名单 Excel 导入。");
      return;
    }
    const cleanRows = whitelistRows.map(clearWhitelistImportAction);
    setWhitelistRows(cleanRows);
    setPendingWhitelistBaseRows(null);
    setPendingWhitelistRollbackRows(null);
    setWhitelistImportCompleted(true);
    onWhitelistImportCommitted();
    recordOperation("替换白名单 Excel", whitelistFileName || "客户白名单 Excel", `新增 ${whitelistImportStats.added} 名，更新 ${whitelistImportStats.phoneUpdated + whitelistImportStats.updated} 名，移除 ${whitelistImportStats.removed} 名。`);
    setActionNotice(`白名单 Excel 替换完成：新增 ${whitelistImportStats.added} 名、更新 ${whitelistImportStats.phoneUpdated + whitelistImportStats.updated} 名、移除 ${whitelistImportStats.removed} 名；当前原型不会写入后端。`);
  };
  const handleWhitelistFile = async (file: File) => {
    if (activityStarted) {
      setWhitelistImportError("活动已开始，禁止重新导入白名单 Excel。");
      setActionNotice("活动已开始，禁止重新导入白名单 Excel。");
      return;
    }
    setWhitelistImportError("");
    try {
      const result = await parseWhitelistWorkbook(file);
      const currentCatalogRows = whitelistImportHasRun ? whitelistRows : [];
      const baseRows = pendingWhitelistBaseRows ? cloneWhitelistRows(pendingWhitelistBaseRows) : cloneWhitelistRows(currentCatalogRows);
      const replaceResult = replaceWhitelistImportRows(baseRows, result.rows);
      setPendingWhitelistBaseRows(pendingWhitelistBaseRows ? pendingWhitelistBaseRows : cloneWhitelistRows(currentCatalogRows));
      setPendingWhitelistRollbackRows(pendingWhitelistRollbackRows ? pendingWhitelistRollbackRows : cloneWhitelistRows(whitelistRows));
      setWhitelistRows(replaceResult.rows);
      setWhitelistFileName(file.name);
      setWhitelistSheetCounts(result.sheetCounts);
      setWhitelistImportInputCount(result.rows.length);
      setWhitelistImportStats(replaceResult.stats);
      setWhitelistImportWarnings([...result.warnings, ...replaceResult.warnings]);
      setWhitelistImportCompleted(false);
      setActionNotice(`已解析 ${result.rows.length} 名白名单客户：新增 ${replaceResult.stats.added} 名、更新 ${replaceResult.stats.phoneUpdated + replaceResult.stats.updated} 名、移除 ${replaceResult.stats.removed} 名，请检查后确认替换。`);
    } catch (error) {
      setWhitelistFileName(file.name);
      setWhitelistSheetCounts([]);
      setWhitelistImportInputCount(0);
      setWhitelistImportStats(emptyWhitelistImportStats);
      setWhitelistImportWarnings([]);
      setWhitelistImportError(error instanceof Error ? error.message : "文件解析失败，请检查 Excel 格式。");
      setWhitelistImportCompleted(false);
    }
  };
  const openWhitelistForm = () => {
    if (activityClosed) {
      setActionNotice("活动已截止，白名单数据只读。" );
      return;
    }
    if (!whitelistImportCompleted && (!whitelistFileName || whitelistImportError)) {
      setActionNotice("请先完成一次白名单 Excel 解析，再手动添加客户。" );
      return;
    }
    setEditingWhitelistRow(null);
    setWhitelistFormOpen(true);
  };
  const handleAttendanceFile = async (file: File) => {
    if (activityStarted) {
      onAttendanceImportErrorChange("活动已开始，禁止重新导入现场到场 Excel。" );
      setActionNotice("活动已开始，禁止重新导入现场到场 Excel。" );
      return;
    }
    setAttendanceImportAttemptName(file.name);
    onAttendanceImportErrorChange("");
    try {
      const result = await parseAttendanceWorkbook(file);
      setPendingAttendanceImport({ ...result, fileName: file.name });
      setActionNotice(`已解析 ${result.rows.length} 名现场到场客户，请检查预览后确认导入。`);
    } catch (error) {
      onAttendanceImportErrorChange(error instanceof Error ? error.message : "文件解析失败，请检查 Excel 内容。" );
      setPendingAttendanceImport(null);
    }
  };
  const cancelAttendanceImport = () => {
    if (!pendingAttendanceImport && !attendanceImportError) return;
    setPendingAttendanceImport(null);
    setAttendanceImportAttemptName("");
    onAttendanceImportErrorChange("");
    setAttendanceFormOpen(false);
    setEditingAttendanceRow(null);
    setActionNotice("已取消本次现场到场名单导入，当前名单保持不变。" );
  };
  const confirmAttendanceImport = () => {
    if (activityStarted) {
      setActionNotice("活动已开始，禁止确认现场到场 Excel 导入。" );
      return;
    }
    if (!pendingAttendanceImport) return;
    const imported = pendingAttendanceImport;
    setAttendanceRows(cloneAttendanceRows(imported.rows));
    onAttendanceFileNameChange(imported.fileName);
    onAttendanceIsDemoChange(false);
    onAttendanceWarningsChange(imported.warnings);
    onAttendanceSheetCountsChange(imported.sheetCounts);
    onAttendanceImportErrorChange("");
    setPendingAttendanceImport(null);
    setAttendanceImportAttemptName("");
    setAttendanceFormOpen(false);
    setEditingAttendanceRow(null);
    recordOperation("替换现场到场 Excel", imported.fileName, `确认导入 ${imported.rows.length} 名现场到场客户；抽奖候选池已同步更新。`);
    setActionNotice(`现场到场 Excel 导入完成：${imported.rows.length} 名客户，抽奖候选池已同步更新。`);
  };
  const restoreAttendanceDemo = () => {
    if (activityStarted) {
      setActionNotice("活动已开始，禁止批量恢复现场到场名单。" );
      return;
    }
    setAttendanceRows(cloneAttendanceRows(initialAttendanceRows));
    onAttendanceFileNameChange("现场到场客户名单-演示.xlsx");
    onAttendanceIsDemoChange(true);
    onAttendanceWarningsChange([]);
    onAttendanceSheetCountsChange([]);
    onAttendanceImportErrorChange("");
    setPendingAttendanceImport(null);
    setAttendanceImportAttemptName("");
    setActionNotice("已恢复现场到场客户演示数据。" );
  };
  const saveWhitelistRow = (row: WhitelistRow, reason = "") => {
    if (activityClosed) {
      setActionNotice("活动已截止，白名单数据只读。" );
      return;
    }
    const nextRow = { ...row, identityKey: whitelistIdentityKey(row), importAction: undefined };
    if (editingWhitelistRow) {
      setWhitelistRows((current) => current.map((item) => item.id === nextRow.id ? { ...nextRow, manuallyEdited: true } : item));
      if (activityStarted) recordOperation("活动开始后改单条白名单", nextRow.dealerShort || nextRow.dealerFull, `修改前：客户类型 ${editingWhitelistRow.customerType}、全称 ${editingWhitelistRow.dealerFull || "—"}、姓名 ${editingWhitelistRow.dealerName || "—"}、电话 ${editingWhitelistRow.dealerPhone || "—"}、分公司 ${editingWhitelistRow.branch || "—"}、状态 ${editingWhitelistRow.status}；修改后：客户类型 ${nextRow.customerType}、全称 ${nextRow.dealerFull || "—"}、姓名 ${nextRow.dealerName || "—"}、电话 ${nextRow.dealerPhone || "—"}、分公司 ${nextRow.branch || "—"}、状态 ${nextRow.status}；原因：${reason || "—"}。`);
      setActionNotice(`${activityStarted ? "已记录并保存" : "已保存"}白名单修改：${nextRow.dealerShort}`);
      return;
    }
    const manualRow: WhitelistRow = { ...nextRow, source: "manual", status: "有效", manuallyEdited: true };
    setWhitelistRows((current) => [...current, manualRow]);
    if (!whitelistImportCompleted && whitelistFileName) {
      setWhitelistImportInputCount((current) => current + 1);
      setWhitelistImportStats((current) => ({ ...current, added: current.added + 1 }));
    }
    recordOperation(activityStarted ? "活动开始后手动新增白名单客户" : "手动添加白名单客户", manualRow.dealerShort || manualRow.dealerFull, `客户类型：${manualRow.customerType}；电话：${manualRow.dealerPhone || "—"}；${activityStarted ? `原因：${reason || "—"}。` : ""}`);
    setActionNotice(`${activityStarted ? "已记录并添加" : "已添加"}白名单客户：${manualRow.dealerShort || manualRow.dealerFull}`);
  };
  const saveAttendanceRow = (row: AttendanceRow) => {
    if (activityClosed) {
      setActionNotice("活动已截止，现场到场名单只读。" );
      return;
    }
    if (pendingAttendanceImport) {
      if (editingAttendanceRow) {
        setPendingAttendanceImport((current) => current ? { ...current, rows: current.rows.map((item) => item.id === row.id ? row : item) } : current);
        setActionNotice(`已修改待导入到场客户：${row.dealerCompany || row.dealerName || "未命名客户"}，确认导入后生效。`);
      } else {
        setPendingAttendanceImport((current) => current ? { ...current, rows: [...current.rows, row] } : current);
        setActionNotice(`已添加待导入到场客户：${row.dealerCompany || row.dealerName || "未命名客户"}，确认导入后生效。`);
      }
      return;
    }
    if (editingAttendanceRow) {
      setAttendanceRows((current) => current.map((item) => item.id === row.id ? row : item));
      if (activityStarted) recordOperation("活动开始后改单条现场到场客户", row.dealerCompany || row.dealerName, `修改现场到场信息；原因由表单记录。`);
      else recordOperation("编辑现场到场客户", row.dealerCompany || row.dealerName, "修改当前现场到场名单信息。" );
      onAttendanceIsDemoChange(false);
      setActionNotice(`${activityStarted ? "已记录并保存" : "已保存"}到场客户修改：${row.dealerCompany || row.dealerName || "未命名客户"}`);
    } else {
      setAttendanceRows((current) => [...current, row]);
      onAttendanceIsDemoChange(false);
      recordOperation(activityStarted ? "活动开始后手动新增现场到场客户" : "手动添加现场到场客户", row.dealerCompany || row.dealerName, activityStarted ? "活动开始后单条补录现场到场客户。" : "手动添加现场到场客户。" );
      setActionNotice(`已添加到场客户：${row.dealerCompany || row.dealerName || "未命名客户"}`);
    }
  };
  const deleteProductRows = (ids: string[]) => {
    if (activityStarted) {
      setActionNotice("活动已开始，禁止删除商品；如需紧急处理请改单条并记录原因。");
      return;
    }
    setProductRows((current) => current.filter((row) => !ids.includes(row.id)));
    setEditingProductRow((current) => current && ids.includes(current.id) ? null : current);
    recordOperation("删除商品", `${ids.length} 条商品`, "从当前有效商品列表移除；已有订单明细和金额不受影响。" );
    setActionNotice(`${productImportCompleted ? "已删除" : "已从待导入结果移除"} ${ids.length} 条商品，已有订单明细和金额不受影响。`);
  };
  const deleteWhitelistRows = (ids: string[]) => {
    if (activityStarted) {
      setActionNotice("活动已开始，禁止删除白名单客户；如需紧急处理请改单条并记录原因。");
      return;
    }
    setWhitelistRows((current) => {
      const nextRows = current.filter((row) => !ids.includes(row.id));
      return nextRows;
    });
    setEditingWhitelistRow((current) => current && ids.includes(current.id) ? null : current);
    recordOperation("删除白名单", `${ids.length} 名客户`, "从当前有效白名单移除；已有订单不会被删除。" );
    setActionNotice(`${whitelistImportCompleted ? "已删除" : "已从待导入结果移除"} ${ids.length} 名白名单客户，已有订单不会被删除。`);
  };
  const deleteAttendanceRows = (ids: string[]) => {
    if (activityStarted) {
      setActionNotice("活动已开始，禁止批量删除现场到场客户；如需调整请编辑单条记录。");
      return;
    }
    if (ids.length === 0) return;
    if (pendingAttendanceImport) {
      setPendingAttendanceImport((current) => current ? { ...current, rows: current.rows.filter((row) => !ids.includes(row.id)) } : current);
      setActionNotice(`已从待导入结果移除 ${ids.length} 名到场客户，确认导入后生效。`);
      return;
    }
    setAttendanceRows((current) => current.filter((row) => !ids.includes(row.id)));
    setEditingAttendanceRow((current) => current && ids.includes(current.id) ? null : current);
    recordOperation("删除现场到场客户", `${ids.length} 名客户`, "从当前现场到场名单移除，并同步从抽奖候选池移除；原 Excel 文件不受影响。" );
    setActionNotice(`已删除 ${ids.length} 名现场到场客户，抽奖候选池已同步更新。`);
  };
  return (
    <section className="admin-app">
      <aside className="admin-sidebar">
        <div className="admin-logo"><span>金</span><b>订购会管理平台</b></div>
        <nav>{nav.map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}><i>{item.slice(0, 1)}</i>{item}</button>)}</nav>
        <div className="admin-user"><span>陈</span><p><b>运营管理员</b><small>调味品事业部</small></p></div>
      </aside>
      <main className="admin-main">
        <header><div><span>{activityName}</span><b>{tab}</b></div><div className="admin-actions"><button onClick={() => setOperationLogOpen((value) => !value)}>操作日志{operationLogs.length > 0 ? ` · ${operationLogs.length}` : ""}</button><span className={activityClosed ? "closed" : activityStarted ? "" : "pending"}>{activityStatus === "draft" ? "草稿" : activityStatus === "scheduled" ? "待开始" : activityStatus === "running" ? "进行中" : "已截止"}</span>{activityStarted && <span className="locked">数据已锁定</span>}{operationLogOpen && <div className="operation-log-popover"><div><b>操作日志</b><button type="button" onClick={() => setOperationLogOpen(false)}>×</button></div>{operationLogs.length === 0 ? <p>暂无操作记录</p> : operationLogs.slice(0, 8).map((entry) => <article key={entry.id}><b>{entry.action}</b><span>{entry.target}</span><small>{entry.detail}</small><em>{entry.operator} · {entry.time}</em></article>)}</div>}</div></header>
        {tab === "活动概览" && (
          <>
            <div className="admin-stats">
              {[["订单总金额", "¥19,457,005.28", "+12.8%"], ["已提交客户", "1,146", "68.2%"], ["订货总箱数", "38,620", "+2,841"], ["订货总吨数", "1,316.0", "+98.2"]].map((item) => <article key={item[0]}><span>{item[0]}</span><strong>{item[1]}</strong><small>{item[2]} 较1小时前</small></article>)}
            </div>
            <div className="admin-grid">
              <article className="progress-card"><h2>客户提交进度</h2>{[["综合客户", 1073, 826], ["特渠专业客户", 607, 320]].map((x) => <div key={x[0] as string}><p><b>{x[0]}</b><span>{x[2]} / {x[1]}</span></p><i><em style={{ width: `${Number(x[2]) / Number(x[1]) * 100}%` }} /></i></div>)}</article>
              <article className="activity-card"><h2>活动设置</h2><div className="activity-config-grid"><label><span>活动名称 *</span><input value={activityNameDraft} onChange={(event) => setActivityNameDraft(event.target.value)} placeholder="例如：2026 年中秋订货会" /></label><label><span>活动编号</span><input value={activityId} readOnly aria-label="活动编号，只读" /></label><label><span>订货开始时间</span><input type="datetime-local" value={activityStartDraft} onChange={(event) => setActivityStartDraft(event.target.value)} /></label><label><span>订货截止时间</span><input type="datetime-local" value={activityEndDraft} onChange={(event) => setActivityEndDraft(event.target.value)} /></label><label><span>活动状态</span><select value={activityStatus} onChange={(event) => changeActivityStatus(event.target.value as ActivityStatus)}><option value="draft">草稿</option><option value="scheduled">待开始</option><option value="running">进行中</option><option value="ended">已截止</option></select></label></div><p><span>当前状态</span><b className={activityClosed ? "closed-text" : activityStarted ? "green" : "pending-text"}>{activityStatus === "draft" ? "草稿" : activityStatus === "scheduled" ? "待开始" : activityStatus === "running" ? "进行中" : "已截止"}</b></p><p><span>基础数据</span><b className={activityStarted ? "closed-text" : "green"}>{activityStarted ? "已锁定" : "可导入"}</b></p><p><span>运行规则</span><small>{activityClosed ? "全部数据只读" : activityStarted ? "仅可单条手动调整" : "可批量导入和替换"}</small></p><div className="activity-card-actions"><button className="admin-primary" onClick={saveActivityConfig}>保存活动设置</button><button onClick={() => changeActivityStatus(activityStarted ? "scheduled" : "running")}>{activityStarted ? "恢复为待开始" : "立即开始并锁定导入"}</button></div></article>
            </div>
          </>
        )}
        {tab === "商品导入" && (
          <div className="admin-panel">
            <div className="panel-title"><div><h2>{productImportCompleted ? "当前活动商品" : "活动商品导入"}</h2><p>{productImportCompleted ? "当前数据来自最近一次确认的完整 Excel，可在活动开始前重新替换" : "上传完整商品 Excel，浏览器解析后替换当前商品目录"}</p></div><div className="panel-actions"><button className="secondary-button" disabled={activityClosed || (!productImportCompleted && (!productFileName || productImportError))} onClick={openProductForm}>＋ 手动添加商品</button>{productImportCompleted && <button className="admin-primary" disabled={activityStarted} onClick={beginProductImport}>重新导入 Excel</button>}</div></div>
            {!productImportCompleted && <div className="import-rule-hint"><b>全量替换规则</b><span>{activityStarted ? "活动已开始，商品 Excel 和批量图片导入已锁定；如需紧急处理，只能编辑单条商品并记录操作日志。" : "每次确认的商品 Excel 都是当前完整数据，会替换上一次 Excel 结果；本次导入前可以编辑或删除，下一次重新导入后以新 Excel 为准。商品图片 ZIP 按物料名称匹配并写入商品字段。"}</span></div>}
            {!productImportCompleted && <div className="dual-upload-grid product-import-upload-grid">
              <article className={`file-upload-card ${productFileName && !productImportError ? "ready" : ""}`}>
                <div className="file-card-heading"><span>XL</span><div><b>商品信息 Excel</b><small>统一文件 · 读取 4 个商品 Sheet</small></div><em>{productFileName ? (productImportError ? "解析失败" : "解析完成") : "待上传"}</em></div>
                {productFileName ? <p title={productFileName}>{productFileName}</p> : <p>请选择：调味产品信息表.xlsx</p>}
                <div className="sheet-tags">{productSheetConfig.map((item) => <span key={item.name}>{item.name}</span>)}</div>
                <footer><small>{activityStarted ? "活动已开始，Excel 导入已锁定" : productFileName && !productImportError ? `识别 ${parsedProductCount} 条商品` : "必须包含上述 4 个 Sheet"}</small><div>{productFileName && <button type="button" disabled={activityStarted} onClick={cancelProductImport}>移除</button>}<label className={activityStarted ? "disabled" : ""}><input type="file" accept=".xlsx,.xls" disabled={activityStarted} onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleProductFile(file); event.currentTarget.value = ""; }} />{productFileName ? "替换文件" : "选择文件"}</label></div></footer>
              </article>
              <ProductImageUploadCard fileName={productImageFileName} stats={productImageStats} error={productImageError} disabled={activityStarted || (!productFileName && !productImportCompleted)} disabledMessage={activityStarted ? "活动已开始，批量图片导入已锁定" : undefined} onFile={handleProductImageFile} onRemove={removeProductImages} />
            </div>}
            {!productImportCompleted && productFileName && <div className="import-result"><div className="import-summary"><span className="success-icon">✓</span><p><b>{productImportError ? "文件解析失败" : "Excel 解析完成 · 等待确认替换"}</b><small>{productImportError ? "请修正文件后重新选择" : `物料代码优先匹配；本次新增 ${productImportStats.added} 条、更新 ${productImportStats.updated} 条、移除 ${productImportStats.removed} 条、疑似重复 ${productImportStats.suspected + productImportStats.pending} 条`}</small></p><strong>{parsedProductCount} 条商品</strong></div>{productImportError && <div className="warning-box"><b>文件无法导入</b><span>{productImportError}</span></div>}{!productImportError && productImportWarnings.length > 0 && <div className="warning-box"><b>导入前检查提示</b>{productImportWarnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}{!productImportError && <><div className="sheet-counts">{productSheetCounts.map((item) => <span key={item.name}>{item.name}<b>{item.count}</b></span>)}</div><div className="product-import-stats">{[["新增", productImportStats.added], ["更新", productImportStats.updated], ["未变更", productImportStats.unchanged], ["移除", productImportStats.removed], ["疑似重复", productImportStats.suspected], ["待确认", productImportStats.pending]].map(([label, count]) => <span key={label as string}><b>{count}</b><small>{label}</small></span>)}</div><ProductImportTable rows={productRows} onEdit={setEditingProductRow} readOnly={activityClosed} allowDelete={!activityStarted} onDelete={deleteProductRows} /><button className="admin-primary wide" disabled={!parsedProductCount || activityStarted} onClick={confirmProductImport}>确认替换当前商品 {parsedProductCount} 条</button></>}</div>}
            {productImportCompleted && <><div className="import-completed-banner"><span className="success-icon">✓</span><p><b>本次商品 Excel 替换完成</b><small>{activityClosed ? "活动已截止，商品数据只读。" : activityStarted ? "活动已开始，Excel 导入已锁定；紧急修改单条商品会记录操作日志。" : "当前商品来自最近一次确认的完整 Excel；重新导入后以新 Excel 为准，订单明细仍保留。"}</small></p><div><strong>{parsedProductCount}</strong><small>本次解析</small></div><div><strong>{productImportStats.added}</strong><small>新增</small></div><div><strong>{productImportStats.updated}</strong><small>更新</small></div><div><strong>{productImportStats.removed}</strong><small>移除</small></div></div><ProductImageUploadCard fileName={productImageFileName} stats={productImageStats} error={productImageError} disabled={activityStarted || (!productFileName && !productImportCompleted)} disabledMessage={activityStarted ? "活动已开始，批量图片导入已锁定" : undefined} onFile={handleProductImageFile} onRemove={removeProductImages} /><div className="data-section-title"><div><b>当前活动商品</b><span>{productFileName} · 共 {productRows.length} 条 · {activityClosed ? "活动已截止，只读" : activityStarted ? "活动已锁定，仅可改单条" : "可编辑、单条/批量删除"}</span></div><button disabled={activityStarted} onClick={() => setProductImportCompleted(false)}>查看本次导入结果</button></div><ProductImportTable rows={productRows} onEdit={setEditingProductRow} readOnly={activityClosed} allowDelete={!activityStarted} allowDeleteAll={!activityStarted} onDelete={deleteProductRows} /></>}
          </div>
        )}
        {tab === "白名单" && (
          <div className="admin-panel">
            <div className="panel-title"><div><h2>{whitelistImportCompleted ? "当前客户白名单" : "客户白名单导入"}</h2><p>{whitelistImportCompleted ? "当前数据来自最近一次确认的完整 Excel，可在活动开始前重新替换" : "上传完整白名单 Excel，浏览器解析后替换当前白名单"}</p></div><div className="panel-actions"><button className="secondary-button" disabled={activityClosed || (!whitelistImportCompleted && (!whitelistFileName || whitelistImportError))} onClick={openWhitelistForm}>＋ 手动添加客户</button>{whitelistImportCompleted && <button className="admin-primary" disabled={activityStarted} onClick={beginWhitelistImport}>重新导入 Excel</button>}</div></div>
            {!whitelistImportCompleted && <div className="import-rule-hint"><b>全量替换规则</b><span>{activityStarted ? "活动已开始，白名单 Excel 导入已锁定；如需紧急处理，只能编辑单条客户并记录操作日志。" : "每次确认的白名单 Excel 都是当前完整数据，会替换上一次 Excel 结果；本次导入前可以编辑或删除，下一次重新导入后以新 Excel 为准。客户类型由 Sheet 确定，综合和特渠可以存在同一个手机号。"}</span></div>}
            {!whitelistImportCompleted && <div className="single-upload-grid">
              <article className={"file-upload-card " + (whitelistFileName && !whitelistImportError ? "ready" : "")}>
                <div className="file-card-heading"><span>XL</span><div><b>客户白名单 Excel</b><small>统一文件 · 读取 2 个白名单 Sheet</small></div><em>{whitelistFileName ? (whitelistImportError ? "解析失败" : "解析完成") : "待上传"}</em></div>
                {whitelistFileName ? <p title={whitelistFileName}>{whitelistFileName}</p> : <p>请选择：【白名单】26年中秋订货会经销商白名单7.2.xlsx</p>}
                <div className="sheet-tags">{whitelistSheetConfig.map((item) => <span key={item.name}>{item.name}</span>)}</div>
                <footer><small>{activityStarted ? "活动已开始，Excel 导入已锁定" : whitelistFileName && !whitelistImportError ? "识别 " + parsedWhitelistCount + " 名客户" : "必须包含上述 2 个 Sheet"}</small><div>{whitelistFileName && <button type="button" disabled={activityStarted} onClick={cancelWhitelistImport}>移除</button>}<label className={activityStarted ? "disabled" : ""}><input type="file" accept=".xlsx,.xls" disabled={activityStarted} onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleWhitelistFile(file); event.currentTarget.value = ""; }} />{whitelistFileName ? "替换文件" : "选择文件"}</label></div></footer>
              </article>
            </div>}
            {!whitelistImportCompleted && whitelistFileName && <div className="import-result"><div className="import-summary"><span className="success-icon">✓</span><p><b>{whitelistImportError ? "文件解析失败" : "Excel 解析完成 · 等待确认替换"}</b><small>{whitelistImportError ? "请修正文件后重新选择" : `按客户类型 + 名称全称匹配；本次新增 ${whitelistImportStats.added} 名、更新 ${whitelistImportStats.phoneUpdated + whitelistImportStats.updated} 名、移除 ${whitelistImportStats.removed} 名、名称异常 ${whitelistImportStats.duplicateName + whitelistImportStats.pendingName} 名`}</small></p><strong>{parsedWhitelistCount} 名客户</strong></div>{whitelistImportError && <div className="warning-box"><b>文件无法导入</b><span>{whitelistImportError}</span></div>}{!whitelistImportError && whitelistImportWarnings.length > 0 && <div className="warning-box"><b>导入前检查提示</b>{whitelistImportWarnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}{!whitelistImportError && <><div className="sheet-counts">{whitelistSheetCounts.map((item) => <span key={item.name}>{item.name}<b>{item.count}</b></span>)}</div><div className="product-import-stats">{[["新增", whitelistImportStats.added], ["更新", whitelistImportStats.phoneUpdated + whitelistImportStats.updated], ["未变更", whitelistImportStats.unchanged], ["移除", whitelistImportStats.removed], ["名称异常", whitelistImportStats.duplicateName + whitelistImportStats.pendingName], ["电话待处理", whitelistImportStats.pendingPhone]].map(([label, count]) => <span key={label as string}><b>{count}</b><small>{label}</small></span>)}</div><CustomerWhitelistTable rows={whitelistRows} onEdit={setEditingWhitelistRow} readOnly={activityClosed} allowDelete={!activityStarted} onDelete={deleteWhitelistRows} /><button className="admin-primary wide" disabled={!parsedWhitelistCount || activityStarted} onClick={confirmWhitelistImport}>确认替换当前白名单 {parsedWhitelistCount} 名</button></>}</div>}
            {whitelistImportCompleted && <><div className="import-completed-banner"><span className="success-icon">✓</span><p><b>本次白名单 Excel 替换完成</b><small>{activityClosed ? "活动已截止，白名单数据只读。" : activityStarted ? "活动已开始，白名单 Excel 导入已锁定；紧急修改单条客户会记录操作日志。" : "当前白名单来自最近一次确认的完整 Excel；重新导入后以新 Excel 为准，历史订单不会被删除。"}</small></p><div><strong>{parsedWhitelistCount}</strong><small>本次解析</small></div><div><strong>{whitelistImportStats.added}</strong><small>新增</small></div><div><strong>{whitelistImportStats.phoneUpdated + whitelistImportStats.updated}</strong><small>更新</small></div><div><strong>{whitelistImportStats.removed}</strong><small>移除</small></div></div><div className="data-section-title"><div><b>当前客户白名单</b><span>{whitelistFileName} · 综合客户和特渠客户共 {whitelistRows.length} 名 · {activityClosed ? "活动已截止，只读" : activityStarted ? "活动已锁定，仅可改单条" : "可编辑、单条/批量删除"}</span></div><button disabled={activityStarted} onClick={() => setWhitelistImportCompleted(false)}>查看本次导入结果</button></div><CustomerWhitelistTable rows={whitelistRows} onEdit={setEditingWhitelistRow} readOnly={activityClosed} allowDelete={!activityStarted} allowDeleteAll={!activityStarted} onDelete={deleteWhitelistRows} /></>}
          </div>
        )}
        {tab === "现场到场" && <AttendancePage rows={pendingAttendanceImport?.rows ?? attendanceRows} fileName={attendanceFileName} isDemo={attendanceIsDemo} warnings={attendanceWarnings} sheetCounts={attendanceSheetCounts} error={attendanceImportError} activityStarted={activityStarted} activityClosed={activityClosed} pendingImport={pendingAttendanceImport} importAttemptName={attendanceImportAttemptName} onFile={handleAttendanceFile} onRestoreDemo={restoreAttendanceDemo} onAdd={() => { setEditingAttendanceRow(null); setAttendanceFormOpen(true); }} onEdit={setEditingAttendanceRow} onDelete={deleteAttendanceRows} onConfirmImport={confirmAttendanceImport} onCancelImport={cancelAttendanceImport} />}
        {tab === "订单管理" && <OrderManagement activityClosed={activityClosed} />}
        {tab === "抽奖规则" && <LotterySettings rounds={lotteryRounds} attendanceRows={attendanceRows} onChange={onLotteryChange} />}
      </main>
      {(productFormOpen || editingProductRow) && <ProductFormDrawer key={editingProductRow?.id ?? "new-product"} rows={productRows} initialRow={editingProductRow ?? undefined} activityStarted={activityStarted} onClose={() => { setProductFormOpen(false); setEditingProductRow(null); }} onSave={saveProductRow} />}
      {(whitelistFormOpen || editingWhitelistRow) && <WhitelistFormDrawer key={editingWhitelistRow?.id ?? "new-whitelist"} rows={whitelistRows} initialRow={editingWhitelistRow ?? undefined} activityStarted={activityStarted} onClose={() => { setWhitelistFormOpen(false); setEditingWhitelistRow(null); }} onSave={saveWhitelistRow} />}
      {(attendanceFormOpen || editingAttendanceRow) && !activityClosed && <AttendanceFormDrawer key={editingAttendanceRow?.id ?? "new-attendance"} rows={pendingAttendanceImport?.rows ?? attendanceRows} initialRow={editingAttendanceRow ?? undefined} onClose={() => { setAttendanceFormOpen(false); setEditingAttendanceRow(null); }} onSave={saveAttendanceRow} />}
      {actionNotice && <div className="admin-toast" role="status"><span>✓</span>{actionNotice}<button aria-label="关闭提示" onClick={() => setActionNotice("")}>×</button></div>}
    </section>
  );
}

export function Prototype() {
  const [surface, setSurface] = useState<Surface>("h5");
  const [lotteryRounds, setLotteryRounds] = useState<LotteryRound[]>(initialLotteryRounds);
  const [activityName, setActivityName] = useState("2026年中秋订货会");
  const [activityId] = useState("HD202608200001");
  const [activityStatus, setActivityStatus] = useState<ActivityStatus>("scheduled");
  const [activityStartAt, setActivityStartAt] = useState("2030-07-28T14:30");
  const [activityEndAt, setActivityEndAt] = useState("2030-07-30T18:30");
  const activityClosed = activityStatus === "ended";
  const [productRows, setProductRows] = useState<ProductImportRow[]>(initialProductImportRows);
  const [productImportCompleted, setProductImportCompleted] = useState(false);
  const [productImportHasRun, setProductImportHasRun] = useState(false);
  const [whitelistRows, setWhitelistRows] = useState<WhitelistRow[]>(initialWhitelistRows);
  const [whitelistImportCompleted, setWhitelistImportCompleted] = useState(false);
  const [whitelistImportHasRun, setWhitelistImportHasRun] = useState(false);
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRow[]>(() => cloneAttendanceRows(initialAttendanceRows));
  const [attendanceFileName, setAttendanceFileName] = useState("现场到场客户名单-演示.xlsx");
  const [attendanceIsDemo, setAttendanceIsDemo] = useState(true);
  const [attendanceWarnings, setAttendanceWarnings] = useState<string[]>([]);
  const [attendanceSheetCounts, setAttendanceSheetCounts] = useState<Array<{ name: string; count: number }>>([]);
  const [attendanceImportError, setAttendanceImportError] = useState("");
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
        <div className="prototype-title"><span>金</span><p><b>{activityName}</b><small>交互原型 · Mock Data</small></p></div>
        <div className="surface-tabs">{surfaces.map((item) => <button key={item.key} className={surface === item.key ? "active" : ""} onClick={() => setSurface(item.key)}><b>{item.label}</b><small>{item.sub}</small></button>)}</div>
        <div className="prototype-status"><i /> 原型预览</div>
      </nav>
      <div className="prototype-canvas">
        <div className={surface === "h5" ? "surface-slot" : "surface-slot surface-hidden"}><H5Prototype activityClosed={activityClosed} importedRows={productImportCompleted ? productRows : null} importedWhitelistRows={whitelistImportCompleted ? whitelistRows : null} /></div>
        {surface === "ranking" && <RankingBoard />}
        {surface === "report" && <ReportBoard />}
        {surface === "lottery" && <LotteryBoard rounds={lotteryRounds} attendanceRows={attendanceRows} onComplete={(id) => setLotteryRounds((items) => items.map((item) => item.id === id ? { ...item, status: "completed" } : item))} />}
        {surface === "admin" && <AdminPrototype lotteryRounds={lotteryRounds} onLotteryChange={setLotteryRounds} activityName={activityName} onActivityNameChange={setActivityName} activityId={activityId} activityStatus={activityStatus} onActivityStatusChange={setActivityStatus} activityStartAt={activityStartAt} onActivityStartAtChange={setActivityStartAt} activityEndAt={activityEndAt} onActivityEndAtChange={setActivityEndAt} productRows={productRows} onProductRowsChange={setProductRows} productImportCompleted={productImportCompleted} onProductImportCompleted={setProductImportCompleted} onProductImportCommitted={() => setProductImportHasRun(true)} productImportHasRun={productImportHasRun} whitelistRows={whitelistRows} onWhitelistRowsChange={setWhitelistRows} whitelistImportCompleted={whitelistImportCompleted} onWhitelistImportCompleted={setWhitelistImportCompleted} onWhitelistImportCommitted={() => setWhitelistImportHasRun(true)} whitelistImportHasRun={whitelistImportHasRun} attendanceRows={attendanceRows} onAttendanceRowsChange={setAttendanceRows} attendanceFileName={attendanceFileName} onAttendanceFileNameChange={setAttendanceFileName} attendanceIsDemo={attendanceIsDemo} onAttendanceIsDemoChange={setAttendanceIsDemo} attendanceWarnings={attendanceWarnings} onAttendanceWarningsChange={setAttendanceWarnings} attendanceSheetCounts={attendanceSheetCounts} onAttendanceSheetCountsChange={setAttendanceSheetCounts} attendanceImportError={attendanceImportError} onAttendanceImportErrorChange={setAttendanceImportError} />}
      </div>
    </main>
  );
}
