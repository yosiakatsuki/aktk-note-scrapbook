import { describe, expect, it, vi } from 'vitest';

import {
  ensureDirectory,
  hasWritePermission,
  requestWritePermission,
  writeFile,
} from '../src/lib/file-system.js';

/**
 * File System Access API のフォルダハンドルを模したオブジェクトを作る。
 */
function fakeDirectory(options = {}) {
  const { name = 'root', permission = 'granted', writeError = null } = options;
  const state = { permission };

  const directory = {
    name,
    files: new Map(),
    children: new Map(),
    requestedModes: [],

    async queryPermission() {
      return state.permission;
    },

    async requestPermission(descriptor) {
      directory.requestedModes.push(descriptor.mode);
      state.permission = 'granted';

      return state.permission;
    },

    async getDirectoryHandle(childName, { create = false } = {}) {
      if (!directory.children.has(childName)) {
        if (!create) {
          throw new DOMException('not found', 'NotFoundError');
        }

        directory.children.set(childName, fakeDirectory({ name: childName }));
      }

      return directory.children.get(childName);
    },

    async getFileHandle(fileName, { create = false } = {}) {
      if (!directory.files.has(fileName) && !create) {
        throw new DOMException('not found', 'NotFoundError');
      }

      return {
        async createWritable() {
          return {
            closed: false,
            aborted: false,
            async write(contents) {
              if (writeError) {
                throw writeError;
              }

              directory.files.set(fileName, contents);
            },
            async close() {
              this.closed = true;
            },
            async abort() {
              directory.aborted = true;
            },
          };
        },
      };
    },
  };

  return directory;
}

describe('hasWritePermission', () => {
  it('granted のときだけ true', async () => {
    await expect(hasWritePermission(fakeDirectory({ permission: 'granted' }))).resolves.toBe(true);
    await expect(hasWritePermission(fakeDirectory({ permission: 'prompt' }))).resolves.toBe(false);
    await expect(hasWritePermission(fakeDirectory({ permission: 'denied' }))).resolves.toBe(false);
  });
});

describe('requestWritePermission', () => {
  it('既に許可されていれば要求しない', async () => {
    const directory = fakeDirectory({ permission: 'granted' });

    await expect(requestWritePermission(directory)).resolves.toBe(true);
    expect(directory.requestedModes).toEqual([]);
  });

  it('未許可なら readwrite で要求する', async () => {
    const directory = fakeDirectory({ permission: 'prompt' });

    await expect(requestWritePermission(directory)).resolves.toBe(true);
    expect(directory.requestedModes).toEqual(['readwrite']);
  });
});

describe('ensureDirectory', () => {
  it('なければ作り、あれば同じものを返す', async () => {
    const root = fakeDirectory();
    const first = await ensureDirectory(root, 'images');
    const second = await ensureDirectory(root, 'images');

    expect(first.name).toBe('images');
    expect(second).toBe(first);
    expect(root.children.size).toBe(1);
  });
});

describe('writeFile', () => {
  it('中身を書き込んで close する', async () => {
    const directory = fakeDirectory();

    await writeFile(directory, 'index.html', '<p>本文</p>');

    expect(directory.files.get('index.html')).toBe('<p>本文</p>');
  });

  it('既存のファイルは置き換える', async () => {
    const directory = fakeDirectory();

    await writeFile(directory, 'article.md', '古い');
    await writeFile(directory, 'article.md', '新しい');

    expect(directory.files.get('article.md')).toBe('新しい');
  });

  it('書き込みに失敗したら abort して例外を投げる', async () => {
    const directory = fakeDirectory({ writeError: new Error('disk full') });

    await expect(writeFile(directory, 'index.html', 'x')).rejects.toThrow('disk full');
    expect(directory.aborted).toBe(true);
  });
});
