// ============================================================
// 畫面：README 轉換器
// 把 Markdown 變成安全的 HTML，並把相對路徑的圖片 / 連結
// 改成 GitHub 上的完整網址（不然圖片會破圖）
// ============================================================

export function renderReadme(project) {
  if (project.readme === null) return '<p class="muted">尚未讀取 README，請按「彙整 GitHub」。</p>';
  if (!project.readme) return '<p class="muted">這個專案沒有 README。</p>';

  // 外部函式庫沒載入時（例如離線），退回純文字顯示
  if (!window.marked || !window.DOMPurify) {
    const pre = document.createElement('pre');
    pre.textContent = project.readme;
    return pre.outerHTML;
  }

  const html = window.DOMPurify.sanitize(window.marked.parse(project.readme, { gfm: true }), {
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['target', 'allow', 'allowfullscreen', 'frameborder'],
  });

  const box = document.createElement('div');
  box.innerHTML = html;

  const rawBase = `https://raw.githubusercontent.com/${project.fullName}/${project.defaultBranch}/`;
  const blobBase = `${project.url}/blob/${project.defaultBranch}/`;
  const isRelative = (u) => u && !/^([a-z]+:|#|\/\/)/i.test(u);

  for (const img of box.querySelectorAll('img')) {
    const src = img.getAttribute('src');
    if (isRelative(src)) img.src = rawBase + src.replace(/^\.?\//, '');
    img.loading = 'lazy';
  }
  for (const a of box.querySelectorAll('a')) {
    const href = a.getAttribute('href');
    if (isRelative(href)) a.href = blobBase + href.replace(/^\.?\//, '');
    if (!href?.startsWith('#')) {
      a.target = '_blank';
      a.rel = 'noopener';
    }
  }
  // 跟 GitHub 一樣：段落裡只有一個附件網址時，顯示成影片播放器
  for (const para of box.querySelectorAll('p')) {
    const a = para.querySelector('a');
    const text = para.textContent.trim();
    if (a && para.children.length === 1 && text === a.href && /github\.com\/user-attachments\/assets\//.test(a.href)) {
      const v = document.createElement('video');
      v.controls = true;
      v.preload = 'metadata';
      v.src = a.href;
      para.replaceWith(v);
    }
  }
  // 只保留 YouTube 的 iframe，其它的移除
  for (const f of box.querySelectorAll('iframe')) {
    if (!/^https:\/\/(www\.)?youtube(-nocookie)?\.com\/embed\//.test(f.src)) f.remove();
  }
  return box.innerHTML;
}
