/**
 * 保存先フォルダのハンドルを永続化する。
 *
 * FileSystemDirectoryHandle は構造化複製できるので IndexedDB にそのまま入る。
 * chrome.storage は構造化複製に対応していないため使えない。
 * ポップアップ・設定ページ・service worker のどこからでも読める。
 */

const DB_NAME = 'note-scrapbook';
const DB_VERSION = 1;
const STORE_NAME = 'settings';
const DIRECTORY_KEY = 'save-directory';

/**
 * 保存先フォルダのハンドルを取り出す。未設定なら null。
 *
 * @return {Promise<FileSystemDirectoryHandle|null>}
 */
export async function loadSaveDirectory() {
  const db = await openDatabase();

  try {
    return (await request(transactionStore(db, 'readonly').get(DIRECTORY_KEY))) ?? null;
  } finally {
    db.close();
  }
}

/**
 * 保存先フォルダのハンドルを記録する。
 *
 * @param {FileSystemDirectoryHandle} handle 設定ページで選ばれたフォルダ。
 */
export async function saveSaveDirectory(handle) {
  const db = await openDatabase();

  try {
    await request(transactionStore(db, 'readwrite').put(handle, DIRECTORY_KEY));
  } finally {
    db.close();
  }
}

function openDatabase() {
  const openRequest = indexedDB.open(DB_NAME, DB_VERSION);

  openRequest.onupgradeneeded = () => {
    openRequest.result.createObjectStore(STORE_NAME);
  };

  return request(openRequest);
}

function transactionStore(db, mode) {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

function request(idbRequest) {
  return new Promise((resolve, reject) => {
    idbRequest.onsuccess = () => resolve(idbRequest.result);
    idbRequest.onerror = () => reject(idbRequest.error);
  });
}
