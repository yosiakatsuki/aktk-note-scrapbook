/**
 * ポップアップ UI。保存の起点と結果表示、保存先の権限確認を担当する。
 *
 * 権限の要求（requestPermission）はユーザー操作の中からしか呼べないので、
 * service worker ではなくここで行う。
 */

import { hasWritePermission, requestWritePermission } from '../lib/file-system.js';
import { loadSaveDirectory } from '../lib/storage.js';

const targetLabel = document.getElementById('target');
const saveButton = document.getElementById('save');
const grantButton = document.getElementById('grant');
const statusLabel = document.getElementById('status');
const destinationLabel = document.getElementById('destination');
const optionsLink = document.getElementById('options');

const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
const isArticle = isNoteArticle(activeTab?.url);
const saveDirectory = await loadSaveDirectory();

targetLabel.textContent = isArticle
  ? (activeTab.title ?? activeTab.url)
  : 'note の記事ページを開いてから実行してください。';

destinationLabel.textContent = saveDirectory?.name ?? '未設定';

await refreshAvailability();

optionsLink.addEventListener('click', (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

grantButton.addEventListener('click', async () => {
  if (await requestWritePermission(saveDirectory)) {
    setStatus('');
    await refreshAvailability();
  } else {
    setStatus('保存先へのアクセスが許可されませんでした。', true);
  }
});

saveButton.addEventListener('click', async () => {
  saveButton.disabled = true;
  setStatus('保存中…');

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'save-article',
      tabId: activeTab.id,
    });

    if (!result?.ok) {
      throw new Error(result?.error ?? '保存に失敗しました。');
    }

    setStatus(formatResult(result));
  } catch (error) {
    setStatus(error?.message ?? String(error), true);
  } finally {
    saveButton.disabled = false;
  }
});

/**
 * 保存先の設定状況に応じて、押せるボタンと案内を切り替える。
 */
async function refreshAvailability() {
  if (!saveDirectory) {
    setStatus('保存先フォルダが未設定です。「変更」から選んでください。', true);
    return;
  }

  if (!(await hasWritePermission(saveDirectory))) {
    grantButton.hidden = false;
    setStatus('保存先へのアクセスを許可してください。');
    return;
  }

  grantButton.hidden = true;
  saveButton.disabled = !isArticle;
}

/**
 * note の記事 URL かどうかを判定する。
 * 記事は https://note.com/<ユーザー名>/n/<記事 ID> の形。
 */
function isNoteArticle(url) {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);

    return parsed.hostname === 'note.com' && /\/n\/n?[\w-]+/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function formatResult(result) {
  const lines = [`保存しました: ${result.folder}`, `画像: ${result.savedImages} 件`];

  if (result.failedImages.length > 0) {
    lines.push(`取得できなかった画像: ${result.failedImages.length} 件`);
  }

  return lines.join('\n');
}

function setStatus(message, isError = false) {
  statusLabel.textContent = message;
  statusLabel.classList.toggle('error', isError);
}
