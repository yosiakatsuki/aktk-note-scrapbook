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

  // 画像がない figure は埋め込み（X / YouTube / リンクカードなど）とみなす。
  const iframeSrc = figure.querySelector('iframe')?.getAttribute('src');
  const anchor = figure.querySelector('a[href]');
  const href = iframeSrc || anchor?.getAttribute('href');
  const label = caption || anchor?.textContent?.trim() || '';
  const embed = embedBlock(href, label, ctx);

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

function embedBlock(href, label, ctx) {
  const url = resolveUrl(href, ctx);

  return url ? { type: 'embed', url, label: label || url } : null;
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

      return href ? [{ type: 'link', href, children }] : children;
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
