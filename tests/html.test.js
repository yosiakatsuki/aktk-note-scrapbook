import { describe, expect, it } from 'vitest';

import { renderHtml } from '../src/lib/html.js';

const text = (value) => ({ type: 'text', text: value });

function render(blocks, meta = {}) {
  return renderHtml({ title: 'タイトル', blocks, ...meta });
}

describe('renderHtml', () => {
  it('外部リソースを参照しない自己完結の HTML を返す', () => {
    const html = render([{ type: 'paragraph', inline: [text('本文')] }]);

    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<style>');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link[^>]+href=/i);
  });

  it('背景は白で固定し、OS のダークモードに追従しない', () => {
    const html = render([]);

    expect(html).toContain('color-scheme: light;');
    expect(html).toContain('background: #ffffff;');
    expect(html).not.toContain('color-scheme: light dark');
    expect(html).not.toContain('prefers-color-scheme');
  });

  it('コードブロックはグレー背景で、横スクロールせずに折り返す', () => {
    const html = render([{ type: 'code', lang: '', text: 'const a = 1;' }]);
    const preStyle = html.slice(html.indexOf('pre {'), html.indexOf('}', html.indexOf('pre {')));

    expect(preStyle).toContain('background: #f2f2f2;');
    expect(preStyle).toContain('white-space: pre-wrap;');
    expect(preStyle).not.toContain('overflow-x');
  });

  it('タイトルとメタ情報をヘッダーに出す', () => {
    const html = render([], {
      author: '著者',
      publishedAt: '2024-01-01T00:00:00Z',
      url: 'https://note.com/user/n/nabc',
    });

    expect(html).toContain('<title>タイトル</title>');
    expect(html).toContain('<h1>タイトル</h1>');
    expect(html).toContain('著者');
    expect(html).toContain('<a href="https://note.com/user/n/nabc">');
  });

  it('見出しは記事タイトルの下に入るよう 1 段下げる', () => {
    expect(render([{ type: 'heading', level: 2, inline: [text('見出し')] }])).toContain(
      '<h3>見出し</h3>'
    );
  });

  it('画像は figure と figcaption で組む', () => {
    const html = render([
      { type: 'image', src: 'https://example.com/a.png', alt: '図', caption: '説明', path: 'images/001.png' },
    ]);

    expect(html).toContain('<img src="images/001.png" alt="図">');
    expect(html).toContain('<figcaption>説明</figcaption>');
  });

  it('保存に失敗した画像は元 URL を参照する', () => {
    expect(render([{ type: 'image', src: 'https://example.com/b.png', alt: '' }])).toContain(
      '<img src="https://example.com/b.png" alt="">'
    );
  });

  it('リストが単一段落なら p を挟まない', () => {
    const html = render([
      {
        type: 'list',
        ordered: true,
        items: [[{ type: 'paragraph', inline: [text('あ')] }]],
      },
    ]);

    expect(html).toContain('<ol>\n<li>あ</li>\n</ol>');
  });

  it('見出し行つきの表を thead で組む', () => {
    const html = render([
      {
        type: 'table',
        hasHeader: true,
        rows: [
          [[text('A')], [text('B')]],
          [[text('1')], [text('2')]],
        ],
      },
    ]);

    expect(html).toContain('<thead><tr><th>A</th><th>B</th></tr></thead>');
    expect(html).toContain('<tbody><tr><td>1</td><td>2</td></tr></tbody>');
  });

  it('保存済みの添付ファイルはローカルパスを参照する', () => {
    const html = render([
      {
        type: 'embed',
        url: 'https://note.com/files/a.zip',
        label: '配布データ',
        isFile: true,
        path: 'files/a.zip',
      },
      {
        type: 'paragraph',
        inline: [
          {
            type: 'link',
            href: 'https://note.com/files/b.pdf',
            children: [text('資料')],
            isFile: true,
            path: 'files/b.pdf',
          },
        ],
      },
    ]);

    expect(html).toContain('<a href="files/a.zip">配布データ</a>');
    expect(html).toContain('href="files/b.pdf">資料</a>');
  });

  it('添付ファイルがある場合は左上の固定ナビゲーションから各箇所へ移動できる', () => {
    const html = render([
      {
        type: 'embed',
        url: 'https://note.com/files/a.zip',
        label: '配布データ',
        isFile: true,
        path: 'files/a.zip',
      },
      {
        type: 'paragraph',
        inline: [
          {
            type: 'link',
            href: 'https://note.com/files/b.pdf',
            children: [text('資料')],
            isFile: true,
            path: 'files/b.pdf',
          },
        ],
      },
    ]);

    expect(html).toContain('<body class="has-download-navigation">');
    expect(html).toContain('<nav class="download-navigation" aria-label="添付ファイルへの移動">');
    expect(html).toContain('<li><a href="#download-1">配布データ</a></li>');
    expect(html).toContain('<li><a href="#download-2">資料</a></li>');
    expect(html).toContain('id="download-1" class="embed download-target"');
    expect(html).toContain('id="download-2" class="download-target" href="files/b.pdf"');
    expect(html).toContain('position: relative;');
    expect(html).toMatch(/\.download-navigation \{[\s\S]*position: fixed;[\s\S]*top: 1rem;[\s\S]*left: 1rem;/);
  });

  it('添付ファイルがなければ固定ナビゲーションを出さない', () => {
    const html = render([{ type: 'paragraph', inline: [text('本文')] }]);

    expect(html).toContain('<body>');
    expect(html).not.toContain('class="download-navigation"');
    expect(html).not.toContain('id="download-1"');
  });

  it('取得できなかった添付ファイルは元の URL を残す', () => {
    const html = render([
      { type: 'embed', url: 'https://note.com/files/a.zip', label: 'a.zip', isFile: true },
    ]);

    expect(html).toContain('<a href="https://note.com/files/a.zip">a.zip</a>');
  });

  it('HTML 特殊文字と属性値をエスケープする', () => {
    const html = render([
      { type: 'paragraph', inline: [text('<script>alert("x")</script> & more')] },
    ]);

    expect(html).toContain('&lt;script&gt;alert("x")&lt;/script&gt; &amp; more');
    expect(html).not.toContain('<script>alert');
  });

  it('リンクの二重引用符を属性内でエスケープする', () => {
    const html = render([
      {
        type: 'paragraph',
        inline: [{ type: 'link', href: 'https://example.com/?q="x"', children: [text('リンク')] }],
      },
    ]);

    expect(html).toContain('href="https://example.com/?q=&quot;x&quot;"');
  });
});
