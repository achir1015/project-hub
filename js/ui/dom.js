// ============================================================
// 畫面小工具：建立 HTML 元素、跳脫文字、格式化
// ============================================================

/** 跳脫 HTML，避免專案說明裡的符號破壞畫面 */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** 只允許 http / https 網址，其他一律當作不安全 */
export function safeUrl(u) {
  return /^https?:\/\//i.test(u || '') ? u : '';
}

/** 產生可點選、另開分頁的連結 */
export function link(url, text, cls = '') {
  const u = safeUrl(url);
  if (!u) return '';
  return `<a class="${cls}" href="${esc(u)}" target="_blank" rel="noopener">${esc(text ?? u)}</a>`;
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('zh-TW', { hour12: false });
}

export function fmtSize(bytes) {
  if (!bytes) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < u.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(i ? 1 : 0)} ${u[i]}`;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
