/**
 * service worker。保存処理全体の司令塔。
 *
 * 1. 設定済みの保存先フォルダを取り出す
 * 2. content script に記事の抽出を依頼する
 * 3. 画像を取得して images/ に保存し、本文の参照をローカルパスに差し替える
 * 4. index.html と article.md を書き出す
 *
 * 保存はポップアップではなくここで行う。ポップアップは途中で閉じられると
 * 処理が止まってしまうため。
 */

import { collectImageBlocks } from './lib/blocks.js';
import { ensureDirectory, hasWritePermission, writeFile } from './lib/file-system.js';
import { imageFileName, sanitizeSegment } from './lib/filename.js';
import { renderHtml } from './lib/html.js';
import { renderMarkdown } from './lib/markdown.js';
import { loadSaveDirectory } from './lib/storage.js';

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
  const rootDirectory = await requireSaveDirectory();
  const article = await extractFromTab(tabId);

  article.savedAt = new Date().toISOString();

  const folder = sanitizeSegment(article.title);
  const articleDirectory = await ensureDirectory(rootDirectory, folder);
  const imageResult = await saveImages(article.blocks, articleDirectory);

  await writeFile(articleDirectory, 'index.html', renderHtml(article));
  await writeFile(articleDirectory, 'article.md', renderMarkdown(article));

  return {
    ok: true,
    folder: `${rootDirectory.name}/${folder}`,
    title: article.title,
    savedImages: imageResult.saved,
    failedImages: imageResult.failed,
  };
}

/**
 * 設定済みの保存先フォルダを、書き込める状態で返す。
 *
 * 権限の要求はユーザー操作が必要でここからは呼べないので、
 * 権限が切れている場合はポップアップ側に委ねる。
 */
async function requireSaveDirectory() {
  const handle = await loadSaveDirectory();

  if (!handle) {
    throw new Error('保存先フォルダが未設定です。設定ページで選んでください。');
  }

  if (!(await hasWritePermission(handle))) {
    throw new Error('保存先フォルダへのアクセスが許可されていません。');
  }

  return handle;
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
 * 画像の取得は service worker から行う。content script から fetch すると
 * ドメインをまたぐため CORS で失敗する。
 *
 * 取得に失敗した画像は元の URL のまま残す（オフラインでは表示されないが、
 * リンクとしては辿れる状態を保つ）。
 */
async function saveImages(blocks, articleDirectory) {
  const imageBlocks = collectImageBlocks(blocks);
  const failed = [];
  let saved = 0;

  if (imageBlocks.length === 0) {
    return { saved, failed };
  }

  const imageDirectory = await ensureDirectory(articleDirectory, IMAGE_FOLDER);

  for (const [index, block] of imageBlocks.entries()) {
    try {
      const response = await fetch(block.src);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get('content-type') ?? '';
      const name = imageFileName(index + 1, { url: block.src, contentType });

      await writeFile(imageDirectory, name, await response.blob());

      block.path = `${IMAGE_FOLDER}/${name}`;
      saved += 1;
    } catch (error) {
      failed.push({ src: block.src, reason: error?.message ?? String(error) });
    }
  }

  return { saved, failed };
}
