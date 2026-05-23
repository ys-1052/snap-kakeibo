# 📱 SnapKakeibo (AIレシート家計簿)

SnapKakeibo は、レシート画像をマルチモーダルAIで解析し、日付・金額・品目・カテゴリを自動抽出してデータベースに保存・可視化する、**超低コストかつ高性能な次世代サーバーレス家計簿システム**です。

---

## 🚀 コアバリュー (Core Values)

1. **極限の低コスト**: AWSサーバーレス（S3 + CloudFront + Lambda + DynamoDB）をフル活用し、アクセスがない時は**月額固定費0円**を実現。
2. **OCRレス高精度画像解析**: Amazon Bedrock の最新鋭マルチモーダルモデル **Amazon Nova Lite** に直接レシート画像を投げることで、高額なOCRサービスの利用を廃止。品目ごとの単価や個数まで完璧に抽出。
3. **ローカルクリーン開発環境**: Docker Compose環境による完全ローカルクローズド開発を提供。ホスト環境を汚さずに開発が可能です。
4. **プレミアムすりガラスUX**: ダークモード、グラデーション、美しいモーダルアニメーション、そしてAIによる予算管理進捗ゲージを備えたプレミアムなUI。

---

## 🛠️ 技術スタック (Tech Stack)

### フロントエンド (frontend/)
- **Vite 6 + React 19 + TypeScript 5.7**
- **Vanilla CSS** (ダークモード、ガラスモルフィズム、スキャンアニメーション)
- **Recharts 2.15** (日別支出ラインチャート、カテゴリ別支出円グラフ)
- **Lucide React** (美しいアイコンシステム)

### バックエンド (backend/)
- **Python 3.12 + FastAPI + Mangum** (Uvicorn)
- **Boto3** (DynamoDBへの保存、S3署名付きURL発行、Bedrock APIのConverse呼び出し)
- **Ruff** (超高速Linter/Formatter)

### インフラ・デプロイ
- **Serverless Framework 3** (AWSリソースの自動プロビジョニング)
- **Amazon S3** (レシート画像の格納、Presigned URL経由での直接アップロード)
- **Amazon DynamoDB** (PK: `user_id`, SK: `transaction_id` による超低コストデータベース)
- **Amazon Bedrock** (マルチモーダルAI `amazon.nova-lite-v1:0` によるOCRレス構造化抽出)

---

## 🐳 ローカル開発環境のセットアップ (完全ローカル完結)

ローカル環境では、AWSにリソースを作成することなく、**ローカルDynamoDB（エミュレータ）**および**GUI管理画面**を含めたフルスタック構成が、Docker Composeによってコマンド一発で立ち上がります。

### 1. 起動方法
リポジトリのルートディレクトリで以下のコマンドを実行します：

```bash
# 再ビルドしてバックグラウンドで全サービスを起動
make up-build
```

### 2. ポートマッピング一覧
起動完了後、ブラウザから以下のURLで各サービスにアクセスできます：

| サービス | URL / アドレス | 役割 |
| :--- | :--- | :--- |
| **フロントエンド** | [http://localhost:3000](http://localhost:3000) | React SPA 画面 (リアルタイム自動リロード対応) |
| **バックエンド API** | [http://localhost:8000](http://localhost:8000) | FastAPI Swagger UI ([/docs](http://localhost:8000/docs)) |
| **DynamoDB Local** | `localhost:8008` (コンテナ内は `8000`) | ローカル内データストア (AWSエミュレータ) |
| **DynamoDB GUI Admin** | [http://localhost:8001](http://localhost:8001) | **dynamodb-admin**: DBの中身を目で確認・操作可能 |

> [!NOTE]  
> バックエンドの起動時イベント（FastAPIの `startup`）により、ローカルDynamoDB上にテーブル **`snap-kakeibo-backend-transactions-dev`** が**自動でプロビジョニング**されます。手動でのテーブル作成コマンドは一切不要です！

### 3. ローカル検証時の便利コマンド
```bash
make logs    # コンテナのログをリアルタイム監視
make ps      # サービス稼働状況の確認
make lint    # フロント/バック両方のLintチェックを実行 (ESLint & Ruff)
make format  # コードの自動フォーマットを実行 (Prettier & Ruff)
make down    # 全コンテナの停止と削除
```

---

## 🚀 AWS本番環境へのデプロイ手順

ローカルでの検証が完了したら、Serverless Frameworkを使用してAWS上にプロダクション環境を一発で構築できます。

### 1. デプロイ前準備
1. **AWSの認証情報**: 
   ホストPC側に `AdministratorAccess` 等の権限を持ったAWSアクセスキーが設定されていることを確認してください (`aws configure`)。
2. **Bedrock Nova Lite モデルの有効化 (必須)**:
   AWSコンソールで **Amazon Bedrock** にアクセスし、**Model access** 画面から **Amazon Nova Lite** にチェックを入れてモデル使用リクエストを許可（`Access granted`）状態にしてください。

### 2. デプロイ実行
ルートディレクトリで以下のコマンドを実行します：

```bash
make deploy
```
これにより、CloudFormation経由でAWS上にS3バケット、DynamoDBテーブル、Lambda関数が自動構築されます。

### 3. APIエンドポイントのバインド
デプロイ完了時にターミナルに表示される **`Lambda Function URL`** (例: `https://xxxx.lambda-url.ap-northeast-1.on.aws/`) をコピーします。
Reactの **「設定(Settings)」タブ** の「AWS Lambda Function URL」欄にペーストして「保存」すれば、本番AI連携機能が即座にアクティブになります！

---

## 📂 主要なディレクトリ構造の責務

```
snap-kakeibo/
├── backend/                  # 🐍 Pythonバックエンド (AWS Lambda API)
│   ├── main.py               # メインAPIロジック (FastAPI)
│   ├── requirements.txt      # 依存ライブラリ
│   └── serverless.yml        # Serverless Framework インフラ構成ファイル
├── frontend/                 # ⚛️ Reactフロントエンド (Vite SPA)
│   ├── src/
│   │   ├── App.tsx           # アプリケーションのメイン画面・ステート
│   │   ├── index.css         # スタイリング (プレミアムすりガラス・アニメーション)
│   │   └── main.tsx          # エントリーポイント
│   └── package.json          # プロジェクト依存関係とスクリプト
├── docker-compose.yml        # 🐳 ローカル開発環境の構成定義
├── Makefile                  # 🛠️ 開発・運用自動化用のメイクファイル
└── README.md                 # 📄 本説明書 (本ファイル)
```
