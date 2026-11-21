// ============================================================
// 進入點：把「總編輯（ProjectHub）」和「畫面（Views）」接起來
// 比喻：main.js 是「櫃台」，接收使用者的點擊，
//       轉交給總編輯處理，再請畫面重新整理。
// ============================================================
import { ProjectHub } from './app/ProjectHub.js';
import { LocalStore } from './infra/LocalStore.js';
import { renderTabs, renderGrid, renderDetail, renderCategoryList } from './ui/Views.js';
import { $, $$, fmtDateTime } from './ui/dom.js';

const hub = new ProjectHub();

// ---------- 畫面狀態（目前選了哪個頁簽、哪個專案…） ----------
const saved = LocalStore.loadUi();
const state = {
  tab: saved.tab || 'all',
  selected: saved.selected || null,
  detailTab: saved.detailTab || 'overview',
  keyword: '',
  sort: saved.sort || 'pushed',
  filters: saved.filters || [],
  visited: saved.visited || [], // 看過的專案（卡片會有淡淡的標記）
};
// 手機上詳細面板是全螢幕，重新開啟網頁時先回到列表
if (window.matchMedia('(max-width: 900px)').matches) state.selected = null;
// 頁簽對應的分類被刪除時，回到「全部」
if (!['all', 'uncategorized'].includes(state.tab) && !hub.book.categories.some((c) => c.id === state.tab)) state.tab = 'all';

function persistUi() {
  const { keyword, ...rest } = state;
  LocalStore.saveUi(rest);
}

// ---------- 繪製 ----------
function render() {
  $('#tabs').innerHTML = renderTabs(hub, state);
  $('#grid').innerHTML = renderGrid(hub, state);
  renderDetailOnly();
  $('#lastUpdated').textContent = hub.lastAggregatedAt
    ? `${hub.fromSnapshot ? '📦 內建快照' : '上次彙整'}：${fmtDateTime(hub.lastAggregatedAt)}`
    : '尚未彙整';
  $('#sort').value = state.sort;
  $$('#filters .chip').forEach((b) => {
    const on = state.filters.includes(b.dataset.filter);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
  });
  if ($('#dlgCategories').open) $('#catList').innerHTML = renderCategoryList(hub);
}

function renderDetailOnly() {
  const d = $('#detail');
  // 保留詳細面板的捲動位置與輸入焦點，避免打字時跳掉
  const active = document.activeElement;
  const focusKey = active && d.contains(active) ? active.dataset.note : null;
  const scroll = d.scrollTop;
  d.innerHTML = renderDetail(hub, state);
  d.classList.toggle('open', !!state.selected);
  d.scrollTop = scroll;
  if (focusKey) d.querySelector(`[data-note="${focusKey}"]`)?.focus();
}

