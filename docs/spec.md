# 仕様

保存されるファイルの構成と使い方は [README.md](../README.md)、開発の進め方は [AGENTS.md](../AGENTS.md) にあります。
ここには、実装の判断が必要になったときに立ち返る仕様と、その判断理由を書きます。

## 決定事項とその理由

### HTML と Markdown を両方出す

issue では「本文を Markdown で保存し、確認用に HTML を用意する」案と「最初から HTML だけにする」案が挙がっていました。結論として **両方を出力** します。

判断の前提は、確認用 HTML が Markdown を読み込めるかどうかでした。`file:///` で開いたページから `fetch()` や `XMLHttpRequest` でローカルファイルを読むことは、Chrome のセキュリティ制約（`file://` のオリジンは `null` として扱われる）でできません。つまり「Markdown 1 本＋それを描画する HTML」は成立しません。

一方で Markdown を捨てると、後から編集したり他のツールに取り込んだりする用途が失われます。ファイルを 2 つ持つコストは小さいので、役割を分けます。

- `index.html` … 読むためのもの。単体で完結し、ダブルクリックで開ける
- `article.md` … 残すためのもの。テキストとして扱いやすい

どちらも `images/` を相対パスで参照するため、フォルダ単位でのポータビリティは保たれます。

### 保存先はダウンロードフォルダ配下に固定する

`<ダウンロード>/note-scrapbook/<公開日YYYYMMDD>_<記事タイトル>/` に固定し、`chrome.downloads` API に `saveAs: false` を渡して保存先を尋ねずに書き出します。公開日を取得できない場合は、記事タイトルだけをフォルダ名に使います。`chrome.downloads` はダウンロードフォルダの外に書き込めないため、保存先は選べません。

### File System Access API は使えない

保存先を自由に選び、ブラウザの設定に関係なくダイアログを出さない方式として File System Access API を検討し、一度実装しましたが**動きませんでした**。`showDirectoryPicker()` は Web ページ（`https://`）にしか公開されておらず、拡張のページ（`chrome-extension://`）では `undefined` になります。設定ページから呼ぶと `showDirectoryPicker is not defined` で失敗します。

content script なら Web ページのコンテキストで呼べますが、得られた `FileSystemDirectoryHandle` を拡張側へ渡す手段がありません（`chrome.runtime.sendMessage` は構造化複製ではなく JSON 相当のシリアライズのため）。

したがって、拡張からディスクに書く方法は `chrome.downloads` だけです。再検討しないでください。

### 保存ダイアログはブラウザ設定に依存する

`saveAs: false` を指定しても、ブラウザ本体の設定「ダウンロード前に各ファイルの保存場所を確認する」（`chrome://settings/downloads`）のほうが優先されます。この設定がオンだと、1 記事の保存で「画像 N 枚 + HTML + Markdown」の N+2 回ダイアログが出ます。

拡張側では抑止できないため、README で設定をオフにするよう案内しています。

### 同名フォルダは上書きする

`conflictAction: 'overwrite'` を指定しています。指定しない場合、同じ記事を保存し直すと `index (1).html` のようなファイルが同じフォルダに増えていきます。フォルダ単位では分かれないため、かえって扱いにくくなります。

同名タイトルの別記事を保存すると上書きされますが、自分用ツールとして許容します。

### data: URL でダウンロードする

MV3 の service worker では `URL.createObjectURL()` が使えません。取得した画像と生成したテキストは data: URL に変換して `chrome.downloads.download` に渡します。

### 添付ファイルは URL をそのまま chrome.downloads に渡す

本文に zip などの添付ファイルリンクがあれば `files/` に保存し、本文の参照をローカルパスへ差し替えます。

会員向けページの配布ファイルでも取得できます。`chrome.downloads.download` はブラウザ自身のネットワークスタックで取得するため、ログイン中のクッキーが付き、ユーザーがリンクをクリックしたときと同じ扱いになるからです。拡張から `fetch` すると拡張のオリジンからの送信になりクッキーが付かないので、画像と同じ方法は使えません。

対象の判定は、note の DOM が読めない場合にも当たるよう多段にしています。

- `download` 属性の付いたリンク
- URL の拡張子が既知のもの（`DOWNLOADABLE_EXTENSIONS`）
- `figure` の `embedded-service` が file / attachment / download を含むもの

拡張機能のポップアップを開いた時点で本文を事前解析し、画像数と添付ファイル数をポップアップへ表示します。添付ファイルがある場合は、保存を始める前にnoteページの`body`直下へ固定ナビゲーションを挿入し、本文中の添付リンクへ移動できるようにします。ナビゲーションはページ左上に固定し、再解析時には既存要素を置き換えて重複させません。

