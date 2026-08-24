/**
 * service worker。保存処理全体の司令塔。
 *
 * 1. content script に記事の抽出を依頼する
 * 2. 画像を取得して images/ に保存し、本文の参照をローカルパスに差し替える
 * 3. index.html と article.md を書き出す
 */

import { collectFileNodes, collectImageBlocks } from './lib/blocks.js';
import { bytesToDataUrl, textToDataUrl } from './lib/data-url.js';
import { attachmentFileName, imageFileName, sanitizeSegment } from './lib/filename.js';
import { renderHtml } from './lib/html.js';
import { renderMarkdown } from './lib/markdown.js';

// ダウンロードフォルダ直下に作るまとめ用フォルダ。
const ROOT_FOLDER = 'note-scrapbook';
const IMAGE_FOLDER = 'images';
const FILE_FOLDER = 'files';

// 添付ファイルの完了を待つ上限。これを過ぎたらダウンロード継続中として扱う。
const DOWNLOAD_TIMEOUT_MS = 30000;

// 保存先を決めるまでの間だけ、添付ファイルの URL と置き場所を覚えておく。
const pendingAttachments = new Map();

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
  const fileResult = await saveAttachments(article.blocks, folder);

  await downloadText(`${folder}/index.html`, 'text/html', renderHtml(article));
  await downloadText(`${folder}/article.md`, 'text/markdown', renderMarkdown(article));

  return {
    ok: true,
    folder,
    title: article.title,
    savedImages: imageResult.saved,
    failedImages: imageResult.failed,
    savedFiles: fileResult.saved,
    pendingFiles: fileResult.pending,
    failedFiles: fileResult.failed,
  };
}

/**
 * 本文中の添付ファイル（zip など）を files/ に保存し、参照をローカルパスに差し替える。
 *
 * 画像と違い、URL をそのまま chrome.downloads.download に渡す。
 * ダウンロード API はブラウザ自身のネットワークスタックで取得するため、
 * ログイン中のクッキーが付き、会員向けのファイルもリンクをクリックしたときと
 * 同じように取得できる。拡張から fetch すると拡張のオリジンからの送信になり、
 * クッキーが付かないので同じことはできない。
 */
async function saveAttachments(blocks, folder) {
  const fileNodes = collectFileNodes(blocks);
  const usedNames = new Set();
  const failed = [];
  let saved = 0;
  let pending = 0;

  for (const [index, node] of fileNodes.entries()) {
    const url = node.url ?? node.href;

    try {
      const { name, state } = await downloadAttachment(url, folder, usedNames, index + 1);

      node.path = `${FILE_FOLDER}/${name}`;

      if (state === 'pending') {
        pending += 1;
      } else {
        saved += 1;
      }
    } catch (error) {
      failed.push({ url, reason: error?.message ?? String(error) });
    }
  }

  return { saved, pending, failed };
}

/**
 * 添付ファイル 1 件をダウンロードし、実際に保存されたファイル名を返す。
 *
 * download() に filename を渡さないのがポイント。渡すとそれが優先され、
 * サーバーが Content-Disposition で返す本来のファイル名が失われる。
 * note の配信 URL は拡張子を含まないため、本来の名前が分からないと
 * 拡張子なしのファイルになってしまう。
 * 代わりに onDeterminingFilename で、本来の名前のまま保存先だけを差し替える。
 */
async function downloadAttachment(url, folder, usedNames, index) {
  pendingAttachments.set(url, {
    folder,
    usedNames,
    fallbackName: attachmentFileName(url, index),
  });

  try {
    const downloadId = await chrome.downloads.download({ url, saveAs: false });
    const state = await waitForDownload(downloadId);
    const [item] = await chrome.downloads.search({ id: downloadId });
    const name = baseName(item?.filename ?? '');

    if (!name) {
      throw new Error('保存されたファイル名を確認できませんでした');
    }

    return { name, state };
  } finally {
    pendingAttachments.delete(url);
  }
}

/**
 * 保存先を決める直前に呼ばれ、サーバー由来のファイル名はそのままに、
 * 置き場所だけを記事の files/ に差し替える。
 */
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const attachment = pendingAttachments.get(item.url) ?? pendingAttachments.get(item.finalUrl);

  if (!attachment) {
    return;
  }

  const suggested = sanitizeSegment(baseName(item.filename), {
    fallback: attachment.fallbackName,
  });
  const name = uniqueName(suggested, attachment.usedNames);

  suggest({
    filename: `${attachment.folder}/${FILE_FOLDER}/${name}`,
    conflictAction: 'overwrite',
  });
});

function baseName(path) {
  return String(path ?? '').split(/[\\/]/).pop() ?? '';
}

/**
 * 同じフォルダ内でファイル名がぶつからないよう、必要なら連番を足す。
 */
function uniqueName(name, usedNames) {
  if (!usedNames.has(name)) {
    usedNames.add(name);

    return name;
  }

  const dotIndex = name.lastIndexOf('.');
  const base = dotIndex > 0 ? name.slice(0, dotIndex) : name;
  const extension = dotIndex > 0 ? name.slice(dotIndex) : '';

  let counter = 2;

  while (usedNames.has(`${base}-${counter}${extension}`)) {
    counter += 1;
  }

  const candidate = `${base}-${counter}${extension}`;
  usedNames.add(candidate);

  return candidate;
}

/**
 * ダウンロードの完了を待つ。
 *
 * 大きなファイルを待ち続けても保存処理が終わらないので、一定時間で切り上げる。
 * その場合もダウンロード自体はブラウザ側で続くため、参照は差し替えてよい。
 *
 * @return {Promise<'complete'|'pending'>} 待ち切れたかどうか。
 */
function waitForDownload(downloadId) {
  return new Promise((resolve, reject) => {
    let timer;

    const settle = (callback, value) => {
      chrome.downloads.onChanged.removeListener(onChanged);
      clearTimeout(timer);
      callback(value);
    };

    const handleState = (state, error) => {
      if (state === 'complete') {
        settle(resolve, 'complete');
      } else if (state === 'interrupted') {
        settle(reject, new Error(error ?? 'ダウンロードが中断されました'));
      }
    };

    function onChanged(delta) {
      if (delta.id === downloadId && delta.state) {
        handleState(delta.state.current, delta.error?.current);
      }
    }

    chrome.downloads.onChanged.addListener(onChanged);
    timer = setTimeout(() => settle(resolve, 'pending'), DOWNLOAD_TIMEOUT_MS);

    // リスナーを付ける前に終わっている場合があるので、現在の状態も確かめる。
    chrome.downloads.search({ id: downloadId }).then(([item]) => {
      if (item) {
        handleState(item.state, item.error);
      }
    });
  });
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
