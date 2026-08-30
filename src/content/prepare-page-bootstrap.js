/**
 * 拡張機能のポップアップを開いたときに注入されるエントリポイント。
 *
 * 添付ファイルへの移動ナビゲーションを保存前のnoteページへ挿入し、
 * ポップアップに表示する画像数と添付ファイル数を返す。
 */
(async () => {
  try {
    const module = await import(chrome.runtime.getURL('src/content/extract-article.js'));

    return { ok: true, ...module.prepareArticlePage() };
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
})();
