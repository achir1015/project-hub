// ============================================================
// 領域：連結偵測器（LinkExtractor）
// 比喻：像一位「圖書館員」，翻遍 README 與說明文字，
//       把看到的網址依「種類」分別放進不同的抽屜。
// ============================================================

/** 連結種類（值物件的分類標籤） */
export const LinkKind = Object.freeze({
  APPLE: 'apple',       // App Store / TestFlight
  PLAY: 'play',         // Google Play 商店
  VIDEO: 'video',       // YouTube / Vimeo / 影片檔
  DOWNLOAD: 'download', // 下載檔案或 Release 下載網址
});

// 各抽屜的判斷規則
const RULES = [
  { kind: LinkKind.APPLE, test: /(apps|itunes|testflight)\.apple\.com\//i },
  { kind: LinkKind.PLAY, test: /play\.google\.com\/store\/apps/i },
  {
    kind: LinkKind.VIDEO,
    test: /(youtube\.com\/(watch|shorts|embed|live|playlist|@)|youtu\.be\/|vimeo\.com\/\d|\.(mp4|webm|mov|m4v)(\?|#|$))/i,
  },
  {
    kind: LinkKind.DOWNLOAD,
    test: /(\/releases\/(download|latest|tag)\b|\.(apk|aab|ipa|exe|msi|dmg|pkg|zip|7z|rar|deb|AppImage)(\?|#|$))/i,
  },
];

// 單獨一行的 GitHub 附件網址（拖曳上傳到 README 的影片）
export const GH_ATTACHMENT = /^https:\/\/github\.com\/user-attachments\/assets\/[\w-]+$/;
const GH_VIDEO_LINE = /^[ \t]*(https:\/\/github\.com\/user-attachments\/assets\/[\w-]+)[ \t]*$/gm;

// 擷取文字中所有網址（含 Markdown 連結、HTML 屬性、裸網址）
const URL_PATTERN = /https?:\/\/[^\s<>"'`)\]]+/gi;

/** 清理網址尾端的標點符號 */
function tidy(url) {
  return url.replace(/[.,;:!?。，、）]+$/u, '');
}

/**
 * 從多段文字中偵測各種連結
 * @param {...string} texts
 * @returns {{apple:string[], play:string[], video:string[], download:string[]}}
 */
export function extractLinks(...texts) {
  const result = { apple: [], play: [], video: [], download: [] };
  const seen = new Set();
  for (const text of texts) {
    if (!text) continue;
    // GitHub 的特殊寫法：README 裡「單獨一行」的附件網址，GitHub 會顯示成影片
    for (const m of text.matchAll(GH_VIDEO_LINE)) {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        result.video.push(m[1]);
      }
    }
    for (const raw of text.match(URL_PATTERN) || []) {
      const url = tidy(raw);
      if (seen.has(url)) continue;
      seen.add(url);
      const rule = RULES.find((r) => r.test.test(url));
      if (rule) result[rule.kind].push(url);
    }
  }
  return result;
}

/** 取得 YouTube 影片 ID（用來嵌入播放器）；不是 YouTube 就回傳 null */
export function youtubeId(url) {
  if (!url) return null;
  const m =
    url.match(/youtu\.be\/([\w-]{11})/) ||
    url.match(/[?&]v=([\w-]{11})/) ||
    url.match(/youtube\.com\/(?:shorts|embed|live)\/([\w-]{11})/);
  return m ? m[1] : null;
}
