/**
 * 記事の中間表現を Markdown 文字列に変換する。
 *
 * 画像は block.path（ローカル保存先の相対パス）が入っていればそちらを、
 * 保存に失敗していれば元の URL を参照する。
 */

/**
 * @param {object} article 記事の中間表現。
 * @return {string} Markdown 文字列。
 */
export function renderMarkdown(article) {
  const sections = [
    frontMatter(article),
    `# ${escapeText(article.title || '無題')}`,
    ...renderBlocks(article.blocks ?? []),
  ];

  return `${sections.filter(Boolean).join('\n\n')}\n`;
}

function frontMatter(article) {
  const fields = [
    ['title', article.title],
    ['author', article.author],
    ['published', article.publishedAt],
    ['source', article.url],
    ['saved', article.savedAt],
  ].filter(([, value]) => Boolean(value));

  const body = fields.map(([key, value]) => `${key}: ${yamlString(value)}`).join('\n');

  return `---\n${body}\n---`;
}

function yamlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function renderBlocks(blocks) {
  return blocks.flatMap((block) => renderBlock(block)).filter((chunk) => chunk !== '');
}

function renderBlock(block) {
  switch (block.type) {
    case 'heading':
      return [`${'#'.repeat(Math.min(block.level + 1, 6))} ${renderInline(block.inline)}`];

    case 'paragraph':
      return [renderInline(block.inline)];

    case 'divider':
      return ['---'];

    case 'image': {
      const target = block.path || block.src;
      const image = `![${escapeText(block.alt ?? '')}](${encodeTarget(target)})`;

      return block.caption ? [`${image}\n\n*${escapeText(block.caption)}*`] : [image];
    }

    case 'embed':
      return [`[${escapeText(block.label || block.url)}](${encodeTarget(block.path || block.url)})`];

    case 'code':
      return [`\`\`\`${block.lang ?? ''}\n${stripTrailingNewline(block.text)}\n\`\`\``];

    case 'quote':
      return [
        renderBlocks(block.blocks ?? [])
          .join('\n\n')
          .split('\n')
          .map((line) => (line ? `> ${line}` : '>'))
          .join('\n'),
      ];

    case 'list':
      return [renderList(block)];

    case 'table':
      return [renderTable(block)];

    default:
      return [];
  }
}

function renderList(block) {
  return (block.items ?? [])
    .map((itemBlocks, index) => {
      const marker = block.ordered ? `${index + 1}. ` : '- ';
      const indent = ' '.repeat(marker.length);
      const lines = renderBlocks(itemBlocks).join('\n\n').split('\n');

      return lines
        .map((line, lineIndex) => {
          if (lineIndex === 0) {
            return `${marker}${line}`;
          }

          return line ? `${indent}${line}` : '';
        })
        .join('\n');
    })
    .join('\n');
}

function renderTable(block) {
  const rows = (block.rows ?? []).map((cells) => cells.map((inline) => renderInline(inline)));

  if (rows.length === 0) {
    return '';
  }

  const columnCount = Math.max(...rows.map((cells) => cells.length));
  const toLine = (cells) => {
    const padded = [...cells, ...Array(columnCount - cells.length).fill('')];

    return `| ${padded.map((cell) => cell.replace(/\|/g, '\\|')).join(' | ')} |`;
  };

  const [first, ...rest] = rows;
  const separator = `| ${Array(columnCount).fill('---').join(' | ')} |`;

  // 見出し行がない表でも Markdown として成立させるため、常に区切り行を入れる。
  return [toLine(first), separator, ...rest.map(toLine)].join('\n');
}

function renderInline(nodes = []) {
  return nodes.map((node) => renderInlineNode(node)).join('');
}

function renderInlineNode(node) {
  switch (node.type) {
    case 'text':
      return escapeText(node.text);

    case 'break':
      return '  \n';

    case 'strong':
      return `**${renderInline(node.children)}**`;

    case 'emphasis':
      return `*${renderInline(node.children)}*`;

    case 'strike':
      return `~~${renderInline(node.children)}~~`;

    case 'inlineCode':
      return `\`${node.text.replace(/`/g, '')}\``;

    case 'link':
      return `[${renderInline(node.children)}](${encodeTarget(node.path || node.href)})`;

    default:
      return '';
  }
}

/**
 * Markdown の構文文字をエスケープする。
 * 日本語本文を読みにくくしないよう、誤解釈されやすい文字だけに絞っている。
 */
function escapeText(text) {
  return String(text).replace(/([\\`*_[\]])/g, '\\$1');
}

function encodeTarget(url) {
  const value = String(url ?? '');

  // 丸括弧はリンク記法を壊すのでエンコードする。
  return value.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/ /g, '%20');
}

function stripTrailingNewline(text) {
  return String(text ?? '').replace(/\n+$/, '');
}
