// ============================================================
// 基礎設施：GitHub 閘道（GithubGateway）
// 比喻：像一位「跑腿小弟」，負責去 GitHub 拿資料回來。
//   - GitHub 規定：沒帶通行證（Token）每小時只能跑 60 趟；帶 Token 可跑 5000 趟
//   - 小弟會記住每個網址上次拿到的「版本號（ETag）」，
//     資料沒變時 GitHub 回 304，這趟不算次數，也更快
//   - README 走 raw.githubusercontent.com，不佔 API 次數
// ============================================================

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const ETAG_KEY = 'hub.etagCache.v1';

export class RateLimitError extends Error {}

export class GithubGateway {
  /** @param {{token?:string}} opts */
  constructor({ token = '' } = {}) {
    this.token = token.trim();
    /** 目前剩餘可用次數（從回應標頭得知） */
    this.remaining = null;
    this.limit = null;
    this.resetAt = null;
    this.etags = this._loadEtags();
  }

  get hasToken() {
    return !!this.token;
  }

  // ---------- 對外提供的動作 ----------

  /** 取得使用者的所有儲存庫（自動翻頁） */
  async listRepos(owner) {
    const all = [];
    for (let page = 1; page <= 10; page++) {
      // 有 Token 且是本人 → 用 /user/repos 才看得到私人儲存庫
      const path = this.hasToken
        ? `/user/repos?per_page=100&page=${page}&affiliation=owner&sort=pushed`
        : `/users/${owner}/repos?per_page=100&page=${page}&type=owner&sort=pushed`;
      const list = await this._getJson(path);
      all.push(...list);
      if (list.length < 100) break;
    }
    // /user/repos 在 Token 不屬於 owner 時會拿到別人的，過濾一下
    return all.filter((r) => r.owner?.login?.toLowerCase() === owner.toLowerCase());
  }

  /** 取得最新一筆 Release；沒有則回傳 null */
  async latestRelease(fullName) {
    // 用 ?per_page=1 而不是 /latest：沒有 Release 時回 []（200）而非 404，可被 ETag 快取
    const list = await this._getJson(`/repos/${fullName}/releases?per_page=1`);
    return list.find((r) => !r.draft) || null;
  }

  /** 取得 README 原始文字；找不到回傳 '' */
  async readme(fullName, branch, isPrivate) {
    if (this.hasToken && isPrivate) {
      const res = await this._fetch(`${API}/repos/${fullName}/readme`, {
        Accept: 'application/vnd.github.raw+json',
      });
      return res.ok ? res.text() : '';
    }
    // 公開專案：直接讀原始檔，不佔 API 次數
    for (const file of ['README.md', 'readme.md', 'Readme.md']) {
      try {
        const res = await fetch(`${RAW}/${fullName}/${branch}/${file}`, { cache: 'no-store' });
        if (res.ok) return res.text();
      } catch (_) {
        /* 網路錯誤就試下一個檔名 */
      }
    }
    return '';
  }

  /** 還能不能再打 API（保留 reserve 次當緩衝） */
  canSpend(reserve = 1) {
    return this.remaining === null || this.remaining > reserve;
  }

  // ---------- 內部工具 ----------

  async _getJson(path) {
    const url = API + path;
    const cached = this.etags[url];
    const headers = { Accept: 'application/vnd.github+json' };
    if (cached?.etag) headers['If-None-Match'] = cached.etag;

    const res = await this._fetch(url, headers);
    if (res.status === 304 && cached) return cached.data; // 沒變，直接用上次的
    if (res.status === 403 || res.status === 429) {
      if (this.remaining === 0) throw new RateLimitError(this._rateMessage());
    }
    if (!res.ok) throw new Error(`GitHub 回應 ${res.status}：${path}`);

    const data = await res.json();
    const etag = res.headers.get('ETag');
    if (etag) {
      this.etags[url] = { etag, data: this._slim(data) };
      this._saveEtags();
    }
    return data;
  }

  async _fetch(url, headers = {}) {
    if (this.hasToken) headers.Authorization = `Bearer ${this.token}`;
    const res = await fetch(url, { headers, cache: 'no-store' });
    const rem = res.headers.get('X-RateLimit-Remaining');
    if (rem !== null) {
      this.remaining = Number(rem);
      this.limit = Number(res.headers.get('X-RateLimit-Limit'));
      this.resetAt = new Date(Number(res.headers.get('X-RateLimit-Reset')) * 1000);
    }
    return res;
  }

  _rateMessage() {
    const t = this.resetAt ? this.resetAt.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) : '稍後';
    return `GitHub API 次數已用完，${t} 後恢復。可到「設定」填入 Token 提高到每小時 5000 次。`;
  }

  /** 只留下需要的欄位，避免 localStorage 爆量 */
  _slim(data) {
    const pickRepo = (r) => ({
      name: r.name, full_name: r.full_name, html_url: r.html_url, description: r.description,
      stargazers_count: r.stargazers_count, forks_count: r.forks_count, language: r.language,
      topics: r.topics, homepage: r.homepage, default_branch: r.default_branch, pushed_at: r.pushed_at,
      fork: r.fork, private: r.private, archived: r.archived, owner: { login: r.owner?.login },
    });
    const pickRelease = (r) => ({
      tag_name: r.tag_name, name: r.name, html_url: r.html_url, published_at: r.published_at, draft: r.draft,
      assets: (r.assets || []).map((a) => ({
        name: a.name, browser_download_url: a.browser_download_url, size: a.size, download_count: a.download_count,
      })),
    });
    if (!Array.isArray(data)) return data;
    return data.map((x) => ('stargazers_count' in x ? pickRepo(x) : 'tag_name' in x ? pickRelease(x) : x));
  }

  _loadEtags() {
    try {
      return JSON.parse(localStorage.getItem(ETAG_KEY)) || {};
    } catch (_) {
      return {};
    }
  }
  _saveEtags() {
    try {
      localStorage.setItem(ETAG_KEY, JSON.stringify(this.etags));
    } catch (_) {
      /* 空間不足就算了，下次重新抓 */
    }
  }
}
