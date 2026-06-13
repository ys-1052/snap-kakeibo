# Project Guidelines (SSoT)

このファイルは、AIエージェントがプロジェクト「SnapKakeibo」を理解し、一貫性のある開発を行うためのシングル・ソース・オブ・トゥルース（SSoT）となるプロジェクトガイドラインです。

---

## 1. プロジェクト概要
**SnapKakeibo** は、レシート画像を直接AIで解析し、日付・金額・品目・カテゴリを自動抽出してデータベースに保存・可視化する超低コストかつ高性能な家計簿システムです。

### 🚀 コアバリュー
1. **極限の低コスト**: AWSサーバーレス（S3 + CloudFront + Lambda + DynamoDB）をフル活用します。
2. **OCRレス画像解析**: マルチモーダルAI (Amazon Bedrock) に直接画像を投げることで、高額なOCRサービスの利用を廃止。
3. **ローカルクリーン開発**: Docker Compose 環境による完全コンテナ開発を提供し、開発者のローカル環境を汚しません。

---

## 2. 技術スタック (Tech Stack)

### フロントエンド (frontend/)
- **Vite 6 + React 19 + TypeScript 5.7**
- グラフライブラリ: **Recharts 2.15** (支出統計のエリアチャート・円グラフ用)
- アイコン: **Lucide React**
- スタイリング: **Vanilla CSS** (ダークモード、ガラスモルフィズム、スキャンアニメーション)

### バックエンド (backend/)
- **Python 3.12 + FastAPI + Mangum**
- AWS SDK: **Boto3** (DynamoDBへの保存、S3署名付きURL発行、Bedrock APIのConverse呼び出し)
- 解析AI: **Amazon Bedrock** (Converseマルチモーダル呼び出し)

### インフラ・デプロイ
- **Serverless Framework 4** (`infra/serverless.yml` によるAWSリソースの自動プロビジョニング)
- データベース: **Amazon DynamoDB** (PK: `user_id`, SK: `transaction_id`)
- ストレージ: **Amazon S3** (レシート画像の格納、Presigned URL経由での直接アップロード)

---

## 3. ディレクトリ構造の責務

```
 snap-kakeibo/
 ├── .agent/                  # 🤖 AIエージェント設定 (Rules & Workflows)
 ├── backend/                 # 🐍 Pythonバックエンド (AWS Lambda API)
 │   ├── Dockerfile
 │   ├── main.py              # メインロジック
 │   └── requirements.txt     # Python依存パッケージ
 ├── frontend/                # ⚛️ Reactフロントエンド (Vite SPA)
 │   ├── Dockerfile
 │   ├── index.html
 │   ├── package.json
 │   ├── tsconfig.json
 │   ├── vite.config.ts
 │   └── src/                 # ソースコード (App.tsx, index.css)
 ├── infra/                   # 🚀 インフラ・デプロイ定義 (Serverless IaC)
 │   ├── requirements.txt     # backend/requirements.txt へのシンボリックリンク
 │   └── serverless.yml       # Serverless Framework構成ファイル
 ├── docker-compose.yml       # 🐳 ローカル開発環境の統合
 └── AGENTS.md                # 📄 本ガイドライン (SSoT)
```

---

## 4. 開発ワークフロー
- **ローカル起動**: `docker compose up --build` を実行し、`http://localhost:3000` で動作確認。
- **本番デプロイ**: `infra/` にて `serverless deploy` を実行し、生成された Lambda Function URL をフロントエンド設定にバインドする。
- **行動規範**: 詳細な振る舞いは `.agent/rules/` に定義された各ルールを厳格に遵守してください。
