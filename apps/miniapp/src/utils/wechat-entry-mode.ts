type WechatEntryOptions = {
  scene?: number | string;
  apiCategory?: string;
};

type WechatEntryRuntime = {
  getEnterOptionsSync?: () => WechatEntryOptions;
  getLaunchOptionsSync?: () => WechatEntryOptions;
};

export function isWechatTimelinePreview(options?: WechatEntryOptions | null) {
  return Number(options?.scene) === 1154 || options?.apiCategory === 'browseOnly';
}

export function isCurrentWechatTimelinePreview() {
  const runtime = globalThis as typeof globalThis & { wx?: WechatEntryRuntime };
  const wx = runtime.wx;
  if (!wx) return false;

  try {
    const currentEntry = wx.getEnterOptionsSync?.();
    if (currentEntry) return isWechatTimelinePreview(currentEntry);
    return isWechatTimelinePreview(wx.getLaunchOptionsSync?.());
  } catch {
    return false;
  }
}
