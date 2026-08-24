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
