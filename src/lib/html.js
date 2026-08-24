/**
 * 記事の中間表現を、単体で開ける HTML に変換する。
 *
 * file:/// でダブルクリック起動する前提なので、CSS はインラインで持ち、
 * 外部リソース（フォント・スクリプト）は一切参照しない。
 */

// 保存した記事は原稿と同じ見た目で読みたいので、OS のダークモードには追従せず
// 背景は白で固定する。色はすべて具体値で指定し、閲覧環境で変わらないようにする。
const STYLE = `
:root { color-scheme: light; }
body {
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
`.trim();

/**
 * @param {object} article 記事の中間表現。
 * @return {string} 完結した HTML ドキュメント。
 */
export function renderHtml(article) {
  const title = article.title || '無題';

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
<body>
<header>
<h1>${escapeHtml(title)}</h1>
${renderMeta(article)}
</header>
<main>
${renderBlocks(article.blocks ?? [], 0)}
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

function renderBlocks(blocks, depth) {
  return blocks
    .map((block) => renderBlock(block, depth))
    .filter(Boolean)
    .join('\n');
}

function renderBlock(block, depth) {
  switch (block.type) {
    case 'heading': {
      // 記事タイトルが h1 なので、本文の見出しは 1 段下げる。
      const level = Math.min(block.level + 1, 6);
      return `<h${level}>${renderInline(block.inline)}</h${level}>`;
    }

    case 'paragraph':
      return `<p>${renderInline(block.inline)}</p>`;

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

    case 'embed':
      return `<p class="embed"><a href="${escapeAttribute(block.url)}">${escapeHtml(block.label || block.url)}</a></p>`;

    case 'code':
      return `<pre><code>${escapeHtml(stripTrailingNewline(block.text))}</code></pre>`;

    case 'quote':
      return `<blockquote>\n${renderBlocks(block.blocks ?? [], depth + 1)}\n</blockquote>`;

    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      const items = (block.items ?? [])
        .map((itemBlocks) => `<li>${renderListItem(itemBlocks, depth + 1)}</li>`)
        .join('\n');

      return `<${tag}>\n${items}\n</${tag}>`;
    }

    case 'table':
      return renderTable(block);

    default:
      return '';
  }
}

/**
 * リスト項目は、単一段落なら <p> を省いて素直な見た目にする。
 */
function renderListItem(blocks, depth) {
  if (blocks.length === 1 && blocks[0].type === 'paragraph') {
    return renderInline(blocks[0].inline);
  }

  return renderBlocks(blocks, depth);
}

function renderTable(block) {
  const rows = block.rows ?? [];

  if (rows.length === 0) {
    return '';
  }

  const toRow = (cells, cellTag) =>
    `<tr>${cells.map((inline) => `<${cellTag}>${renderInline(inline)}</${cellTag}>`).join('')}</tr>`;

  if (!block.hasHeader) {
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

function renderInline(nodes = []) {
  return nodes.map((node) => renderInlineNode(node)).join('');
}

function renderInlineNode(node) {
  switch (node.type) {
    case 'text':
      return escapeHtml(node.text);

    case 'break':
      return '<br>';

    case 'strong':
      return `<strong>${renderInline(node.children)}</strong>`;

    case 'emphasis':
      return `<em>${renderInline(node.children)}</em>`;

    case 'strike':
      return `<s>${renderInline(node.children)}</s>`;

    case 'inlineCode':
      return `<code>${escapeHtml(node.text)}</code>`;

    case 'link':
      return `<a href="${escapeAttribute(node.href)}">${renderInline(node.children)}</a>`;

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
