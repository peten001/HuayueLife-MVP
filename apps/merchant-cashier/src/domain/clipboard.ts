export async function copyPlainText(value: string) {
  if (!value) return false;
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Continue with the legacy WebView fallback below.
    }
  }
  if (typeof document === 'undefined') return false;
  const input = document.createElement('textarea');
  input.value = value;
  input.readOnly = true;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  let copied = false;
  try {
    copied = Boolean(document.execCommand?.('copy'));
  } catch {
    copied = false;
  }
  input.remove();
  return copied;
}
