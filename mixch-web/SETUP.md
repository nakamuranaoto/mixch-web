# Mixch 特典履行CSV生成ツール — デプロイ手順

## 必要なもの
- GitHubアカウント
- Netlifyアカウント（無料プランでOK）
- Anthropic APIキー → https://console.anthropic.com

---

## Step 1: GitHubにリポジトリを作る

1. https://github.com/new でリポジトリ新規作成
   - 名前: `mixch-web`（なんでもOK）
   - Public または Private どちらでも可
2. ローカルに clone してこのフォルダの中身をコピー

```bash
git clone https://github.com/あなた/mixch-web.git
cp -r mixch-web/* mixch-web-repo/
cd mixch-web-repo
git add .
git commit -m "initial commit"
git push
```

または GitHub Desktop を使っても可

---

## Step 2: Netlifyにデプロイ

1. https://app.netlify.com でサインイン
2. 「Add new site」→「Import an existing project」→「GitHub」
3. `mixch-web` リポジトリを選択
4. ビルド設定（自動検出されるはず）:
   - Build command: （空欄でOK）
   - Publish directory: `public`
5. 「Deploy site」をクリック

---

## Step 3: 環境変数を設定

Netlify管理画面 →「Site configuration」→「Environment variables」→「Add a variable」

| キー | 値 |
|------|-----|
| `ANTHROPIC_API_KEY` | `sk-ant-api03-...`（Anthropic Consoleで発行） |

設定後、「Deploys」→「Trigger deploy」→「Deploy site」で再デプロイ

---

## Step 4: 動作確認

発行されたURL（例: `https://amazing-koala-abc123.netlify.app`）にアクセス

1. MixchのイベントURLを貼り付け
2. 「CSV生成」ボタンをクリック
3. AI解析結果が表示されCSVがダウンロードされれば完成！

---

## チームで使う場合

URLをSlackやNotionで共有するだけでOK。
ログインなしで使えます（必要であとでFirebase Authを追加可能）。

---

## トラブルシューティング

| 症状 | 原因 | 対処 |
|------|------|------|
| 「ANTHROPIC_API_KEY が設定されていません」 | 環境変数未設定 | Step 3を再確認 |
| CSVが空 | イベントが終了済みでAPIが空 | 別のイベントURLで試す |
| 「HTTP 404」エラー | イベントIDが存在しない | URLを確認 |

---

## ファイル構成

```
mixch-web/
├── netlify.toml              # Netlify設定
├── package.json
├── netlify/
│   └── functions/
│       └── analyze-event.js  # サーバーサイド（Mixch API取得 + Claude AI解析）
└── public/
    └── index.html            # フロントエンド（URL入力 → CSV生成UI）
```
