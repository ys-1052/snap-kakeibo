import React, { useState, useEffect, useCallback } from 'react';
import {
  Camera,
  TrendingUp,
  History,
  Settings as SettingsIcon,
  Upload,
  Plus,
  Check,
  X,
  ShoppingBag,
  Sparkles,
  Calendar,
  AlertCircle,
  Trash2,
  LogOut,
  Lock,
  Mail,
  User,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Key,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  cognitoSignIn,
  cognitoRespondToNewPasswordRequired,
  cognitoRefreshToken,
  cognitoRevokeToken,
  cognitoStartWebAuthnRegistration,
  cognitoCompleteWebAuthnRegistration,
  cognitoInitiateUserAuth,
  cognitoRespondToWebAuthnChallenge,
  arrayBufferToBase64Url,
  base64UrlToArrayBuffer,
  cognitoListWebAuthnCredentials,
  cognitoDeleteWebAuthnCredential,
} from './cognito';
import { CONFIG } from './config';

// --- モックデータ & 型定義 ---

interface TaxSummaryItem {
  tax_rate: number | null;
  taxable_amount: number | null;
  tax_amount: number | null;
  tax_included: boolean | null;
}

interface ReceiptItem {
  name: string;
  price: number;
  qty: number;
  tax_rate?: number | null;
  tax_included?: boolean | null;
  tax_marker?: string | null;
}

interface Transaction {
  id: string;
  transaction_date: string;
  shop_name: string;
  total_amount: number;
  category_name: string;
  items: ReceiptItem[];
  tax_summary?: TaxSummaryItem[] | null;
  receipt_s3_key?: string;
  memo?: string;
  created_at: string;
}

const CATEGORY_COLORS: { [key: string]: string } = {
  食費: '#ff6b6b',
  日用品: '#4dabf7',
  交際費: '#ffd43b',
  交通費: '#51cf66',
  エンタメ: '#20c997',
  '医療・健康': '#ae3ec9',
  '衣服・美容': '#f06595',
  '水道・光熱': '#ff922b',
  '通信・家賃': '#748ffc',
  '自己投資・教育': '#15aabf',
  '貯蓄・投資': '#94d82d',
  その他: '#868e96',
};

