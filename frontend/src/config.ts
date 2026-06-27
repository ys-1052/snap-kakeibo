/**
 * SnapKakeibo Frontend Configuration
 *
 * ローカル開発時は環境変数が空となるため、自動的に 'local' 擬似認証モードで動作します。
 * AWSに本番デプロイする際は、ビルド時に環境変数（VITE_API_URL等）から値が注入されます。
 */
export const CONFIG = {
  // バックエンドのAWS Lambda Function URL (例: https://xxxx.lambda-url.ap-northeast-1.on.aws)
  // 末尾のスラッシュを除去して、二重スラッシュ（//api/...）による404やCORSブロックを防ぎます。
  API_URL: (import.meta.env.VITE_API_URL || '').replace(/\/$/, ''),

  // AWS Cognito ユーザープールクライアントID
  // 値がない場合は、完全ローカルで動く「擬似認証（ログイン・ログアウト・マルチユーザー分離）モード」が有効になります。
  COGNITO_CLIENT_ID: import.meta.env.VITE_COGNITO_CLIENT_ID || 'local',

  // AWS Cognito の配置リージョン
  COGNITO_REGION: import.meta.env.VITE_COGNITO_REGION || 'ap-northeast-1',

  // LINE LIFF アプリ ID
  LIFF_ID: import.meta.env.VITE_LIFF_ID || '',
};
