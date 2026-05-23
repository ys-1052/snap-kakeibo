FROM node:24-slim

WORKDIR /app

# package.json と package-lock.json のコピー
COPY package.json ./

# 依存パッケージのインストール
RUN npm install

EXPOSE 3000

# 開発用 Vite 起動コマンド
CMD ["npm", "run", "dev"]
