// ============================================================
// 領域：專案（Project）
// 比喻：每個專案就像一張「履歷表」。
//   - GitHub 上抓到的資料 = 履歷上的「客觀紀錄」（名稱、星星、README、Release）
//   - 你手動填的資料（ProjectNote）= 你在履歷旁邊貼的「便利貼」
//   - 真正顯示時，便利貼優先，沒有便利貼才用自動偵測的結果
// ============================================================
import { extractLinks } from './LinkExtractor.js';

/** 版本發佈（Release）值物件 */
export class Release {
  constructor({ tagName, name, htmlUrl, publishedAt, assets = [] }) {
    this.tagName = tagName;
    this.name = name || tagName;
    this.htmlUrl = htmlUrl;
    this.publishedAt = publishedAt;
    /** @type {{name:string,url:string,size:number,downloadCount:number}[]} */
    this.assets = assets;
  }

  /** 從 GitHub API 的 release JSON 建立 */
  static fromApi(json) {
    return new Release({
      tagName: json.tag_name,
      name: json.name,
      htmlUrl: json.html_url,
      publishedAt: json.published_at,
      assets: (json.assets || []).map((a) => ({
        name: a.name,
        url: a.browser_download_url,
        size: a.size,
        downloadCount: a.download_count,
      })),
    });
  }
}

/** 手動補充資料（便利貼） */
export class ProjectNote {
  constructor(data = {}) {
    this.appleUrl = data.appleUrl || '';
    this.appleNote = data.appleNote || '';
    this.playUrl = data.playUrl || '';
    this.playNote = data.playNote || '';
    this.videoUrl = data.videoUrl || '';
    this.downloadUrl = data.downloadUrl || '';
    this.memo = data.memo || '';
  }
  isEmpty() {
    return Object.values(this).every((v) => !v);
  }
}

/** 專案實體 */
export class Project {
  constructor(data) {
    this.name = data.name;
    this.fullName = data.fullName;
    this.url = data.url;
    this.description = data.description || '';
    this.stars = data.stars || 0;
    this.forks = data.forks || 0;
    this.language = data.language || '';
    this.topics = data.topics || [];
    this.homepage = data.homepage || '';
    this.defaultBranch = data.defaultBranch || 'main';
    this.pushedAt = data.pushedAt;
    this.isFork = !!data.isFork;
    this.isPrivate = !!data.isPrivate;
    this.archived = !!data.archived;
    /** README 原始 Markdown；null = 尚未抓取，'' = 沒有 README */
    this.readme = data.readme ?? null;
    /** 最新 Release；null = 沒有；undefined = 尚未查詢 */
    this.release = data.release === undefined ? undefined : data.release && new Release(data.release);
    /** @type {ProjectNote} */
    this.note = new ProjectNote(data.note);
  }

  /** 從 GitHub API 的 repo JSON 建立 */
  static fromApi(json) {
    return new Project({
      name: json.name,
      fullName: json.full_name,
      url: json.html_url,
      description: json.description,
      stars: json.stargazers_count,
      forks: json.forks_count,
      language: json.language,
      topics: json.topics,
      homepage: json.homepage,
      defaultBranch: json.default_branch,
      pushedAt: json.pushed_at,
      isFork: json.fork,
      isPrivate: json.private,
      archived: json.archived,
    });
  }

  /** 自動偵測到的連結（每次依目前 README 重新計算） */
  get detected() {
    if (!this._detectedCache || this._detectedFrom !== this.readme) {
      this._detectedFrom = this.readme;
      this._detectedCache = extractLinks(this.readme, this.description, this.homepage);
    }
    return this._detectedCache;
  }

  // ---- 以下為「最終顯示值」：便利貼優先，其次自動偵測 ----

  get appleUrl() {
    return this.note.appleUrl || this.detected.apple[0] || '';
  }
  get playUrl() {
    return this.note.playUrl || this.detected.play[0] || '';
  }
  get videoUrl() {
    return this.note.videoUrl || this.detected.video[0] || '';
  }
  /** 下載網址：手動 > 最新 Release 頁 > README 偵測 */
  get downloadUrl() {
    return this.note.downloadUrl || this.release?.htmlUrl || this.detected.download[0] || '';
  }
  get releasesPageUrl() {
    return `${this.url}/releases`;
  }
  /** 是否為 GitHub Pages 等線上網址 */
  get liveUrl() {
    return /^https?:\/\//.test(this.homepage) ? this.homepage : '';
  }

  /** 把 GitHub 新資料合併進來，但保留便利貼與先前查過的 Release */
  mergeFresh(fresh) {
    const keepRelease = this.release;
    const keepNote = this.note;
    Object.assign(this, fresh);
    this.note = keepNote;
    if (fresh.release === undefined) this.release = keepRelease;
    this._detectedCache = null;
    return this;
  }

  /** 轉成可存進 localStorage 的純資料 */
  toJSON() {
    const { _detectedCache, _detectedFrom, ...rest } = this;
    return rest;
  }
}
