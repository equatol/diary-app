# 日記アプリ（GitHub 保存版）

iPhone の Safari で使える日記アプリです。書いた日記は、自分の GitHub の**非公開リポジトリ**に保存されるので、スマホと PC のどちらからでも同じ日記を読み書きできます。

- シンプル版: `diary-app/`
- かわいい版（シマエナガのマスコットと効果音つき）: `diary-app-cute/`

## しくみ

```
このリポジトリ（公開・GitHub Pages）… アプリ本体。日記も合鍵も含まない
        │  GitHub API（合鍵を付けて読み書き）
        ▼
非公開リポジトリ … 日記データ entries/2026.json など（年ごとに1ファイル）
```

- 保存先が公開リポジトリだった場合、アプリは日記を一切読み書きしません。
- 合鍵（トークン）は各端末のアプリの中にだけ保存されます。
- ページの通信先は GitHub の窓口（api.github.com）だけに制限しています。

## 使い方

1. GitHub で日記用の**非公開**リポジトリを作る（README ありで作成）
2. Fine-grained トークンを作る
   - Repository access: 日記用リポジトリだけ
   - Permissions: Contents を Read and write
   - 有効期限を付ける
3. アプリを開き、右上の ⚙ にユーザー名・リポジトリ名・トークンを入れて「接続する」
4. iPhone では Safari の共有ボタン →「ホーム画面に追加」でアプリのように使えます
   - ホーム画面のアプリは Safari と保存場所が別なので、トークンはホーム画面から開いたアプリで入力します

## スマホをなくしたとき・トークンが漏れたかもしれないとき

GitHub の Settings → Developer settings → Personal access tokens → Fine-grained tokens で、該当するトークンを **Delete** してください。すぐに使えなくなります。新しいトークンを作り直して各端末に入れ直せば、日記はそのまま使えます。

## テスト

```
node test/storage.test.js
node test/csv.test.js
node test/html.test.js
```
