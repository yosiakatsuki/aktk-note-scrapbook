import { describe, expect, it } from 'vitest';

import { renderMarkdown } from '../src/lib/markdown.js';

const text = (value) => ({ type: 'text', text: value });

function render(blocks, meta = {}) {
  return renderMarkdown({ title: 'タイトル', blocks, ...meta });
}

describe('renderMarkdown', () => {
  it('front matter と記事タイトルを先頭に置く', () => {
    const markdown = renderMarkdown({
      title: '記事の "タイトル"',
      author: '著者',
      publishedAt: '2024-01-01T00:00:00+09:00',
      url: 'https://note.com/user/n/nabc',
      savedAt: '2024-02-01T00:00:00.000Z',
      blocks: [],
    });

    expect(markdown).toContain('title: "記事の \\"タイトル\\""');
    expect(markdown).toContain('author: "著者"');
    expect(markdown).toContain('published: "2024-01-01T00:00:00+09:00"');
    expect(markdown).toContain('source: "https://note.com/user/n/nabc"');
    expect(markdown).toContain('saved: "2024-02-01T00:00:00.000Z"');
    expect(markdown).toContain('# 記事の "タイトル"');
  });

  it('値が空の front matter 項目は出力しない', () => {
    expect(render([])).not.toContain('author:');
  });

  it('見出しは記事タイトルの下に入るよう 1 段下げる', () => {
    expect(render([{ type: 'heading', level: 2, inline: [text('見出し')] }])).toContain(
      '### 見出し'
    );
  });

  it('装飾つきの段落を変換する', () => {
    const markdown = render([
      {
        type: 'paragraph',
        inline: [
          text('これは '),
          { type: 'strong', children: [text('強調')] },
          text(' と '),
          { type: 'emphasis', children: [text('斜体')] },
          text(' と '),
          { type: 'link', href: 'https://example.com/', children: [text('リンク')] },
        ],
      },
    ]);

    expect(markdown).toContain('これは **強調** と *斜体* と [リンク](https://example.com/)');
  });

  it('br は行末 2 スペースの改行にする', () => {
    const markdown = render([
      { type: 'paragraph', inline: [text('1 行目'), { type: 'break' }, text('2 行目')] },
    ]);

    expect(markdown).toContain('1 行目  \n2 行目');
  });

  it('保存済み画像はローカルパスを、失敗した画像は元 URL を参照する', () => {
    const markdown = render([
      { type: 'image', src: 'https://example.com/a.png', alt: '図', path: 'images/001.png' },
      { type: 'image', src: 'https://example.com/b.png', alt: '' },
    ]);

    expect(markdown).toContain('![図](images/001.png)');
    expect(markdown).toContain('![](https://example.com/b.png)');
  });

  it('画像キャプションを画像の下に添える', () => {
    const markdown = render([
      { type: 'image', src: 'a.png', alt: '', caption: '説明文', path: 'images/001.png' },
    ]);

    expect(markdown).toContain('![](images/001.png)\n\n*説明文*');
  });

  it('リストを変換する', () => {
    const item = (value) => [{ type: 'paragraph', inline: [text(value)] }];

    expect(render([{ type: 'list', ordered: false, items: [item('あ'), item('い')] }])).toContain(
      '- あ\n- い'
    );
    expect(render([{ type: 'list', ordered: true, items: [item('あ'), item('い')] }])).toContain(
      '1. あ\n2. い'
    );
  });

  it('引用は各行に > を付ける', () => {
    const markdown = render([
      {
        type: 'quote',
        blocks: [
          { type: 'paragraph', inline: [text('引用 1')] },
          { type: 'paragraph', inline: [text('引用 2')] },
        ],
      },
    ]);

    expect(markdown).toContain('> 引用 1\n>\n> 引用 2');
  });

  it('コードブロックをフェンスで囲む', () => {
    const markdown = render([{ type: 'code', lang: 'js', text: "const a = 1;\n" }]);

    expect(markdown).toContain('```js\nconst a = 1;\n```');
  });

  it('表を変換する', () => {
    const markdown = render([
      {
        type: 'table',
        hasHeader: true,
        rows: [
          [[text('見出し A')], [text('見出し B')]],
          [[text('値 1')], [text('値 2')]],
        ],
      },
    ]);

    expect(markdown).toContain('| 見出し A | 見出し B |\n| --- | --- |\n| 値 1 | 値 2 |');
  });

  it('Markdown 記法として誤解釈される文字をエスケープする', () => {
    expect(render([{ type: 'paragraph', inline: [text('*強調ではない* [括弧]')] }])).toContain(
      '\\*強調ではない\\* \\[括弧\\]'
    );
  });

  it('保存済みの添付ファイルはローカルパスを参照する', () => {
    const markdown = render([
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

    expect(markdown).toContain('[配布データ](files/a.zip)');
    expect(markdown).toContain('[資料](files/b.pdf)');
  });

  it('取得できなかった添付ファイルは元の URL を残す', () => {
    const markdown = render([
      { type: 'embed', url: 'https://note.com/files/a.zip', label: 'a.zip', isFile: true },
    ]);

    expect(markdown).toContain('[a.zip](https://note.com/files/a.zip)');
  });

  it('埋め込みはリンクとして残す', () => {
    const markdown = render([
      { type: 'embed', url: 'https://youtu.be/abc', label: '動画タイトル' },
    ]);

    expect(markdown).toContain('[動画タイトル](https://youtu.be/abc)');
  });
});
