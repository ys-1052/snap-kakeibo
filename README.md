# 📱 SnapKakeibo (AIレシート家計簿)

SnapKakeibo は、レシート画像をマルチモーダルAIで解析し、日付・金額・品目・カテゴリを自動抽出してデータベースに保存・可視化する、**サーバーレス家計簿システム**です。

---

## 🚀 主要機能 (Key Features)

1. **マルチモーダルAIによる高精度解析**: Amazon Bedrock 上の **Claude 4.5 Haiku** に直接レシート画像を送信し、品目ごとの単価や数量、消費税区分にいたる詳細情報を構造化されたJSONとして高精度に自動抽出します。
2. **セキュアなユーザー認証とパスキー（WebAuthn）対応**: AWS Cognito を利用したログイン機構を搭載し、パスキー登録・認証による安全なサインインをサポート。Amplifyなどの大規模ライブラリを使わず、軽量なJSON RPC 1.1 APIの直接通信による独自実装を採用。サイレントリフレッシュやトークン取り消し（Revocation）も完備しています。
3. **Discordログイン通知機能**: Cognito Post-Authenticationトリガーにより、ユーザーログイン成功時にIPアドレスやデバイス環境情報をDiscordへWebhookで通知するセキュリティ監視機能を搭載しています。
4. **レスポンシブかつ洗練されたすりガラスUI**: ダークモードや美しいグラデーション、アニメーションに加え、モバイル端末向けに最適化された入力フォーム（タップターゲットの拡大、iOSでの日付入力はみ出し防止）、レシート画像のプレビュー切り替え機能を搭載しています。
5. **柔軟な家計簿データ管理**: AIによる自動解析に加えて手動での追加・編集・削除が可能。予算カテゴリを全12種類（食費、日用品、交際費、交通費、エンタメ、医療・健康、衣服・美容、水道・光熱、通信・家賃、自己投資・教育、貯蓄・投資、その他）に拡張し、実用性を高めています。
6. **ローカルクリーン開発環境**: Docker Compose環境による完全ローカルクローズド開発を提供。ホスト環境を汚さずにすべてのサービスを検証可能です。

---

## 🛠️ 技術スタック (Tech Stack)

### フロントエンド (frontend/)
- **Vite 6 + React 19 + TypeScript 5.7**
- **Vanilla CSS** (ダークモード、ガラスモルフィズム、スキャンアニメーション、モバイル最適化スタイル)
- **Recharts 2.15** (日別支出エリア/ラインチャート、カテゴリ別支出円グラフ)
- **Lucide React** (アイコンシステム)
- **Cognito WebAuthnクライアント** (JSON RPC 1.1 APIによる独自実装)

### バックエンド (backend/)
- **Python 3.12 + FastAPI + Mangum** (Uvicorn)
- **Boto3** (DynamoDB操作、S3署名付きURL発行、Bedrock APIのConverse呼び出し)
- **PyJWT & Cryptography** (Cognitoトークン検証・デコード用)
- **Ruff** (Linter/Formatter)

### インフラ・デプロイ
- **Serverless Framework 4** (AWSリソースの自動プロビジョニング)
- **Amazon S3** (レシート画像の格納、Presigned URL経由での直接アップロード)
- **Amazon DynamoDB** (PK: `user_id`, SK: `transaction_id` によるNoSQLデータベース)
- **Amazon Cognito** (サインイン認証、パスキー認証、Post-Authentication通知トリガー)
- **Amazon Bedrock** (マルチモーダルAI `global.anthropic.claude-haiku-4-5-20251001-v1:0` による構造化データ抽出)

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
> バックエンドの起動時イベント（FastAPIの `startup`）により、ローカルDynamoDB上にテーブル **`snap-kakeibo-transactions-dev`** が**自動でプロビジョニング**されます。手動でのテーブル作成コマンドは不要です。

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
2. **Bedrock Claude 4.5 Haiku モデルの有効化 (必須)**:
   AWSコンソールで **Amazon Bedrock** にアクセスし、**Model access** 画面から **Claude 4.5 Haiku** にチェックを入れてモデル使用リクエストを許可（`Access granted`）状態にしてください。

### 2. デプロイ実行
ルートディレクトリで以下のコマンドを実行します：

```bash
make deploy
```
これにより、CloudFormation経由でAWS上にS3バケット、DynamoDBテーブル、Cognitoユーザープール、Lambda関数（API用およびCognitoトリガー用）が自動構築されます。

### 3. APIエンドポイントのバインド
デプロイ完了時にターミナルに表示される **`Lambda Function URL`** (例: `https://xxxx.lambda-url.ap-northeast-1.on.aws/`) をコピーします。
Reactの **「設定(Settings)」タブ** の「AWS Lambda Function URL」欄にペーストして「保存」すれば、本番AI連携機能が即座にアクティブになります。

---

## 📂 主要なディレクトリ構造の責務

```
snap-kakeibo/
├── backend/                  # 🐍 Pythonバックエンド (AWS Lambda API / Cognitoトリガー)
│   ├── main.py               # メインAPIロジック & Cognitoトリガーハンドラー (FastAPI)
│   └── requirements.txt      # 依存ライブラリ
├── frontend/                 # ⚛️ Reactフロントエンド (Vite SPA)
│   ├── src/
│   │   ├── App.tsx           # アプリケーションのメイン画面・ステート
│   │   ├── cognito.ts        # Cognito WebAuthn統合用軽量クライアント
│   │   ├── index.css         # スタイリング (すりガラス・モバイル最適化・アニメーション)
│   │   └── main.tsx          # エントリーポイント
│   └── package.json          # プロジェクト依存関係とスクリプト
├── infra/                    # 🚀 インフラ・デプロイ定義 (Serverless IaC)
│   ├── requirements.txt      # backend/requirements.txt へのシンボリックリンク
│   └── serverless.yml        # Serverless Framework構成ファイル
├── docker-compose.yml        # 🐳 ローカル開発環境の構成定義
├── Makefile                  # 🛠️ 開発・運用自動化用のメイクファイル
└── README.md                 # 📄 本説明書 (本ファイル)
```
