/**
 * ブロック配列を走査するヘルパー。
 */

/**
 * 引用やリストの入れ子も含めて、画像ブロックを本文の登場順に集める。
 *
 * 返すのは元オブジェクトの参照なので、呼び出し側で `path` を書き込むと
 * そのまま Markdown / HTML の出力に反映される。
 *
 * @param {Array<object>} blocks ブロック配列。
 * @return {Array<object>} 画像ブロックの配列。
 */
export function collectImageBlocks(blocks = []) {
  const images = [];

  for (const block of blocks) {
    if (block.type === 'image') {
      images.push(block);
      continue;
    }

    if (block.type === 'quote') {
      images.push(...collectImageBlocks(block.blocks ?? []));
      continue;
    }

    if (block.type === 'list') {
      for (const itemBlocks of block.items ?? []) {
        images.push(...collectImageBlocks(itemBlocks));
      }
    }
  }

  return images;
}
