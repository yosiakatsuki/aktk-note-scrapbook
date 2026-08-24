/**
 * chrome.downloads.download に渡すための data: URL を組み立てる。
 *
 * MV3 の service worker では URL.createObjectURL が使えないため、
 * 保存対象は data: URL に変換してからダウンロード API に渡している。
 */

/**
 * @param {string}     mimeType MIME タイプ。
 * @param {Uint8Array} bytes    バイト列。
 * @return {string} data: URL。
 */
export function bytesToDataUrl(mimeType, bytes) {
  return `data:${mimeType || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`;
}

/**
 * @param {string} mimeType MIME タイプ。
 * @param {string} text     UTF-8 として保存したい文字列。
 * @return {string} data: URL。
 */
export function textToDataUrl(mimeType, text) {
  const bytes = new TextEncoder().encode(text);

  return `data:${mimeType};charset=utf-8;base64,${bytesToBase64(bytes)}`;
}

function bytesToBase64(bytes) {
  // btoa に一度に渡すと大きな画像でスタックが溢れるため分割して処理する。
  const chunkSize = 0x8000;
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}
