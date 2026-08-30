/**
 * note の記事ページの DOM から、保存に必要な情報を中間表現（ブロック配列）として取り出す。
 *
 * 中間表現の形は docs/spec.md を参照。
 * DOM だけに依存し拡張 API は使わないので、jsdom 上のユニットテストからも呼べる。
 */

// 本文のルート要素を探すためのセレクタ。note の DOM 変更に備えて上から順に試す。
const BODY_SELECTORS = [
  '.note-common-styles__textnote-body',
  '[class*="note-common-styles__textnote-body"]',
  '.o-noteContentText__body',
  '.p-article__content',
  'article [class*="textnote-body"]',
  'article',
];

// タイトル要素を探すためのセレクタ。JSON-LD / OGP が取れなかったときのフォールバック。
const TITLE_SELECTORS = [
  'h1.o-noteContentText__title',
  'h1[class*="title"]',
  'article h1',
  'h1',
];

// 本文から取り除く要素。広告・シェアボタン・「サポート」導線など。
// 部分一致は誤爆しやすいので、note で実際に使われている語だけを対象にする。
const NOISE_SELECTORS = [
  'script',
  'style',
  'noscript',
  'template',
  'button',
  '[aria-hidden="true"]',
  '[class*="AdBanner"]',
  '[class*="ShareButton"]',
  '[class*="share-button"]',
  '[class*="SupportArea"]',
];

const BLOCK_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'div',
  'section',
  'article',
  'ul',
  'ol',
  'blockquote',
  'pre',
  'hr',
  'figure',
  'table',
  'img',
  'iframe',
  'dl',
  'details',
]);

// 本文からローカルに持ち出したい添付ファイルの拡張子。
// 画像は別扱いなので含めない。HTML など開くと危ないものも含めない。
const DOWNLOADABLE_EXTENSIONS = new Set([
  'zip',
  '7z',
  'rar',
  'tar',
  'gz',
  'pdf',
  'epub',
  'txt',
  'csv',
  'md',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'psd',
  'ai',
  'sketch',
  'mp3',
  'wav',
  'm4a',
  'mp4',
  'mov',
]);

// note の添付ファイル埋め込みを表す embedded-service の値。
const FILE_EMBED_SERVICES = /file|attachment|download/i;

// 保存前のnoteページへ挿入するナビゲーションを識別する名前。
const PAGE_NAVIGATION_ID = 'note-scrapbook-download-navigation';
const PAGE_NAVIGATION_STYLE_ID = 'note-scrapbook-download-navigation-style';
const DOWNLOAD_TARGET_PREFIX = 'note-scrapbook-download-';
const ORIGINAL_ID_ATTRIBUTE = 'data-note-scrapbook-original-id';
const ORIGINAL_BODY_POSITION_ATTRIBUTE = 'data-note-scrapbook-original-body-position';

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * 記事全体を抽出する。
 *
 * @param {Document} doc 対象ドキュメント。省略時は現在のページ。
 * @return {object} 記事の中間表現。
 */
export function extractArticle(doc = globalThis.document) {
  const linkedData = readLinkedData(doc);
  const root = findBodyRoot(doc);

  if (!root) {
    throw new Error('記事本文が見つかりませんでした。note の記事ページで実行してください。');
  }

  const blocks = extractBlocks(root, doc);

  if (blocks.length === 0) {
    throw new Error('記事本文が空でした。ページの読み込み完了後にもう一度試してください。');
  }

  return {
    title: extractTitle(doc, linkedData),
    author: extractAuthor(doc, linkedData),
    publishedAt: extractPublishedAt(doc, linkedData),
    url: canonicalUrl(doc, linkedData),
    blocks,
  };
}

/**
 * 保存前のnoteページを解析し、添付ファイルへの移動ナビゲーションを挿入する。
 *
 * @param {Document} doc 対象ドキュメント。省略時は現在のページ。
 * @return {{ imageCount: number, fileCount: number }} 事前解析結果。
 */
