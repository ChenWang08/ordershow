import { useEffect, useState } from "react";
import { loadDealerCandidates, loadScopeHistory, type DealerCandidate, type DealerScope } from "../../../api";
import type { ProductImportRow } from "../../../domain/import-domain";
import type { DealerCandidateCache } from "../dealer-candidate-cache";

const key = (value: string) => value.trim().toLowerCase().replace(/[\s　_\-（）()\[\]【】{}：:，,。·/\\]+/g, "");
const split = (value: string) => value.split(/[，,、]/).map(item => item.trim()).filter(Boolean);

function describeSnapshot(value: unknown) {
  try {
    const scope = (typeof value === "string" ? JSON.parse(value) : value) as { customerType: string; branchScope: string[]; dealerScope: DealerScope[] };
    const type = scope.customerType === "GENERAL" ? "综合" : scope.customerType === "SPECIAL" ? "特渠" : "不限制";
    return `客户类型：${type}；分公司：${scope.branchScope.join("、") || "全部分公司"}；经销商：${scope.dealerScope.map(item => `${item.branchName || "未填写分公司"}（${item.members.map(member => member.dealerFullName).join("、") || "待处理"}）`).join("；") || "不限制"}`;
  } catch {
    return "记录暂时无法展示";
  }
}

export function ProductScopeEditor({ activityId, form, enabled, onChange, candidateCache }: {
  activityId: number;
  form: ProductImportRow;
  enabled: boolean;
  onChange: (branchScope: string, dealerScope: DealerScope[]) => void;
  candidateCache?: DealerCandidateCache;
}) {
  const [candidates, setCandidates] = useState<DealerCandidate[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [branchQuery, setBranchQuery] = useState("");
  const [query, setQuery] = useState("");
  const [activeBranch, setActiveBranch] = useState("");
  const [history, setHistory] = useState<Awaited<ReturnType<typeof loadScopeHistory>> | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let active = true;
    (candidateCache ? candidateCache.read() : loadDealerCandidates(activityId)).then(rows => {
      if (active) {
        setCandidates(rows);
        setLoaded(true);
      }
    }).catch(reason => {
      if (active) {
        setError(reason instanceof Error ? reason.message : "经销商列表加载失败");
        setLoaded(true);
      }
    });
    return () => { active = false; };
  }, [activityId, enabled, candidateCache]);

  const customerType = form.customerType === "综合" ? "GENERAL" : form.customerType === "特渠" ? "SPECIAL" : "ALL";
  const eligible = candidates.filter(candidate => customerType === "ALL" || candidate.customerType === customerType);
  const selectedBranches = split(form.branchScope);
  const scopes = form.dealerScope ?? [];
  const loading = enabled && !loaded && !error;
  const names = new Map<string, string>();
  [...eligible.map(candidate => candidate.branchName), ...selectedBranches, ...scopes.map(scope => scope.branchName)]
    .filter(Boolean)
    .forEach(branch => names.set(key(branch), branch));
  const branches = [...names.values()].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const visibleBranches = branches.filter(branch => !branchQuery.trim() || key(branch).includes(key(branchQuery)));
  const currentBranch = selectedBranches.find(branch => key(branch) === key(activeBranch)) ?? selectedBranches[0] ?? "";
  const activeScope = scopes.find(scope => key(scope.branchName) === key(currentBranch));
  const activeCandidates = eligible.filter(candidate => key(candidate.branchName) === key(currentBranch));
  const activeIsAll = !activeScope;
  const visibleCandidates = activeCandidates.filter(candidate => {
    const normalized = key(query);
    return !normalized || key(`${candidate.dealerFullName}${candidate.dealerShortName ?? ""}`).includes(normalized);
  });
  const activeSelectedIds = new Set((activeScope?.members ?? []).map(member => member.customerId));
  const invalidMemberCount = (activeScope?.members ?? []).filter(member => !member.active || !activeCandidates.some(candidate => candidate.customerId === member.customerId)).length;

  const updateBranches = (nextBranches: string[]) => {
    const nextScopes = nextBranches.length === 0
      ? []
      : scopes.filter(scope => nextBranches.some(branch => key(branch) === key(scope.branchName)));
    setActiveBranch(nextBranches[0] ?? "");
    setBranchQuery("");
    setQuery("");
    onChange(nextBranches.join("，"), nextScopes);
  };

  const toggleBranch = (branch: string, checked: boolean) => {
    const next = checked
      ? [...selectedBranches, branch]
      : selectedBranches.filter(item => key(item) !== key(branch));
    if (!checked && next.length === 0 && !window.confirm("取消最后一个分公司后将恢复全部分公司，是否继续？")) return;
    updateBranches(next);
  };

  const updateActiveMembers = (members: DealerScope["members"]) => {
    if (!currentBranch) return;
    const rest = scopes.filter(scope => key(scope.branchName) !== key(currentBranch));
    const memberIds = new Set(members.filter(member => member.active).map(member => member.customerId));
    const allCurrentSelected = activeCandidates.length > 0 && activeCandidates.every(candidate => memberIds.has(candidate.customerId));
    onChange(form.branchScope, allCurrentSelected ? rest : [...rest, { branchName: currentBranch, members }]);
  };

  const restoreAllActive = () => onChange(form.branchScope, scopes.filter(scope => key(scope.branchName) !== key(currentBranch)));
  const cancelAllActive = () => updateActiveMembers([]);
  const toggleDealer = (candidate: DealerCandidate, checked: boolean) => {
    const base = activeScope
      ? activeScope.members
      : activeCandidates.map(item => ({ ...item, active: true }));
    const members = base.filter(member => member.customerId !== candidate.customerId);
    if (checked) members.push({ ...candidate, active: true });
    updateActiveMembers(members);
  };

  return <section className="product-scope-editor wide-field">
    <div className="scope-title-row"><b>分公司限制</b><small>{form.customerType || "全部客户类型"}</small></div>
    <p className="scope-help">Excel 的“分公司限制”（兼容“分公司定制品”）会自动勾选；勾选分公司后，在下方维护该分公司的经销商。</p>
    {error && <p className="field-error">{error}</p>}
    <div className="scope-layout">
      <div className="scope-branch-column">
        <div className="scope-branch-toolbar">
          <label className="scope-all-branch"><input type="checkbox" checked={selectedBranches.length === 0} disabled={loading || !!error}
            onChange={event => { if (event.target.checked) updateBranches([]); }} />全部分公司</label>
          <small>{selectedBranches.length ? `已选 ${selectedBranches.length} 个分公司` : "当前为全部分公司"}</small>
        </div>
        {loading && <p className="scope-loading">正在加载分公司…</p>}
        <input className="scope-branch-search" type="search" value={branchQuery} onChange={event => setBranchQuery(event.target.value)} placeholder="搜索分公司" />
        <div className="scope-branch-list">
          {visibleBranches.map(branch => {
            const branchCandidates = eligible.filter(candidate => key(candidate.branchName) === key(branch));
            const branchScope = scopes.find(scope => key(scope.branchName) === key(branch));
            const branchCount = branchScope ? branchScope.members.filter(member => member.active && branchCandidates.some(candidate => candidate.customerId === member.customerId)).length : branchCandidates.length;
            const active = key(currentBranch) === key(branch);
            return <label className={`scope-branch-chip ${active ? "active" : ""}`} key={key(branch)}>
              <input type="checkbox" checked={selectedBranches.some(item => key(item) === key(branch))} disabled={loading || !!error}
                onChange={event => toggleBranch(branch, event.target.checked)} />
              <span onClick={() => { if (selectedBranches.some(item => key(item) === key(branch))) setActiveBranch(branch); }}>
                <b>{branch}</b><small>{branchScope ? `指定 ${branchCount} 家` : `${branchCount} 家`}</small>
              </span>
            </label>;
          })}
          {!visibleBranches.length && !loading && <p className="scope-empty">没有找到匹配的分公司。</p>}
        </div>
      </div>
      <div className="scope-dealer-column">
        <div className="scope-title-row scope-dealer-title"><b>经销商限制</b><small>{selectedBranches.length ? "选择左侧分公司后维护经销商" : "请先选择具体分公司"}</small></div>
        {!enabled ? <p className="scope-empty">请先确认商品和白名单导入，再设置经销商限制。</p> : selectedBranches.length === 0 ? <p className="scope-empty">当前是全部分公司范围；如需限制经销商，请先勾选具体分公司。</p> : <div className="scope-dealer-panel">
      <div className="scope-active-branches" aria-label="已选分公司">
        {selectedBranches.map(branch => <button type="button" className={key(currentBranch) === key(branch) ? "active" : ""} key={key(branch)} onClick={() => { setActiveBranch(branch); setQuery(""); }}>{branch}</button>)}
      </div>
      <div className="scope-dealer-heading"><strong>{currentBranch || "请选择分公司"}</strong><span>{activeScope ? `已指定 ${activeScope.members.length} 家` : `全部 ${activeCandidates.length} 家`}</span></div>
      <input className="scope-dealer-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索当前分公司的经销商" />
      <div className="scope-dealer-actions">
        {activeScope
          ? <button type="button" onClick={restoreAllActive}>恢复全选</button>
          : <button type="button" onClick={cancelAllActive}>取消全选</button>}
      </div>
      {invalidMemberCount > 0 && <p className="field-error">有 {invalidMemberCount} 家已不在当前白名单，请重新选择。</p>}
      {activeScope?.members.length === 0 && <p className="field-error">请至少选择一家经销商，或点击“恢复全选”。</p>}
      <div className="scope-dealer-list">
        {visibleCandidates.map(candidate => <label className="scope-dealer-row" key={candidate.customerId}>
          <input type="checkbox" checked={activeIsAll || activeSelectedIds.has(candidate.customerId)} onChange={event => toggleDealer(candidate, event.target.checked)} />
          <span><b>{candidate.dealerFullName}</b><small>{candidate.dealerShortName || "无简称"}</small></span>
        </label>)}
        {!visibleCandidates.length && <p className="scope-empty">当前分公司没有匹配的经销商。</p>}
      </div>
        </div>}
      </div>
    </div>

    {enabled && form.serverVersion !== undefined && <button type="button" className="scope-history-button" onClick={async () => {
      try { setHistory(await loadScopeHistory(activityId, Number(form.id))); } catch (reason) { setError(reason instanceof Error ? reason.message : "记录加载失败"); }
    }}>查看范围修改记录</button>}
    {history && <div className="scope-history">{history.length === 0 ? <p>暂无范围修改记录</p> : history.map((item, index) => <details key={index}><summary>{item.created_at} · {item.display_name} · {item.reason || "草稿期修改"}</summary><p>修改前：{describeSnapshot(item.before_json)}</p><p>修改后：{describeSnapshot(item.after_json)}</p></details>)}</div>}
  </section>;
}
