/**
 * 設定ページ。保存先フォルダの選択だけを担当する。
 *
 * フォルダ選択はポップアップではなくこのページで行う。
 * ポップアップはフォーカスを失うと閉じるため、
 * フォルダ選択ダイアログを開いた時点で処理が中断してしまう。
 */

import { requestWritePermission } from '../lib/file-system.js';
import { loadSaveDirectory, saveSaveDirectory } from '../lib/storage.js';

const currentLabel = document.getElementById('current');
const chooseButton = document.getElementById('choose');
const statusLabel = document.getElementById('status');

const savedHandle = await loadSaveDirectory();

if (savedHandle) {
  currentLabel.textContent = savedHandle.name;
}

chooseButton.addEventListener('click', async () => {
  setStatus('');

  let handle;

  try {
    handle = await showDirectoryPicker({ mode: 'readwrite', startIn: 'documents' });
  } catch (error) {
    // ユーザーがキャンセルした場合も例外になるので、その場合は何も言わない。
    if (error?.name !== 'AbortError') {
      setStatus(error?.message ?? String(error), true);
    }

    return;
  }

  if (!(await requestWritePermission(handle))) {
    setStatus('このフォルダへの書き込みが許可されませんでした。', true);
    return;
  }

  await saveSaveDirectory(handle);

  currentLabel.textContent = handle.name;
  setStatus('保存先を設定しました。');
});

function setStatus(message, isError = false) {
  statusLabel.textContent = message;
  statusLabel.classList.toggle('error', isError);
}