export function prepareArticlePage(doc = globalThis.document) {
  removePageDownloadNavigation(doc);

  const article = extractArticle(doc);
  const root = findBodyRoot(doc);
  const downloadTargets = findPageDownloadTargets(root, doc);

  insertPageDownloadNavigation(doc, downloadTargets);

  return {
    imageCount: countImageBlocks(article.blocks),
    fileCount: downloadTargets.length,
  };
}

function countImageBlocks(blocks = []) {
  return blocks.reduce(
    (count, block) =>
      count +
      (block.type === 'image' ? 1 : 0) +
      countImageBlocks(block.blocks ?? []) +
      (block.items ?? []).reduce(
        (itemCount, itemBlocks) => itemCount + countImageBlocks(itemBlocks),
        0
      ),
    0
  );
}

function findPageDownloadTargets(root, doc) {
  const targets = [];
  const handledAnchors = new Set();

  for (const element of root.querySelectorAll('figure, a[href]')) {
    const tag = element.tagName.toLowerCase();

    if (tag === 'figure') {
      // 添付埋め込みはfigure全体の属性も判定材料になるため、リンクより先に確認する。
      const anchor = element.querySelector('a[href]');
      const href = resolveUrl(
        anchor?.getAttribute('href') ?? element.querySelector('iframe')?.getAttribute('src'),
        { doc }
      );
      const isFile =
        FILE_EMBED_SERVICES.test(element.getAttribute('embedded-service') ?? '') ||
        anchor?.hasAttribute('download') === true ||
        isDownloadableUrl(href);

      if (!isFile) {
        // 通常の画像や外部サービス埋め込みは、ダウンロード移動先に含めない。
        continue;
      }

      if (anchor) {
        // 同じリンクを後続のa要素の走査で重複登録しないよう記録する。
        handledAnchors.add(anchor);
      }

      targets.push({
        element: anchor ?? element,
        label:
          anchor?.textContent?.trim() ||
          element.querySelector('figcaption')?.textContent?.trim() ||
          `添付ファイル ${targets.length + 1}`,
      });
      continue;
    }

    if (handledAnchors.has(element)) {
      // 添付figureとして登録済みのリンクは、一覧へ二重に表示しない。
      continue;
    }

    const href = resolveUrl(element.getAttribute('href'), { doc });

    if (!element.hasAttribute('download') && !isDownloadableUrl(href)) {
      // 通常の本文リンクは、ダウンロード移動先に含めない。
      continue;
    }

    targets.push({
      element,
      label: element.textContent?.trim() || `添付ファイル ${targets.length + 1}`,
    });
  }

  return targets;
}