保存名は連番ではなく URL の末尾を使います。画像と違い、名前そのものに意味があるためです。同じフォルダで名前がぶつかる場合だけ連番を足します。

ダウンロードの完了は `chrome.downloads.onChanged` で待ちますが、大きなファイルで保存処理が終わらなくなるのを避けるため 30 秒で切り上げます。切り上げてもダウンロードはブラウザ側で続き、指定した場所に保存されるので、参照の差し替えはそのまま残し、結果に「継続中」として件数を出します。

### 画像は service worker 側で取得する

content script から画像を `fetch` すると、note のドメインをまたぐため CORS で失敗します。service worker からの `fetch` は `host_permissions` に基づいて実行されるので、`assets.st-note.com` の画像を取得できます。

取得に失敗した画像は、本文の参照を元の URL のまま残します。オフラインでは表示されませんが、リンクとしては辿れる状態を保つためです。

## 中間表現

`src/content/extract-article.js` が DOM から組み立て、`src/lib/markdown.js` と `src/lib/html.js` が受け取るデータ構造です。ここが note の DOM と出力フォーマットの間の境界になります。

### 記事

```js
{
  title: string,        // 記事タイトル
  author: string,       // 著者名
  publishedAt: string,  // 公開日時（ISO 8601 文字列）
  url: string,          // 元記事の URL
  savedAt: string,      // 保存日時（background.js が付与）
  blocks: Block[],      // 本文
}
```

メタ情報は JSON-LD（`script[type="application/ld+json"]` の `Article` 系）を第一の情報源とし、取れないときに `h1` や OGP へフォールバックします。JSON-LD は表示用の DOM より構造が安定しているためです。

### ブロック

| type | フィールド | 備考 |
| --- | --- | --- |
| `heading` | `level`, `inline` | `level` は元の `h1`〜`h6` の数字 |
| `paragraph` | `inline` | |
| `image` | `src`, `alt`, `caption`, `path?` | `path` は保存成功時にローカルの相対パスが入る |
| `embed` | `url`, `label`, `isFile?`, `path?` | 埋め込みはリンクに落とす。`isFile` は添付ファイルの印、`path` は保存成功時のローカル相対パス |
| `code` | `lang`, `text` | |
| `quote` | `blocks` | 入れ子 |
| `list` | `ordered`, `items` | `items` はブロック配列の配列 |
| `table` | `hasHeader`, `rows` | `rows` はインライン配列の 2 次元配列 |
| `divider` | なし | `hr` |

### インライン

| type | フィールド |
| --- | --- |
| `text` | `text` |
| `break` | なし |
| `strong` / `emphasis` / `strike` | `children` |
| `inlineCode` | `text` |
| `link` | `href`, `children`, `isFile?`, `path?` |

## 出力の詳細

### 見出しレベル

記事タイトルを `h1` / `# ` として出力するため、本文の見出しは 1 段下げます（本文の `h2` → 出力の `h3`）。文書内で見出しが 1 つの木になるようにするためです。

### Markdown

- 先頭に YAML front matter（`title` / `author` / `published` / `source` / `saved`）を置く。値が空の項目は出力しない
- 記法として誤解釈されやすい文字（`` \ ` * _ [ ] ``）だけをエスケープする。日本語の本文を読みにくくしないため、対象を絞っている
- `br` は行末 2 スペース＋改行にする

### HTML

- CSS はインラインで持ち、外部リソースを一切参照しない
- 背景は白で固定する。OS のダークモードには追従しない。保存した記事はいつどの環境で開いても同じ見た目で読めるほうがよいため、色はすべて具体値で指定する
- コードブロックは背景をグレー（`#f2f2f2`）にして本文と区別する。横スクロールは使わず `white-space: pre-wrap` で折り返し、スクロールなしで全文が読めるようにする
- 添付ファイルがある場合は左上に固定ナビゲーションを表示し、各リンクから本文中の添付箇所へ移動できるようにする
- 本文由来の文字列は必ずエスケープしてから埋め込む

## 対応する記事

`https://note.com/<ユーザー名>/n/<記事 ID>` の形の記事ページのみを対象とします。記事一覧・マガジン・プロフィールページは対象外です。

本文のルート要素は複数のセレクタ候補を上から順に試します。note の DOM は予告なく変わるため、決め打ちにしません。取れなかった場合はエラーにして、黙って壊れた内容を保存しないようにします。
