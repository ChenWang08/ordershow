/** A partial batch must reflect confirmed writes even when a later write fails. */
export async function deleteConfirmedRows(ids: string[], remove: (id: string) => Promise<unknown>) {
  const deleted: string[] = [];
  for (const id of [...new Set(ids)]) {
    try { await remove(id); deleted.push(id); }
    catch (error) { return { deleted, error: error instanceof Error ? error.message : "删除失败，请刷新列表核对。" }; }
  }
  return { deleted, error: "" };
}