function insertPageDownloadNavigation(doc, targets) {
  if (targets.length === 0) {
    // 添付ファイルがないページでは、本文閲覧に不要なナビゲーションを追加しない。
    return;
  }

  if (!doc.body || !doc.head) {
    // 通常のHTML文書として準備できていないページは、安全に書き換えられないため中断する。
    return;
  }

  doc.body.setAttribute(ORIGINAL_BODY_POSITION_ATTRIBUTE, doc.body.style.position);
  doc.body.style.position = 'relative';

  const style = doc.createElement('style');
  style.id = PAGE_NAVIGATION_STYLE_ID;
  style.textContent = `
#${PAGE_NAVIGATION_ID}.download-navigation {
  all: initial;
  position: fixed;
  top: 1rem;
  left: 1rem;
  z-index: 2147483647;
  box-sizing: border-box;
  display: block;
  width: min(15rem, calc(100vw - 2rem));
  max-height: calc(100vh - 2rem);
  padding: 0.75rem;
  overflow-y: auto;
  border: 1px solid #cccccc;
  border-radius: 6px;
  background: #ffffff;
  box-shadow: 0 4px 16px rgb(0 0 0 / 14%);
  color: #222222;
  font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", Meiryo, sans-serif;
  font-size: 13px;
  line-height: 1.5;
}
#${PAGE_NAVIGATION_ID} .download-navigation__title {
  margin: 0 0 0.4rem;
  color: #555555;
  font: 700 12px/1.5 -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", Meiryo, sans-serif;
  letter-spacing: 0.08em;
}
#${PAGE_NAVIGATION_ID} ol { margin: 0; padding-left: 1.5rem; }
#${PAGE_NAVIGATION_ID} li { margin: 0; padding: 0; }
#${PAGE_NAVIGATION_ID} li + li { margin-top: 0.3rem; }
#${PAGE_NAVIGATION_ID} a {
  display: block;
  color: #1a6dcc;
  font: inherit;
  text-decoration: underline;
  overflow-wrap: anywhere;
}
[${ORIGINAL_ID_ATTRIBUTE}] { scroll-margin-top: 1rem; }
`.trim();
  doc.head.append(style);

  const navigation = doc.createElement('nav');
  navigation.id = PAGE_NAVIGATION_ID;
  navigation.className = 'download-navigation';
  navigation.setAttribute('aria-label', '添付ファイルへの移動');

  const title = doc.createElement('p');
  title.className = 'download-navigation__title';
  title.textContent = 'ダウンロード';
  navigation.append(title);

  const list = doc.createElement('ol');

  for (const [index, target] of targets.entries()) {
    const targetId = `${DOWNLOAD_TARGET_PREFIX}${index + 1}`;
    target.element.setAttribute(ORIGINAL_ID_ATTRIBUTE, target.element.getAttribute('id') ?? '');
    target.element.id = targetId;

    const item = doc.createElement('li');
    const link = doc.createElement('a');
    link.href = `#${targetId}`;
    link.textContent = target.label;
    item.append(link);
    list.append(item);
  }

  navigation.append(list);
  doc.body.prepend(navigation);
}

function removePageDownloadNavigation(doc) {
  doc.getElementById(PAGE_NAVIGATION_ID)?.remove();
  doc.getElementById(PAGE_NAVIGATION_STYLE_ID)?.remove();

  for (const target of doc.querySelectorAll(`[${ORIGINAL_ID_ATTRIBUTE}]`)) {
    const originalId = target.getAttribute(ORIGINAL_ID_ATTRIBUTE);

    if (originalId) {
      // 元からIDがあった要素は、再解析前にサイト本来の値へ戻す。
      target.id = originalId;
    } else {
      // 拡張機能が新しく付けたIDだけを取り除き、ページ側へ痕跡を残さない。
      target.removeAttribute('id');
    }

    target.removeAttribute(ORIGINAL_ID_ATTRIBUTE);
  }

  if (doc.body?.hasAttribute(ORIGINAL_BODY_POSITION_ATTRIBUTE)) {
    // 再解析時にbodyの指定を積み重ねないよう、挿入前のインラインスタイルへ戻す。
    doc.body.style.position = doc.body.getAttribute(ORIGINAL_BODY_POSITION_ATTRIBUTE) ?? '';
    doc.body.removeAttribute(ORIGINAL_BODY_POSITION_ATTRIBUTE);
  }
}

/**
 * 本文ルート要素から、ブロックの配列を組み立てる。
 *
 * @param {Element}  root 本文ルート要素。
 * @param {Document} doc  URL 解決に使うドキュメント。
 * @return {Array<object>} ブロック配列。
 */
export function extractBlocks(root, doc = root.ownerDocument) {
  const clone = root.cloneNode(true);

  for (const selector of NOISE_SELECTORS) {
    for (const node of clone.querySelectorAll(selector)) {
      node.remove();
    }
  }

  return blocksFromChildren(clone, { doc });
}

