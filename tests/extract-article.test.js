import { describe, expect, it } from 'vitest';

import {
  extractArticle,
  extractBlocks,
  prepareArticlePage,
} from '../src/content/extract-article.js';

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

describe('添付ファイルの検出', () => {
  it('拡張子が既知のファイルの figure は isFile を立てる', () => {
    expect(
      blocksOf('<figure><a href="https://note.com/files/sample.zip">配布データ</a></figure>')
    ).toEqual([
      {
        type: 'embed',
        url: 'https://note.com/files/sample.zip',
        label: '配布データ',
        isFile: true,
      },
    ]);
  });

  it('拡張子がなくても embedded-service が file なら isFile を立てる', () => {
    const [block] = blocksOf(
      '<figure embedded-service="file"><a href="https://note.com/api/v1/attachments/123/download">配布データ</a></figure>'
    );

    expect(block.isFile).toBe(true);
  });

  it('download 属性が付いたリンクも添付ファイルとみなす', () => {
    const [block] = blocksOf('<p><a href="https://note.com/dl/xyz" download>ダウンロード</a></p>');

    expect(block.inline[0].isFile).toBe(true);
  });

  it('本文中のリンクでも拡張子で判定する', () => {
    const [block] = blocksOf('<p>資料は<a href="https://note.com/files/a.pdf">こちら</a></p>');

    expect(block.inline[1]).toMatchObject({ type: 'link', isFile: true });
  });

  it('画像や普通のリンクには isFile を付けない', () => {
    const [paragraph] = blocksOf('<p><a href="https://example.com/page">記事</a></p>');
    const [embed] = blocksOf(
      '<figure embedded-service="youtube"><iframe src="https://youtube.com/embed/x"></iframe></figure>'
    );

    expect(paragraph.inline[0].isFile).toBeUndefined();
    expect(embed.isFile).toBeUndefined();
  });

  it('大文字の拡張子も判定する', () => {
    const [block] = blocksOf('<p><a href="https://note.com/files/A.ZIP">DL</a></p>');

    expect(block.inline[0].isFile).toBe(true);
  });
});

describe('保存前のページ準備', () => {
  it('画像と添付ファイルを数え、左上ナビゲーションを挿入する', () => {
    const doc = makeDocument(`
      <figure><img src="https://assets.st-note.com/img/a.png" alt="画像"></figure>
      <p><a href="https://note.com/files/a.zip">配布データ</a></p>
    `);

    expect(prepareArticlePage(doc)).toEqual({ imageCount: 1, fileCount: 1 });
    expect(doc.body.style.position).toBe('relative');
    expect(doc.querySelectorAll('.download-navigation')).toHaveLength(1);
    expect(doc.querySelector('.download-navigation a')?.getAttribute('href')).toBe(
      '#note-scrapbook-download-1'
    );
    expect(doc.getElementById('note-scrapbook-download-1')?.textContent).toBe('配布データ');
  });

  it('再解析してもナビゲーションと移動先IDを重複させない', () => {
    const doc = makeDocument(
      '<p><a id="original-file" href="https://note.com/files/a.zip">配布データ</a></p>'
    );

    prepareArticlePage(doc);
    prepareArticlePage(doc);

    expect(doc.querySelectorAll('.download-navigation')).toHaveLength(1);
    expect(doc.querySelectorAll('#note-scrapbook-download-1')).toHaveLength(1);
    expect(
      doc.getElementById('note-scrapbook-download-1')?.getAttribute(
        'data-note-scrapbook-original-id'
      )
    ).toBe('original-file');
  });

  it('拡張子のない添付埋め込みもナビゲーションへ追加する', () => {
    const doc = makeDocument(`
      <figure embedded-service="file">
        <a href="https://note.com/api/v1/attachments/123/download">限定資料</a>
      </figure>
    `);

    expect(prepareArticlePage(doc)).toEqual({ imageCount: 0, fileCount: 1 });
    expect(doc.querySelector('.download-navigation a')?.textContent).toBe('限定資料');
    expect(doc.getElementById('note-scrapbook-download-1')?.getAttribute('href')).toBe(
      'https://note.com/api/v1/attachments/123/download'
    );
  });

  it('添付ファイルがなければナビゲーションを挿入しない', () => {
    const doc = makeDocument('<p><a href="https://example.com/page">通常リンク</a></p>');

    expect(prepareArticlePage(doc)).toEqual({ imageCount: 0, fileCount: 0 });
    expect(doc.querySelector('.download-navigation')).toBeNull();
  });
});
