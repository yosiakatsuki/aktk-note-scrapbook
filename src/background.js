/**
 * service worker。保存処理全体の司令塔。
 *
 * 1. content script に記事の抽出を依頼する
 * 2. 画像を取得して images/ に保存し、本文の参照をローカルパスに差し替える
 * 3. index.html と article.md を書き出す
 */

import { collectImageBlocks } from './lib/blocks.js';
import { bytesToDataUrl, textToDataUrl } from './lib/data-url.js';
import { imageFileName, sanitizeSegment } from './lib/filename.js';
import { renderHtml } from './lib/html.js';
import { renderMarkdown } from './lib/markdown.js';

// ダウンロードフォルダ直下に作るまとめ用フォルダ。
const ROOT_FOLDER = 'note-scrapbook';
const IMAGE_FOLDER = 'images';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'save-article') {
    return false;
  }

  saveArticle(message.tabId).then(sendResponse, (error) => {
    sendResponse({ ok: false, error: error?.message ?? String(error) });
  });

  // 非同期で応答するので true を返す。
  return true;
});

/**
 * 指定タブの記事を保存する。
 *
 * @param {number} tabId 対象タブの ID。
 * @return {Promise<object>} 保存結果。
 */
async function saveArticle(tabId) {
  const article = await extractFromTab(tabId);

  article.savedAt = new Date().toISOString();

  const folder = `${ROOT_FOLDER}/${sanitizeSegment(article.title)}`;
  const imageResult = await saveImages(article.blocks, folder);

  await downloadText(`${folder}/index.html`, 'text/html', renderHtml(article));
  await downloadText(`${folder}/article.md`, 'text/markdown', renderMarkdown(article));

  return {
    ok: true,
    folder,
    title: article.title,
    savedImages: imageResult.saved,
    failedImages: imageResult.failed,
  };
}

/**
 * content script を注入して記事を抽出する。
 */
async function extractFromTab(tabId) {
  let injection;

  try {
    [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/content/bootstrap.js'],
    });
  } catch (error) {
    throw new Error(`ページにアクセスできませんでした: ${error?.message ?? error}`);
  }

  const result = injection?.result;

  if (!result?.ok) {
    throw new Error(result?.error ?? '記事を読み取れませんでした。');
  }

  return result.article;
}

/**
 * 画像を取得して images/ に保存し、成功したものはブロックにローカルパスを書き込む。
 *
 * 取得に失敗した画像は元の URL のまま残す（オフラインでは表示されないが、
 * リンクとしては辿れる状態を保つ）。
 */
async function saveImages(blocks, folder) {
  const imageBlocks = collectImageBlocks(blocks);
  const failed = [];
  let saved = 0;

  for (const [index, block] of imageBlocks.entries()) {
    try {
      const response = await fetch(block.src);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get('content-type') ?? '';
      const bytes = new Uint8Array(await response.arrayBuffer());
      const name = imageFileName(index + 1, { url: block.src, contentType });

      await download({
        url: bytesToDataUrl(contentType.split(';')[0].trim(), bytes),
        filename: `${folder}/${IMAGE_FOLDER}/${name}`,
      });

      block.path = `${IMAGE_FOLDER}/${name}`;
      saved += 1;
    } catch (error) {
      failed.push({ src: block.src, reason: error?.message ?? String(error) });
    }
  }

  return { saved, failed };
}

function downloadText(filename, mimeType, text) {
  return download({ url: textToDataUrl(mimeType, text), filename });
}

/**
 * 同じ記事を保存し直したときに増殖しないよう、常に上書きする。
 */
function download({ url, filename }) {
  return chrome.downloads.download({
    url,
    filename,
    conflictAction: 'overwrite',
    saveAs: false,
  });
}
