# 開発ガイド

AI エージェント（Codex / Claude Code）と人間の双方が読む、このリポジトリの開発ガイドです。
メインの開発環境は Codex を想定しています。

拡張の使い方・保存されるファイルの構成は [README.md](README.md)、仕様の詳細と設計判断の理由は [docs/spec.md](docs/spec.md) にあります。ここには開発時の情報だけを書きます。

## セットアップとコマンド

```sh
npm install     # 依存はテスト用のみ。ビルドは不要
npm test        # vitest を 1 回実行
npm run test:watch
```

拡張本体はバンドルせず、素の ES モジュールのまま `chrome://extensions` から読み込みます。
コードを変更したら拡張機能ページの再読み込みボタンを押してください。

## ディレクトリ構成

```
manifest.json              MV3 マニフェスト
src/
├── background.js          service worker。保存処理の司令塔
├── content/
│   ├── attachment-nav.js  添付ファイルへのページ内ナビ。自動で読み込まれる content script
│   ├── bootstrap.js       executeScript の注入先。extract-article.js を動的 import する
│   └── extract-article.js DOM → 中間表現の抽出。note の DOM 依存はここに閉じる
├── lib/
│   ├── blocks.js          中間表現の走査ヘルパー
│   ├── data-url.js        chrome.downloads に渡す data: URL の生成
│   ├── filename.js        フォルダ名・ファイル名のサニタイズ
│   ├── html.js            中間表現 → 確認用 HTML
│   └── markdown.js        中間表現 → Markdown
└── popup/                 ポップアップ UI
tests/                     vitest（jsdom 環境）
```

## 設計上の約束

- **note の DOM 依存は `src/content/extract-article.js` に閉じる。** 他のファイルは中間表現（[docs/spec.md](docs/spec.md) 参照）しか知らない。note の DOM が変わったときの修正範囲をこのファイルだけに保つため
- **`src/lib/` は拡張 API に触れない純粋な関数にする。** そのままユニットテストできる状態を保つ
- **セレクタは決め打ちにせず、フォールバックの配列で持つ。** note の DOM は予告なく変わる
- **出力は自己完結させる。** 確認用 HTML から外部のスクリプト・フォント・CSS を参照しない
- **添付ファイルは `fetch` せず `chrome.downloads` に URL を渡す。** 会員向けファイルの取得にブラウザのクッキーが要るため（理由は [docs/spec.md](docs/spec.md) 参照）

## コードスタイル

Linter は入れていません。既存のコードに揃えてください。

- インデントは半角スペース 2、シングルクォート、セミコロンあり
- コメントは日本語で、「なぜそうしているか」を書く。処理の言い換えは書かない
- 早期 return を優先し、ネストを浅く保つ

## テスト

`tests/` に vitest のテストを置いています。jsdom 環境なので `DOMParser` が使えます。

- `src/lib/` の変換ロジックと `extract-article.js` の抽出ロジックはテストで守る
- `background.js` / `popup/` / `content/attachment-nav.js` は Chrome の API や実ページの DOM に依存するためテスト対象外。手動で確認する

### 手動確認の手順

1. `chrome://extensions` で拡張を再読み込みする
2. note の記事を開いて保存する
3. 保存されたフォルダの `index.html` を Finder からダブルクリックし、画像が表示されるか確認する
4. `article.md` をエディタで開き、本文構造が保たれているか確認する
5. 添付ファイルのある記事なら、`files/` に保存され `index.html` のリンクから開けるか確認する
6. 添付ファイルのある記事で、右下のナビからダウンロードボタンへジャンプできるか確認する

うまくいかないときは、拡張機能ページの「Service Worker」リンクから開く DevTools にログが出ます。
