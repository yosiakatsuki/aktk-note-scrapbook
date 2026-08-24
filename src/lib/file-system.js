/**
 * File System Access API 越しの読み書きをまとめる。
 *
 * chrome.downloads を使わないので、ブラウザの
 * 「ダウンロード前に各ファイルの保存場所を確認する」設定に影響されず、
 * 保存ダイアログも出ない。
 */

const READWRITE = { mode: 'readwrite' };

/**
 * 書き込み権限があるかを確かめる。
 *
 * @param {FileSystemDirectoryHandle} handle 対象フォルダ。
 * @return {Promise<boolean>}
 */
export async function hasWritePermission(handle) {
  return (await handle.queryPermission(READWRITE)) === 'granted';
}

/**
 * 書き込み権限を要求する。ユーザー操作の中からしか呼べない。
 *
 * @param {FileSystemDirectoryHandle} handle 対象フォルダ。
 * @return {Promise<boolean>} 許可されたら true。
 */
export async function requestWritePermission(handle) {
  if (await hasWritePermission(handle)) {
    return true;
  }

  return (await handle.requestPermission(READWRITE)) === 'granted';
}

/**
 * 子フォルダを取得する。なければ作る。
 *
 * @param {FileSystemDirectoryHandle} parent 親フォルダ。
 * @param {string}                    name   フォルダ名。
 * @return {Promise<FileSystemDirectoryHandle>}
 */
export function ensureDirectory(parent, name) {
  return parent.getDirectoryHandle(name, { create: true });
}

/**
 * ファイルを書き出す。既にあれば中身を置き換える。
 *
 * @param {FileSystemDirectoryHandle}         directory 書き込み先フォルダ。
 * @param {string}                            name      ファイル名。
 * @param {string|BufferSource|Blob}          contents  中身。
 */
export async function writeFile(directory, name, contents) {
  const fileHandle = await directory.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();

  try {
    await writable.write(contents);
  } catch (error) {
    await writable.abort();
    throw error;
  }

  await writable.close();
}
