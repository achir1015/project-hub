// ============================================================
// 應用服務：專案彙整中心（ProjectHub）
// 比喻：像一位「總編輯」。
//   - 叫跑腿小弟（GithubGateway）去 GitHub 拿最新資料
//   - 把資料整理成履歷表（Project），貼回你的便利貼（ProjectNote）
//   - 管理文件夾目錄（CategoryBook）
//   - 每次有變動就收進抽屜（LocalStore），並通知畫面更新
// ============================================================
import { Project, ProjectNote, Release } from '../domain/Project.js';
import { CategoryBook } from '../domain/CategoryBook.js';
import { GithubGateway, RateLimitError } from '../infra/GithubGateway.js';
import { LocalStore } from '../infra/LocalStore.js';

/** GitHub 帳號格式：英數字與「-」，最多 39 字 */
const LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/**
 * 把使用者輸入整理成 GitHub 帳號
 * 例如「achir1015@gmail.com」→「achir1015」、「https://github.com/achir1015」→「achir1015」
 */
export function normalizeOwner(input) {
  let v = String(input || '').trim();
  v = v.replace(/^https?:\/\/github\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
  if (v.includes('@')) v = v.split('@')[0];
  return LOGIN_PATTERN.test(v) ? v : '';
}

/** 同時跑幾個請求 */
const CONCURRENCY = 6;

/** 簡易平行處理：最多同時 n 個 */
async function runPool(items, n, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

export class ProjectHub extends EventTarget {
  constructor() {
    super();
    this.settings = LocalStore.loadSettings();
    // 舊設定若存了 email 或錯誤格式，自動修正成正確帳號
    this.settings.owner = normalizeOwner(this.settings.owner) || 'achir1015';
    /** 目前顯示的資料是否來自內建快照（無法連線 GitHub 時的備援） */
    this.fromSnapshot = false;
    this.book = new CategoryBook(LocalStore.loadCategories());
    this.notes = LocalStore.loadNotes(); // 專案名稱 → ProjectNote 純資料
    /** @type {Map<string, Project>} */
    this.projects = new Map();
    this.lastAggregatedAt = null;
    this.busy = false;
    this.gateway = new GithubGateway({ token: this.settings.token });
    this._restoreSnapshot();
  }

  // ================= 查詢 =================

  /** 依條件列出專案 */
  list({ tab = 'all', keyword = '', sort = 'pushed', filters = [] } = {}) {
    let arr = [...this.projects.values()];
    if (!this.settings.includeForks) arr = arr.filter((p) => !p.isFork);

    if (tab === 'uncategorized') arr = arr.filter((p) => this.book.isUncategorized(p.name));
    else if (tab !== 'all') arr = arr.filter((p) => this.book.isIn(p.name, tab));

    const kw = keyword.trim().toLowerCase();
    if (kw) {
      arr = arr.filter((p) =>
        [p.name, p.description, p.language, ...p.topics, p.note.memo].join(' ').toLowerCase().includes(kw),
      );
    }

    const has = {
      apple: (p) => !!p.appleUrl,
      play: (p) => !!p.playUrl,
      video: (p) => !!p.videoUrl,
      download: (p) => !!p.downloadUrl,
      live: (p) => !!p.liveUrl,
    };
    for (const f of filters) arr = arr.filter(has[f]);

    const sorters = {
      pushed: (a, b) => (b.pushedAt || '').localeCompare(a.pushedAt || ''),
      stars: (a, b) => b.stars - a.stars || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return arr.sort(sorters[sort] || sorters.pushed);
  }

  /** 每個頁簽的專案數 */
  tabCounts() {
    const visible = this.list();
    const counts = { all: visible.length, uncategorized: 0 };
    for (const c of this.book.categories) counts[c.id] = 0;
    for (const p of visible) {
      const cats = this.book.categoriesOf(p.name);
      if (!cats.length) counts.uncategorized++;
      for (const c of cats) counts[c.id]++;
    }
    return counts;
  }

  get(name) {
    return this.projects.get(name);
  }

  // ================= 彙整 GitHub =================

  /**
   * 按下「彙整 GitHub」時執行
   * 步驟：① 抓儲存庫清單 ② 抓每個 README ③ 在次數允許下抓 Release
   */
  async aggregate() {
    if (this.busy) return;
    this.busy = true;
    const progress = (text, done = 0, total = 0) => this._emit('progress', { text, done, total });
    try {
      this.gateway = new GithubGateway({ token: this.settings.token });
      progress('① 讀取儲存庫清單…');
      let repos;
      try {
        repos = await this.gateway.listRepos(this.settings.owner);
      } catch (e) {
        // 連不上 GitHub（例如在不允許外連的預覽環境）→ 改用內建快照
        if (e instanceof TypeError && (await this._loadBundledSnapshot())) return;
        throw e;
      }
      this.fromSnapshot = false;

      // 合併：已存在的更新、新出現的加入、GitHub 上已刪除的移除
      const fresh = new Map();
      for (const json of repos) {
        const incoming = Project.fromApi(json);
        const old = this.projects.get(incoming.name);
        const p = old ? old.mergeFresh({ ...incoming, release: undefined, note: undefined }) : incoming;
        p.note = new ProjectNote(this.notes[p.name]);
        fresh.set(p.name, p);
      }
      this.projects = fresh;
      this._emit('changed');

      // ② README（不佔 API 次數）
      const list = [...fresh.values()];
      let done = 0;
      await runPool(list, CONCURRENCY, async (p) => {
        p.readme = await this.gateway.readme(p.fullName, p.defaultBranch, p.isPrivate);
        p._detectedCache = null;
        progress('② 讀取 README…', ++done, list.length);
      });
      this._emit('changed');

      // ③ Release（佔 API 次數；最近更新的優先）
      done = 0;
      const byRecent = [...list].sort((a, b) => (b.pushedAt || '').localeCompare(a.pushedAt || ''));
      await runPool(byRecent, CONCURRENCY, async (p) => {
        if (!this.gateway.canSpend(2)) return; // 次數快用完：保留上次的結果
        try {
          const r = await this.gateway.latestRelease(p.fullName);
          p.release = r ? Release.fromApi(r) : null;
        } catch (e) {
          if (!(e instanceof RateLimitError)) console.warn(p.name, e);
        }
        progress('③ 讀取下載版本（Release）…', ++done, byRecent.length);
      });

      // 從來沒查過 Release 的專案數（之前查過的會沿用上次結果）
      const skipped = list.filter((p) => p.release === undefined).length;
      this.lastAggregatedAt = new Date().toISOString();
      this._saveSnapshot();
      this._emit('changed');
      const rate = this.gateway.remaining !== null ? `（API 剩餘 ${this.gateway.remaining}/${this.gateway.limit}）` : '';
      const msg = skipped
        ? `彙整完成：${list.length} 個專案。有 ${skipped} 個專案的 Release 因 API 次數不足還沒查到，可稍後再按一次或在「設定」填入 Token。${rate}`
        : `彙整完成：${list.length} 個專案。${rate}`;
      this._emit('done', { message: msg, warn: skipped > 0 });
    } catch (e) {
      this._emit('done', { message: '彙整失敗：' + e.message, error: true });
    } finally {
      this.busy = false;
      this._emit('progress', { text: '', done: 0, total: 0 });
    }
  }

  /** 單獨重新查詢某一個專案的 Release */
  async refreshRelease(name) {
    const p = this.get(name);
    if (!p) return;
    try {
      const r = await this.gateway.latestRelease(p.fullName);
      p.release = r ? Release.fromApi(r) : null;
      this._saveSnapshot();
      this._emit('changed');
    } catch (e) {
      this._emit('done', { message: e.message, error: true });
    }
  }

  // ================= 分類操作 =================

  addCategory(name) {
    const c = this.book.add(name);
    this._saveBook();
    return c;
  }
  renameCategory(id, name) {
    this.book.rename(id, name);
    this._saveBook();
  }
  recolorCategory(id, color) {
    this.book.recolor(id, color);
    this._saveBook();
  }
  removeCategory(id) {
    this.book.remove(id);
    this._saveBook();
  }
  moveCategory(id, delta) {
    this.book.move(id, delta);
    this._saveBook();
  }
  toggleCategory(repoName, catId) {
    this.book.toggle(repoName, catId);
    this._saveBook();
  }

  // ================= 便利貼（手動補充） =================

  updateNote(name, patch) {
    const p = this.get(name);
    const note = new ProjectNote({ ...(this.notes[name] || {}), ...patch });
    if (note.isEmpty()) delete this.notes[name];
    else this.notes[name] = { ...note };
    if (p) p.note = note;
    LocalStore.saveNotes(this.notes);
    this._emit('changed');
  }

  // ================= 設定 / 匯出匯入 =================

  updateSettings(patch) {
    if ('owner' in patch) {
      const owner = normalizeOwner(patch.owner);
      if (!owner) throw new Error('GitHub 帳號格式不正確，請填帳號名稱（例如 achir1015），不是 email');
      patch = { ...patch, owner };
    }
    this.settings = { ...this.settings, ...patch };
    LocalStore.saveSettings(this.settings);
    this.gateway = new GithubGateway({ token: this.settings.token });
    this._emit('changed');
  }

  exportBackup() {
    return LocalStore.exportBackup(this.book.toJSON(), this.notes);
  }

  importBackup(data) {
    if (!data || data.app !== 'Achir1015專案彙整') throw new Error('這不是本網站匯出的備份檔');
    this.book = new CategoryBook(data.categories);
    this.notes = data.notes || {};
    for (const p of this.projects.values()) p.note = new ProjectNote(this.notes[p.name]);
    this._saveBook();
    LocalStore.saveNotes(this.notes);
  }

  // ================= 內部 =================

  /** 載入網站內建的快照 data/snapshot.json（只在連不上 GitHub 時使用） */
  async _loadBundledSnapshot() {
    try {
      // 單檔版：快照直接內嵌在 HTML 裡；網站版：讀 data/snapshot.json
      const embedded = document.getElementById('bundled-snapshot');
      let snap;
      if (embedded) {
        snap = JSON.parse(embedded.textContent);
      } else {
        const res = await fetch('data/snapshot.json', { cache: 'no-store' });
        if (!res.ok) return false;
        snap = await res.json();
      }
      if (snap.owner?.toLowerCase() !== this.settings.owner.toLowerCase()) return false;
      const fresh = new Map();
      for (const data of snap.projects) {
        const old = this.projects.get(data.name);
        const p = new Project({ ...data, release: old?.release, note: this.notes[data.name] });
        fresh.set(p.name, p);
      }
      this.projects = fresh;
      this.lastAggregatedAt = snap.at;
      this.fromSnapshot = true;
      this._emit('changed');
      const t = new Date(snap.at).toLocaleString('zh-TW', { hour12: false });
      this._emit('done', {
        message: `目前無法連線到 GitHub，改顯示內建快照（${t}，共 ${fresh.size} 個專案，不含 Release）。能連上 GitHub 時再按一次「彙整 GitHub」，就會即時抓最新資料。`,
        warn: true,
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  _saveBook() {
    LocalStore.saveCategories(this.book.toJSON());
    this._emit('changed');
  }

  _saveSnapshot() {
    LocalStore.saveSnapshot({
      at: this.lastAggregatedAt,
      projects: [...this.projects.values()].map((p) => p.toJSON()),
    });
  }

  _restoreSnapshot() {
    const snap = LocalStore.loadSnapshot();
    if (!snap) return;
    this.lastAggregatedAt = snap.at;
    for (const data of snap.projects || []) {
      const p = new Project({ ...data, note: this.notes[data.name] });
      this.projects.set(p.name, p);
    }
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
