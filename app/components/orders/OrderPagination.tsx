"use client";

export function OrderPagination({ page, totalPages, total, loading, onPage }: {
  page: number; totalPages: number; total: number; loading: boolean; onPage: (page: number) => void;
}) {
  const pages = Math.max(1, totalPages, page);
  return <div className="order-pagination">
    <span>共 {total} 条 · 第 {page} / {Math.max(1, totalPages)} 页 · 每页 50 条</span>
    <div>
      <button disabled={page <= 1 || loading} onClick={() => onPage(page - 1)}>上一页</button>
      <select aria-label="选择页码" value={page} disabled={loading} onChange={event => onPage(Number(event.target.value))}>
        {Array.from({ length: pages }, (_, index) => <option key={index + 1} value={index + 1}>第 {index + 1} 页</option>)}
      </select>
      <button disabled={page >= totalPages || loading} onClick={() => onPage(page + 1)}>下一页</button>
    </div>
  </div>;
}