function toast(message, kind = '') {
  const t = $('#toast');
  t.textContent = message;
  t.className = `toast ${kind}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.add('hidden'), kind === 'error' ? 10000 : 6000);
}

// ---------- 總編輯的通知 ----------
hub.addEventListener('changed', render);
hub.addEventListener('progress', (e) => {
  const { text, done, total } = e.detail;
  $('#progress').classList.toggle('hidden', !text);
  $('#progressText').textContent = total ? `${text} ${done}/${total}` : text;
  $('#progressFill').style.width = total ? `${(done / total) * 100}%` : '15%';
  $('#btnAggregate').disabled = !!text;
});
hub.addEventListener('done', (e) => {
  const { message, error, warn } = e.detail;
  toast(message, error ? 'error' : warn ? 'warn' : 'ok');
});

// ---------- 使用者操作 ----------
$('#btnAggregate').addEventListener('click', () => hub.aggregate());

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT') return;
  const { action, id, name } = el.dataset;

  switch (action) {
    case 'tab':
      state.tab = id;
      break;
    case 'select':
      // 點卡片裡的連結時，不切換選取
      if (e.target.closest('a')) return;
      state.selected = name;
      if (!state.visited.includes(name)) state.visited.push(name);
      break;
    case 'close-detail':
      state.selected = null;
      break;
    case 'detail-tab':
      state.detailTab = id;
      break;
    case 'toggle-cat':
      hub.toggleCategory(state.selected, id);
      break;
    case 'open-categories':
      openCategories(!!el.closest('#detail'));
      return;
    case 'refresh-release':
      hub.refreshRelease(state.selected);
      return;
    case 'cat-up':
    case 'cat-down':
      hub.moveCategory(el.closest('li').dataset.id, action === 'cat-up' ? -1 : 1);
      return;
    case 'cat-delete': {
      const li = el.closest('li');
      const name = li.querySelector('.cat-name').value;
      if (confirm(`確定刪除分類「${name}」？\n（專案不會被刪除，只會移出這個分類）`)) {
        hub.removeCategory(li.dataset.id);
        if (state.tab === li.dataset.id) state.tab = 'all';
      }
      break;
    }
    default:
      return;
  }
  persistUi();
  render();
});

// 鍵盤：在卡片上按 Enter 等同點選
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('.card')) e.target.click();
  if (e.key === 'Escape' && state.selected && !document.querySelector('dialog[open]')) {
    state.selected = null;
    persistUi();
    render();
  }
});

// 手動補充欄位：停止輸入 0.5 秒後自動儲存
let noteTimer;
$('#detail').addEventListener('input', (e) => {
  const key = e.target.dataset.note;
  if (!key || !state.selected) return;
  const name = state.selected;
  const value = e.target.value.trim();
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => hub.updateNote(name, { [key]: value }), 500);
});

// 搜尋 / 排序 / 篩選
$('#search').addEventListener('input', (e) => {
  state.keyword = e.target.value;
  $('#grid').innerHTML = renderGrid(hub, state);
});
$('#sort').addEventListener('change', (e) => {
  state.sort = e.target.value;
  persistUi();
  render();
});
$('#filters').addEventListener('click', (e) => {
  const f = e.target.closest('[data-filter]')?.dataset.filter;
  if (!f) return;
  state.filters = state.filters.includes(f) ? state.filters.filter((x) => x !== f) : [...state.filters, f];
  persistUi();
  render();
});

// ---------- 分類管理視窗 ----------
function openCategories(fromDetail = false) {
  // 從詳細面板打開時，新增的分類會直接套用到目前的專案
  $('#dlgCategories').dataset.fromDetail = fromDetail === true ? '1' : '0';
  $('#catList').innerHTML = renderCategoryList(hub);
  $('#dlgCategories').showModal();
  $('#newCatName').focus();
}
$('#btnCategories').addEventListener('click', openCategories);

function addCategory() {
  try {
    const c = hub.addCategory($('#newCatName').value);
    $('#newCatName').value = '';
    // 若正在看某個專案，新增的分類直接套用到它，省一步
    if (state.selected && $('#dlgCategories').dataset.fromDetail === '1') hub.toggleCategory(state.selected, c.id);
    toast(`已新增分類「${c.name}」`, 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
}
$('#btnAddCat').addEventListener('click', addCategory);
$('#newCatName').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addCategory();
  }
});
$('#catList').addEventListener('change', (e) => {
  const id = e.target.closest('li')?.dataset.id;
  if (!id) return;
  try {
    if (e.target.dataset.action === 'cat-rename') hub.renameCategory(id, e.target.value);
    if (e.target.dataset.action === 'cat-color') hub.recolorCategory(id, e.target.value);
  } catch (err) {
    toast(err.message, 'error');
    render();
  }
});

// ---------- 設定視窗 ----------
$('#btnSettings').addEventListener('click', () => {
  $('#setOwner').value = hub.settings.owner;
  $('#setToken').value = hub.settings.token;
  $('#setForks').checked = hub.settings.includeForks;
  $('#dlgSettings').showModal();
});
$('#dlgSettings').addEventListener('close', () => {
  if ($('#dlgSettings').returnValue !== 'save') return;
  try {
    hub.updateSettings({
      owner: $('#setOwner').value.trim() || 'achir1015',
      token: $('#setToken').value.trim(),
      includeForks: $('#setForks').checked,
    });
    toast(`設定已儲存（帳號：${hub.settings.owner}）`, 'ok');
  } catch (err) {
    toast(err.message, 'error');
  }
});

$('#btnExport').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(hub.exportBackup(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `achir1015專案彙整-備份-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$('#fileImport').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    hub.importBackup(JSON.parse(await file.text()));
    toast('匯入完成', 'ok');
  } catch (err) {
    toast('匯入失敗：' + err.message, 'error');
  }
  e.target.value = '';
});

// ---------- 啟動 ----------
render();
