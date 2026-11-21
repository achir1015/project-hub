// ============================================================
// 畫面：各區塊的繪製（頁簽、卡片、詳細面板、分類管理）
// 每個函式只負責「把狀態畫出來」，不直接改資料；
// 使用者的操作透過 data-action 屬性交給 main.js 處理。
// ============================================================
import { esc, link, safeUrl, fmtDate, fmtDateTime, fmtSize } from './dom.js';
import { renderReadme } from './Readme.js';
import { youtubeId, GH_ATTACHMENT } from '../domain/LinkExtractor.js';

// ------------------------------------------------------------
// 分類頁簽
// ------------------------------------------------------------
export function renderTabs(hub, state) {
  const counts = hub.tabCounts();
  const tab = (id, label, color = '') => `
    <button role="tab" class="tab ${state.tab === id ? 'active' : ''}" aria-selected="${state.tab === id}"
            data-action="tab" data-id="${esc(id)}" ${color ? `style="--cat:${esc(color)}"` : ''}>
      ${color ? '<i class="dot"></i>' : ''}${esc(label)} <span class="count">${counts[id] ?? 0}</span>
    </button>`;
  return [
    tab('all', '📚 全部'),
    ...hub.book.categories.map((c) => tab(c.id, c.name, c.color)),
    tab('uncategorized', '📥 未分類'),
    `<button class="tab add" data-action="open-categories" title="新增分類">＋ 分類</button>`,
  ].join('');
}

// ------------------------------------------------------------
// 專案卡片列表
// ------------------------------------------------------------
const BADGES = [
  ['apple', '🍎', 'Apple 上架', (p) => p.appleUrl],
  ['play', '▶', 'Play 商店', (p) => p.playUrl],
  ['video', '🎬', '影片', (p) => p.videoUrl],
  ['download', '⬇', '下載版本', (p) => p.downloadUrl],
  ['live', '🌐', '線上版', (p) => p.liveUrl],
];

export function renderGrid(hub, state) {
  const list = hub.list(state);
  if (!hub.projects.size) {
    return `<div class="empty">
      <p>還沒有資料。</p>
      <p>按右上角「🔄 彙整 GitHub」，就會抓取 <b>${esc(hub.settings.owner)}</b> 的所有專案。</p>
    </div>`;
  }
  if (!list.length) return `<div class="empty"><p>這個頁簽目前沒有符合條件的專案。</p></div>`;

  return list
    .map((p) => {
      const cats = hub.book.categoriesOf(p.name);
      const selected = state.selected === p.name;
      const visited = state.visited.includes(p.name);
      return `
      <article class="card ${selected ? 'selected' : ''} ${visited ? 'visited' : ''}" tabindex="0"
               data-action="select" data-name="${esc(p.name)}" aria-selected="${selected}">
        <header>
          <h3>${esc(p.name)}</h3>
          <span class="stars" title="星星數">★ ${p.stars}</span>
        </header>
        <p class="desc">${esc(p.description) || '<span class="muted">（沒有說明）</span>'}</p>
        <div class="badges">
          ${BADGES.map(([k, icon, label, get]) => `<span class="badge ${get(p) ? 'on' : ''}" title="${label}${get(p) ? '' : '：未偵測到'}">${icon}</span>`).join('')}
        </div>
        <footer>
          <span class="cats">${cats.map((c) => `<span class="cat-pill" style="--cat:${esc(c.color)}">${esc(c.name)}</span>`).join('')}</span>
          <span class="meta">${p.language ? esc(p.language) + ' · ' : ''}${fmtDate(p.pushedAt)}${p.isFork ? ' · Fork' : ''}${p.isPrivate ? ' · 🔒' : ''}</span>
        </footer>
      </article>`;
    })
    .join('');
}

// ------------------------------------------------------------
// 詳細面板
// ------------------------------------------------------------
const DETAIL_TABS = [
  ['overview', '總覽'],
  ['readme', 'README'],
  ['download', '下載版本'],
  ['apple', 'Apple'],
  ['play', 'Play 商店'],
  ['video', '影片'],
];

