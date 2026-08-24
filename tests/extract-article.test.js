import { describe, expect, it } from 'vitest';

import { extractArticle, extractBlocks } from '../src/content/extract-article.js';

/**
 * note の記事ページを模したドキュメントを作る。
 */
function makeDocument(bodyHtml, headHtml = '') {
  return new DOMParser().parseFromString(
    `<!DOCTYPE html><html><head>${headHtml}</head><body>
      <article>
        <h1 class="o-noteContentText__title">記事タイトル</h1>
        <div class="note-common-styles__textnote-body">${bodyHtml}</div>
      </article>
    </body></html>`,
    'text/html'
  );
}

function blocksOf(bodyHtml) {
  const doc = makeDocument(bodyHtml);

  return extractBlocks(doc.querySelector('.note-common-styles__textnote-body'), doc);
}

const LINKED_DATA = `<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'NewsArticle',
  headline: 'JSON-LD のタイトル',
  datePublished: '2024-05-01T09:00:00+09:00',
  author: { '@type': 'Person', name: 'テスト著者' },
  url: 'https://note.com/tester/n/nabc123',
})}</script>`;

describe('extractArticle', () => {
  it('JSON-LD からメタ情報を取り出す', () => {
    const article = extractArticle(makeDocument('<p>本文</p>', LINKED_DATA));

    expect(article.title).toBe('JSON-LD のタイトル');
    expect(article.author).toBe('テスト著者');
    expect(article.publishedAt).toBe('2024-05-01T09:00:00+09:00');
    expect(article.url).toBe('https://note.com/tester/n/nabc123');
  });

  it('JSON-LD がなければ h1 と meta にフォールバックする', () => {
    const article = extractArticle(
      makeDocument('<p>本文</p>', '<meta property="og:site_name" content="note">')
    );

    expect(article.title).toBe('記事タイトル');
    expect(article.author).toBe('note');
  });

  it('本文が見つからなければエラーにする', () => {
    const doc = new DOMParser().parseFromString(
      '<!DOCTYPE html><html><body><div>本文なし</div></body></html>',
      'text/html'
    );

    expect(() => extractArticle(doc)).toThrow(/記事本文が見つかりません/);
  });

  it('本文が空ならエラーにする', () => {
    expect(() => extractArticle(makeDocument('<p>   </p>'))).toThrow(/記事本文が空/);
  });
});

describe('extractBlocks', () => {
  it('段落と見出しを取り出す', () => {
    expect(blocksOf('<h2>見出し</h2><p>本文です</p>')).toEqual([
      { type: 'heading', level: 2, inline: [{ type: 'text', text: '見出し' }] },
      { type: 'paragraph', inline: [{ type: 'text', text: '本文です' }] },
    ]);
  });

  it('空の段落は捨てる', () => {
    expect(blocksOf('<p>  </p><p><br></p><p>本文</p>')).toHaveLength(1);
  });

  it('装飾とリンクをインラインとして保つ', () => {
    const [block] = blocksOf('<p><strong>太字</strong>と<a href="/other">リンク</a></p>');

    expect(block.inline[0]).toEqual({
      type: 'strong',
      children: [{ type: 'text', text: '太字' }],
    });
    expect(block.inline[2].type).toBe('link');
    expect(block.inline[2].href).toMatch(/\/other$/);
  });

  it('href のないリンクは中身だけ残す', () => {
    const [block] = blocksOf('<p><a>ただの文字</a></p>');

    expect(block.inline).toEqual([{ type: 'text', text: 'ただの文字' }]);
  });

  it('figure から画像とキャプションを取り出す', () => {
    expect(
      blocksOf(
        '<figure><img src="https://assets.st-note.com/img/a.png" alt="代替"><figcaption>説明</figcaption></figure>'
      )
    ).toEqual([
      {
        type: 'image',
        src: 'https://assets.st-note.com/img/a.png',
        alt: '代替',
        caption: '説明',
      },
    ]);
  });

  it('srcset があれば最大幅の画像を選ぶ', () => {
    const [block] = blocksOf(
      '<figure><img src="https://example.com/small.png" srcset="https://example.com/small.png 320w, https://example.com/large.png 1280w"></figure>'
    );

    expect(block.src).toBe('https://example.com/large.png');
  });

  it('遅延読み込みの data-src を拾う', () => {
    const [block] = blocksOf('<figure><img data-src="https://example.com/lazy.png"></figure>');

    expect(block.src).toBe('https://example.com/lazy.png');
  });

  it('画像を含まない figure は埋め込みリンクにする', () => {
    expect(
      blocksOf('<figure embedded-service="youtube"><iframe src="https://youtube.com/embed/x"></iframe></figure>')
    ).toEqual([{ type: 'embed', url: 'https://youtube.com/embed/x', label: 'https://youtube.com/embed/x' }]);
  });

  it('リストを items の配列にする', () => {
    const [block] = blocksOf('<ul><li>あ</li><li>い</li></ul>');

    expect(block.type).toBe('list');
    expect(block.ordered).toBe(false);
    expect(block.items).toHaveLength(2);
    expect(block.items[0][0].inline).toEqual([{ type: 'text', text: 'あ' }]);
  });

  it('引用の中身も再帰的に処理する', () => {
    const [block] = blocksOf('<blockquote><p>引用文</p></blockquote>');

    expect(block.type).toBe('quote');
    expect(block.blocks[0]).toEqual({
      type: 'paragraph',
      inline: [{ type: 'text', text: '引用文' }],
    });
  });

  it('pre から言語つきコードブロックを作る', () => {
    const [block] = blocksOf('<pre><code class="language-js">const a = 1;</code></pre>');

    expect(block).toEqual({ type: 'code', lang: 'js', text: 'const a = 1;' });
  });

  it('表を rows の配列にする', () => {
    const [block] = blocksOf(
      '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>'
    );

    expect(block.type).toBe('table');
    expect(block.hasHeader).toBe(true);
    expect(block.rows).toHaveLength(2);
  });

  it('hr を区切りにする', () => {
    expect(blocksOf('<hr>')).toEqual([{ type: 'divider' }]);
  });

  it('script やシェアボタンなどのノイズを除く', () => {
    expect(
      blocksOf('<script>alert(1)</script><button>シェア</button><p>本文</p>')
    ).toEqual([{ type: 'paragraph', inline: [{ type: 'text', text: '本文' }] }]);
  });

  it('javascript: のリンクは無視する', () => {
    const [block] = blocksOf('<p><a href="javascript:alert(1)">危険</a></p>');

    expect(block.inline).toEqual([{ type: 'text', text: '危険' }]);
  });

  it('元の DOM を書き換えない', () => {
    const doc = makeDocument('<script>alert(1)</script><p>本文</p>');
    const root = doc.querySelector('.note-common-styles__textnote-body');

    extractBlocks(root, doc);

    expect(root.querySelector('script')).not.toBeNull();
  });
});