function findBodyRoot(doc) {
  for (const selector of BODY_SELECTORS) {
    const found = doc.querySelector(selector);

    if (found) {
      return found;
    }
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* メタデータ                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * JSON-LD から記事を表すオブジェクトを取り出す。見つからなければ null。
 */
function readLinkedData(doc) {
  const articleTypes = new Set(['Article', 'NewsArticle', 'BlogPosting', 'Report']);

  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    let parsed;

    try {
      parsed = JSON.parse(script.textContent ?? '');
    } catch {
      continue;
    }

    // 単体・配列・@graph のいずれの形でも来るのでまとめて走査する。
    const candidates = [];
    const queue = [parsed];

    while (queue.length > 0) {
      const current = queue.shift();

      if (Array.isArray(current)) {
        queue.push(...current);
        continue;
      }

      if (!current || typeof current !== 'object') {
        continue;
      }

      if (Array.isArray(current['@graph'])) {
        queue.push(...current['@graph']);
      }

      candidates.push(current);
    }

    const article = candidates.find((item) => {
      const type = item['@type'];
      return Array.isArray(type)
        ? type.some((one) => articleTypes.has(one))
        : articleTypes.has(type);
    });

    if (article) {
      return article;
    }
  }

  return null;
}

function extractTitle(doc, linkedData) {
  const fromLinkedData = typeof linkedData?.headline === 'string' ? linkedData.headline : '';

  if (fromLinkedData.trim()) {
    return fromLinkedData.trim();
  }

  for (const selector of TITLE_SELECTORS) {
    const text = doc.querySelector(selector)?.textContent?.trim();

    if (text) {
      return text;
    }
  }

  return metaContent(doc, 'og:title') || doc.title?.trim() || '';
}

function extractAuthor(doc, linkedData) {
  const author = linkedData?.author;
  const fromLinkedData = Array.isArray(author) ? author[0]?.name : author?.name;

  if (typeof fromLinkedData === 'string' && fromLinkedData.trim()) {
    return fromLinkedData.trim();
  }

  return metaContent(doc, 'og:site_name') || '';
}

function extractPublishedAt(doc, linkedData) {
  const fromLinkedData = linkedData?.datePublished;

  if (typeof fromLinkedData === 'string' && fromLinkedData.trim()) {
    return fromLinkedData.trim();
  }

  const time = doc.querySelector('time[datetime]')?.getAttribute('datetime');

  return time?.trim() || '';
}

function canonicalUrl(doc, linkedData) {
  const fromLinkedData =
    typeof linkedData?.url === 'string' ? linkedData.url : linkedData?.mainEntityOfPage?.['@id'];

  if (typeof fromLinkedData === 'string' && fromLinkedData.trim()) {
    return fromLinkedData.trim();
  }

  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href');

  return canonical || metaContent(doc, 'og:url') || doc.location?.href || '';
}

function metaContent(doc, property) {
  const meta =
    doc.querySelector(`meta[property="${property}"]`) ??
    doc.querySelector(`meta[name="${property}"]`);

  return meta?.getAttribute('content')?.trim() || '';
}

/* -------------------------------------------------------------------------- */
/* ブロック抽出                                                                */
/* -------------------------------------------------------------------------- */

function blocksFromChildren(parent, ctx) {
  const blocks = [];
  let pending = [];

  const flush = () => {
    const inline = trimInline(pending);
    pending = [];

    if (inline.length > 0) {
      blocks.push({ type: 'paragraph', inline });
    }
  };

  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === TEXT_NODE) {
      pending.push(...inlineFromNode(node, ctx));
      continue;
    }

    if (node.nodeType !== ELEMENT_NODE) {
      continue;
    }

    if (BLOCK_TAGS.has(node.tagName.toLowerCase())) {
      flush();
      blocks.push(...blocksFromElement(node, ctx));
      continue;
    }

    pending.push(...inlineFromNode(node, ctx));
  }

  flush();

  return blocks;
}

