/**
 * ポップアップ UI。保存の起点と、結果表示だけを担当する。
 */

const targetLabel = document.getElementById('target');
const saveButton = document.getElementById('save');
const statusLabel = document.getElementById('status');

const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

if (isNoteArticle(activeTab?.url)) {
  targetLabel.textContent = activeTab.title ?? activeTab.url;
  saveButton.disabled = false;
} else {
  targetLabel.textContent = 'note の記事ページを開いてから実行してください。';
}

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
