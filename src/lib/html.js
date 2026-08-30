/**
 * 記事の中間表現を、単体で開ける HTML に変換する。
 *
 * file:/// でダブルクリック起動する前提なので、CSS はインラインで持ち、
 * 外部リソース（フォント・スクリプト）は一切参照しない。
 */

import { collectFileNodes } from './blocks.js';

// 保存した記事は原稿と同じ見た目で読みたいので、OS のダークモードには追従せず
// 背景は白で固定する。色はすべて具体値で指定し、閲覧環境で変わらないようにする。
const STYLE = `
:root { color-scheme: light; }
body {
  position: relative;
  margin: 0 auto;
  padding: 2rem 1.25rem 6rem;
  max-width: 42rem;
  background: #ffffff;
  color: #222222;
  line-height: 1.9;
  font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", Meiryo, sans-serif;
  word-wrap: break-word;
}
header { border-bottom: 1px solid #dddddd; padding-bottom: 1rem; margin-bottom: 2rem; }
h1 { font-size: 1.7rem; line-height: 1.5; margin: 0 0 0.75rem; }
h2 { font-size: 1.35rem; margin: 2.5rem 0 0.75rem; }
h3 { font-size: 1.15rem; margin: 2rem 0 0.5rem; }
a { color: #1a6dcc; }
.meta { font-size: 0.85rem; color: #666666; margin: 0; }
.meta a { word-break: break-all; }
p { margin: 1rem 0; }
img { max-width: 100%; height: auto; display: block; }
figure { margin: 1.5rem 0; }
figcaption { font-size: 0.85rem; color: #666666; margin-top: 0.4rem; }
blockquote {
  margin: 1.5rem 0;
  padding: 0.25rem 0 0.25rem 1rem;
  border-left: 3px solid #dddddd;
  color: #555555;
}
pre {
  margin: 1.5rem 0;
  padding: 0.9rem;
  background: #f2f2f2;
  border: 1px solid #e2e2e2;
  border-radius: 4px;
  line-height: 1.6;
  /* 横スクロールせずに全文が読めるよう折り返す。 */
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; }
:not(pre) > code { background: #f2f2f2; padding: 0.1em 0.3em; border-radius: 3px; }
hr { border: none; border-top: 1px solid #dddddd; margin: 2.5rem 0; }
table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; }
th, td { border: 1px solid #dddddd; padding: 0.4rem 0.6rem; text-align: left; }
.embed { margin: 1.5rem 0; }
.download-navigation {
  position: fixed;
  top: 1rem;
  left: 1rem;
  z-index: 10;
  box-sizing: border-box;
  width: min(15rem, calc(100vw - 2rem));
  max-height: calc(100vh - 2rem);
  padding: 0.75rem;
  overflow-y: auto;
  border: 1px solid #cccccc;
  border-radius: 6px;
  background: #ffffff;
  box-shadow: 0 4px 16px rgb(0 0 0 / 14%);
  font-size: 0.85rem;
  line-height: 1.5;
}
.download-navigation__title {
  margin: 0 0 0.4rem;
  color: #555555;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.download-navigation ol { margin: 0; padding-left: 1.5rem; }
.download-navigation li + li { margin-top: 0.3rem; }
.download-navigation a { display: block; overflow-wrap: anywhere; }
.download-target { scroll-margin-top: 1rem; }
@media (max-width: 64rem) {
  body.has-download-navigation { padding-top: 7rem; }
  .download-navigation {
    top: 0.75rem;
    right: 0.75rem;
    left: 0.75rem;
    width: auto;
    max-height: 5.5rem;
  }
  .download-navigation ol { display: flex; gap: 1.75rem; overflow-x: auto; }
  .download-navigation li { flex: 0 0 auto; }
  .download-navigation li + li { margin-top: 0; }
}
`.trim();

/**
 * @param {object} article 記事の中間表現。
 * @return {string} 完結した HTML ドキュメント。
 */
