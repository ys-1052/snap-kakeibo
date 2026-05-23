.PHONY: up up-build down logs ps lint format lint-fe lint-be format-fe format-be deploy

# ==========================================
# 🐳 Docker Compose コマンド
# ==========================================

# コンテナをバックグラウンドで起動
up:
	docker compose up -d

# コンテナを再ビルドしてバックグラウンドで起動
up-build:
	docker compose up --build -d

# コンテナを停止・削除
down:
	docker compose down

# ログを表示 (リアルタイム監視)
logs:
	docker compose logs -f

# コンテナの稼働状況を確認
ps:
	docker compose ps

# ==========================================
# 🧹 Lint & Format コマンド (Dockerコンテナ内で実行)
# ==========================================

# フロント・バック両方のLintチェックを実行
lint: lint-fe lint-be

# フロント・バック両方の自動フォーマットを実行
format: format-fe format-be

# フロントエンドのLintチェック (ESLint)
lint-fe:
	docker compose exec -T frontend npm run lint

# バックエンドのLintチェック (Ruff)
lint-be:
	docker compose exec -T backend ruff check .

# フロントエンドの自動フォーマット (Prettier)
format-fe:
	docker compose exec -T frontend npm run format

# バックエンドの自動フォーマット (Ruff)
format-be:
	docker compose exec -T backend ruff format .

# ==========================================
# 🚀 デプロイ コマンド (Serverless Framework)
# ==========================================

# バックエンドのAWSデプロイを実行
deploy:
	cd backend && serverless deploy
