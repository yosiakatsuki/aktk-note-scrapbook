/**
 * chrome.scripting.executeScript から注入されるエントリポイント。
 *
 * content script は classic script として実行されるため、
 * ES モジュールである extract-article.js を動的 import で読み込む。
 * ファイル末尾の式の評価結果が executeScript の result になる。
 */
(async () => {
  try {
    const module = await import(chrome.runtime.getURL('src/content/extract-article.js'));

    return { ok: true, article: module.extractArticle() };
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
})();
