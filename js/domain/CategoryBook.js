// ============================================================
// 領域：分類簿（CategoryBook）
// 比喻：像一本「文件夾目錄」。
//   - Category = 一個資料夾（有名稱、顏色）
//   - assignments = 每個專案被放進哪些資料夾（一個專案可放多個資料夾）
//   - 刪除資料夾時，裡面的專案不會消失，只是回到「未分類」
// ============================================================

const PALETTE = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#4b5563'];

export class Category {
  constructor({ id, name, color }) {
    this.id = id;
    this.name = name;
    this.color = color;
  }
}

export class CategoryBook {
  constructor(data = {}) {
    /** @type {Category[]} 依頁簽順序排列 */
    this.categories = (data.categories || []).map((c) => new Category(c));
    /** @type {Record<string,string[]>} 專案名稱 → 分類 id 陣列 */
    this.assignments = data.assignments || {};
  }

  // ---------- 分類的新增 / 修改 / 刪除 / 排序 ----------

  add(name) {
    name = (name || '').trim();
    if (!name) throw new Error('分類名稱不可空白');
    if (this.categories.some((c) => c.name === name)) throw new Error(`已有「${name}」這個分類`);
    const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const color = PALETTE[this.categories.length % PALETTE.length];
    const cat = new Category({ id, name, color });
    this.categories.push(cat);
    return cat;
  }

  rename(id, newName) {
    newName = (newName || '').trim();
    if (!newName) throw new Error('分類名稱不可空白');
    if (this.categories.some((c) => c.name === newName && c.id !== id)) throw new Error(`已有「${newName}」這個分類`);
    this.get(id).name = newName;
  }

  recolor(id, color) {
    this.get(id).color = color;
  }

  remove(id) {
    this.categories = this.categories.filter((c) => c.id !== id);
    // 把所有專案身上的這個分類標籤撕掉
    for (const repo of Object.keys(this.assignments)) {
      this.assignments[repo] = this.assignments[repo].filter((cid) => cid !== id);
      if (!this.assignments[repo].length) delete this.assignments[repo];
    }
  }

  /** 移動分類頁簽位置（delta = -1 往左，+1 往右） */
  move(id, delta) {
    const i = this.categories.findIndex((c) => c.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.categories.length) return;
    [this.categories[i], this.categories[j]] = [this.categories[j], this.categories[i]];
  }

  get(id) {
    const c = this.categories.find((x) => x.id === id);
    if (!c) throw new Error('找不到分類');
    return c;
  }

  // ---------- 專案與分類的對應 ----------

  categoriesOf(repoName) {
    const ids = this.assignments[repoName] || [];
    return this.categories.filter((c) => ids.includes(c.id));
  }

  isIn(repoName, catId) {
    return (this.assignments[repoName] || []).includes(catId);
  }

  /** 切換：在分類裡就拿出來，不在就放進去 */
  toggle(repoName, catId) {
    const ids = new Set(this.assignments[repoName] || []);
    ids.has(catId) ? ids.delete(catId) : ids.add(catId);
    if (ids.size) this.assignments[repoName] = [...ids];
    else delete this.assignments[repoName];
  }

  isUncategorized(repoName) {
    return this.categoriesOf(repoName).length === 0;
  }

  toJSON() {
    return { categories: this.categories, assignments: this.assignments };
  }
}