export function renderDetail(hub, state) {
  const p = state.selected && hub.get(state.selected);
  if (!p) return `<div class="detail-empty muted">👈 點選左邊的專案卡片，這裡會顯示詳細內容。</div>`;

  const sub = state.detailTab || 'overview';
  const body = {
    overview: () => overview(hub, p),
    readme: () => `<div class="markdown">${renderReadme(p)}</div>`,
    download: () => downloadPanel(p),
    apple: () => storePanel(p, 'apple'),
    play: () => storePanel(p, 'play'),
    video: () => videoPanel(p),
  }[sub]();

  return `
    <div class="detail-head">
      <button class="close-detail" data-action="close-detail" aria-label="關閉">✕</button>
      <h2>${link(p.url, p.name)}</h2>
      <div class="muted">★ ${p.stars} · ${esc(p.language || '—')} · 最後更新 ${fmtDate(p.pushedAt)}</div>
      <div class="cat-toggle">
        ${hub.book.categories.length
          ? hub.book.categories
              .map((c) => {
                const on = hub.book.isIn(p.name, c.id);
                return `<button class="chip ${on ? 'on' : ''}" style="--cat:${esc(c.color)}" aria-pressed="${on}"
                          data-action="toggle-cat" data-id="${esc(c.id)}">${on ? '✓ ' : ''}${esc(c.name)}</button>`;
              })
              .join('')
          : '<span class="muted small">尚無分類，</span>'}
        <button class="chip ghost" data-action="open-categories">＋ 管理分類</button>
      </div>
    </div>
    <nav class="subtabs" role="tablist">
      ${DETAIL_TABS.map(([k, label]) => `<button role="tab" class="subtab ${sub === k ? 'active' : ''}" aria-selected="${sub === k}" data-action="detail-tab" data-id="${k}">${label}${hasInfo(p, k) ? ' <i class="ok"></i>' : ''}</button>`).join('')}
    </nav>
    <div class="detail-body">${body}</div>`;
}

function hasInfo(p, k) {
  return { overview: false, readme: !!p.readme, download: !!p.downloadUrl, apple: !!p.appleUrl, play: !!p.playUrl, video: !!p.videoUrl }[k];
}

/** 一行「標籤：值」 */
function row(label, valueHtml, tab) {
  return `<div class="kv ${tab ? 'clickable' : ''}" ${tab ? `data-action="detail-tab" data-id="${tab}"` : ''}>
    <span class="k">${label}</span><span class="v">${valueHtml || '<span class="muted">—</span>'}</span></div>`;
}

function overview(hub, p) {
  const src = (manual) => (manual ? '<span class="tag">手動</span>' : '');
  return `
    <p>${esc(p.description) || '<span class="muted">（沒有說明）</span>'}</p>
    ${row('專案名稱', esc(p.name))}
    ${row('專案網址', link(p.url, p.url))}
    ${row('星星數', `★ ${p.stars}　<span class="muted">Fork ${p.forks}</span>`)}
    ${row('線上網址', link(p.liveUrl))}
    ${row('下載版本', p.downloadUrl ? link(p.downloadUrl, p.release ? `${p.release.name}（${fmtDate(p.release.publishedAt)}）` : p.downloadUrl) + src(p.note.downloadUrl) : '', 'download')}
    ${row('Apple 上架', p.appleUrl ? link(p.appleUrl) + src(p.note.appleUrl) : '', 'apple')}
    ${row('Play 上架', p.playUrl ? link(p.playUrl) + src(p.note.playUrl) : '', 'play')}
    ${row('影片', p.videoUrl ? link(p.videoUrl) + src(p.note.videoUrl) : '', 'video')}
    ${p.topics.length ? row('主題標籤', p.topics.map((t) => `<span class="topic">${esc(t)}</span>`).join(' ')) : ''}
    <label class="memo">備註
      <textarea data-note="memo" rows="3" placeholder="自己的備註，只存在本機">${esc(p.note.memo)}</textarea>
    </label>`;
}

function downloadPanel(p) {
  const r = p.release;
  let releaseHtml;
  if (r === undefined) {
    releaseHtml = `<p class="muted">尚未查詢 Release。</p>`;
  } else if (r === null) {
    releaseHtml = `<p class="muted">這個專案在 GitHub 上沒有發佈 Release。</p>`;
  } else {
    releaseHtml = `
      <div class="release">
        <h4>${link(r.htmlUrl, r.name)} <span class="muted small">${esc(r.tagName)} · ${fmtDateTime(r.publishedAt)}</span></h4>
        ${r.assets.length
          ? `<ul class="assets">${r.assets.map((a) => `<li>${link(a.url, '⬇ ' + a.name)} <span class="muted small">${fmtSize(a.size)} · 下載 ${a.downloadCount} 次</span></li>`).join('')}</ul>`
          : '<p class="muted small">這個版本沒有附加檔案。</p>'}
      </div>`;
  }
  return `
    ${row('目前使用', link(p.downloadUrl) || '')}
    <h4>GitHub 最新版本 <button class="btn small" data-action="refresh-release">↻ 重新查詢</button></h4>
    ${releaseHtml}
    <p>${link(p.releasesPageUrl, '查看全部 Releases →')}</p>
    ${detectedList('README 中偵測到的下載連結', p.detected.download)}
    ${noteField('手動指定下載網址', 'downloadUrl', p.note.downloadUrl, '例如 https://…/app.apk（填了會優先使用）')}`;
}

