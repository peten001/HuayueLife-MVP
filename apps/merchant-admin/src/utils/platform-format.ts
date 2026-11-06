export function platformMoney(value: string | number | bigint | null | undefined) {
  if (value === null || value === undefined || value === '') return '—';
  try { return `${BigInt(value).toLocaleString('en-US')} ₫`; } catch { return '—'; }
}
export function vietnamDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function vietnamTime(value: string | Date) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Ho_Chi_Minh', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}
