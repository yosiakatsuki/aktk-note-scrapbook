/**
 * ポップアップ UI。保存の起点と、結果表示だけを担当する。
 */

const targetLabel = document.getElementById('target');
const saveButton = document.getElementById('save');
const statusLabel = document.getElementById('status');

const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

if (isNoteArticle(activeTab?.url)) {
  targetLabel.textContent = activeTab.title ?? activeTab.url;
  setStatus('画像と添付ファイルを確認中…');

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'prepare-article-page',
      tabId: activeTab.id,
    });

    if (!result?.ok) {
      // 事前解析に失敗したページをそのまま保存すると不完全になるため、保存を開始させない。
      throw new Error(result?.error ?? '記事を事前確認できませんでした。');
    }

    setStatus(formatInspection(result));
    saveButton.disabled = false;
  } catch (error) {
    setStatus(error?.message ?? String(error), true);
  }
} else {
  // noteの記事以外ではDOM解析やページ書き換えを実行しない。
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

  if (result.savedFiles > 0) {
    lines.push(`添付ファイル: ${result.savedFiles} 件`);
  }

  if (result.pendingFiles > 0) {
    lines.push(`ダウンロード継続中の添付ファイル: ${result.pendingFiles} 件`);
  }

  if (result.failedFiles.length > 0) {
    lines.push(`取得できなかった添付ファイル: ${result.failedFiles.length} 件`);
  }

  return lines.join('\n');
}

function formatInspection(result) {
  const lines = [`画像: ${result.imageCount} 件`, `添付ファイル: ${result.fileCount} 件`];

  if (result.fileCount > 0) {
    // ページ側にも変化があることを明示し、固定ナビゲーションを見つけやすくする。
    lines.push('ページ左上に移動リンクを表示しました。');
  }

  return lines.join('\n');
}

function setStatus(message, isError = false) {
  statusLabel.textContent = message;
  statusLabel.classList.toggle('error', isError);
}