function storePanel(p, kind) {
  const isApple = kind === 'apple';
  const url = isApple ? p.appleUrl : p.playUrl;
  const name = isApple ? 'Apple App Store' : 'Google Play 商店';
  const status = url ? `<span class="status ok">✓ 已上架 / 已有連結</span>` : `<span class="status">尚未偵測到 ${name} 連結</span>`;
  return `
    <p>${status}</p>
    ${row('商店網址', link(url))}
    ${url ? `<p><a class="btn primary" href="${esc(safeUrl(url))}" target="_blank" rel="noopener">開啟 ${name} ↗</a></p>` : ''}
    ${detectedList('README 中偵測到的連結', p.detected[kind])}
    ${noteField(`手動指定 ${name} 網址`, isApple ? 'appleUrl' : 'playUrl', isApple ? p.note.appleUrl : p.note.playUrl,
      isApple ? 'https://apps.apple.com/tw/app/…' : 'https://play.google.com/store/apps/details?id=…')}
    <label class="memo">上架訊息 / 備註
      <textarea data-note="${isApple ? 'appleNote' : 'playNote'}" rows="3" placeholder="例如：審核中、1.2.0 版已上架、2026/11 送審…">${esc(isApple ? p.note.appleNote : p.note.playNote)}</textarea>
    </label>`;
}

function videoPanel(p) {
  const url = p.videoUrl;
  const yt = youtubeId(url);
  let player = '';
  if (yt) {
    player = `<div class="video-wrap"><iframe src="https://www.youtube-nocookie.com/embed/${yt}" title="YouTube" allowfullscreen
      allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe></div>`;
  } else if (/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url || '') || GH_ATTACHMENT.test(url || '')) {
    player = `<video controls preload="metadata" src="${esc(safeUrl(url))}"></video>`;
  }
  return `
    ${row('影片位置', link(url))}
    ${player}
    ${detectedList('README 中偵測到的影片', p.detected.video)}
    ${noteField('手動指定影片 / YouTube 網址', 'videoUrl', p.note.videoUrl, 'https://www.youtube.com/watch?v=…')}`;
}

function detectedList(title, urls) {
  if (!urls.length) return '';
  return `<details class="detected" ${urls.length <= 3 ? 'open' : ''}><summary>${title}（${urls.length}）</summary>
    <ul>${urls.map((u) => `<li>${link(u)}</li>`).join('')}</ul></details>`;
}

function noteField(label, key, value, placeholder) {
  return `<label class="memo">${label}
    <input data-note="${key}" value="${esc(value)}" placeholder="${esc(placeholder)}" />
  </label>`;
}

// ------------------------------------------------------------
// 分類管理清單
// ------------------------------------------------------------
export function renderCategoryList(hub) {
  const counts = hub.tabCounts();
  if (!hub.book.categories.length) return `<li class="muted">還沒有分類，先在上面新增一個吧。</li>`;
  return hub.book.categories
    .map(
      (c, i, arr) => `
    <li data-id="${esc(c.id)}">
      <input type="color" value="${esc(c.color)}" data-action="cat-color" title="顏色" />
      <input class="cat-name" value="${esc(c.name)}" data-action="cat-rename" />
      <span class="muted small">${counts[c.id] ?? 0} 個</span>
      <button type="button" class="btn small" data-action="cat-up" ${i === 0 ? 'disabled' : ''} title="往前">◀</button>
      <button type="button" class="btn small" data-action="cat-down" ${i === arr.length - 1 ? 'disabled' : ''} title="往後">▶</button>
      <button type="button" class="btn small danger" data-action="cat-delete" title="刪除">🗑</button>
    </li>`,
    )
    .join('');
}
