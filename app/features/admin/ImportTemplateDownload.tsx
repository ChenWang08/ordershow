const importTemplates = {
  product: { path: "products.xlsx", fileName: "产品信息表.xlsx", label: "下载商品模板" },
  whitelist: { path: "whitelist.xlsx", fileName: "白名单客户信息表.xlsx", label: "下载白名单模板" },
  attendance: { path: "attendance.xlsx", fileName: "现场到场客户信息表.xlsx", label: "下载到场客户模板" },
} as const;

export function ImportTemplateDownload({ kind }: { kind: keyof typeof importTemplates }) {
  const { path, fileName, label } = importTemplates[kind];
  return <a className="secondary-button import-template-download" href={`/import-template-${path}`} download={fileName}>{label}</a>;
}

export function ImportTemplateHint() {
  return <p className="import-template-hint">请先下载模板，删除示例数据后填写实际信息；请勿修改表头，填写完成后上传预览并确认导入。</p>;
}
