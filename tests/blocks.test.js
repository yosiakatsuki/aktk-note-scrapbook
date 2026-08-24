import { describe, expect, it } from 'vitest';

import { collectFileNodes, collectImageBlocks } from '../src/lib/blocks.js';

describe('collectImageBlocks', () => {
  it('本文の登場順に画像を集める', () => {
    const blocks = [
      { type: 'image', src: 'a.png' },
      { type: 'paragraph', inline: [] },
      { type: 'image', src: 'b.png' },
    ];

    expect(collectImageBlocks(blocks).map((block) => block.src)).toEqual(['a.png', 'b.png']);
  });

  it('引用とリストの入れ子も辿る', () => {
    const blocks = [
      { type: 'quote', blocks: [{ type: 'image', src: 'quoted.png' }] },
      { type: 'list', ordered: false, items: [[{ type: 'image', src: 'listed.png' }]] },
    ];

    expect(collectImageBlocks(blocks).map((block) => block.src)).toEqual([
      'quoted.png',
      'listed.png',
    ]);
  });

  it('元オブジェクトの参照を返すので path を書き戻せる', () => {
    const image = { type: 'image', src: 'a.png' };
    collectImageBlocks([image])[0].path = 'images/001.png';

    expect(image.path).toBe('images/001.png');
  });
});

describe('collectFileNodes', () => {
  const link = (href, isFile) => ({
    type: 'link',
    href,
    children: [{ type: 'text', text: 'リンク' }],
    ...(isFile ? { isFile: true } : {}),
  });

  it('印の付いた embed ブロックだけを集める', () => {
    const blocks = [
      { type: 'embed', url: 'https://example.com/a.zip', label: 'a.zip', isFile: true },
      { type: 'embed', url: 'https://youtu.be/x', label: '動画' },
    ];

    expect(collectFileNodes(blocks).map((node) => node.url)).toEqual([
      'https://example.com/a.zip',
    ]);
  });

  it('段落の中のリンクも集める', () => {
    const blocks = [
      {
        type: 'paragraph',
        inline: [link('https://example.com/b.zip', true), link('https://example.com/', false)],
      },
    ];

    expect(collectFileNodes(blocks).map((node) => node.href)).toEqual([
      'https://example.com/b.zip',
    ]);
  });

  it('装飾の入れ子の中のリンクも辿る', () => {
    const blocks = [
      {
        type: 'paragraph',
        inline: [{ type: 'strong', children: [link('https://example.com/c.zip', true)] }],
      },
    ];

    expect(collectFileNodes(blocks)).toHaveLength(1);
  });

  it('引用・リスト・表の中も辿る', () => {
    const blocks = [
      {
        type: 'quote',
        blocks: [{ type: 'paragraph', inline: [link('https://example.com/q.zip', true)] }],
      },
      {
        type: 'list',
        ordered: false,
        items: [[{ type: 'paragraph', inline: [link('https://example.com/l.zip', true)] }]],
      },
      { type: 'table', hasHeader: false, rows: [[[link('https://example.com/t.zip', true)]]] },
    ];

    expect(collectFileNodes(blocks).map((node) => node.href)).toEqual([
      'https://example.com/q.zip',
      'https://example.com/l.zip',
      'https://example.com/t.zip',
    ]);
  });

  it('元オブジェクトの参照を返すので path を書き戻せる', () => {
    const node = { type: 'embed', url: 'https://example.com/a.zip', isFile: true };
    collectFileNodes([node])[0].path = 'files/a.zip';

    expect(node.path).toBe('files/a.zip');
  });
});
