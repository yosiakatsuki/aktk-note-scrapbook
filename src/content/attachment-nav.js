/**
 * note の記事ページに、添付ファイルへのページ内ナビゲーションを差し込む。
 *
 * 記事を読みながらダウンロードボタンまで辿り着くのが面倒なので、
 * 画面に固定した一覧からジャンプできるようにする作業用の補助。
 * 挿入した要素はページに残るだけで、保存される記事には含まれない
 * （本文ルートの外に置くため）。
 *
 * content script として自動で読み込まれる classic script なので、
 * import はせず 1 ファイルで完結させる。
 */
(() => {
  // note の添付ファイル配信 URL。docs/spec.md の ATTACHMENT_URL_PATTERNS と揃える。
  const ATTACHMENT_SELECTOR = 'a[href^="https://note.com/api/v2/attachments/"]';
  const HOST_ID = 'aktk-note-scrapbook-attachment-nav';
  const LABEL_MAX_LENGTH = 24;

  // note 側の CSS と干渉しないよう Shadow DOM に閉じ込める。
  const STYLE = `
:host { all: initial; }
.panel {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483000;
  max-width: 15rem;
  padding: 0.6rem 0.7rem;
  background: #ffffff;
  color: #222222;
  border: 1px solid #d5d5d5;
  border-radius: 6px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
  font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", Meiryo, sans-serif;
  font-size: 12px;
  line-height: 1.5;
}
.head { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.4rem; }
.title { flex: 1; font-weight: bold; }
.close {
  padding: 0 0.25rem;
  border: none;
  background: none;
  color: #666666;
  font: inherit;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
.close:hover { color: #222222; }
ul { margin: 0; padding: 0; list-style: none; }
li + li { margin-top: 0.2rem; }
.jump {
  display: block;
  width: 100%;
  padding: 0.3rem 0.4rem;
  border: none;
  border-radius: 4px;
  background: #f2f2f2;
  color: #1a6dcc;
  font: inherit;
  text-align: left;
  cursor: pointer;
  overflow-wrap: anywhere;
}
.jump:hover { background: #e6e6e6; }
.jump:focus-visible { outline: 2px solid #1a6dcc; outline-offset: 1px; }
`.trim();

  let dismissed = false;

  render();
  watchForChanges();

  /**
   * 添付ファイルリンクの有無に合わせてパネルを出し入れする。
   */
  function render() {
    if (dismissed) {
      return;
    }

    const anchors = Array.from(document.querySelectorAll(ATTACHMENT_SELECTOR));
    const existing = document.getElementById(HOST_ID);

    if (anchors.length === 0) {
      existing?.remove();

      return;
    }

    const host = existing ?? createHost();

    host.shadowRoot.querySelector('ul').replaceChildren(
      ...anchors.map((anchor, index) => createItem(anchor, index))
    );
  }

  function createHost() {
    const host = document.createElement('div');
    host.id = HOST_ID;

    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;

    const panel = document.createElement('div');
    panel.className = 'panel';

    const head = document.createElement('div');
    head.className = 'head';

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = '添付ファイル';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'close';
    close.textContent = '×';
    close.setAttribute('aria-label', '添付ファイルのナビゲーションを閉じる');
    close.addEventListener('click', () => {
      dismissed = true;
      host.remove();
    });

    const list = document.createElement('ul');

    head.append(title, close);
    panel.append(head, list);
    shadow.append(style, panel);
    document.body.append(host);

    return host;
  }

  function createItem(anchor, index) {
    const item = document.createElement('li');
    const button = document.createElement('button');

    button.type = 'button';
    button.className = 'jump';
    button.textContent = labelFor(anchor, index);
    button.addEventListener('click', () => jumpTo(anchor));

    item.append(button);

    return item;
  }

  /**
   * ボタンの文言は、ファイル名が出ていればそれを使う。
   * note のダウンロードボタンはどれも同じ文言のことがあり、区別できないため。
   */
  function labelFor(anchor, index) {
    const candidates = [
      anchor.closest('figure')?.textContent,
      anchor.textContent,
      `添付ファイル ${index + 1}`,
    ];

    for (const candidate of candidates) {
      const text = (candidate ?? '').replace(/\s+/g, ' ').trim();

      if (text) {
        return text.length > LABEL_MAX_LENGTH ? `${text.slice(0, LABEL_MAX_LENGTH)}…` : text;
      }
    }

    return `添付ファイル ${index + 1}`;
  }

  /**
   * ジャンプ先は一瞬だけ枠を付ける。画面中央に寄せただけでは
   * どれが目的のボタンか分かりにくいため。
   */
  function jumpTo(anchor) {
    anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const target = anchor.closest('figure') ?? anchor;
    const previousOutline = target.style.outline;

    target.style.outline = '2px solid #1a6dcc';
    setTimeout(() => {
      target.style.outline = previousOutline;
    }, 1500);
  }

  /**
   * note は画面遷移でも本文が差し替わるので、DOM の変化を見て貼り直す。
   */
  function watchForChanges() {
    let timer;

    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(render, 300);
    }).observe(document.body, { childList: true, subtree: true });
  }
})();
