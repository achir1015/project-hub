// ============================================================
// 基礎設施：本機儲存（LocalStore）
// 比喻：瀏覽器裡的「抽屜」。分類、便利貼、上次彙整結果都放這裡。
//   注意：抽屜只在「這台電腦的這個瀏覽器」裡，
//   換電腦請用「匯出 / 匯入」把設定搬過去。
// ============================================================

const KEYS = {
  categories: 'hub.categories.v1', // 分類簿
  notes: 'hub.notes.v1',           // 每個專案的手動補充
  snapshot: 'hub.snapshot.v1',     // 上次彙整的專案資料
  settings: 'hub.settings.v1',     // Token、帳號等設定
  ui: 'hub.ui.v1',                 // 目前選取的頁簽等
};

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch (_) {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (_) {
    return false;
  }
}

export const LocalStore = {
  loadCategories: () => read(KEYS.categories, {}),
  saveCategories: (book) => write(KEYS.categories, book),

  loadNotes: () => read(KEYS.notes, {}),
  saveNotes: (notes) => write(KEYS.notes, notes),

  loadSnapshot: () => read(KEYS.snapshot, null),
  saveSnapshot: (snap) => {
    // README 太多可能塞不下：先試完整版，失敗就不存 README
    if (write(KEYS.snapshot, snap)) return;
    const slim = { ...snap, projects: snap.projects.map((p) => ({ ...p, readme: null })) };
    write(KEYS.snapshot, slim);
  },

  loadSettings: () => read(KEYS.settings, { owner: 'achir1015', token: '', includeForks: true }),
  saveSettings: (s) => write(KEYS.settings, s),

  loadUi: () => read(KEYS.ui, {}),
  saveUi: (ui) => write(KEYS.ui, ui),

  /** 匯出「你親手整理的東西」：分類 + 便利貼 */
  exportBackup(book, notes) {
    return { app: 'Achir1015專案彙整', version: 1, exportedAt: new Date().toISOString(), categories: book, notes };
  },
};
