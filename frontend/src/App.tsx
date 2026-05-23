import React, { useState, useEffect } from 'react';
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

// --- モックデータ & 型定義 ---

interface ReceiptItem {
  name: string;
  price: number;
  qty: number;
}

interface Transaction {
  id: string;
  transaction_date: str;
  shop_name: string;
  total_amount: number;
  category_name: string;
  items: ReceiptItem[];
  memo?: string;
  created_at: string;
}

const CATEGORY_COLORS: { [key: string]: string } = {
  食費: '#ff6b6b',
  日用品: '#4dabf7',
  交際費: '#ffd43b',
  交通費: '#51cf66',
  エンタメ: '#20c997',
  その他: '#868e96',
};

const INITIAL_TRANSACTIONS: Transaction[] = [
  {
    id: 'mock-1',
    transaction_date: '2026-05-20',
    shop_name: 'スーパーライフ 渋谷店',
    total_amount: 3420,
    category_name: '食費',
    items: [
      { name: '産直こだわり牛乳', price: 248, qty: 1 },
      { name: '国産黒毛和牛バラ', price: 1980, qty: 1 },
      { name: '有機レタス', price: 198, qty: 1 },
      { name: 'こだわり十勝ヨーグルト', price: 168, qty: 2 },
    ],
    memo: '今週のまとめ買い',
    created_at: '2026-05-20T18:30:00Z',
  },
  {
    id: 'mock-2',
    transaction_date: '2026-05-21',
    shop_name: 'マツモトキヨシ',
    total_amount: 1850,
    category_name: '日用品',
    items: [
      { name: 'クリニカ ハミガキ', price: 328, qty: 1 },
      { name: 'エリエール ティシュー 5個パック', price: 498, qty: 1 },
      { name: 'アタック抗菌EX 詰替', price: 798, qty: 1 },
    ],
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
      { name: 'スターバックスラテ Tall', price: 490, qty: 1 },
      { name: 'チョコレートクッキー', price: 190, qty: 1 },
    ],
    memo: 'カフェ勉強',
    created_at: '2026-05-22T15:40:00Z',
  },
  {
    id: 'mock-4',
    transaction_date: '2026-05-23',
    shop_name: 'JR東日本 (Suicaチャージ)',
    total_amount: 2000,
    category_name: '交通費',
    items: [{ name: 'Suica チャージ', price: 2000, qty: 1 }],
    memo: '移動用',
    created_at: '2026-05-23T09:00:00Z',
  },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'scan' | 'history' | 'settings'>(
    'dashboard'
  );
  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    const saved = localStorage.getItem('snap_kakeibo_transactions');
    return saved ? JSON.parse(saved) : INITIAL_TRANSACTIONS;
  });

  // API設定
  const [apiUrl, setApiUrl] = useState(() => localStorage.getItem('snap_kakeibo_api_url') || '');
  const [geminiApiKey, setGeminiApiKey] = useState(
    () => localStorage.getItem('snap_kakeibo_gemini_key') || ''
  );

  // スキャンステータス
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanStep, setScanStep] = useState<string>('');

  // 解析結果プレビュー & 編集
  const [editData, setEditData] = useState<Partial<Transaction> | null>(null);

  useEffect(() => {
    localStorage.setItem('snap_kakeibo_transactions', JSON.stringify(transactions));
  }, [transactions]);

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

  // --- グラフデータの集計 ---

  // 1. 日別支出の集計（過去7日間）
  const getLineChartData = () => {
    const dataMap: { [key: string]: number } = {};
    // 過去7日分を初期化
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      dataMap[dateStr] = 0;
    }

    transactions.forEach(t => {
      if (dataMap[t.transaction_date] !== undefined) {
        dataMap[t.transaction_date] += t.total_amount;
      }
    });

    return Object.keys(dataMap).map(date => {
      const [, m, d] = date.split('-');
      return {
        name: `${parseInt(m)}/${parseInt(d)}`,
        amount: dataMap[date],
      };
    });
  };

  // 2. カテゴリ別支出の集計
  const getPieChartData = () => {
    const dataMap: { [key: string]: number } = {};
    transactions.forEach(t => {
      dataMap[t.category_name] = (dataMap[t.category_name] || 0) + t.total_amount;
    });

    return Object.keys(dataMap).map(name => ({
      name,
      value: dataMap[name],
    }));
  };

  const totalMonthlySpend = transactions.reduce((acc, curr) => acc + curr.total_amount, 0);

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
    setScanStep('画像をアップロード中...');

    // 1. 本物のAPIが設定されている場合は実通信
    if (apiUrl) {
      try {
        setScanStep('S3へ直接アップロード中...');
        // 署名付きURL取得
        const nameParam = selectedFile ? selectedFile.name : 'receipt.jpg';
        const urlRes = await fetch(
          `${apiUrl}/api/receipts/presigned-url?filename=${encodeURIComponent(nameParam)}`
        );
        if (!urlRes.ok) throw new Error('署名付きURLの取得に失敗しました');
        const { upload_url, file_key } = await urlRes.json();

        // S3へPUT送信
        setScanStep('S3へのアップロード完了。AI解析中...');
        const uploadRes = await fetch(upload_url, {
          method: 'PUT',
          body: selectedFile,
          headers: {
            'Content-Type': selectedFile?.type || 'image/jpeg',
          },
        });
        if (!uploadRes.ok) throw new Error('S3へのアップロードに失敗しました');

        // Geminiで解析
        setScanStep('Gemini 2.5 Flashで文字起こし & 解析中...');
        const analyzeRes = await fetch(`${apiUrl}/api/receipts/analyze`, {
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
      setScanStep('GeminiマルチモーダルAPI接続中...');
      setTimeout(() => {
        setScanStep('品目と金額の構造化データを抽出中...');
        setTimeout(() => {
          setIsScanning(false);
          // ランダムにリアルなレシートデータを生成
          const demoReceipts = [
            {
              shop_name: 'セブン-イレブン 渋谷3丁目店',
              transaction_date: new Date().toISOString().split('T')[0],
              total_amount: 1120,
              category_name: '食費',
              items: [
                { name: 'サラダチキン プレーン', price: 238, qty: 1 },
                { name: 'もっちり7種具材のサラダ', price: 398, qty: 1 },
                { name: 'こだわり十勝ヨーグルト', price: 168, qty: 1 },
                { name: 'い・ろ・は・す 550ml', price: 120, qty: 1 },
                { name: 'ブラック無糖缶', price: 140, qty: 1 },
              ],
            },
            {
              shop_name: 'マツモトキヨシ 新宿東口店',
              transaction_date: new Date().toISOString().split('T')[0],
              total_amount: 2540,
              category_name: '日用品',
              items: [
                { name: '超立体マスク 30枚入', price: 1280, qty: 1 },
                { name: 'キレイキレイ 泡ハンドソープ', price: 420, qty: 2 },
                { name: '除菌アルコールウェット', price: 210, qty: 2 },
              ],
            },
          ];
          const chosen = demoReceipts[Math.floor(Math.random() * demoReceipts.length)];
          setEditData(chosen);
        }, 1200);
      }, 1000);
    }, 800);
  };

  // 品目の更新と合計金額の自動計算
  const updateItemsAndTotal = (updatedItems: ReceiptItem[]) => {
    if (!editData) return;
    const newTotal = updatedItems.reduce((acc, item) => acc + item.price * item.qty, 0);
    setEditData({
      ...editData,
      items: updatedItems,
      total_amount: newTotal,
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

  // 品目の新規追加
  const handleAddItem = () => {
    if (!editData) return;
    const updatedItems = [...(editData.items || []), { name: '', price: 0, qty: 1 }];
    updateItemsAndTotal(updatedItems);
  };

  // 品目の削除
  const handleRemoveItem = (index: number) => {
    if (!editData || !editData.items) return;
    const updatedItems = editData.items.filter((_, i) => i !== index);
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
      memo: editData.memo || 'AIスキャンによる登録',
      created_at: new Date().toISOString(),
    };

    // AWS APIが設定されている場合はサーバーに保存
    if (apiUrl) {
      try {
        const response = await fetch(`${apiUrl}/api/transactions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transaction_date: newTx.transaction_date,
            shop_name: newTx.shop_name,
            total_amount: newTx.total_amount,
            category_name: newTx.category_name,
            items: newTx.items,
            receipt_s3_key: editData.receipt_s3_key,
            memo: newTx.memo,
          }),
        });
        if (!response.ok) throw new Error('サーバーへの保存に失敗しました');
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

  // 設定保存
  const saveSettings = () => {
    localStorage.setItem('snap_kakeibo_api_url', apiUrl);
    localStorage.setItem('snap_kakeibo_gemini_key', geminiApiKey);
    alert('設定を保存しました。');
  };

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
          background: 'rgba(9, 10, 15, 0.4)',
          backdropFilter: 'blur(10px)',
          position: 'sticky',
          top: 0,
          zIndex: 50,
          borderBottom: '1px solid rgba(255, 255, 255, 0.03)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              background: 'var(--grad-primary)',
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'var(--glow-purple)',
            }}
          >
            <Camera size={20} color="#fff" />
          </div>
          <div>
            <h1 style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '-0.5px' }}>
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
            </h1>
            <p style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
              AI Receipt Scan & Analytics
            </p>
          </div>
        </div>

        <div
          style={{
            background: 'rgba(255,255,255,0.05)',
            padding: '6px 12px',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <Sparkles size={14} color="#ffd43b" />
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#ffd43b' }}>
            Gemini 2.5 Active
          </span>
        </div>
      </header>

      {/* --- メインコンテンツ領域 --- */}
      <main style={{ padding: '20px', flex: 1 }}>
        {/* ==================== 1. DASHBOARD TAB ==================== */}
        {activeTab === 'dashboard' && (
          <div>
            {/* 総支出カード */}
            <div
              className="glass-card"
              style={{
                background:
                  'linear-gradient(135deg, rgba(27, 20, 52, 0.9) 0%, rgba(15, 18, 36, 0.9) 100%)',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: '-50px',
                  right: '-50px',
                  width: '150px',
                  height: '150px',
                  background: 'var(--accent-purple)',
                  filter: 'blur(80px)',
                  opacity: 0.3,
                  borderRadius: '50%',
                }}
              />

              <p style={{ fontSize: '14px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                今月の総支出
              </p>
              <h2
                className="numeric"
                style={{
                  fontSize: '42px',
                  fontWeight: 800,
                  margin: '8px 0',
                  letterSpacing: '-1px',
                }}
              >
                ¥{totalMonthlySpend.toLocaleString()}
              </h2>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12px',
                  color: '#51cf66',
                }}
              >
                <TrendingUp size={16} />
                <span>AIが支出カテゴリを自動最適化中</span>
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
                最近の支出推移 (日別)
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

            {/* クイックスタートボタン */}
            <button
              onClick={() => setActiveTab('scan')}
              className="btn-primary"
              style={{ width: '100%', padding: '16px', borderRadius: '20px', fontSize: '16px' }}
            >
              <Camera size={20} />
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
                      Gemini APIが日本語レシートを解析し、構造化しています。数秒お待ちください...
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
                    <button onClick={triggerScan} className="btn-primary" style={{ flex: 2 }}>
                      <Sparkles size={18} />
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
                    <h3 style={{ fontSize: '17px', fontWeight: 700 }}>AI解析結果の確認</h3>
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

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
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
                      購入品目内訳（手動編集・追加・削除可能）
                    </label>
                    <button
                      type="button"
                      onClick={handleAddItem}
                      style={{
                        background: 'rgba(139, 92, 246, 0.1)',
                        border: '1px solid rgba(139, 92, 246, 0.25)',
                        borderRadius: '20px',
                        color: '#a78bfa',
                        padding: '4px 10px',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = 'rgba(139, 92, 246, 0.2)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'rgba(139, 92, 246, 0.1)';
                      }}
                    >
                      <Plus size={12} />
                      品目を追加
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {editData.items &&
                      editData.items.map((item, idx) => (
                        <div
                          key={idx}
                          style={{
                            display: 'flex',
                            gap: '8px',
                            alignItems: 'center',
                            background: 'rgba(255, 255, 255, 0.02)',
                            padding: '8px',
                            borderRadius: '12px',
                            border: '1px solid rgba(255, 255, 255, 0.03)',
                          }}
                        >
                          {/* 品目名入力 */}
                          <input
                            type="text"
                            placeholder="品目名（例：牛乳）"
                            value={item.name}
                            onChange={e => handleItemChange(idx, 'name', e.target.value)}
                            style={{
                              flex: 3,
                              background: 'rgba(255,255,255,0.03)',
                              border: '1px solid rgba(255,255,255,0.06)',
                              borderRadius: '8px',
                              color: '#fff',
                              padding: '6px 10px',
                              fontSize: '13px',
                              outline: 'none',
                            }}
                          />

                          {/* 単価入力 */}
                          <div
                            style={{
                              flex: 1.5,
                              display: 'flex',
                              alignItems: 'center',
                              gap: '2px',
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
                              type="number"
                              placeholder="単価"
                              value={item.price || ''}
                              onChange={e => handleItemChange(idx, 'price', e.target.value)}
                              style={{
                                width: '100%',
                                background: 'rgba(255,255,255,0.03)',
                                border: '1px solid rgba(255,255,255,0.06)',
                                borderRadius: '8px',
                                color: '#fff',
                                padding: '6px 6px 6px 18px',
                                fontSize: '13px',
                                outline: 'none',
                                textAlign: 'right',
                              }}
                            />
                          </div>

                          {/* 数量入力 */}
                          <div
                            style={{
                              flex: 1,
                              display: 'flex',
                              alignItems: 'center',
                              gap: '2px',
                              position: 'relative',
                            }}
                          >
                            <span
                              style={{
                                fontSize: '11px',
                                color: 'var(--text-muted)',
                                position: 'absolute',
                                left: '6px',
                              }}
                            >
                              x
                            </span>
                            <input
                              type="number"
                              min="1"
                              placeholder="数"
                              value={item.qty || ''}
                              onChange={e => handleItemChange(idx, 'qty', e.target.value)}
                              style={{
                                width: '100%',
                                background: 'rgba(255,255,255,0.03)',
                                border: '1px solid rgba(255,255,255,0.06)',
                                borderRadius: '8px',
                                color: '#fff',
                                padding: '6px 6px 6px 16px',
                                fontSize: '13px',
                                outline: 'none',
                                textAlign: 'center',
                              }}
                            />
                          </div>

                          {/* 削除ボタン */}
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(idx)}
                            style={{
                              background: 'rgba(239, 68, 68, 0.1)',
                              border: '1px solid rgba(239, 68, 68, 0.2)',
                              borderRadius: '50%',
                              width: '28px',
                              height: '28px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#f87171',
                              cursor: 'pointer',
                              transition: 'all 0.2s',
                              flexShrink: 0,
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
                              e.currentTarget.style.color = '#ef4444';
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
                              e.currentTarget.style.color = '#f87171';
                            }}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                  </div>

                  {editData.items && editData.items.length === 0 && (
                    <p
                      style={{
                        fontSize: '12px',
                        color: 'var(--text-muted)',
                        textAlign: 'center',
                        padding: '12px 0',
                      }}
                    >
                      品目がありません。「品目を追加」から登録してください。
                    </p>
                  )}
                </div>

                <div className="form-group" style={{ marginTop: '20px' }}>
                  <label>合計金額</label>
                  <input
                    type="number"
                    className="form-control numeric"
                    style={{ fontSize: '20px', fontWeight: 700, color: 'var(--accent-purple)' }}
                    value={editData.total_amount || 0}
                    onChange={e =>
                      setEditData({ ...editData, total_amount: parseInt(e.target.value) || 0 })
                    }
                  />
                </div>

                <div className="form-group">
                  <label>メモ</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="任意のメモを入力できます"
                    value={editData.memo || ''}
                    onChange={e => setEditData({ ...editData, memo: e.target.value })}
                  />
                </div>

                <div style={{ display: 'flex', gap: '12px', marginTop: '28px' }}>
                  <button
                    onClick={() => setEditData(null)}
                    className="btn-secondary"
                    style={{ flex: 1 }}
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={handleSaveTransaction}
                    className="btn-primary"
                    style={{ flex: 2 }}
                  >
                    <Check size={18} />
                    確定して保存
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
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                全 {transactions.length} 件
              </span>
            </div>

            {transactions.map(t => (
              <div
                className="glass-card"
                key={t.id}
                style={{ padding: '16px 20px', marginBottom: '12px' }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: '8px',
                  }}
                >
                  <div>
                    <h4 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
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
                  <span
                    className="numeric"
                    style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}
                  >
                    ¥{t.total_amount.toLocaleString()}
                  </span>
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
            ))}
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
              AWS / AI 連携設定
            </h3>

            <div
              style={{
                background: 'rgba(236, 72, 153, 0.08)',
                border: '1px solid rgba(236, 72, 153, 0.15)',
                borderRadius: '16px',
                padding: '14px',
                marginBottom: '24px',
                display: 'flex',
                gap: '10px',
              }}
            >
              <AlertCircle size={20} color="#ec4899" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <h4
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#ec4899',
                    marginBottom: '2px',
                  }}
                >
                  デモモード対応
                </h4>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  AWS Lambda API URL
                  が未設定の場合、自動的にシミュレータによる「ダミースキャン（デモ）」が実行されます。
                  AWSにインフラをデプロイしたら、下記にエンドポイントURLを設定してください。
                </p>
              </div>
            </div>

            <div className="form-group">
              <label>AWS Lambda Function URL (または API Gateway)</label>
              <input
                type="text"
                className="form-control"
                placeholder="https://xxxx.lambda-url.ap-northeast-1.on.aws"
                value={apiUrl}
                onChange={e => setApiUrl(e.target.value)}
              />
              <span
                style={{
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  marginTop: '4px',
                  display: 'block',
                }}
              >
                バックエンドLambdaのデプロイ後に発行されるHTTPSエンドポイントを指定します。
              </span>
            </div>

            <div className="form-group">
              <label>Gemini API Key (Google AI Studio)</label>
              <input
                type="password"
                className="form-control"
                placeholder="AIzaSy..."
                value={geminiApiKey}
                onChange={e => setGeminiApiKey(e.target.value)}
              />
              <span
                style={{
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  marginTop: '4px',
                  display: 'block',
                }}
              >
                ※ バックエンド（AWS Lambda）の環境変数 `GEMINI_API_KEY`
                に設定してデプロイすることを推奨します。
              </span>
            </div>

            <button
              onClick={saveSettings}
              className="btn-primary"
              style={{ width: '100%', marginTop: '20px' }}
            >
              設定を保存
            </button>
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
    </div>
  );
}
