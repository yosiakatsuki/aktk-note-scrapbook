import { describe, expect, it } from 'vitest';

import { attachmentFileName, imageFileName, sanitizeSegment } from '../src/lib/filename.js';

describe('sanitizeSegment', () => {
  it('日本語とスペースはそのまま残す', () => {
    expect(sanitizeSegment('はじめての note 記事')).toBe('はじめての note 記事');
  });

  it('パス区切りや使えない記号を除く', () => {
    expect(sanitizeSegment('2024/01/01 のメモ: 前編?')).toBe('2024 01 01 のメモ 前編');
  });

  it('連続する空白をまとめる', () => {
    expect(sanitizeSegment('  タイトル   です  ')).toBe('タイトル です');
  });

  it('先頭・末尾のドットを落とす', () => {
    expect(sanitizeSegment('...隠しファイル...')).toBe('隠しファイル');
  });

  it('最大文字数で切り詰める', () => {
    expect(sanitizeSegment('あ'.repeat(200))).toHaveLength(80);
    expect(sanitizeSegment('あ'.repeat(200), { maxLength: 10 })).toBe('あ'.repeat(10));
  });

  it('空になったら代替名を返す', () => {
    expect(sanitizeSegment('///')).toBe('note-article');
    expect(sanitizeSegment('', { fallback: 'untitled' })).toBe('untitled');
    expect(sanitizeSegment(null)).toBe('note-article');
  });

  it('Windows の予約名は代替名にする', () => {
    expect(sanitizeSegment('CON')).toBe('note-article');
  });
});

describe('imageFileName', () => {
  it('Content-Type から拡張子を決める', () => {
    expect(imageFileName(1, { contentType: 'image/png' })).toBe('001.png');
    expect(imageFileName(12, { contentType: 'image/jpeg; charset=binary' })).toBe('012.jpg');
  });

  it('Content-Type がなければ URL の拡張子を使う', () => {
    expect(imageFileName(2, { url: 'https://assets.st-note.com/img/a.webp?width=800' })).toBe(
      '002.webp'
    );
  });

  it('判断できなければ img にする', () => {
    expect(imageFileName(3, { url: 'https://example.com/image', contentType: 'text/html' })).toBe(
      '003.img'
    );
  });
});

describe('attachmentFileName', () => {
  it('URL の末尾をファイル名に使う', () => {
    expect(attachmentFileName('https://note.com/files/sample.zip')).toBe('sample.zip');
  });

  it('パーセントエンコードされた日本語名を戻す', () => {
    expect(attachmentFileName('https://note.com/files/%E8%B3%87%E6%96%99.zip')).toBe('資料.zip');
  });

  it('クエリはファイル名に含めない', () => {
    expect(attachmentFileName('https://note.com/files/a.zip?token=xyz')).toBe('a.zip');
  });

  it('使えない文字を落とす', () => {
    expect(attachmentFileName('https://note.com/files/a%2Fb%3Ac.zip')).toBe('a b c.zip');
  });

  it('名前が取れなければ連番にする', () => {
    expect(attachmentFileName('https://note.com/files/', 3)).toBe('file-003');
    expect(attachmentFileName('not a url', 1)).toBe('file-001');
  });
});