export function renderHtml(article) {
  const title = article.title || '無題';
  const blocks = article.blocks ?? [];
  const downloadTargets = createDownloadTargets(blocks);
  const bodyClass = downloadTargets.size > 0 ? ' class="has-download-navigation"' : '';

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${STYLE}
</style>
</head>
<body${bodyClass}>
${renderDownloadNavigation(downloadTargets)}
<header>
<h1>${escapeHtml(title)}</h1>
${renderMeta(article)}
</header>
<main>
${renderBlocks(blocks, 0, downloadTargets)}
</main>
</body>
</html>
`;
}

function renderMeta(article) {
  const items = [];

  if (article.author) {
    items.push(escapeHtml(article.author));
  }

  if (article.publishedAt) {
    items.push(escapeHtml(formatDate(article.publishedAt)));
  }

  const lines = [];

  if (items.length > 0) {
    lines.push(`<p class="meta">${items.join(' ・ ')}</p>`);
  }

  if (article.url) {
    lines.push(
      `<p class="meta">出典: <a href="${escapeAttribute(article.url)}">${escapeHtml(article.url)}</a></p>`
    );
  }

  if (article.savedAt) {
    lines.push(`<p class="meta">保存日時: ${escapeHtml(formatDate(article.savedAt))}</p>`);
  }

  return lines.join('\n');
}

function formatDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  const pad = (number) => String(number).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function createDownloadTargets(blocks) {
  return new Map(
    collectFileNodes(blocks).map((node, index) => [
      node,
      {
        id: `download-${index + 1}`,
        label: downloadLabel(node, index),
      },
    ])
  );
}

function downloadLabel(node, index) {
  const label = node.type === 'embed' ? node.label : inlineText(node.children);

  return label?.trim() || `添付ファイル ${index + 1}`;
}

function inlineText(nodes = []) {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'inlineCode':
          return node.text;

        case 'break':
          return ' ';

        default:
          return inlineText(node.children);
      }
    })
    .join('');
}

function renderDownloadNavigation(downloadTargets) {
  if (downloadTargets.size === 0) {
    // 添付ファイルのない記事では、本文閲覧に不要なナビゲーションを表示しない。
    return '';
  }

  const items = [...downloadTargets.values()]
    .map(
      ({ id, label }) =>
        `<li><a href="#${escapeAttribute(id)}">${escapeHtml(label)}</a></li>`
    )
    .join('\n');

  return `<nav class="download-navigation" aria-label="添付ファイルへの移動">
<p class="download-navigation__title">ダウンロード</p>
<ol>
${items}
</ol>
</nav>`;
}

function renderBlocks(blocks, depth, downloadTargets) {
  return blocks
    .map((block) => renderBlock(block, depth, downloadTargets))
    .filter(Boolean)
    .join('\n');
}

function renderBlock(block, depth, downloadTargets) {
  switch (block.type) {
    case 'heading': {
      // 記事タイトルが h1 なので、本文の見出しは 1 段下げる。
      const level = Math.min(block.level + 1, 6);
      return `<h${level}>${renderInline(block.inline, downloadTargets)}</h${level}>`;
    }

    case 'paragraph':
      return `<p>${renderInline(block.inline, downloadTargets)}</p>`;

    case 'divider':
      return '<hr>';

    case 'image': {
      const src = block.path || block.src;
      const img = `<img src="${escapeAttribute(src)}" alt="${escapeAttribute(block.alt ?? '')}">`;
      const caption = block.caption
        ? `\n<figcaption>${escapeHtml(block.caption)}</figcaption>`
        : '';

      return `<figure>\n${img}${caption}\n</figure>`;
    }

    case 'embed': {
      const target = downloadTargets.get(block);
      const targetAttributes = target
        ? ` id="${escapeAttribute(target.id)}" class="embed download-target"`
        : ' class="embed"';

      return `<p${targetAttributes}><a href="${escapeAttribute(block.path || block.url)}">${escapeHtml(block.label || block.url)}</a></p>`;
    }

    case 'code':
      return `<pre><code>${escapeHtml(stripTrailingNewline(block.text))}</code></pre>`;

    case 'quote':
      return `<blockquote>\n${renderBlocks(block.blocks ?? [], depth + 1, downloadTargets)}\n</blockquote>`;

    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      const items = (block.items ?? [])
        .map(
          (itemBlocks) =>
            `<li>${renderListItem(itemBlocks, depth + 1, downloadTargets)}</li>`
        )
        .join('\n');

      return `<${tag}>\n${items}\n</${tag}>`;
    }

    case 'table':
      return renderTable(block, downloadTargets);

    default:
      return '';
  }
}

/**
 * リスト項目は、単一段落なら <p> を省いて素直な見た目にする。
 */
function renderListItem(blocks, depth, downloadTargets) {
  if (blocks.length === 1 && blocks[0].type === 'paragraph') {
    // 単一段落のリスト項目は余分な段落余白を作らず、元記事の密度を保つ。
    return renderInline(blocks[0].inline, downloadTargets);
  }

  return renderBlocks(blocks, depth, downloadTargets);
}

function renderTable(block, downloadTargets) {
  const rows = block.rows ?? [];

  if (rows.length === 0) {
    // 空の表は意味のない枠だけが残るため、HTMLには出力しない。
    return '';
  }

  const toRow = (cells, cellTag) =>
    `<tr>${cells.map((inline) => `<${cellTag}>${renderInline(inline, downloadTargets)}</${cellTag}>`).join('')}</tr>`;

  if (!block.hasHeader) {
    // 見出しのない表では、先頭行も本文セルとして扱う。
    return `<table>\n${rows.map((cells) => toRow(cells, 'td')).join('\n')}\n</table>`;
  }

  const [header, ...body] = rows;

  return [
    '<table>',
    `<thead>${toRow(header, 'th')}</thead>`,
    `<tbody>${body.map((cells) => toRow(cells, 'td')).join('\n')}</tbody>`,
    '</table>',
  ].join('\n');
}

function renderInline(nodes = [], downloadTargets) {
  return nodes.map((node) => renderInlineNode(node, downloadTargets)).join('');
}

function renderInlineNode(node, downloadTargets) {
  switch (node.type) {
    case 'text':
      return escapeHtml(node.text);

    case 'break':
      return '<br>';

    case 'strong':
      return `<strong>${renderInline(node.children, downloadTargets)}</strong>`;

    case 'emphasis':
      return `<em>${renderInline(node.children, downloadTargets)}</em>`;

    case 'strike':
      return `<s>${renderInline(node.children, downloadTargets)}</s>`;

    case 'inlineCode':
      return `<code>${escapeHtml(node.text)}</code>`;

    case 'link': {
      const target = downloadTargets.get(node);
      const targetAttributes = target
        ? ` id="${escapeAttribute(target.id)}" class="download-target"`
        : '';

      return `<a${targetAttributes} href="${escapeAttribute(node.path || node.href)}">${renderInline(node.children, downloadTargets)}</a>`;
    }

    default:
      return '';
  }
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttribute(text) {
  return escapeHtml(text).replace(/"/g, '&quot;');
}

function stripTrailingNewline(text) {
  return String(text ?? '').replace(/\n+$/, '');
}
