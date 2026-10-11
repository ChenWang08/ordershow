"use client";

import { useRef, useState } from "react";
import { validLiveRoomUrl } from "../shared/live-room";

export function H5LiveRoomExit({ url, disabled, prepare }: {
  url?: string | null; disabled: boolean; prepare: () => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const target = validLiveRoomUrl(url);
  if (!target) return null;
  async function leave() {
    if (lock.current || disabled) return;
    lock.current = true; setBusy(true);
    try {
      if (await prepare()) window.location.assign(target!);
    } finally { lock.current = false; setBusy(false); }
  }
  return <>
    {busy && <div className="h5-exit-saving" role="status">正在保存，请稍候…</div>}
    <button type="button" className="h5-live-room-exit" aria-label="退出订货，返回直播间"
      title="返回直播间" disabled={disabled || busy} onClick={() => void leave()}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M10 12h11m-4-4 4 4-4 4" />
      </svg>
      <span>退出</span>
    </button>
  </>;
}
