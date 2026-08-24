/**
 * 保存先のフォルダ名・ファイル名を組み立てるユーティリティ。
 *
 * macOS / Windows のどちらに持ち出しても壊れないことを優先し、
 * 使える文字を保守的に絞っている。
 */

// パス区切りや Windows で使えない文字を落とす。
const INVALID_CHARS = /[\\/:*?"<>|]/g;

// 制御文字はファイル名に残さない。
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

// Windows の予約デバイス名。フォルダ名にすると保存できない。
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

const EXTENSION_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
};

const KNOWN_EXTENSIONS = new Set(Object.values(EXTENSION_BY_MIME));

/**
 * 任意の文字列を、1 階層分のフォルダ名／ファイル名として安全な形に整える。
 *
 * @param {string} name    元の文字列。
 * @param {object} options maxLength: 最大文字数 / fallback: 空になったときの代替名。
 * @return {string} 整えた名前。
 */
export function sanitizeSegment(name, options = {}) {
  const { maxLength = 80, fallback = 'note-article' } = options;

  let result = String(name ?? '')
    .replace(CONTROL_CHARS, ' ')
    .replace(INVALID_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (result.length > maxLength) {
    result = result.slice(0, maxLength).trim();
  }

  // 先頭・末尾のドットは隠しファイル化や拡張子の誤認を招くので落とす。
  result = result.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');

  if (!result || RESERVED_NAMES.test(result)) {
    return fallback;
  }

  return result;
}

/**
 * 画像の保存ファイル名を作る。連番なので並び順が本文と一致する。
 *
 * @param {number} index  1 始まりの通し番号。
 * @param {object} source url: 元 URL / contentType: レスポンスの MIME タイプ。
 * @return {string} `001.png` のようなファイル名。
 */
export function imageFileName(index, source = {}) {
  const { url = '', contentType = '' } = source;
  const extension = extensionFromMime(contentType) || extensionFromUrl(url) || 'img';

  return `${String(index).padStart(3, '0')}.${extension}`;
}

function extensionFromMime(contentType) {
  const mime = String(contentType).split(';')[0].trim().toLowerCase();

  return EXTENSION_BY_MIME[mime] ?? '';
}

function extensionFromUrl(url) {
  let pathname = String(url);

  try {
    pathname = new URL(url).pathname;
  } catch {
    // 相対 URL などはそのまま末尾を見る。
  }

  const matched = pathname.toLowerCase().match(/\.([a-z0-9]+)$/);

  if (!matched) {
    return '';
  }

  const extension = matched[1] === 'jpeg' ? 'jpg' : matched[1];

  return KNOWN_EXTENSIONS.has(extension) ? extension : '';
}

/**
 * 添付ファイルの保存ファイル名を作る。
 *
 * 画像と違い名前そのものに意味があるので、連番ではなく URL の末尾を使う。
 *
 * @param {string} url   添付ファイルの URL。
 * @param {number} index 1 始まりの通し番号。名前が取れなかったときに使う。
 * @return {string} ファイル名。
 */
export function attachmentFileName(url, index = 1) {
  let lastSegment = '';

  try {
    lastSegment = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  } catch {
    // 解決できない URL は連番にフォールバックする。
  }

  return sanitizeSegment(lastSegment, {
    maxLength: 80,
    fallback: `file-${String(index).padStart(3, '0')}`,
  });
}
