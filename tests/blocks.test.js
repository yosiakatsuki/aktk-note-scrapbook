import { describe, expect, it } from 'vitest';

import { collectImageBlocks } from '../src/lib/blocks.js';

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