function blocksFromElement(element, ctx) {
  const tag = element.tagName.toLowerCase();

  switch (tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const inline = trimInline(inlineFromChildren(element, ctx));
      return inline.length > 0 ? [{ type: 'heading', level: Number(tag[1]), inline }] : [];
    }

    case 'hr':
      return [{ type: 'divider' }];

    case 'img': {
      const image = imageBlock(element, ctx);
      return image ? [image] : [];
    }

    case 'figure':
      return figureBlocks(element, ctx);

    case 'iframe': {
      const embed = embedBlock(element.getAttribute('src'), '', ctx);
      return embed ? [embed] : [];
    }

    case 'ul':
    case 'ol':
      return listBlocks(element, ctx, tag === 'ol');

    case 'blockquote': {
      const blocks = blocksFromChildren(element, ctx);
      return blocks.length > 0 ? [{ type: 'quote', blocks }] : [];
    }

    case 'pre': {
      const text = element.textContent ?? '';
      return text.trim() ? [{ type: 'code', lang: codeLanguage(element), text }] : [];
    }

    case 'table':
      return tableBlocks(element, ctx);

    case 'details': {
      const summary = element.querySelector('summary');
      const summaryInline = summary ? trimInline(inlineFromChildren(summary, ctx)) : [];
      summary?.remove();
      const blocks = blocksFromChildren(element, ctx);

      return [
        ...(summaryInline.length > 0 ? [{ type: 'paragraph', inline: summaryInline }] : []),
        ...blocks,
      ];
    }

    default:
      // p / div / section / article / dl などは中身をそのまま展開する。
      return blocksFromChildren(element, ctx);
  }
}

function figureBlocks(figure, ctx) {
  const caption = figure.querySelector('figcaption')?.textContent?.trim() ?? '';
  const img = figure.querySelector('img');

  if (img) {
    const image = imageBlock(img, ctx);

    if (image) {
      return [{ ...image, caption: caption || image.caption }];
    }
  }

  // 画像がない figure は埋め込み（X / YouTube / リンクカード・添付ファイルなど）とみなす。
  const iframeSrc = figure.querySelector('iframe')?.getAttribute('src');
  const anchor = figure.querySelector('a[href]');
  const href = iframeSrc || anchor?.getAttribute('href');
  const label = caption || anchor?.textContent?.trim() || '';
  // 拡張子が付かない配信 URL もあるので、note の埋め込み種別と download 属性も見る。
  const isFile =
    FILE_EMBED_SERVICES.test(figure.getAttribute('embedded-service') ?? '') ||
    anchor?.hasAttribute('download') === true;
  const embed = embedBlock(href, label, ctx, isFile);

  if (embed) {
    return [embed];
  }

  return blocksFromChildren(figure, ctx);
}

function imageBlock(img, ctx) {
  const src = resolveUrl(pickImageSource(img), ctx);

  if (!src) {
    return null;
  }

  return {
    type: 'image',
    src,
    alt: img.getAttribute('alt')?.trim() ?? '',
    caption: '',
  };
}

/**
 * img から実際に取得すべき URL を選ぶ。
 * 遅延読み込み属性と srcset（最大幅）に対応する。
 */
function pickImageSource(img) {
  const fromSrcset = largestFromSrcset(
    img.getAttribute('srcset') ||
      img.parentElement?.querySelector?.('source[srcset]')?.getAttribute('srcset') ||
      ''
  );

  return (
    fromSrcset ||
    img.getAttribute('data-src') ||
    img.getAttribute('data-original') ||
    img.getAttribute('src') ||
    ''
  );
}

function largestFromSrcset(srcset) {
  if (!srcset) {
    return '';
  }

  let best = '';
  let bestWidth = -1;

  for (const entry of srcset.split(',')) {
    const [url, descriptor = ''] = entry.trim().split(/\s+/);

    if (!url) {
      continue;
    }

    const width = Number.parseFloat(descriptor) || 0;

    if (width >= bestWidth) {
      best = url;
      bestWidth = width;
    }
  }

  return best;
}

function embedBlock(href, label, ctx, isFile = false) {
  const url = resolveUrl(href, ctx);

  if (!url) {
    return null;
  }

  const block = { type: 'embed', url, label: label || url };

  // 添付ファイルは後段でローカルに保存し、参照を差し替える。
  return isFile || isDownloadableUrl(url) ? { ...block, isFile: true } : block;
}

/**
 * リンク先がローカルに保存したい添付ファイルかどうかを、URL の拡張子で判定する。
 */
function isDownloadableUrl(url) {
  let pathname = url;

  try {
    pathname = new URL(url).pathname;
  } catch {
    // 解決できない URL は添付ファイル扱いしない。
    return false;
  }

  const matched = pathname.toLowerCase().match(/\.([a-z0-9]+)$/);

  return matched ? DOWNLOADABLE_EXTENSIONS.has(matched[1]) : false;
}

