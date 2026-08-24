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

/**
 * 添付ファイルを指すノードを、本文の登場順に集める。
 *
 * 対象は `isFile` の印が付いた embed ブロックと link インラインの両方。
 * 画像と同じく元オブジェクトの参照を返すので、呼び出し側で `path` を書き込むと
 * そのまま Markdown / HTML の出力に反映される。
 *
 * @param {Array<object>} blocks ブロック配列。
 * @return {Array<object>} 添付ファイルノードの配列。
 */
export function collectFileNodes(blocks = []) {
  const files = [];

  for (const block of blocks) {
    switch (block.type) {
      case 'embed':
        if (block.isFile) {
          files.push(block);
        }

        break;

      case 'heading':
      case 'paragraph':
        files.push(...fileNodesInInline(block.inline ?? []));
        break;

      case 'quote':
        files.push(...collectFileNodes(block.blocks ?? []));
        break;

      case 'list':
        for (const itemBlocks of block.items ?? []) {
          files.push(...collectFileNodes(itemBlocks));
        }

        break;

      case 'table':
        for (const row of block.rows ?? []) {
          for (const cell of row) {
            files.push(...fileNodesInInline(cell));
          }
        }

        break;

      default:
        break;
    }
  }

  return files;
}

function fileNodesInInline(nodes) {
  const files = [];

  for (const node of nodes) {
    if (node.type === 'link' && node.isFile) {
      files.push(node);
    }

    if (node.children) {
      files.push(...fileNodesInInline(node.children));
    }
  }

  return files;
}