const INITIAL_TRANSACTIONS: Transaction[] = [
  {
    id: 'mock-1',
    transaction_date: '2026-05-20',
    shop_name: 'スーパーライフ 渋谷店',
    total_amount: 2983,
    category_name: '食費',
    items: [
      {
        name: '産直こだわり牛乳',
        price: 248,
        qty: 1,
        tax_rate: 8,
        tax_included: false,
        tax_marker: '※',
      },
      {
        name: '国産黒毛和牛バラ',
        price: 1980,
        qty: 1,
        tax_rate: 8,
        tax_included: false,
        tax_marker: '※',
      },
      { name: '有機レタス', price: 198, qty: 1, tax_rate: 8, tax_included: false, tax_marker: '※' },
      {
        name: 'こだわり十勝ヨーグルト',
        price: 168,
        qty: 2,
        tax_rate: 8,
        tax_included: false,
        tax_marker: '※',
      },
    ],
    tax_summary: [{ tax_rate: 8, taxable_amount: 2762, tax_amount: 221, tax_included: false }],
    memo: '今週のまとめ買い',
    created_at: '2026-05-20T18:30:00Z',
  },
  {
    id: 'mock-2',
    transaction_date: '2026-05-21',
    shop_name: 'マツモトキヨシ',
    total_amount: 1786,
    category_name: '日用品',
    items: [
      {
        name: 'クリニカ ハミガキ',
        price: 328,
        qty: 1,
        tax_rate: 10,
        tax_included: false,
        tax_marker: null,
      },
      {
        name: 'エリエール ティシュー 5個パック',
        price: 498,
        qty: 1,
        tax_rate: 10,
        tax_included: false,
        tax_marker: null,
      },
      {
        name: 'アタック抗菌EX 詰替',
        price: 798,
        qty: 1,
        tax_rate: 10,
        tax_included: false,
        tax_marker: null,
      },
    ],
    tax_summary: [{ tax_rate: 10, taxable_amount: 1624, tax_amount: 162, tax_included: false }],
    memo: '日用品の補充',
    created_at: '2026-05-21T12:15:00Z',
  },
  {
    id: 'mock-3',
    transaction_date: '2026-05-22',
    shop_name: 'スターバックスコーヒー',
    total_amount: 680,
    category_name: '交際費',
    items: [
      {
        name: 'スターバックスラテ Tall',
        price: 490,
        qty: 1,
        tax_rate: 10,
        tax_included: true,
        tax_marker: null,
      },
      {
        name: 'チョコレートクッキー',
        price: 190,
        qty: 1,
        tax_rate: 10,
        tax_included: true,
        tax_marker: null,
      },
    ],
    tax_summary: [{ tax_rate: 10, taxable_amount: 680, tax_amount: 62, tax_included: true }],
    memo: 'カフェ勉強',
    created_at: '2026-05-22T15:40:00Z',
  },
  {
    id: 'mock-4',
    transaction_date: '2026-05-23',
    shop_name: 'JR東日本 (Suicaチャージ)',
    total_amount: 2000,
    category_name: '交通費',
    items: [
      {
        name: 'Suica チャージ',
        price: 2000,
        qty: 1,
        tax_rate: null,
        tax_included: true,
        tax_marker: null,
      },
    ],
    tax_summary: [{ tax_rate: null, taxable_amount: 2000, tax_amount: 0, tax_included: true }],
    memo: '移動用',
    created_at: '2026-05-23T09:00:00Z',
  },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'scan' | 'history' | 'settings'>(
    'dashboard'
  );
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedItemIdx, setExpandedItemIdx] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    const saved = localStorage.getItem('snap_kakeibo_transactions');
    if (saved) return JSON.parse(saved);
    // ローカル開発モード（local）の場合のみ、グラフ表示用のダミーデータを初期表示します
    return CONFIG.COGNITO_CLIENT_ID === 'local' ? INITIAL_TRANSACTIONS : [];
  });

  // API・Cognito認証設定 (config.tsからロード)
  const apiUrl = CONFIG.API_URL || 'http://localhost:8000';
  const isLocal =
    CONFIG.COGNITO_CLIENT_ID === 'local' ||
    !CONFIG.API_URL ||
    apiUrl.includes('localhost') ||
    apiUrl.includes('127.0.0.1') ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';
  const cognitoClientId = CONFIG.COGNITO_CLIENT_ID || '';
  const cognitoRegion = CONFIG.COGNITO_REGION || 'ap-northeast-1';

  // 認証ステート
  // セキュリティ向上のため、本番環境 (cognitoClientId != 'local') では ID Token を localStorage に保存せず、メモリ上 (state) のみで管理します。
  // 開発環境 (local) では、リロード時にログイン状態を維持するため localStorage を使用します。
  const [token, setToken] = useState(() => {
    const isLocalMode = CONFIG.COGNITO_CLIENT_ID === 'local';
    return isLocalMode ? localStorage.getItem('snap_kakeibo_token') || '' : '';
  });
  const [accessToken, setAccessToken] = useState('');
  const [userEmail, setUserEmail] = useState(
    () => localStorage.getItem('snap_kakeibo_user_email') || ''
  );
  const [userRole, setUserRole] = useState(
    () => localStorage.getItem('snap_kakeibo_user_role') || '一般'
  );

  // マウント時のセッション確認状態
  const [isAuthChecking, setIsAuthChecking] = useState(() => {
    const isLocalMode = CONFIG.COGNITO_CLIENT_ID === 'local';
    const hasRefreshToken = !!localStorage.getItem('snap_kakeibo_refresh_token');
    return !isLocalMode && hasRefreshToken;
  });

  // ログインフォームステート
  const [rememberEmail, setRememberEmail] = useState(() => {
    const saved = localStorage.getItem('snap_kakeibo_remember_email');
    return saved === null ? true : saved === 'true';
  });
  const [loginEmail, setLoginEmail] = useState(() => {
    const saved = localStorage.getItem('snap_kakeibo_remember_email');
    const remember = saved === null ? true : saved === 'true';
    return remember ? localStorage.getItem('snap_kakeibo_saved_email') || '' : '';
  });
  const [loginPassword, setLoginPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isNewPasswordRequired, setIsNewPasswordRequired] = useState(false);
  const [cognitoSession, setCognitoSession] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // スキャンステータス
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanStep, setScanStep] = useState<string>('');

  // 解析結果プレビュー & 編集
  const [editData, setEditData] = useState<Partial<Transaction> | null>(null);

  // 詳細表示用の取引データ
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);

  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  // 予算設定ステート
  const [monthlyBudget, setMonthlyBudget] = useState(() => {
    const saved = localStorage.getItem('snap_kakeibo_budget');
    return saved ? parseInt(saved) : 100000;
  });

  // パスキー一覧ステート
  const [registeredPasskeys, setRegisteredPasskeys] = useState<any[]>([]);
  const [passkeysLoading, setPasskeysLoading] = useState(false);
  const [showPasskeys, setShowPasskeys] = useState(false);

  // レシート原本表示ステート（履歴詳細モーダル用）
  const [viewReceiptUrl, setViewReceiptUrl] = useState('');
  const [viewReceiptLoading, setViewReceiptLoading] = useState(false);
  const [showReceiptImage, setShowReceiptImage] = useState(false);

  // レシート原本表示ステート（スキャン後フォーム用）
  const [showScanReceiptImage, setShowScanReceiptImage] = useState(false);

  // Pull-to-refresh
  useEffect(() => {
    let startY = 0;

    const handleTouchStart = (e: TouchEvent) => {
      if (window.scrollY === 0) {
        startY = e.touches[0].clientY;
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (window.scrollY === 0 && startY > 0) {
        const endY = e.changedTouches[0].clientY;
        if (endY - startY > 80) {
          // Threshold for pull
          setRefreshKey(prev => prev + 1);
        }
      }
      startY = 0;
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('snap_kakeibo_transactions', JSON.stringify(transactions));
  }, [transactions]);

  useEffect(() => {
    setViewReceiptUrl('');
    setShowReceiptImage(false);
  }, [selectedTransaction]);

  // editDataがクリアされたらスキャンフォームのレシート表示もリセット
  useEffect(() => {
    if (!editData) {
      setShowScanReceiptImage(false);
    }
  }, [editData]);

  // 認証ヘッダー付きでAPIを呼び出すヘルパー関数（トークンの期限切れ時に自動でリフレッシュ）
  const fetchWithAuth = async (url: string, options: RequestInit = {}): Promise<Response> => {
    let currentToken = token;

    // もしステートのトークンがないが、localStorageにリフレッシュトークンがある場合、自動リフレッシュを試みる
    const savedRefreshToken = localStorage.getItem('snap_kakeibo_refresh_token');
    if (!currentToken && savedRefreshToken && cognitoClientId && cognitoClientId !== 'local') {
      try {
        const res = await cognitoRefreshToken(savedRefreshToken, {
          clientId: cognitoClientId,
          region: cognitoRegion,
        });
        if (res.idToken) {
          const email = userEmail || localStorage.getItem('snap_kakeibo_user_email') || '';
          completeLogin(res.idToken, email, res.refreshToken, res.accessToken);
          currentToken = res.idToken;
        }
      } catch (err) {
        console.error('Silent refresh failed on request start:', err);
      }
    }

    const makeRequest = async (t: string) => {
      const headers = {
        ...(options.headers || {}),
      } as Record<string, string>;
      if (t) {
        headers['Authorization'] = `Bearer ${t}`;
      }
      return fetch(url, { ...options, headers });
    };

    let response = await makeRequest(currentToken);

    // トークン期限切れ（401）の場合、自動的にリフレッシュトークンで再取得を試みる
    if (
      response.status === 401 &&
      cognitoClientId &&
      cognitoClientId !== 'local' &&
      savedRefreshToken
    ) {
      console.log('ID Token expired. Attempting silent refresh...');
      try {
        const res = await cognitoRefreshToken(savedRefreshToken, {
          clientId: cognitoClientId,
          region: cognitoRegion,
        });
        if (res.idToken) {
          const email = userEmail || localStorage.getItem('snap_kakeibo_user_email') || '';
          completeLogin(res.idToken, email, res.refreshToken, res.accessToken);
          // 新しいトークンでリクエストを再試行
          response = await makeRequest(res.idToken);
        } else {
          handleLogout();
        }
      } catch (err) {
        console.error('Silent refresh failed during API call:', err);
        handleLogout();
      }
    } else if (response.status === 401 && cognitoClientId) {
      handleLogout();
    }

    return response;
  };

  // マウント時にリフレッシュトークンによるセッション復旧を試みる
  useEffect(() => {
    const checkSession = async () => {
      const isLocalMode = cognitoClientId === 'local';
      if (isLocalMode) {
        setIsAuthChecking(false);
        return;
      }

      const savedRefreshToken = localStorage.getItem('snap_kakeibo_refresh_token');
      if (savedRefreshToken && cognitoClientId) {
        console.log('Mount: checking session via silent refresh...');
        try {
          const res = await cognitoRefreshToken(savedRefreshToken, {
            clientId: cognitoClientId,
            region: cognitoRegion,
          });
          if (res.idToken) {
            const email = localStorage.getItem('snap_kakeibo_user_email') || '';
            completeLogin(res.idToken, email, res.refreshToken, res.accessToken);
          } else {
            handleLogout();
          }
        } catch (err) {
          console.error('Mount silent refresh failed:', err);
          handleLogout();
        }
      }
      setIsAuthChecking(false);
    };

    checkSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cognitoClientId, cognitoRegion]);

  // 起動時およびapiUrl変更時にAPIから明細データを同期する
  useEffect(() => {
    const fetchTransactions = async () => {
      if (!apiUrl || isAuthChecking) return;
      setIsRefreshing(true);
      try {
        const response = await fetchWithAuth(`${apiUrl}/api/transactions`);
        if (response.ok) {
          const data = await response.json();
          // APIから取得したデータをマッピングして格納 (DynamoDBのSKをidとして使用)
          const mappedData = data.map((item: any) => ({
            id: item.SK,
            transaction_date: item.transaction_date,
            shop_name: item.shop_name,
            total_amount: item.total_amount,
            category_name: item.category_name,
            items: item.items || [],
            tax_summary: item.tax_summary || null,
            receipt_s3_key: item.receipt_s3_key || '',
            memo: item.memo || '',
            created_at: item.created_at || new Date().toISOString(),
          }));
          setTransactions(mappedData);
        }
      } catch (err) {
        console.error('APIからの取引履歴の取得に失敗しました:', err);
      } finally {
        // Minimum animation time for visual feedback
        setTimeout(() => setIsRefreshing(false), 500);
      }
    };

    fetchTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, token, cognitoClientId, refreshKey, isAuthChecking]);

  // SVGグラデーションを定義するために一度だけ描画するコンポーネント用
  const GradientDefs = () => (
    <svg width="0" height="0" style={{ position: 'absolute' }}>
      <defs>
        <linearGradient id="purple-blue-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
        <linearGradient id="accent-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ec4899" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
    </svg>
  );

  // --- グラフデータの集計 & フィルター ---

  // 選択可能な月リストを動的に生成 (過去6ヶ月 + 履歴データにある月)
  const getSelectableMonths = () => {
    const months = new Set<string>();
    transactions.forEach(t => {
      if (t.transaction_date) {
        const m = t.transaction_date.substring(0, 7);
        if (/^\d{4}-\d{2}$/.test(m)) {
          months.add(m);
        }
      }
    });
    // データが0件の場合は現在月だけ表示
    if (months.size === 0) {
      const now = new Date();
      months.add(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    }
    return Array.from(months).sort().reverse();
  };

  // 選択された月のデータのみにフィルター
  const filteredTransactions = transactions.filter(
    t => t.transaction_date && t.transaction_date.startsWith(selectedMonth)
  );

  // 1. 日別支出の集計（選択された月の1日〜月末日）
  const getLineChartData = () => {
    const [yearStr, monthStr] = selectedMonth.split('-');
    const year = parseInt(yearStr);
    const month = parseInt(monthStr);

    // 月の末日を取得
    const daysInMonth = new Date(year, month, 0).getDate();
    const dataMap: { [key: string]: number } = {};

    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      dataMap[dateKey] = 0;
    }

    filteredTransactions.forEach(t => {
      if (dataMap[t.transaction_date] !== undefined) {
        dataMap[t.transaction_date] += t.total_amount;
      }
    });

    return Object.keys(dataMap).map(date => {
      const d = parseInt(date.split('-')[2]);
      return {
        name: `${d}日`,
        amount: dataMap[date],
      };
    });
  };

  // 2. カテゴリ別支出の集計
  const getPieChartData = () => {
    const dataMap: { [key: string]: number } = {};
    filteredTransactions.forEach(t => {
      dataMap[t.category_name] = (dataMap[t.category_name] || 0) + t.total_amount;
    });

    return Object.keys(dataMap).map(name => ({
      name,
      value: dataMap[name],
    }));
  };

  // 直近2週間（14日前〜今日）の取引データを取得
  const getRecentTransactions = () => {
    const now = new Date();
    const twoWeeksAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14);
    const y = twoWeeksAgo.getFullYear();
    const m = String(twoWeeksAgo.getMonth() + 1).padStart(2, '0');
    const d = String(twoWeeksAgo.getDate()).padStart(2, '0');
    const threshold = `${y}-${m}-${d}`;

    return transactions
      .filter(t => t.transaction_date && t.transaction_date >= threshold)
      .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date));
  };

  const totalMonthlySpend = filteredTransactions.reduce((acc, curr) => acc + curr.total_amount, 0);

  // --- ハンドラー ---

  // 写真選択時
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setEditData(null);
    }
  };

  // スキャン開始 (シミュレーション or 実API)
  const triggerScan = async () => {
    if (!previewUrl) return;

    setIsScanning(true);
    setScanStep('レシートを送信中...');

    // 1. ローカル環境の場合はデモモードで即座に実行
    if (isLocal) {
      runDemoScan();
      return;
    }

    // 2. 本物のAPIが設定されている場合は実通信
    if (apiUrl) {
      try {
        setScanStep('レシートを送信中...');
        // 署名付きURL取得
        const nameParam = selectedFile ? selectedFile.name : 'receipt.jpg';
        const urlRes = await fetchWithAuth(
          `${apiUrl}/api/receipts/presigned-url?filename=${encodeURIComponent(nameParam)}`
        );
        if (!urlRes.ok) throw new Error('署名付きURLの取得に失敗しました');
        const { upload_url, file_key } = await urlRes.json();

        // S3へPUT送信
        setScanStep('AIがレシートを解析中...');
        const uploadRes = await fetch(upload_url, {
          method: 'PUT',
          body: selectedFile,
          headers: {
            'Content-Type': selectedFile?.type || 'image/jpeg',
          },
        });
        if (!uploadRes.ok) throw new Error('S3へのアップロードに失敗しました');

        // AIで解析
        setScanStep('AIが品目と金額を読み取り中...');
        const analyzeRes = await fetchWithAuth(`${apiUrl}/api/receipts/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_key }),
        });
        if (!analyzeRes.ok) throw new Error('レシート解析に失敗しました');

        const result = await analyzeRes.json();
        setEditData({
          ...result,
          receipt_s3_key: file_key,
        });
      } catch (err: any) {
        alert(`エラーが発生したため、デモモードのAI解析に切り替えます: ${err.message}`);
        runDemoScan();
      } finally {
        setIsScanning(false);
      }
    } else {
      // 2. 設定がない場合はリッチなデモシミュレーション
      runDemoScan();
    }
  };

  // デモ用のスキャンシミュレーション
  const runDemoScan = () => {
    setTimeout(() => {
      setScanStep('AIがレシートを解析中...');
      setTimeout(() => {
        setScanStep('AIが品目と金額を読み取り中...');
        setTimeout(() => {
          setIsScanning(false);
          // ランダムにリアルなレシートデータを生成
          const demoReceipts: Omit<Transaction, 'id' | 'created_at'>[] = [
            {
              shop_name: 'セブン-イレブン 渋谷3丁目店',
              transaction_date: new Date().toISOString().split('T')[0],
              total_amount: 1149,
              category_name: '食費',
              items: [
                {
                  name: 'サラダチキン プレーン',
                  price: 238,
                  qty: 1,
                  tax_rate: 8,
                  tax_included: false,
                  tax_marker: '※',
                },
                {
                  name: 'もっちり7種具材のサラダ',
                  price: 398,
                  qty: 1,
                  tax_rate: 8,
                  tax_included: false,
                  tax_marker: '※',
                },
                {
                  name: 'こだわり十勝ヨーグルト',
                  price: 168,
                  qty: 1,
                  tax_rate: 8,
                  tax_included: false,
                  tax_marker: '※',
                },
                {
                  name: 'い・ろ・は・す 550ml',
                  price: 120,
                  qty: 1,
                  tax_rate: 8,
                  tax_included: false,
                  tax_marker: '※',
                },
                {
                  name: 'ブラック無糖缶',
                  price: 140,
                  qty: 1,
                  tax_rate: 8,
                  tax_included: false,
                  tax_marker: '※',
                },
              ],
              tax_summary: [
                { tax_rate: 8, taxable_amount: 1064, tax_amount: 85, tax_included: false },
              ],
              receipt_s3_key: 'demo_receipt.png',
            },
            {
              shop_name: 'マツモトキヨシ 新宿東口店',
              transaction_date: new Date().toISOString().split('T')[0],
              total_amount: 2794,
              category_name: '日用品',
              items: [
                {
                  name: '超立体マスク 30枚入',
                  price: 1280,
                  qty: 1,
                  tax_rate: 10,
                  tax_included: false,
                  tax_marker: null,
                },
                {
                  name: 'キレイキレイ 泡ハンドソープ',
                  price: 420,
                  qty: 2,
                  tax_rate: 10,
                  tax_included: false,
                  tax_marker: null,
                },
                {
                  name: '除菌アルコールウェット',
                  price: 210,
                  qty: 2,
                  tax_rate: 10,
                  tax_included: false,
                  tax_marker: null,
                },
              ],
              tax_summary: [
                { tax_rate: 10, taxable_amount: 2540, tax_amount: 254, tax_included: false },
              ],
              receipt_s3_key: 'demo_receipt.png',
            },
          ];
          const chosen = demoReceipts[Math.floor(Math.random() * demoReceipts.length)];
          setEditData(chosen);
        }, 1200);
      }, 1000);
    }, 800);
  };

  // --- 消費税・合計額 自動計算ヘルパー ---
  const calculateTotalAmountFromItems = (items: ReceiptItem[]): number => {
    let sum8 = 0;
    let sum10 = 0;
    let sumOther = 0;

    items.forEach(item => {
      const itemTotal = (item.price || 0) * (item.qty || 1);
      if (item.tax_included) {
        sumOther += itemTotal;
      } else if (item.tax_rate === 8) {
        sum8 += itemTotal;
      } else if (item.tax_rate === 10) {
        sum10 += itemTotal;
      } else {
        // デフォルトは外税10%として扱う、または tax_rate 未定義なら非課税
        if (item.tax_rate === undefined) {
          sumOther += itemTotal;
        } else {
          sumOther += itemTotal;
        }
      }
    });

    const tax8 = Math.floor(sum8 * 0.08);
    const tax10 = Math.floor(sum10 * 0.1);

    return sum8 + tax8 + sum10 + tax10 + sumOther;
  };

  const generateTaxSummaryFromItems = (items: ReceiptItem[]): TaxSummaryItem[] => {
    let sum8Ex = 0;
    let sum10Ex = 0;
    let sum8In = 0;
    let sum10In = 0;
    let sumFree = 0;

    items.forEach(item => {
      const itemTotal = (item.price || 0) * (item.qty || 1);
      if (item.tax_rate === 8) {
        if (item.tax_included) sum8In += itemTotal;
        else sum8Ex += itemTotal;
      } else if (item.tax_rate === 10) {
        if (item.tax_included) sum10In += itemTotal;
        else sum10Ex += itemTotal;
      } else if (item.tax_rate === 0 || item.tax_rate === null) {
        sumFree += itemTotal;
      } else {
        sumFree += itemTotal;
      }
    });

    const summary: TaxSummaryItem[] = [];

    if (sum8Ex > 0) {
      summary.push({
        tax_rate: 8,
        taxable_amount: sum8Ex,
        tax_amount: Math.floor(sum8Ex * 0.08),
        tax_included: false,
      });
    }
    if (sum8In > 0) {
      summary.push({
        tax_rate: 8,
        taxable_amount: sum8In,
        tax_amount: Math.floor((sum8In * 8) / 108),
        tax_included: true,
      });
    }
    if (sum10Ex > 0) {
      summary.push({
        tax_rate: 10,
        taxable_amount: sum10Ex,
        tax_amount: Math.floor(sum10Ex * 0.1),
        tax_included: false,
      });
    }
    if (sum10In > 0) {
      summary.push({
        tax_rate: 10,
        taxable_amount: sum10In,
        tax_amount: Math.floor((sum10In * 10) / 110),
        tax_included: true,
      });
    }
    if (sumFree > 0) {
      summary.push({
        tax_rate: null,
        taxable_amount: sumFree,
        tax_amount: 0,
        tax_included: true,
      });
    }

    return summary;
  };

  // 品目の更新と合計金額の自動計算
  const updateItemsAndTotal = (updatedItems: ReceiptItem[]) => {
    if (!editData) return;
    const newTotal = calculateTotalAmountFromItems(updatedItems);
    const newSummary = generateTaxSummaryFromItems(updatedItems);
    setEditData({
      ...editData,
      items: updatedItems,
      total_amount: newTotal,
      tax_summary: newSummary,
    });
  };

  // 個別の品目フィールドの編集
  const handleItemChange = (index: number, field: keyof ReceiptItem, value: any) => {
    if (!editData || !editData.items) return;
    const updatedItems = [...editData.items];

    if (field === 'price') {
      updatedItems[index] = { ...updatedItems[index], price: parseInt(value) || 0 };
    } else if (field === 'qty') {
      updatedItems[index] = { ...updatedItems[index], qty: parseInt(value) || 1 };
    } else {
      updatedItems[index] = { ...updatedItems[index], [field]: value };
    }

    updateItemsAndTotal(updatedItems);
  };

  // 税区分の切り替え
  const handleTaxChange = (index: number, taxOption: string) => {
    if (!editData || !editData.items) return;
    const updatedItems = [...editData.items];
    let tax_rate: number | null = null;
    let tax_included = true;
    let tax_marker: string | null = null;

    if (taxOption === '8-ex') {
      tax_rate = 8;
      tax_included = false;
      tax_marker = '※';
    } else if (taxOption === '8-in') {
      tax_rate = 8;
      tax_included = true;
      tax_marker = '※';
    } else if (taxOption === '10-ex') {
      tax_rate = 10;
      tax_included = false;
      tax_marker = null;
    } else if (taxOption === '10-in') {
      tax_rate = 10;
      tax_included = true;
      tax_marker = null;
    } else {
      tax_rate = null;
      tax_included = true;
      tax_marker = null;
    }

    updatedItems[index] = {
      ...updatedItems[index],
      tax_rate,
      tax_included,
      tax_marker,
    };
    updateItemsAndTotal(updatedItems);
  };

  // 品目の新規追加
  const handleAddItem = () => {
    if (!editData) return;
    const updatedItems = [
      ...(editData.items || []),
      { name: '', price: 0, qty: 1, tax_rate: 8, tax_included: false, tax_marker: '※' },
    ];
    updateItemsAndTotal(updatedItems);
    setExpandedItemIdx(updatedItems.length - 1);
  };

  // 品目の削除
  const handleRemoveItem = (index: number) => {
    if (!editData || !editData.items) return;
    const updatedItems = editData.items.filter((_, i) => i !== index);
    updateItemsAndTotal(updatedItems);
    setExpandedItemIdx(null);
  };

  // 品目の数量調整 (+1, -1)
  const handleQtyAdjust = (index: number, delta: number) => {
    if (!editData || !editData.items) return;
    const updatedItems = [...editData.items];
    const currentQty = updatedItems[index].qty || 1;
    const newQty = Math.max(1, currentQty + delta);
    updatedItems[index] = { ...updatedItems[index], qty: newQty };
    updateItemsAndTotal(updatedItems);
  };

  // 解析結果の確定保存
  const handleSaveTransaction = async () => {
    if (!editData) return;

    const newTx: Transaction = {
      id: `tx-${Date.now()}`,
      transaction_date: editData.transaction_date || new Date().toISOString().split('T')[0],
      shop_name: editData.shop_name || '不明な店舗',
      total_amount: editData.total_amount || 0,
      category_name: editData.category_name || 'その他',
      items: editData.items || [],
      tax_summary: editData.tax_summary || null,
      receipt_s3_key: editData.receipt_s3_key,
      memo: editData.memo || '',
      created_at: new Date().toISOString(),
    };

    // AWS APIが設定されている場合はサーバーに保存
    if (apiUrl) {
      try {
        const response = await fetchWithAuth(`${apiUrl}/api/transactions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transaction_date: newTx.transaction_date,
            shop_name: newTx.shop_name,
            total_amount: newTx.total_amount,
            category_name: newTx.category_name,
            items: newTx.items,
            tax_summary: newTx.tax_summary,
            receipt_s3_key: editData.receipt_s3_key,
            memo: newTx.memo,
          }),
        });
        if (!response.ok) throw new Error('サーバーへの保存に失敗しました');
        const resData = await response.json();
        // サーバーが返した本物のDynamoDB SKをセットする
        if (resData.transaction_id) {
          newTx.id = resData.transaction_id;
        }
      } catch (err: any) {
        console.warn('サーバー保存エラー。ローカルのみに保存します:', err);
      }
    }

    setTransactions([newTx, ...transactions]);

    // リセット
    setSelectedFile(null);
    setPreviewUrl(null);
    setEditData(null);
    setActiveTab('dashboard');
  };

  // 取引データの更新
  const handleUpdateTransaction = async () => {
    if (!editData || !selectedTransaction) return;

    const updatedTx: Transaction = {
      id: selectedTransaction.id,
      transaction_date: editData.transaction_date || selectedTransaction.transaction_date,
      shop_name: editData.shop_name || selectedTransaction.shop_name,
      total_amount: editData.total_amount || selectedTransaction.total_amount,
      category_name: editData.category_name || selectedTransaction.category_name,
      items: editData.items || selectedTransaction.items,
      tax_summary:
        editData.tax_summary !== undefined ? editData.tax_summary : selectedTransaction.tax_summary,
      memo: editData.memo !== undefined ? editData.memo : selectedTransaction.memo,
      receipt_s3_key: editData.receipt_s3_key || selectedTransaction.receipt_s3_key,
      created_at: selectedTransaction.created_at || new Date().toISOString(),
    };

    if (apiUrl) {
      try {
        const encodedId = encodeURIComponent(selectedTransaction.id);
        const response = await fetchWithAuth(`${apiUrl}/api/transactions/${encodedId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transaction_date: updatedTx.transaction_date,
            shop_name: updatedTx.shop_name,
            total_amount: updatedTx.total_amount,
            category_name: updatedTx.category_name,
            items: updatedTx.items,
            tax_summary: updatedTx.tax_summary,
            receipt_s3_key: updatedTx.receipt_s3_key,
            memo: updatedTx.memo,
          }),
        });
        if (!response.ok) throw new Error('サーバーでの更新に失敗しました');
      } catch (err: any) {
        console.warn('サーバー更新エラー。ローカルのみに保存します:', err);
      }
    }

    setTransactions(transactions.map(t => (t.id === selectedTransaction.id ? updatedTx : t)));

    // リセット
    setEditData(null);
    setSelectedTransaction(null);
  };

  // 取引データの削除
  const handleDeleteTransaction = async (id: string) => {
    if (!window.confirm('この取引データを削除しますか？')) return;

    if (apiUrl) {
      try {
        // キーに含まれる「#」を安全に転送するためにURLエンコードする
        await fetchWithAuth(`${apiUrl}/api/transactions/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
      } catch (err) {
        console.warn('サーバーでの削除に失敗しました（ローカルからのみ削除します）');
      }
    }

    setTransactions(prev => prev.filter(t => t.id !== id));

    if (selectedTransaction?.id === id) {
      setSelectedTransaction(null);
    }
  };

  // 認証ハンドラー
  const handleLogout = () => {
    const savedRefreshToken = localStorage.getItem('snap_kakeibo_refresh_token');

    // UIとローカルストレージを即座にクリア
    localStorage.removeItem('snap_kakeibo_token');
    localStorage.removeItem('snap_kakeibo_refresh_token');
    localStorage.removeItem('snap_kakeibo_user_email');
    localStorage.removeItem('snap_kakeibo_user_role');
    setToken('');
    setAccessToken('');
    setUserEmail('');
    setUserRole('一般');
    setIsNewPasswordRequired(false);
    setCognitoSession('');
    setAuthError('');

    // バックグラウンドでCognito上のトークンを無効化（失敗してもログアウト自体は継続）
    if (savedRefreshToken && cognitoClientId && cognitoClientId !== 'local') {
      cognitoRevokeToken(savedRefreshToken, {
        clientId: cognitoClientId,
        region: cognitoRegion,
      }).catch(err => {
        console.warn('Cognito token revocation failed:', err);
      });
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail || !loginPassword) {
      setAuthError('メールアドレスとパスワードを入力してください。');
      return;
    }

    setAuthLoading(true);
    setAuthError('');

    // ローカル擬似認証モードの場合のバイパス処理
    if (cognitoClientId === 'local') {
      setTimeout(() => {
        completeLogin(`local-token-${loginEmail}`, loginEmail);
        setAuthLoading(false);
      }, 600);
      return;
    }

    try {
      const res = await cognitoSignIn(loginEmail, loginPassword, {
        clientId: cognitoClientId,
        region: cognitoRegion,
      });

      if (res.error) {
        // セキュリティ対策（ユーザー列挙脆弱性の防止）：
        // 存在しないユーザー名の場合も、パスワード誤りと同じ汎用メッセージに統一します。
        const errMsg = res.error.toLowerCase();
        if (
          errMsg.includes('user not found') ||
          errMsg.includes('usernotfoundexception') ||
          errMsg.includes('notauthorizedexception') ||
          errMsg.includes('incorrect username or password') ||
          errMsg.includes('user does not exist')
        ) {
          setAuthError('メールアドレスまたはパスワードが正しくありません。');
        } else {
          setAuthError(res.error);
        }
      } else if (res.challengeName === 'NEW_PASSWORD_REQUIRED' && res.session) {
        setIsNewPasswordRequired(true);
        setCognitoSession(res.session);
      } else if (res.idToken) {
        completeLogin(res.idToken, loginEmail, res.refreshToken, res.accessToken);
      }
    } catch (err: any) {
      setAuthError(err.message || 'ログイン中にエラーが発生しました。');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleNewPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword) {
      setAuthError('新しいパスワードを入力してください。');
      return;
    }

    setAuthLoading(true);
    setAuthError('');

    try {
      const res = await cognitoRespondToNewPasswordRequired(
        loginEmail,
        newPassword,
        cognitoSession,
        {
          clientId: cognitoClientId,
          region: cognitoRegion,
        }
      );

      if (res.error) {
        setAuthError(res.error);
      } else if (res.idToken) {
        setIsNewPasswordRequired(false);
        setCognitoSession('');
        completeLogin(res.idToken, loginEmail, res.refreshToken, res.accessToken);
      }
    } catch (err: any) {
      setAuthError(err.message || 'パスワード変更中にエラーが発生しました。');
    } finally {
      setAuthLoading(false);
    }
  };

  const formatCreatedAt = (val: any) => {
    if (!val) return '不明';
    try {
      if (typeof val === 'string' && val.includes('-')) {
        return new Date(val).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });
      }
      const num = Number(val);
      if (!isNaN(num)) {
        const ms = num < 10000000000 ? num * 1000 : num;
        return new Date(ms).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });
      }
      return String(val);
    } catch (e) {
      return '不明';
    }
  };

  const loadPasskeys = useCallback(async () => {
    if (!accessToken || cognitoClientId === 'local') return;
    setPasskeysLoading(true);
    try {
      const res = await cognitoListWebAuthnCredentials(accessToken, {
        clientId: cognitoClientId,
        region: cognitoRegion,
      });
      if (res && res.Credentials) {
        setRegisteredPasskeys(res.Credentials);
      }
    } catch (err: any) {
      console.error('Failed to list passkeys:', err);
    } finally {
      setPasskeysLoading(false);
    }
  }, [accessToken, cognitoClientId, cognitoRegion]);

  const handlePasskeyDelete = async (credentialId: string) => {
    if (!window.confirm('このパスキーを削除してもよろしいですか？')) return;
    if (!accessToken) return;
    setPasskeysLoading(true);
    try {
      await cognitoDeleteWebAuthnCredential(accessToken, credentialId, {
        clientId: cognitoClientId,
        region: cognitoRegion,
      });
      alert('パスキーを削除しました。');
      await loadPasskeys();
    } catch (err: any) {
      console.error('Failed to delete passkey:', err);
      alert(err.message || 'パスキーの削除中にエラーが発生しました。');
      setPasskeysLoading(false);
    }
  };

  const handleViewReceipt = async () => {
    if (showReceiptImage) {
      setShowReceiptImage(false);
      return;
    }
    if (viewReceiptUrl) {
      setShowReceiptImage(true);
      return;
    }
    const s3Key = editData?.receipt_s3_key;
    if (!s3Key) return;

    // ローカル環境またはデモ用のS3キーの場合は直接ローカルアセットを参照
    if (cognitoClientId === 'local' || s3Key === 'demo_receipt.png') {
      setViewReceiptUrl('/demo_receipt.png');
      setShowReceiptImage(true);
      return;
    }

    setViewReceiptLoading(true);
    try {
      const res = await fetchWithAuth(
        `${apiUrl}/api/receipts/view-url?file_key=${encodeURIComponent(s3Key)}`
      );
      if (!res.ok) throw new Error('画像の取得に失敗しました');
      const data = await res.json();
      setViewReceiptUrl(data.view_url);
      setShowReceiptImage(true);
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'レシート画像の取得中にエラーが発生しました。');
    } finally {
      setViewReceiptLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'settings' && accessToken && cognitoClientId !== 'local') {
      loadPasskeys();
    }
  }, [activeTab, accessToken, cognitoClientId, loadPasskeys]);

  const handlePasskeyRegister = async () => {
    if (!accessToken) {
      alert('パスキーを登録するには、ログインしている必要があります。');
      return;
    }

    setAuthLoading(true);
    setAuthError('');

    try {
      // 1. パスキー登録の開始
      const res = await cognitoStartWebAuthnRegistration(accessToken, {
        clientId: cognitoClientId,
        region: cognitoRegion,
      });

      const rawOptions = res.CredentialCreationOptions;
      if (!rawOptions) {
        throw new Error('パスキー登録パラメータの取得に失敗しました。');
      }

      // 2. クレデンシャル作成オプションをWebAuthn用にバイナリ化
      const options = {
        ...rawOptions,
        challenge: base64UrlToArrayBuffer(rawOptions.challenge),
        user: {
          ...rawOptions.user,
          id: base64UrlToArrayBuffer(rawOptions.user.id),
        },
        excludeCredentials: rawOptions.excludeCredentials
          ? rawOptions.excludeCredentials.map((cred: any) => ({
              ...cred,
              id: base64UrlToArrayBuffer(cred.id),
            }))
          : undefined,
      };

      // 3. ブラウザで認証情報を生成
      const credential = (await navigator.credentials.create({
        publicKey: options,
      })) as PublicKeyCredential;

      if (!credential) {
        throw new Error('パスキーの生成に失敗しました。');
      }

      // 4. 生成されたアテステーションレスポンスをBase64URLに変換
      const response = credential.response as AuthenticatorAttestationResponse;
      const credentialObj = {
        id: credential.id,
        rawId: arrayBufferToBase64Url(credential.rawId),
        type: credential.type,
        response: {
          clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
          attestationObject: arrayBufferToBase64Url(response.attestationObject),
          transports: typeof response.getTransports === 'function' ? response.getTransports() : [],
        },
        authenticatorAttachment: credential.authenticatorAttachment,
      };

      // 5. 登録の完了
      await cognitoCompleteWebAuthnRegistration(accessToken, credentialObj, {
        clientId: cognitoClientId,
        region: cognitoRegion,
      });

      alert('パスキーを正常に登録しました！次回からパスキーでログインできます。');
      await loadPasskeys();
    } catch (err: any) {
      console.error(err);
      if (err.name === 'NotAllowedError') {
        alert('パスキー登録がキャンセルされました。');
      } else if (
        err.name === 'InvalidStateError' ||
        (err.message && err.message.toLowerCase().includes('invalid state'))
      ) {
        alert('このパスキー（またはデバイス）は既に登録されています。');
      } else {
        const msg = err.message || '';
        if (msg.includes('already registered')) {
          alert('このパスキー（またはデバイス）は既に登録されています。');
        } else if (msg.includes('not enabled')) {
          alert('このユーザープールではパスキー（WebAuthn）認証が有効化されていません。');
        } else if (msg.includes('not valid')) {
          alert('登録しようとしたパスキー情報が無効です。');
        } else {
          alert(msg || 'パスキー登録中にエラーが発生しました。');
        }
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    if (!loginEmail) {
      setAuthError('パスキーでログインするには、まずメールアドレスを入力してください。');
      return;
    }

    setAuthLoading(true);
    setAuthError('');

    try {
      // 1. パスキー認証の開始 (USER_AUTH flow)
      const res = await cognitoInitiateUserAuth(loginEmail, {
        clientId: cognitoClientId,
        region: cognitoRegion,
      });

      if (res.ChallengeName !== 'WEB_AUTHN') {
        throw new Error(
          'パスキー認証に対応していません。設定からパスキーを登録しているかご確認ください。'
        );
      }

      const session = res.Session;
      const challengeParams = res.ChallengeParameters;
      const credentialRequestOptionsStr = challengeParams.CREDENTIAL_REQUEST_OPTIONS;
      if (!credentialRequestOptionsStr) {
        throw new Error('認証パラメータの取得に失敗しました。');
      }

      // 2. クレデンシャルリクエストオプションをパースしてWebAuthn用に変換
      const rawOptions = JSON.parse(credentialRequestOptionsStr);
      const options = {
        ...rawOptions,
        challenge: base64UrlToArrayBuffer(rawOptions.challenge),
        allowCredentials: rawOptions.allowCredentials
          ? rawOptions.allowCredentials.map((cred: any) => ({
              ...cred,
              id: base64UrlToArrayBuffer(cred.id),
            }))
          : undefined,
      };

      // 3. ブラウザで認証情報を取得
      const assertion = (await navigator.credentials.get({
        publicKey: options,
      })) as PublicKeyCredential;

      if (!assertion) {
        throw new Error('パスキーアサーションの取得に失敗しました。');
      }

      // 4. アサーションのバイナリフィールドをBase64URLに変換
      const response = assertion.response as AuthenticatorAssertionResponse;
      const credentialObj = {
        id: assertion.id,
        rawId: arrayBufferToBase64Url(assertion.rawId),
        type: assertion.type,
        response: {
          clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
          authenticatorData: arrayBufferToBase64Url(response.authenticatorData),
          signature: arrayBufferToBase64Url(response.signature),
          userHandle: response.userHandle ? arrayBufferToBase64Url(response.userHandle) : null,
        },
      };

      // 5. チャレンジに回答
      const signInRes = await cognitoRespondToWebAuthnChallenge(
        loginEmail,
        session,
        credentialObj,
        {
          clientId: cognitoClientId,
          region: cognitoRegion,
        }
      );

      if (signInRes.error) {
        setAuthError(signInRes.error);
      } else if (signInRes.idToken) {
        completeLogin(signInRes.idToken, loginEmail, signInRes.refreshToken, signInRes.accessToken);
      }
    } catch (err: any) {
      console.error(err);
      if (err.name === 'NotAllowedError') {
        setAuthError('パスキー認証がキャンセルされました。');
      } else {
        const msg = err.message || '';
        if (msg.includes('user not found') || msg.includes('UserNotFoundException')) {
          setAuthError('ユーザーが見つかりません。入力したメールアドレスをご確認ください。');
        } else if (msg.includes('not enabled')) {
          setAuthError('このユーザープールではパスキー（WebAuthn）認証が有効化されていません。');
        } else {
          setAuthError(msg || 'パスキーログイン中にエラーが発生しました。');
        }
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const completeLogin = (
    idToken: string,
    email: string,
    refreshToken?: string,
    accessTok?: string
  ) => {
    // 開発用の擬似認証（local）の場合のみ、ID TokenをlocalStorageに永続化し、本番環境ではメモリ上（state）のみで保持します。
    if (cognitoClientId === 'local') {
      localStorage.setItem('snap_kakeibo_token', idToken);
    }
    localStorage.setItem('snap_kakeibo_user_email', email);
    if (refreshToken) {
      localStorage.setItem('snap_kakeibo_refresh_token', refreshToken);
    }

    if (rememberEmail) {
      localStorage.setItem('snap_kakeibo_remember_email', 'true');
      localStorage.setItem('snap_kakeibo_saved_email', email);
    } else {
      localStorage.setItem('snap_kakeibo_remember_email', 'false');
      localStorage.removeItem('snap_kakeibo_saved_email');
    }

    let role = '一般';
    try {
      const payloadBase64 = idToken.split('.')[1];
      const decodedPayload = JSON.parse(atob(payloadBase64));
      const groups = decodedPayload['cognito:groups'] || [];
      if (groups.includes('Admins')) {
        role = '管理者';
      }
    } catch (err) {
      console.warn('トークンの解析に失敗しました:', err);
    }

    localStorage.setItem('snap_kakeibo_user_role', role);
    setToken(idToken);
    setAccessToken(accessTok || '');
    setUserEmail(email);
    setUserRole(role);
    setLoginPassword('');
    setNewPassword('');
    setAuthError('');
  };

  // 設定保存
  const saveSettings = () => {
    localStorage.setItem('snap_kakeibo_budget', monthlyBudget.toString());
    alert('設定を保存しました。');
  };

  const isAuthRequired = !!cognitoClientId;

  if (isAuthRequired && isAuthChecking) {
    return (
      <div
        className="app-container"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          background: 'var(--bg-dark)',
          color: 'var(--text-light)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <RefreshCw
            className="animate-spin-fast"
            size={24}
            style={{ color: 'var(--accent-purple)' }}
          />
          <span style={{ fontSize: '16px', fontWeight: '500' }}>セッションを検証中...</span>
        </div>
      </div>
    );
  }

  if (isAuthRequired && !token) {
    return (
      <div
        className="app-container"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '20px',
        }}
      >
        <GradientDefs />

        {/* ガラスモルフィズム調のログインフォーム */}
        <div
          className="glass-card"
          style={{
            width: '100%',
            maxWidth: '420px',
            background:
              'linear-gradient(135deg, rgba(27, 20, 52, 0.8) 0%, rgba(15, 18, 36, 0.8) 100%)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.3)',
            borderRadius: '24px',
            padding: '40px 30px',
            textAlign: 'center',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: '-100px',
              right: '-100px',
              width: '200px',
              height: '200px',
              background: 'var(--accent-purple)',
              filter: 'blur(80px)',
              opacity: 0.25,
              borderRadius: '50%',
            }}
          />

          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
            <div
              style={{
                background: 'var(--grad-primary)',
                width: '54px',
                height: '54px',
                borderRadius: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: 'var(--glow-purple)',
              }}
            >
              <Camera size={28} color="#fff" />
            </div>
          </div>

          <h2
            style={{
              fontSize: '24px',
              fontWeight: 800,
              letterSpacing: '-0.5px',
              marginBottom: '6px',
            }}
          >
            Snap
            <span
              style={{
                background: 'var(--grad-accent)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              Kakeibo
            </span>
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '30px' }}>
            招待者用のログイン画面です。管理者から付与されたアカウント情報でログインしてください。
          </p>

          {authError && (
            <div
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                borderRadius: '12px',
                padding: '12px',
                fontSize: '13px',
                color: '#f87171',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                marginBottom: '20px',
              }}
            >
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>{authError}</span>
            </div>
          )}

          {!isNewPasswordRequired ? (
            // 通常ログインフォーム
            <form
              onSubmit={handleLoginSubmit}
              style={{ display: 'flex', flexDirection: 'column', gap: '18px', textAlign: 'left' }}
            >
              <div className="form-group" style={{ margin: 0 }}>
                <label
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    marginBottom: '6px',
                    display: 'block',
                  }}
                >
                  メールアドレス
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="email"
                    className="form-control"
                    placeholder="your-email@example.com"
                    style={{ paddingLeft: '40px' }}
                    value={loginEmail}
                    onChange={e => setLoginEmail(e.target.value)}
                    disabled={authLoading}
                  />
                  <Mail
                    size={16}
                    color="var(--text-muted)"
                    style={{ position: 'absolute', left: '14px', top: '15px' }}
                  />
                </div>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    marginBottom: '6px',
                    display: 'block',
                  }}
                >
                  パスワード
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="password"
                    className="form-control"
                    placeholder="パスワードを入力"
                    style={{ paddingLeft: '40px' }}
                    value={loginPassword}
                    onChange={e => setLoginPassword(e.target.value)}
                    disabled={authLoading}
                  />
                  <Lock
                    size={16}
                    color="var(--text-muted)"
                    style={{ position: 'absolute', left: '14px', top: '15px' }}
                  />
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginTop: '-4px',
                  userSelect: 'none',
                }}
              >
                <input
                  type="checkbox"
                  id="remember-email"
                  checked={rememberEmail}
                  onChange={e => setRememberEmail(e.target.checked)}
                  style={{
                    cursor: 'pointer',
                    width: '16px',
                    height: '16px',
                    accentColor: 'var(--accent-purple)',
                  }}
                />
                <label
                  htmlFor="remember-email"
                  style={{
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
                >
                  メールアドレスを記憶する
                </label>
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                style={{
                  width: '100%',
                  marginTop: '10px',
                  height: '46px',
                  fontSize: '14px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                }}
                disabled={authLoading}
              >
                {authLoading ? 'ログイン中...' : 'ログイン'}
              </button>

              {cognitoClientId !== 'local' && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handlePasskeyLogin}
                  style={{
                    width: '100%',
                    height: '46px',
                    fontSize: '14px',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                  }}
                  disabled={authLoading}
                >
                  <Key size={16} />
                  パスキーでログイン
                </button>
              )}
            </form>
          ) : (
            // 初回パスワード強制変更フォーム
            <form
              onSubmit={handleNewPasswordSubmit}
              style={{ display: 'flex', flexDirection: 'column', gap: '18px', textAlign: 'left' }}
            >
              <div
                style={{
                  background: 'rgba(59, 130, 246, 0.1)',
                  border: '1px solid rgba(59, 130, 246, 0.2)',
                  borderRadius: '12px',
                  padding: '12px',
                  fontSize: '12px',
                  color: '#60a5fa',
                  lineHeight: 1.4,
                  marginBottom: '10px',
                }}
              >
                <strong>【初回ログインチャレンジ】</strong>
                <br />
                安全のため、管理者から提供された仮パスワードから、新しくあなた専用の永続パスワードを設定する必要があります。
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    marginBottom: '6px',
                    display: 'block',
                  }}
                >
                  新しいパスワード (8文字以上)
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="password"
                    className="form-control"
                    placeholder="新しいパスワードを設定"
                    style={{ paddingLeft: '40px' }}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    disabled={authLoading}
                  />
                  <Lock
                    size={16}
                    color="var(--text-muted)"
                    style={{ position: 'absolute', left: '14px', top: '15px' }}
                  />
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                style={{
                  width: '100%',
                  marginTop: '10px',
                  height: '46px',
                  fontSize: '14px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                }}
                disabled={authLoading}
              >
                {authLoading ? '設定中...' : '新パスワードを設定して完了'}
              </button>

              <button
                type="button"
                className="btn"
                style={{
                  width: '100%',
                  height: '40px',
                  fontSize: '13px',
                  color: 'var(--text-secondary)',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.05)',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  setIsNewPasswordRequired(false);
                  setAuthError('');
                }}
                disabled={authLoading}
              >
                キャンセル
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <GradientDefs />

      {/* --- ヘッダー --- */}
      <header
        style={{
          padding: '24px 20px 10px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'rgba(9, 10, 15, 0.6)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          position: 'sticky',
          top: 0,
          zIndex: 50,
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              background: 'var(--grad-primary)',
              width: '38px',
              height: '38px',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 15px rgba(139, 92, 246, 0.5)',
            }}
          >
            <Camera size={20} color="#fff" />
          </div>
          <div>
            <h1
              style={{
                fontSize: '18px',
                fontWeight: 800,
                letterSpacing: '-0.5px',
                lineHeight: 1.2,
              }}
            >
              Snap
              <span className="gradient-text">Kakeibo</span>
            </h1>
            <p
              style={{
                fontSize: '9px',
                color: 'var(--text-secondary)',
                fontWeight: 500,
                letterSpacing: '0.5px',
              }}
            >
              RECEIPT SCAN & ANALYTICS
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {token && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                padding: '4px 10px',
                borderRadius: '20px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '11px',
                  color: 'var(--text-primary)',
                  fontWeight: 500,
                  maxWidth: '90px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                <User size={10} color="var(--text-secondary)" />
                <span>{userEmail.split('@')[0]}</span>
              </div>
              <div
                style={{
                  width: '1px',
                  height: '10px',
                  background: 'rgba(255,255,255,0.1)',
                }}
              />
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '2px',
                  fontSize: '9px',
                  color: userRole === '管理者' ? '#a78bfa' : 'var(--text-secondary)',
                  background:
                    userRole === '管理者' ? 'rgba(167, 139, 250, 0.1)' : 'rgba(255,255,255,0.05)',
                  padding: '2px 6px',
                  borderRadius: '10px',
                  fontWeight: 600,
                }}
              >
                <span>{userRole}</span>
              </div>
            </div>
          )}

          {token && (
            <button
              onClick={() => {
                // If we scroll down or click, we trigger refresh
                setRefreshKey(prev => prev + 1);
              }}
              style={{
                background: 'transparent',
                border: 'none',
                borderRadius: '50%',
                width: '44px',
                height: '44px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              title="更新"
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <RefreshCw
                size={18}
                color="var(--text-muted)"
                className={isRefreshing ? 'animate-spin-fast' : ''}
              />
            </button>
          )}

          {token && (
            <button
              onClick={handleLogout}
              style={{
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.15)',
                borderRadius: '50%',
                width: '44px',
                height: '44px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              title="ログアウト"
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
                e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.4)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)';
                e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.15)';
              }}
            >
              <LogOut size={16} color="#f87171" />
            </button>
          )}

          {!token && (
            <div
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.08)',
                padding: '4px 10px',
                borderRadius: '20px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Sparkles size={12} color="#ffd43b" />
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#ffd43b' }}>
                Local Mode
              </span>
            </div>
          )}
        </div>
      </header>

      {/* --- メインコンテンツ領域 --- */}
      <main style={{ padding: '20px', flex: 1 }}>
        {/* ==================== 1. DASHBOARD TAB ==================== */}
        {activeTab === 'dashboard' && (
          <div>
            {/* 月選択セレクター */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
              }}
            >
              <h3 style={{ fontSize: '16px', fontWeight: 700, margin: 0, color: '#fff' }}>
                収支ダッシュボード
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Calendar size={14} color="var(--text-muted)" />
                <select
                  value={selectedMonth}
                  onChange={e => setSelectedMonth(e.target.value)}
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '8px',
                    color: '#fff',
                    padding: '4px 8px',
                    fontSize: '13px',
                    fontWeight: 600,
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {getSelectableMonths().map(m => {
                    const [y, mm] = m.split('-');
                    return (
                      <option key={m} value={m} style={{ background: '#131520', color: '#fff' }}>
                        {y}年{parseInt(mm)}月
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            {/* 総支出カード */}
            <div
              className="glass-card"
              style={{
                background:
                  'linear-gradient(135deg, rgba(27, 20, 52, 0.9) 0%, rgba(15, 18, 36, 0.9) 100%)',
                position: 'relative',
                overflow: 'hidden',
                border: '1px solid rgba(139, 92, 246, 0.2)',
                boxShadow: '0 8px 32px 0 rgba(139, 92, 246, 0.15)',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: '-30px',
                  right: '-30px',
                  width: '120px',
                  height: '120px',
                  background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-pink))',
                  filter: 'blur(60px)',
                  opacity: 0.4,
                  borderRadius: '50%',
                }}
              />

              <p
                style={{
                  fontSize: '13px',
                  color: 'var(--text-secondary)',
                  fontWeight: 600,
                  letterSpacing: '0.5px',
                }}
              >
                今月の総支出
              </p>
              <h2
                className="numeric gradient-text"
                style={{
                  fontSize: '44px',
                  fontWeight: 800,
                  margin: '6px 0',
                  letterSpacing: '-1.5px',
                  display: 'inline-block',
                }}
              >
                ¥{totalMonthlySpend.toLocaleString()}
              </h2>
            </div>

            {/* 予算ゲージカード */}
            <div
              className={`glass-card ${totalMonthlySpend > monthlyBudget ? 'pulsing-danger' : ''}`}
              style={{
                padding: '18px 20px',
                marginBottom: '16px',
                border:
                  totalMonthlySpend > monthlyBudget
                    ? '1px solid rgba(236, 72, 153, 0.4)'
                    : '1px solid var(--bg-card-border)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '10px',
                }}
              >
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                  今月の予算使用状況
                </span>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  予算: ¥{monthlyBudget.toLocaleString()}
                </span>
              </div>

              {/* プログレスバー */}
              <div
                style={{
                  width: '100%',
                  height: '12px',
                  borderRadius: '6px',
                  background: 'rgba(255, 255, 255, 0.04)',
                  overflow: 'hidden',
                  position: 'relative',
                  marginBottom: '12px',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, (totalMonthlySpend / monthlyBudget) * 100)}%`,
                    height: '100%',
                    borderRadius: '6px',
                    background:
                      totalMonthlySpend > monthlyBudget
                        ? 'linear-gradient(90deg, #ec4899 0%, #ef4444 100%)'
                        : 'linear-gradient(90deg, #8b5cf6 0%, #3b82f6 100%)',
                    boxShadow:
                      totalMonthlySpend > monthlyBudget
                        ? '0 0 10px rgba(236, 72, 153, 0.5)'
                        : '0 0 10px rgba(139, 92, 246, 0.5)',
                    transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '12px',
                }}
              >
                <span
                  style={{
                    color: totalMonthlySpend > monthlyBudget ? '#f87171' : 'var(--text-secondary)',
                    fontWeight: 500,
                  }}
                >
                  {totalMonthlySpend > monthlyBudget
                    ? `予算を ¥${(totalMonthlySpend - monthlyBudget).toLocaleString()} 超過しています`
                    : `残り: ¥${(monthlyBudget - totalMonthlySpend).toLocaleString()}`}
                </span>
                <span className="numeric" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  {((totalMonthlySpend / monthlyBudget) * 100).toFixed(1)}%
                </span>
              </div>
            </div>

            {/* グラフエリア */}
            <div className="glass-card">
              <h3
                style={{
                  fontSize: '15px',
                  fontWeight: 600,
                  marginBottom: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <TrendingUp size={18} color="#8b5cf6" />
                {parseInt(selectedMonth.split('-')[1])}月の支出推移
              </h3>
              <div style={{ width: '100%', height: 160 }}>
                <ResponsiveContainer>
                  <AreaChart
                    data={getLineChartData()}
                    margin={{ top: 5, right: 5, left: -25, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="name"
                      stroke="rgba(255,255,255,0.4)"
                      fontSize={11}
                      tickLine={false}
                    />
                    <YAxis stroke="rgba(255,255,255,0.4)" fontSize={11} tickLine={false} />
                    <Tooltip
                      contentStyle={{
                        background: 'rgba(18,20,32,0.95)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '12px',
                        color: '#fff',
                      }}
                      labelStyle={{ color: 'var(--text-secondary)' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="amount"
                      stroke="#8b5cf6"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorAmount)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* カテゴリ割合グラフ */}
            <div className="glass-card">
              <h3
                style={{
                  fontSize: '15px',
                  fontWeight: 600,
                  marginBottom: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <ShoppingBag size={18} color="#ec4899" />
                カテゴリ割合
              </h3>
              {getPieChartData().length === 0 ? (
                <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px 0' }}>
                  データがありません
                </p>
              ) : (
                <div
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <div style={{ width: '50%', height: 140 }}>
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie
                          data={getPieChartData()}
                          cx="50%"
                          cy="50%"
                          innerRadius={35}
                          outerRadius={55}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {getPieChartData().map((entry, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={CATEGORY_COLORS[entry.name] || '#868e96'}
                            />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  {/* カスタム凡例 */}
                  <div
                    style={{ width: '45%', display: 'flex', flexDirection: 'column', gap: '6px' }}
                  >
                    {getPieChartData().map((entry, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: '12px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div
                            style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              background: CATEGORY_COLORS[entry.name] || '#868e96',
                            }}
                          />
                          <span style={{ color: 'var(--text-secondary)' }}>{entry.name}</span>
                        </div>
                        <span className="numeric" style={{ fontWeight: 600 }}>
                          ¥{entry.value.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 最近の支出セクション（直近2週間） */}
            <div className="glass-card" style={{ marginBottom: '20px' }}>
              <h3
                style={{
                  fontSize: '15px',
                  fontWeight: 600,
                  marginBottom: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <History size={18} color="#a78bfa" />
                最近の支出
              </h3>

              {getRecentTransactions().length === 0 ? (
                <p
                  style={{
                    textAlign: 'center',
                    color: 'var(--text-muted)',
                    padding: '16px 0',
                    fontSize: '13px',
                  }}
                >
                  最近の支出はありません
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {getRecentTransactions()
                    .slice(0, 5)
                    .map(t => (
                      <div
                        key={t.id}
                        onClick={() => {
                          setSelectedTransaction(t);
                          setEditData({ ...t });
                        }}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '10px 14px',
                          background: 'rgba(255, 255, 255, 0.02)',
                          border: '1px solid rgba(255, 255, 255, 0.03)',
                          borderRadius: '12px',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          gap: '16px',
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                          e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.2)';
                          e.currentTarget.style.transform = 'translateX(2px)';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
                          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.03)';
                          e.currentTarget.style.transform = 'translateX(0)';
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          <div
                            style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              background: CATEGORY_COLORS[t.category_name] || '#868e96',
                              flexShrink: 0,
                            }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <h4
                              style={{
                                fontSize: '13px',
                                fontWeight: 600,
                                color: 'var(--text-primary)',
                                margin: 0,
                                wordBreak: 'break-word',
                              }}
                            >
                              {t.shop_name}
                            </h4>
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                              {t.transaction_date}
                            </span>
                          </div>
                        </div>
                        <span
                          className="numeric"
                          style={{
                            fontSize: '14px',
                            fontWeight: 700,
                            color: 'var(--text-primary)',
                            flexShrink: 0,
                          }}
                        >
                          ¥{t.total_amount.toLocaleString()}
                        </span>
                      </div>
                    ))}

                  <button
                    onClick={() => setActiveTab('history')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--accent-purple)',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      textAlign: 'center',
                      marginTop: '4px',
                      padding: '4px 0',
                      display: 'block',
                      width: '100%',
                      transition: 'color 0.2s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.color = '#a78bfa';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.color = 'var(--accent-purple)';
                    }}
                  >
                    すべての履歴を見る ({transactions.length}件)
                  </button>
                </div>
              )}
            </div>

            {/* クイックスタートボタン */}
            <button
              onClick={() => setActiveTab('scan')}
              className="btn-primary"
              style={{
                width: '100%',
                padding: '16px',
                borderRadius: '20px',
                fontSize: '16px',
                position: 'relative',
              }}
            >
              <Camera size={20} style={{ position: 'absolute', left: '20px' }} />
              レシートをスキャンする
            </button>
          </div>
        )}

        {/* ==================== 2. SCAN & REVIEW TAB ==================== */}
        {activeTab === 'scan' && (
          <div>
            {!previewUrl && !editData && (
              <div className="glass-card" style={{ padding: '40px 20px', textAlign: 'center' }}>
                <label className="upload-zone" style={{ display: 'block' }}>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                  />
                  <div
                    style={{
                      width: '64px',
                      height: '64px',
                      borderRadius: '50%',
                      background: 'rgba(139, 92, 246, 0.1)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      margin: '0 auto 16px',
                    }}
                  >
                    <Upload size={32} color="#8b5cf6" />
                  </div>
                  <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>
                    レシート写真をアップロード
                  </h3>
                  <p
                    style={{
                      fontSize: '13px',
                      color: 'var(--text-secondary)',
                      marginBottom: '16px',
                    }}
                  >
                    カメラで撮影、またはライブラリから選択
                  </p>
                  <span
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      padding: '6px 12px',
                      borderRadius: '20px',
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                    }}
                  >
                    対応形式: JPG, JPEG, PNG
                  </span>
                </label>

                <div
                  style={{
                    marginTop: '24px',
                    paddingTop: '24px',
                    borderTop: '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  <button
                    onClick={() => {
                      const today = new Date().toISOString().split('T')[0];
                      setEditData({
                        transaction_date: today,
                        shop_name: '',
                        total_amount: 0,
                        category_name: 'その他',
                        items: [],
                        tax_summary: [],
                        memo: '',
                      });
                    }}
                    className="btn-secondary"
                    style={{
                      width: '100%',
                      padding: '12px',
                      borderRadius: '16px',
                      fontSize: '14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                    }}
                  >
                    <Plus size={18} />
                    手動で入力する
                  </button>
                </div>
              </div>
            )}

            {/* プレビュー & スキャン実行中 */}
            {previewUrl && !editData && (
              <div className="glass-card" style={{ textAlign: 'center' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>
                  {isScanning ? 'AIスキャン解析中' : '選択された画像'}
                </h3>

                <div className="scan-container">
                  <img src={previewUrl} alt="Receipt Preview" className="scan-image" />
                  {isScanning && <div className="scan-line" />}
                </div>

                {isScanning ? (
                  <div style={{ marginTop: '24px' }}>
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        color: 'var(--accent-purple)',
                        fontWeight: 600,
                        fontSize: '14px',
                        marginBottom: '8px',
                      }}
                    >
                      <Sparkles className="animate-spin" size={16} />
                      <span>{scanStep}</span>
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      AIがレシートを解析し、構造化しています。数秒お待ちください...
                    </p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
                    <button
                      onClick={() => {
                        setSelectedFile(null);
                        setPreviewUrl(null);
                      }}
                      className="btn-secondary"
                      style={{ flex: 1 }}
                    >
                      やり直す
                    </button>
                    <button
                      onClick={triggerScan}
                      className="btn-primary"
                      style={{ flex: 2, position: 'relative' }}
                    >
                      <Sparkles size={18} style={{ position: 'absolute', left: '20px' }} />
                      AIスキャンを開始
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 解析結果プレビュー & 編集画面 */}
            {editData && (
              <div className="glass-card">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '20px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Sparkles size={20} color="#8b5cf6" />
                    <h3 style={{ fontSize: '17px', fontWeight: 700 }}>
                      {previewUrl ? 'AI解析結果' : '手動入力'}
                    </h3>
                  </div>
                  <button
                    onClick={() => {
                      setEditData(null);
                      setSelectedFile(null);
                      setPreviewUrl(null);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="form-group">
                  <label>店舗名</label>
                  <input
                    type="text"
                    className="form-control"
                    value={editData.shop_name || ''}
                    onChange={e => setEditData({ ...editData, shop_name: e.target.value })}
                  />
                </div>

                <div>
                  <div className="form-group">
                    <label>日付</label>
                    <input
                      type="date"
                      className="form-control"
                      value={editData.transaction_date || ''}
                      onChange={e => setEditData({ ...editData, transaction_date: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>カテゴリ</label>
                    <select
                      className="form-control"
                      value={editData.category_name || 'その他'}
                      onChange={e => setEditData({ ...editData, category_name: e.target.value })}
                    >
                      {Object.keys(CATEGORY_COLORS).map(cat => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 品目リスト (インライン編集・追加・削除機能付き) */}
                <div style={{ margin: '20px 0' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '10px',
                    }}
                  >
                    <label
                      style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}
                    >
                      購入品目内訳
                    </label>
                    <button
                      type="button"
                      onClick={handleAddItem}
                      style={{
                        background: 'rgba(139, 92, 246, 0.1)',
                        border: '1px solid rgba(139, 92, 246, 0.25)',
                        borderRadius: '20px',
                        color: '#a78bfa',
                        padding: '4px 14px 4px 22px',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        position: 'relative',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = 'rgba(139, 92, 246, 0.2)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'rgba(139, 92, 246, 0.1)';
                      }}
                    >
                      <Plus size={12} style={{ position: 'absolute', left: '6px' }} />
                      追加
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {editData.items &&
                      editData.items.map((item, idx) => {
                        const isExpanded = expandedItemIdx === idx;
                        const subtotal = (item.price || 0) * (item.qty || 1);
                        return (
                          <div key={idx} className="ios-item-card" style={{ padding: '12px 14px' }}>
                            {/* アコーディオンヘッダー（クリックで開閉） */}
                            <div
                              className="accordion-header"
                              onClick={() => setExpandedItemIdx(isExpanded ? null : idx)}
                              style={{ gap: '12px' }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                  flex: 1,
                                  minWidth: 0,
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: '14px',
                                    fontWeight: 600,
                                    color: '#fff',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    flex: '0 1 auto',
                                  }}
                                >
                                  {item.name || '品目未入力'}
                                </span>
                                <span className="tax-badge">
                                  {item.tax_rate ? `${item.tax_rate}%` : '免税'}
                                </span>
                              </div>

                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '12px',
                                  flexShrink: 0,
                                }}
                              >
                                <div style={{ textAlign: 'right' }}>
                                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                    ¥{item.price || 0} × {item.qty || 1}
                                  </div>
                                  <div
                                    className="numeric"
                                    style={{
                                      fontSize: '14px',
                                      fontWeight: 700,
                                      color: 'var(--text-primary)',
                                    }}
                                  >
                                    ¥{subtotal.toLocaleString()}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={e => {
                                    e.stopPropagation();
                                    handleRemoveItem(idx);
                                  }}
                                  style={{
                                    background: 'rgba(239, 68, 68, 0.08)',
                                    border: '1px solid rgba(239, 68, 68, 0.15)',
                                    borderRadius: '8px',
                                    width: '40px',
                                    height: '36px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: '#f87171',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                    padding: 0,
                                  }}
                                  onMouseEnter={e => {
                                    e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)';
                                    e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.3)';
                                    e.currentTarget.style.color = '#ef4444';
                                  }}
                                  onMouseLeave={e => {
                                    e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)';
                                    e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.15)';
                                    e.currentTarget.style.color = '#f87171';
                                  }}
                                  title="この品目を削除"
                                >
                                  <Trash2 size={16} />
                                </button>
                                {isExpanded ? (
                                  <ChevronUp size={16} color="var(--text-secondary)" />
                                ) : (
                                  <ChevronDown size={16} color="var(--text-secondary)" />
                                )}
                              </div>
                            </div>

                            {/* アコーディオンボディ */}
                            <div className={`accordion-body ${isExpanded ? 'open' : ''}`}>
                              {/* 1行目: 品目名と削除ボタン */}
                              <div
                                style={{
                                  display: 'flex',
                                  gap: '8px',
                                  width: '100%',
                                  alignItems: 'center',
                                  marginBottom: '8px',
                                }}
                              >
                                <input
                                  type="text"
                                  className="premium-input"
                                  placeholder="品目名（例：牛乳）"
                                  value={item.name}
                                  onChange={e => handleItemChange(idx, 'name', e.target.value)}
                                  style={{
                                    flex: 1,
                                    height: '44px',
                                    fontSize: '15px',
                                    fontWeight: 500,
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={() => handleRemoveItem(idx)}
                                  style={{
                                    background: 'rgba(239, 68, 68, 0.08)',
                                    border: '1px solid rgba(239, 68, 68, 0.15)',
                                    borderRadius: '12px',
                                    width: '44px',
                                    height: '44px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: '#f87171',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                    flexShrink: 0,
                                  }}
                                  onMouseEnter={e => {
                                    e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)';
                                    e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.3)';
                                    e.currentTarget.style.color = '#ef4444';
                                  }}
                                  onMouseLeave={e => {
                                    e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)';
                                    e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.15)';
                                    e.currentTarget.style.color = '#f87171';
                                  }}
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>

                              {/* 2行目: 単価、数量ステッパー、税区分 */}
                              <div
                                style={{
                                  display: 'flex',
                                  gap: '6px',
                                  width: '100%',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  flexWrap: 'nowrap',
                                }}
                              >
                                {/* 単価入力 */}
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    flex: 1.2,
                                    minWidth: '75px',
                                    position: 'relative',
                                  }}
                                >
                                  <span
                                    style={{
                                      fontSize: '11px',
                                      color: 'var(--text-muted)',
                                      position: 'absolute',
                                      left: '8px',
                                    }}
                                  >
                                    ¥
                                  </span>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    className="premium-input numeric"
                                    placeholder="単価"
                                    value={item.price === 0 ? '' : item.price}
                                    onChange={e => handleItemChange(idx, 'price', e.target.value)}
                                    style={{
                                      width: '100%',
                                      height: '44px',
                                      paddingLeft: '18px',
                                      paddingRight: '6px',
                                      fontSize: '15px',
                                      textAlign: 'right',
                                    }}
                                  />
                                </div>

                                {/* 数量入力（ステッパー） */}
                                <div
                                  className="stepper-container"
                                  style={{
                                    flex: 1.1,
                                    minWidth: '94px',
                                    justifyContent: 'space-between',
                                  }}
                                >
                                  <button
                                    type="button"
                                    className="stepper-btn"
                                    onClick={() => handleQtyAdjust(idx, -1)}
                                  >
                                    -
                                  </button>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    className="stepper-input"
                                    placeholder="数"
                                    value={item.qty || ''}
                                    onChange={e => handleItemChange(idx, 'qty', e.target.value)}
                                  />
                                  <button
                                    type="button"
                                    className="stepper-btn"
                                    onClick={() => handleQtyAdjust(idx, 1)}
                                  >
                                    +
                                  </button>
                                </div>

                                {/* 税区分・税率選択 */}
                                <select
                                  value={
                                    item.tax_rate === 8
                                      ? item.tax_included
                                        ? '8-in'
                                        : '8-ex'
                                      : item.tax_rate === 10
                                        ? item.tax_included
                                          ? '10-in'
                                          : '10-ex'
                                        : 'free'
                                  }
                                  onChange={e => handleTaxChange(idx, e.target.value)}
                                  className="premium-input"
                                  style={{
                                    flex: 1.2,
                                    minWidth: '85px',
                                    height: '44px',
                                    fontSize: '13px',
                                    padding: '4px 6px',
                                    color: 'var(--text-primary)',
                                    cursor: 'pointer',
                                  }}
                                >
                                  <option
                                    value="8-ex"
                                    style={{ background: 'var(--bg-card)', color: '#fff' }}
                                  >
                                    8% (外)
                                  </option>
                                  <option
                                    value="8-in"
                                    style={{ background: 'var(--bg-card)', color: '#fff' }}
                                  >
                                    8% (内)
                                  </option>
                                  <option
                                    value="10-ex"
                                    style={{ background: 'var(--bg-card)', color: '#fff' }}
                                  >
                                    10% (外)
                                  </option>
                                  <option
                                    value="10-in"
                                    style={{ background: 'var(--bg-card)', color: '#fff' }}
                                  >
                                    10% (内)
                                  </option>
                                  <option
                                    value="free"
                                    style={{ background: 'var(--bg-card)', color: '#fff' }}
                                  >
                                    免税
                                  </option>
                                </select>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>

                  {editData.items && editData.items.length === 0 && (
                    <p
                      style={{
                        fontSize: '12px',
                        color: 'var(--text-muted)',
                        textAlign: 'center',
                        padding: '16px 0',
                      }}
                    >
                      品目がありません。「品目を追加」から登録してください。
                    </p>
                  )}
                </div>

                {/* 品目小計（税抜） サマリーカード */}
                <div className="summary-card">
                  <span
                    style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 500 }}
                  >
                    品目小計 (税抜)
                  </span>
                  <span
                    className="numeric"
                    style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}
                  >
                    ¥
                    {(editData.items || [])
                      .reduce(
                        (acc: number, item: ReceiptItem) =>
                          acc + (item.price || 0) * (item.qty || 1),
                        0
                      )
                      .toLocaleString()}
                  </span>
                </div>

                {/* 合計金額（税込） サマリーカード */}
                <div className="summary-card accent">
                  <span style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: 600 }}>
                    合計金額 (税込)
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span
                      style={{ fontSize: '20px', fontWeight: 800, color: 'var(--accent-purple)' }}
                    >
                      ¥
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      className="numeric"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        borderBottom: '2px solid var(--accent-purple)',
                        color: '#fff',
                        fontSize: '22px',
                        fontWeight: 800,
                        width: '100px',
                        textAlign: 'right',
                        outline: 'none',
                        padding: '0 4px',
                      }}
                      value={editData.total_amount || 0}
                      onChange={e => {
                        const val = parseInt(e.target.value.replace(/,/g, '')) || 0;
                        setEditData({ ...editData, total_amount: val });
                      }}
                    />
                  </div>
                </div>

                {/* メモ */}
                <div className="form-group" style={{ marginTop: '16px' }}>
                  <label
                    style={{
                      fontSize: '13px',
                      color: 'var(--text-secondary)',
                      marginBottom: '6px',
                      display: 'block',
                      fontWeight: 500,
                    }}
                  >
                    メモ
                  </label>
                  <input
                    type="text"
                    className="premium-input"
                    style={{ width: '100%', height: '42px' }}
                    placeholder="任意のメモを入力できます"
                    value={editData.memo || ''}
                    onChange={e => setEditData({ ...editData, memo: e.target.value })}
                  />
                </div>

                {/* レシート原本表示（スキャン後フォーム） */}
                {previewUrl && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      marginTop: '16px',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setShowScanReceiptImage(prev => !prev)}
                      style={{
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '12px',
                        color: '#fff',
                        padding: '10px 16px',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        width: '100%',
                        transition: 'background-color 0.2s',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                      }}
                    >
                      <Camera size={16} color="#8b5cf6" />
                      {showScanReceiptImage
                        ? 'レシート原本を非表示にする'
                        : 'レシート原本を表示する'}
                    </button>
                    {showScanReceiptImage && (
                      <div
                        style={{
                          marginTop: '4px',
                          borderRadius: '16px',
                          overflow: 'hidden',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          background: 'rgba(0, 0, 0, 0.2)',
                          display: 'flex',
                          justifyContent: 'center',
                          alignItems: 'center',
                          maxHeight: '320px',
                        }}
                      >
                        <img
                          src={previewUrl}
                          alt="レシート原本"
                          style={{
                            maxWidth: '100%',
                            maxHeight: '320px',
                            objectFit: 'contain',
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '12px', marginTop: '28px' }}>
                  <button
                    onClick={() => setEditData(null)}
                    className="btn-secondary"
                    style={{
                      flex: 1,
                      borderRadius: '16px',
                      padding: '16px',
                      fontSize: '15px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={handleSaveTransaction}
                    className="btn-primary"
                    style={{
                      flex: 2,
                      borderRadius: '16px',
                      padding: '16px',
                      fontSize: '15px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                    }}
                  >
                    <Check size={18} />
                    確定
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================== 3. HISTORY TAB ==================== */}
        {activeTab === 'history' && (
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '20px',
              }}
            >
              <h3 style={{ fontSize: '17px', fontWeight: 700 }}>家計簿履歴一覧</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {/* 月選択ドロップダウン */}
                <select
                  value={selectedMonth}
                  onChange={e => setSelectedMonth(e.target.value)}
                  style={{
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: '10px',
                    color: '#fff',
                    fontSize: '13px',
                    fontWeight: 600,
                    padding: '6px 10px',
                    cursor: 'pointer',
                    outline: 'none',
                  }}
                >
                  {getSelectableMonths().map(m => {
                    const [y, mo] = m.split('-');
                    return (
                      <option key={m} value={m} style={{ background: '#1a1a2e', color: '#fff' }}>
                        {y}年{parseInt(mo)}月
                      </option>
                    );
                  })}
                </select>
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  {filteredTransactions.length} 件
                </span>
              </div>
            </div>

            {filteredTransactions.length === 0 ? (
              <p
                style={{
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  padding: '40px 0',
                  fontSize: '14px',
                }}
              >
                この月の取引はありません
              </p>
            ) : (
              [...filteredTransactions]
                .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date))
                .map(t => (
                  <div
                    className="glass-card"
                    key={t.id}
                    onClick={() => {
                      setSelectedTransaction(t);
                      setEditData({ ...t });
                    }}
                    style={{
                      padding: '16px 20px',
                      marginBottom: '12px',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      position: 'relative',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                      e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.3)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.background = 'var(--glass-bg)';
                      e.currentTarget.style.borderColor = 'var(--glass-border)';
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        marginBottom: '8px',
                        gap: '16px',
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <h4
                          style={{
                            fontSize: '15px',
                            fontWeight: 600,
                            color: 'var(--text-primary)',
                            wordBreak: 'break-word',
                          }}
                        >
                          {t.shop_name}
                        </h4>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            marginTop: '4px',
                          }}
                        >
                          <span
                            style={{
                              background: CATEGORY_COLORS[t.category_name] + '20',
                              color: CATEGORY_COLORS[t.category_name] || '#868e96',
                              fontSize: '11px',
                              padding: '2px 8px',
                              borderRadius: '10px',
                              fontWeight: 600,
                            }}
                          >
                            {t.category_name}
                          </span>
                          <span
                            className="numeric"
                            style={{
                              fontSize: '12px',
                              color: 'var(--text-muted)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <Calendar size={12} />
                            {t.transaction_date}
                          </span>
                        </div>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          flexShrink: 0,
                        }}
                      >
                        <span
                          className="numeric"
                          style={{
                            fontSize: '18px',
                            fontWeight: 700,
                            color: 'var(--text-primary)',
                          }}
                        >
                          ¥{t.total_amount.toLocaleString()}
                        </span>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            handleDeleteTransaction(t.id);
                          }}
                          style={{
                            background: 'rgba(239, 68, 68, 0.1)',
                            border: '1px solid rgba(239, 68, 68, 0.2)',
                            borderRadius: '8px',
                            width: '40px',
                            height: '40px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#f87171',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.background = 'rgba(239, 68, 68, 0.25)';
                            e.currentTarget.style.color = '#ef4444';
                            e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.4)';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
                            e.currentTarget.style.color = '#f87171';
                            e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.2)';
                          }}
                          title="この履歴を削除"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>

                    {t.items && t.items.length > 0 && (
                      <div
                        style={{
                          borderTop: '1px solid rgba(255,255,255,0.05)',
                          paddingTop: '8px',
                          marginTop: '8px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                        }}
                      >
                        {t.items.slice(0, 2).map((item, index) => (
                          <div
                            key={index}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              fontSize: '12px',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            <span>• {item.name}</span>
                            <span>
                              ¥{item.price.toLocaleString()} x{item.qty}
                            </span>
                          </div>
                        ))}
                        {t.items.length > 2 && (
                          <span
                            style={{
                              fontSize: '11px',
                              color: 'var(--text-muted)',
                              fontStyle: 'italic',
                              marginTop: '2px',
                            }}
                          >
                            他 {t.items.length - 2} 件の品目...
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))
            )}
          </div>
        )}

        {/* ==================== 4. SETTINGS TAB ==================== */}
        {activeTab === 'settings' && (
          <div className="glass-card">
            <h3
              style={{
                fontSize: '17px',
                fontWeight: 700,
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <SettingsIcon size={20} color="#8b5cf6" />
              設定
            </h3>

            <div className="form-group" style={{ marginBottom: '24px' }}>
              <label>月間予算設定 (円)</label>
              <input
                type="number"
                className="form-control numeric"
                placeholder="100000"
                style={{ fontSize: '16px', fontWeight: 600 }}
                value={monthlyBudget === 0 ? '' : monthlyBudget}
                onChange={e => setMonthlyBudget(parseInt(e.target.value) || 0)}
              />
              <span
                style={{
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  marginTop: '4px',
                  display: 'block',
                }}
              >
                ダッシュボードの予算使用ゲージにリアルタイム連動します。
              </span>
            </div>

            <button
              onClick={saveSettings}
              className="btn-primary"
              style={{ width: '100%', marginTop: '20px' }}
            >
              設定を保存
            </button>

            {cognitoClientId !== 'local' && (
              <div
                style={{
                  marginTop: '30px',
                  paddingTop: '20px',
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                <h4
                  style={{
                    fontSize: '15px',
                    fontWeight: 600,
                    marginBottom: '12px',
                    color: 'var(--text-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <Key size={18} color="#10b981" />
                  セキュリティ設定
                </h4>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '16px',
                    padding: '8px 0',
                  }}
                >
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    パスキー登録状態
                  </span>
                  {passkeysLoading ? (
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>確認中...</span>
                  ) : registeredPasskeys.length > 0 ? (
                    <span
                      style={{
                        background: 'rgba(16, 185, 129, 0.15)',
                        color: '#10b981',
                        padding: '4px 10px',
                        borderRadius: '20px',
                        fontSize: '12px',
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <span
                        style={{
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          backgroundColor: '#10b981',
                        }}
                      ></span>
                      登録済み
                    </span>
                  ) : (
                    <span
                      style={{
                        background: 'rgba(255, 255, 255, 0.08)',
                        color: 'var(--text-muted)',
                        padding: '4px 10px',
                        borderRadius: '20px',
                        fontSize: '12px',
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <span
                        style={{
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          backgroundColor: 'var(--text-muted)',
                        }}
                      ></span>
                      未登録
                    </span>
                  )}
                </div>

                {registeredPasskeys.length > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      marginBottom: '20px',
                    }}
                  >
                    <button
                      onClick={() => setShowPasskeys(!showPasskeys)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-secondary)',
                        fontSize: '12px',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        width: '100%',
                        padding: '6px 0',
                        cursor: 'pointer',
                        userSelect: 'none',
                      }}
                    >
                      <span>登録済みのパスキー一覧 ({registeredPasskeys.length}件)</span>
                      {showPasskeys ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>

                    {showPasskeys && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {registeredPasskeys.map(cred => (
                          <div
                            key={cred.CredentialId}
                            style={{
                              padding: '12px 16px',
                              borderRadius: '12px',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              border: '1px solid rgba(255, 255, 255, 0.05)',
                              background: 'rgba(255, 255, 255, 0.02)',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '2px',
                                overflow: 'hidden',
                                marginRight: '8px',
                              }}
                            >
                              <span
                                style={{
                                  fontSize: '13px',
                                  fontWeight: 600,
                                  color: 'var(--text-primary)',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {cred.FriendlyCredentialName || '登録済みパスキー'}
                              </span>
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                作成日: {formatCreatedAt(cred.CreatedAt)}
                              </span>
                            </div>
                            <button
                              onClick={() => handlePasskeyDelete(cred.CredentialId)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#ef4444',
                                cursor: 'pointer',
                                padding: '6px',
                                borderRadius: '8px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'background-color 0.2s',
                              }}
                              onMouseEnter={e =>
                                (e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)')
                              }
                              onMouseLeave={e =>
                                (e.currentTarget.style.backgroundColor = 'transparent')
                              }
                              title="削除"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <p
                  style={{
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                    marginBottom: '14px',
                    lineHeight: 1.4,
                  }}
                >
                  このデバイスを登録すると、次回からパスワード不要で安全にログインできます。
                </p>
                <button
                  onClick={handlePasskeyRegister}
                  className="btn-secondary"
                  style={{
                    width: '100%',
                    fontSize: '14px',
                    padding: '12px 20px',
                    borderRadius: '12px',
                  }}
                  disabled={authLoading || passkeysLoading}
                >
                  {authLoading ? '登録処理中...' : 'このデバイスをパスキー登録する'}
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* --- ボトムナビゲーションバー --- */}
      <nav className="bottom-nav">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
        >
          <TrendingUp size={22} />
          <span>ダッシュボード</span>
        </button>
        <button
          onClick={() => setActiveTab('scan')}
          className={`nav-item ${activeTab === 'scan' ? 'active' : ''}`}
        >
          <Camera size={22} />
          <span>スキャン</span>
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`nav-item ${activeTab === 'history' ? 'active' : ''}`}
        >
          <History size={22} />
          <span>履歴一覧</span>
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
        >
          <SettingsIcon size={22} />
          <span>設定</span>
        </button>
      </nav>

      {/* ==================== 5. DETAIL MODAL ==================== */}
      {selectedTransaction && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(12px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            animation: 'fadeIn 0.25s ease-out',
          }}
          onClick={() => setSelectedTransaction(null)}
        >
          <style>{`
            @keyframes fadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            @keyframes scaleUp {
              from { transform: scale(0.96); opacity: 0; }
              to { transform: scale(1); opacity: 1; }
            }
          `}</style>
          <div
            style={{
              background: 'rgba(15, 17, 26, 0.85)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '24px',
              width: '100%',
              maxWidth: '480px',
              padding: '28px 24px 24px',
              boxShadow: '0 25px 60px rgba(0, 0, 0, 0.6)',
              backdropFilter: 'blur(20px)',
              position: 'relative',
              animation: 'scaleUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* モーダルヘッダー */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '20px',
              }}
            >
              <h3
                style={{ fontSize: '18px', fontWeight: 700, color: '#fff', letterSpacing: '0.5px' }}
              >
                取引明細の編集
              </h3>
              <button
                onClick={() => {
                  setSelectedTransaction(null);
                  setEditData(null);
                }}
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: 'none',
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.15)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                }}
              >
                <X size={16} />
              </button>
            </div>

            {editData ? (
              /* 常時編集フォーム */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* 店舗名 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label
                    style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}
                  >
                    ご利用店舗
                  </label>
                  <input
                    type="text"
                    value={editData.shop_name || ''}
                    onChange={e => setEditData({ ...editData, shop_name: e.target.value })}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '12px',
                      color: '#fff',
                      padding: '12px 16px',
                      fontSize: '16px',
                      outline: 'none',
                      width: '100%',
                    }}
                  />
                </div>

                {/* 日付とカテゴリ */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    width: '100%',
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      width: '100%',
                      minWidth: 0,
                    }}
                  >
                    <label
                      style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}
                    >
                      利用日
                    </label>
                    <input
                      type="date"
                      value={editData.transaction_date || ''}
                      onChange={e => setEditData({ ...editData, transaction_date: e.target.value })}
                      style={{
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '12px',
                        color: '#fff',
                        padding: '12px 16px',
                        fontSize: '16px',
                        outline: 'none',
                        width: '100%',
                        boxSizing: 'border-box',
                        minWidth: 0,
                        WebkitAppearance: 'none',
                        appearance: 'none',
                      }}
                    />
                  </div>
                  <div
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      width: '100%',
                      minWidth: 0,
                    }}
                  >
                    <label
                      style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}
                    >
                      カテゴリ
                    </label>
                    <select
                      value={editData.category_name || 'その他'}
                      onChange={e => setEditData({ ...editData, category_name: e.target.value })}
                      style={{
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '12px',
                        color: '#fff',
                        padding: '12px 40px 12px 16px',
                        fontSize: '16px',
                        outline: 'none',
                        height: '48px',
                        cursor: 'pointer',
                        width: '100%',
                        appearance: 'none',
                        WebkitAppearance: 'none',
                        backgroundImage: `url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23a1a1aa' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                        backgroundRepeat: 'no-repeat',
                        backgroundPosition: 'right 16px center',
                        backgroundSize: '16px',
                        boxSizing: 'border-box',
                        minWidth: 0,
                      }}
                    >
                      {Object.keys(CATEGORY_COLORS).map(cat => (
                        <option key={cat} value={cat} style={{ background: '#131520' }}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 品目内訳リスト */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <label
                      style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}
                    >
                      購入品目内訳
                    </label>
                    <button
                      onClick={handleAddItem}
                      style={{
                        background: 'rgba(139, 92, 246, 0.1)',
                        border: '1px solid rgba(139, 92, 246, 0.2)',
                        borderRadius: '8px',
                        padding: '6px 12px',
                        fontSize: '13px',
                        color: 'var(--accent-purple)',
                        cursor: 'pointer',
                      }}
                    >
                      + 追加
                    </button>
                  </div>
                  <div
                    style={{
                      maxHeight: '180px',
                      overflowY: 'auto',
                      background: 'rgba(0,0,0,0.18)',
                      borderRadius: '16px',
                      border: '1px solid rgba(255,255,255,0.02)',
                      padding: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    {editData.items &&
                      editData.items.map((item, index) => (
                        <div
                          key={index}
                          style={{
                            background: 'rgba(255,255,255,0.01)',
                            border: '1px solid rgba(255,255,255,0.03)',
                            borderRadius: '12px',
                            padding: '12px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '10px',
                          }}
                        >
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <input
                              type="text"
                              placeholder="品目名"
                              value={item.name || ''}
                              onChange={e => handleItemChange(index, 'name', e.target.value)}
                              style={{
                                flex: 1,
                                background: 'transparent',
                                border: 'none',
                                borderBottom: '1px solid rgba(255,255,255,0.1)',
                                color: '#fff',
                                fontSize: '16px',
                                outline: 'none',
                                padding: '8px 0',
                              }}
                            />
                            <button
                              onClick={() => handleRemoveItem(index)}
                              style={{
                                background: 'rgba(239, 68, 68, 0.08)',
                                border: 'none',
                                borderRadius: '8px',
                                width: '36px',
                                height: '36px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#f87171',
                                cursor: 'pointer',
                              }}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              gap: '8px',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                単価
                              </span>
                              <input
                                type="number"
                                value={item.price === 0 ? '' : item.price}
                                onChange={e => handleItemChange(index, 'price', e.target.value)}
                                style={{
                                  width: '85px',
                                  background: 'transparent',
                                  border: 'none',
                                  borderBottom: '1px solid rgba(255,255,255,0.1)',
                                  color: '#fff',
                                  fontSize: '16px',
                                  outline: 'none',
                                  textAlign: 'right',
                                  padding: '6px 0',
                                }}
                              />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <button
                                onClick={() => handleQtyAdjust(index, -1)}
                                style={{
                                  background: 'rgba(255,255,255,0.05)',
                                  border: 'none',
                                  borderRadius: '6px',
                                  width: '34px',
                                  height: '34px',
                                  color: '#fff',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '16px',
                                  cursor: 'pointer',
                                }}
                              >
                                -
                              </button>
                              <span
                                style={{ fontSize: '15px', minWidth: '24px', textAlign: 'center' }}
                                className="numeric"
                              >
                                {item.qty}
                              </span>
                              <button
                                onClick={() => handleQtyAdjust(index, 1)}
                                style={{
                                  background: 'rgba(255,255,255,0.05)',
                                  border: 'none',
                                  borderRadius: '6px',
                                  width: '34px',
                                  height: '34px',
                                  color: '#fff',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '16px',
                                  cursor: 'pointer',
                                }}
                              >
                                +
                              </button>
                            </div>
                            <select
                              value={
                                item.tax_rate === null
                                  ? 'free'
                                  : `${item.tax_rate}-${item.tax_included ? 'in' : 'ex'}`
                              }
                              onChange={e => handleTaxChange(index, e.target.value)}
                              style={{
                                background: 'rgba(255,255,255,0.05)',
                                border: 'none',
                                borderRadius: '6px',
                                color: '#fff',
                                fontSize: '14px',
                                padding: '6px 8px',
                                height: '34px',
                                cursor: 'pointer',
                                outline: 'none',
                              }}
                            >
                              <option value="8-ex" style={{ background: '#131520' }}>
                                8%外税
                              </option>
                              <option value="8-in" style={{ background: '#131520' }}>
                                8%内税
                              </option>
                              <option value="10-ex" style={{ background: '#131520' }}>
                                10%外税
                              </option>
                              <option value="10-in" style={{ background: '#131520' }}>
                                10%内税
                              </option>
                              <option value="free" style={{ background: '#131520' }}>
                                非課税
                              </option>
                            </select>
                          </div>
                        </div>
                      ))}
                    {(!editData.items || editData.items.length === 0) && (
                      <p
                        style={{
                          textAlign: 'center',
                          fontSize: '11px',
                          color: 'var(--text-muted)',
                          margin: '8px 0',
                        }}
                      >
                        品目データはありません
                      </p>
                    )}
                  </div>
                </div>

                {/* メモ */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label
                    style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}
                  >
                    メモ
                  </label>
                  <textarea
                    value={editData.memo || ''}
                    onChange={e => setEditData({ ...editData, memo: e.target.value })}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '12px',
                      color: '#fff',
                      padding: '12px 16px',
                      fontSize: '16px',
                      outline: 'none',
                      resize: 'none',
                      height: '65px',
                      width: '100%',
                    }}
                  />
                </div>

                {/* レシート画像表示ボタン */}
                {editData.receipt_s3_key && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      marginTop: '6px',
                    }}
                  >
                    <button
                      onClick={handleViewReceipt}
                      type="button"
                      style={{
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '12px',
                        color: '#fff',
                        padding: '10px 16px',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        width: '100%',
                        transition: 'background-color 0.2s',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                      }}
                    >
                      <Camera size={16} color="#8b5cf6" />
                      {viewReceiptLoading
                        ? '読み込み中...'
                        : showReceiptImage
                          ? 'レシート原本を非表示にする'
                          : 'レシート原本を表示する'}
                    </button>

                    {showReceiptImage && viewReceiptUrl && (
                      <div
                        style={{
                          marginTop: '8px',
                          borderRadius: '16px',
                          overflow: 'hidden',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          background: 'rgba(0, 0, 0, 0.2)',
                          display: 'flex',
                          justifyContent: 'center',
                          alignItems: 'center',
                          maxHeight: '260px',
                        }}
                      >
                        <img
                          src={viewReceiptUrl}
                          alt="レシート原本"
                          style={{
                            maxWidth: '100%',
                            maxHeight: '260px',
                            objectFit: 'contain',
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* 合計金額表示 */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    marginTop: '4px',
                    padding: '0 4px',
                  }}
                >
                  <span style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>合計金額</span>
                  <span
                    className="numeric"
                    style={{ fontSize: '24px', fontWeight: 800, color: 'var(--accent-purple)' }}
                  >
                    ¥{(editData.total_amount || 0).toLocaleString()}
                  </span>
                </div>

                {/* 操作ボタン */}
                <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                  <button
                    onClick={handleUpdateTransaction}
                    className="btn-primary"
                    style={{
                      flex: 2,
                      borderRadius: '16px',
                      padding: '16px',
                      fontSize: '15px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                    }}
                  >
                    <Check size={18} />
                    保存する
                  </button>
                  <button
                    onClick={() => {
                      handleDeleteTransaction(selectedTransaction.id);
                    }}
                    style={{
                      flex: 1,
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.25)',
                      borderRadius: '16px',
                      color: '#f87171',
                      padding: '16px',
                      fontSize: '15px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
                      e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.4)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
                      e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.25)';
                    }}
                  >
                    <Trash2 size={18} />
                    削除
                  </button>
                  <button
                    onClick={() => {
                      setSelectedTransaction(null);
                      setEditData(null);
                    }}
                    className="btn-secondary"
                    style={{
                      flex: 1,
                      borderRadius: '16px',
                      padding: '16px',
                      fontSize: '15px',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    閉じる
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