function listBlocks(list, ctx, ordered) {
  const items = [];

  for (const li of Array.from(list.children)) {
    if (li.tagName?.toLowerCase() !== 'li') {
      continue;
    }

    const blocks = blocksFromChildren(li, ctx);

    if (blocks.length > 0) {
      items.push(blocks);
    }
  }

  return items.length > 0 ? [{ type: 'list', ordered, items }] : [];
}

function tableBlocks(table, ctx) {
  const rows = [];
  let hasHeader = false;

  for (const tr of Array.from(table.querySelectorAll('tr'))) {
    const cells = Array.from(tr.children).filter((cell) =>
      ['td', 'th'].includes(cell.tagName?.toLowerCase())
    );

    if (cells.length === 0) {
      continue;
    }

    if (rows.length === 0 && cells.every((cell) => cell.tagName.toLowerCase() === 'th')) {
      hasHeader = true;
    }

    rows.push(cells.map((cell) => trimInline(inlineFromChildren(cell, ctx))));
  }

  return rows.length > 0 ? [{ type: 'table', hasHeader, rows }] : [];
}

function codeLanguage(pre) {
  const className = pre.querySelector('code')?.getAttribute('class') || pre.getAttribute('class') || '';
  const matched = className.match(/language-([\w+-]+)/);

  return matched ? matched[1] : '';
}

/* -------------------------------------------------------------------------- */
/* インライン抽出                                                              */
/* -------------------------------------------------------------------------- */

function inlineFromChildren(parent, ctx) {
  const nodes = [];

  for (const child of Array.from(parent.childNodes)) {
    nodes.push(...inlineFromNode(child, ctx));
  }

  return nodes;
}

function inlineFromNode(node, ctx) {
  if (node.nodeType === TEXT_NODE) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ');

    return text ? [{ type: 'text', text }] : [];
  }

  if (node.nodeType !== ELEMENT_NODE) {
    return [];
  }

  const tag = node.tagName.toLowerCase();

  switch (tag) {
    case 'br':
      return [{ type: 'break' }];

    case 'strong':
    case 'b': {
      const children = inlineFromChildren(node, ctx);
      return children.length > 0 ? [{ type: 'strong', children }] : [];
    }

    case 'em':
    case 'i': {
      const children = inlineFromChildren(node, ctx);
      return children.length > 0 ? [{ type: 'emphasis', children }] : [];
    }

    case 's':
    case 'del':
    case 'strike': {
      const children = inlineFromChildren(node, ctx);
      return children.length > 0 ? [{ type: 'strike', children }] : [];
    }

    case 'code': {
      const text = node.textContent ?? '';
      return text ? [{ type: 'inlineCode', text }] : [];
    }

    case 'a': {
      const children = inlineFromChildren(node, ctx);
      const href = resolveUrl(node.getAttribute('href'), ctx);

      if (children.length === 0) {
        return [];
      }

      if (!href) {
        return children;
      }

      const isFile = node.hasAttribute('download') || isDownloadableUrl(href);

      return [isFile ? { type: 'link', href, children, isFile: true } : { type: 'link', href, children }];
    }

    default:
      return inlineFromChildren(node, ctx);
  }
}

/**
 * 先頭・末尾の空白テキストと改行を落とす。
 */
function trimInline(nodes) {
  const trimmed = [...nodes];

  while (trimmed.length > 0 && isBlank(trimmed[0])) {
    trimmed.shift();
  }

  while (trimmed.length > 0 && isBlank(trimmed[trimmed.length - 1])) {
    trimmed.pop();
  }

  return trimmed;
}

function isBlank(node) {
  return node.type === 'break' || (node.type === 'text' && !node.text.trim());
}

function resolveUrl(value, ctx) {
  const raw = (value ?? '').trim();

  if (!raw || raw.startsWith('javascript:') || raw.startsWith('#')) {
    return '';
  }

  try {
    return new URL(raw, ctx.doc?.baseURI ?? undefined).href;
  } catch {
    return '';
  }
}
