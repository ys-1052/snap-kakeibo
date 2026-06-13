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

# インフラのデプロイ、フロントエンドのビルド、S3同期までを全自動で実行
deploy:
	cd infra && AWS_PROFILE=$(AWS_PROFILE) npx serverless deploy
	@echo "# このファイルはデプロイ時に自動生成されました。手動で変更しないでください。" > frontend/.env.production
	@echo VITE_API_URL=$$(aws cloudformation describe-stacks --stack-name snap-kakeibo-prod --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text --profile $(AWS_PROFILE) --region ap-northeast-1) >> frontend/.env.production
	@echo VITE_COGNITO_CLIENT_ID=$$(aws cloudformation describe-stacks --stack-name snap-kakeibo-prod --query "Stacks[0].Outputs[?OutputKey=='CognitoClientId'].OutputValue" --output text --profile $(AWS_PROFILE) --region ap-northeast-1) >> frontend/.env.production
	@echo VITE_COGNITO_REGION=ap-northeast-1 >> frontend/.env.production
	@echo "✨ frontend/.env.production を自動生成しました！"
	@echo "フロントエンドをDocker環境でビルド中..."
	docker compose run --rm frontend npm run build
	@echo "ビルドされた静的ファイルを本番S3バケットにアップロード中..."
	@FRONTEND_BUCKET=$$(aws cloudformation describe-stacks --stack-name snap-kakeibo-prod --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" --output text --profile $(AWS_PROFILE) --region ap-northeast-1) && \
	aws s3 sync frontend/dist s3://$$FRONTEND_BUCKET --delete --profile $(AWS_PROFILE) --region ap-northeast-1
	@echo "CloudFrontのCDNキャッシュをクリア中..."
	@CDN_ID=$$(aws cloudformation describe-stacks --stack-name snap-kakeibo-prod --query "Stacks[0].Outputs[?OutputKey=='FrontendCDNId'].OutputValue" --output text --profile $(AWS_PROFILE) --region ap-northeast-1) && \
	aws cloudfront create-invalidation --distribution-id $$CDN_ID --paths "/*" --profile $(AWS_PROFILE) --region ap-northeast-1 > /dev/null
	@echo "\n🎉 デプロイ完了！アプリケーションURL:"
	@aws cloudformation describe-stacks --stack-name snap-kakeibo-prod --query "Stacks[0].Outputs[?OutputKey=='FrontendUrl'].OutputValue" --output text --profile $(AWS_PROFILE) --region ap-northeast-1
