import os
import uuid
from datetime import datetime
from typing import List, Optional

import boto3
import jwt
import requests
from botocore.config import Config
from botocore.exceptions import ClientError
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from mangum import Mangum
from pydantic import BaseModel, Field

app = FastAPI(title="SnapKakeibo API", version="1.0.0")

# CORS設定 (ローカル開発環境のみFastAPI側で適用。本番環境はLambda Function URLのCORS設定が処理し、二重出力エラーを防ぎます)
if os.environ.get("MOCK_AUTH_ENABLED") == "true":
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# AWSクライアントの初期化
region_name = os.environ.get("AWS_REGION", "ap-northeast-1")

# AWSクライアントの初期化
s3_client = boto3.client(
    "s3",
    region_name=region_name,
    endpoint_url=f"https://s3.{region_name}.amazonaws.com",
    config=Config(signature_version="s3v4"),
)

# ローカルDynamoDBまたはAWS DynamoDBへの接続切り替え
DYNAMODB_ENDPOINT_URL = os.environ.get("DYNAMODB_ENDPOINT_URL")
if DYNAMODB_ENDPOINT_URL:
    dynamodb = boto3.resource(
        "dynamodb", endpoint_url=DYNAMODB_ENDPOINT_URL, region_name=region_name
    )
else:
    dynamodb = boto3.resource("dynamodb", region_name=region_name)
# Bedrock Runtimeクライアントの初期化 (東京リージョン ap-northeast-1)
bedrock_client = boto3.client("bedrock-runtime", region_name=region_name)

# 環境変数から設定を取得
TABLE_NAME = os.environ.get("DYNAMODB_TABLE", "snap_kakeibo_transactions")
BUCKET_NAME = os.environ.get("S3_BUCKET", "snap-kakeibo-receipts")
MODEL_ID = "nvidia.nemotron-nano-12b-v2"  # NVIDIA Nemotron Nano 12B

# Cognito認証設定
COGNITO_USER_POOL_ID = os.environ.get("COGNITO_USER_POOL_ID")
COGNITO_CLIENT_ID = os.environ.get("COGNITO_CLIENT_ID")
AWS_REGION = os.environ.get("AWS_REGION", "ap-northeast-1")

COGNITO_JWKS = None
security_scheme = HTTPBearer(auto_error=False)


def get_jwks():
    global COGNITO_JWKS
    if COGNITO_JWKS is None and COGNITO_USER_POOL_ID:
        try:
            jwks_url = f"https://cognito-idp.{AWS_REGION}.amazonaws.com/{COGNITO_USER_POOL_ID}/.well-known/jwks.json"
            response = requests.get(jwks_url, timeout=5)
            COGNITO_JWKS = response.json()
        except Exception as e:
            print(f"Warning: Failed to fetch Cognito JWKS: {e}")
    return COGNITO_JWKS


def find_jwk(jwks: dict, kid: str) -> Optional[dict]:
    """JWKSから一致するkidを持つ公開鍵を検索します。"""
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            return key
    return None


def decode_cognito_token(token: str, key_data: dict) -> dict:
    """公開鍵を使用してCognitoトークンをデコードし検証します。"""
    public_key = jwt.algorithms.RSAAlgorithm.from_jwk(key_data)
    issuer = f"https://cognito-idp.{AWS_REGION}.amazonaws.com/{COGNITO_USER_POOL_ID}"
    return jwt.decode(
        token,
        public_key,
        algorithms=["RS256"],
        audience=COGNITO_CLIENT_ID,
        issuer=issuer,
        leeway=120,  # サーバー間のわずかな時刻ズレ(Clock Skew)によるエラーを防ぐため、2分間の猶予を許可します
    )


def handle_local_mock_auth(
    credentials: Optional[HTTPAuthorizationCredentials],
) -> dict:
    """ローカル開発用の擬似認証トークンを安全にパースします。"""
    token = credentials.credentials if credentials else None
    email = "dev-user@example.com"
    if token and token.startswith("local-token-"):
        email = token.replace("local-token-", "")

    # S3やDynamoDBのキーとして使える形式でユーザーIDを生成
    user_id = f"local-user-{email.replace('@', '-').replace('.', '-')}"
    groups = ["Admins"] if "admin" in email else ["Users"]
    return {
        "sub": user_id,
        "email": email,
        "groups": groups,
    }


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_scheme),  # noqa: B008
) -> dict:
    # MOCK_AUTH_ENABLED=true の場合はローカル擬似認証モードを適用（マルチユーザー再現可）
    if os.environ.get("MOCK_AUTH_ENABLED") == "true":
        return handle_local_mock_auth(credentials)

    if not credentials:
        raise HTTPException(
            status_code=401, detail="Authorization header missing or invalid"
        )

    token = credentials.credentials
    jwks = get_jwks()
    if not jwks:
        raise HTTPException(status_code=500, detail="Cognito JWKS configuration error")

    try:
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")
        if not kid:
            raise HTTPException(
                status_code=401, detail="Invalid token header: missing kid"
            )

        key_data = find_jwk(jwks, kid)
        if not key_data:
            raise HTTPException(status_code=401, detail="Public key not found for kid")

        decoded = decode_cognito_token(token, key_data)
        user_id = decoded.get("sub")
        email = decoded.get("email")
        groups = decoded.get("cognito:groups", [])

        if not user_id:
            raise HTTPException(
                status_code=401, detail="Token missing user identity (sub)"
            )

        return {"sub": user_id, "email": email, "groups": groups}
    except jwt.ExpiredSignatureError as e:
        import time

        try:
            unverified_payload = jwt.decode(token, options={"verify_signature": False})
            exp = unverified_payload.get("exp")
            iat = unverified_payload.get("iat")
            now = int(time.time())
            print(
                f"JWT ExpiredSignatureError details: exp={exp}, iat={iat}, current_time={now}, diff={now - exp} seconds"
            )
        except Exception as pe:
            print(f"Failed to parse unverified payload: {pe}")
        print(f"JWT ExpiredSignatureError: {e}")
        raise HTTPException(status_code=401, detail="Token has expired") from e
    except jwt.InvalidTokenError as e:
        print(f"JWT InvalidTokenError: {e}")
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=401, detail="Invalid token") from e
    except Exception as e:
        print(f"JWT Generic Auth Error: {e}")
        import traceback

        traceback.print_exc()
        raise HTTPException(status_code=401, detail="Authentication failed") from e


# ローカル環境起動時にテーブルがなければ自動作成する
@app.on_event("startup")
def setup_local_db():
    if DYNAMODB_ENDPOINT_URL:
        try:
            # 既存テーブルをチェック
            existing_tables = [table.name for table in dynamodb.tables.all()]
            if TABLE_NAME not in existing_tables:
                print(f"Creating local DynamoDB table: {TABLE_NAME}...")
                dynamodb.create_table(
                    TableName=TABLE_NAME,
                    KeySchema=[
                        {"AttributeName": "PK", "KeyType": "HASH"},
                        {"AttributeName": "SK", "KeyType": "RANGE"},
                    ],
                    AttributeDefinitions=[
                        {"AttributeName": "PK", "AttributeType": "S"},
                        {"AttributeName": "SK", "AttributeType": "S"},
                    ],
                    BillingMode="PAY_PER_REQUEST",
                )
                print("Local DynamoDB table created successfully!")
        except Exception as e:
            print(f"Warning: Failed to setup local DynamoDB: {e}")


# --- スキーマ定義 (Pydantic) ---


class PresignedUrlResponse(BaseModel):
    upload_url: str
    file_key: str


class ReceiptItem(BaseModel):
    name: Optional[str] = Field("不明な品目", description="品目名（例：牛乳）")
    price: Optional[int] = Field(0, description="単価または明細行金額（数量反映後）")
    qty: Optional[int] = Field(1, description="数量")
    tax_rate: Optional[int] = Field(
        None, description="消費税率（8または10。非課税または不明な場合はnull）"
    )
    tax_included: Optional[bool] = Field(
        None, description="税込か否か（税込の場合はtrue、税抜の場合はfalse）"
    )
    tax_marker: Optional[str] = Field(
        None, description="レシート上の税印マーク（例：※, 軽, 非 など）"
    )


class TaxSummaryItem(BaseModel):
    tax_rate: Optional[int] = Field(None, description="消費税率（8または10）")
    taxable_amount: Optional[int] = Field(None, description="課税対象額（小計ベース）")
    tax_amount: Optional[int] = Field(None, description="消費税額")
    tax_included: Optional[bool] = Field(
        None,
        description="対象額が税込ベースか否か（内税の場合はtrue、外税の場合はfalse）",
    )


class ReceiptAnalysisResult(BaseModel):
    transaction_date: Optional[str] = Field(
        "2026-05-23", description="購入日 (YYYY-MM-DD形式)"
    )
    shop_name: Optional[str] = Field(
        "不明な店舗", description="店舗名。不明な場合は '不明な店舗'"
    )
    total_amount: Optional[int] = Field(0, description="合計金額")
    category_name: Optional[str] = Field(
        "その他",
        description=(
            "カテゴリ名。"
            "'食費', '日用品', '交際費', '交通費', 'エンタメ', 'その他' のいずれか"
        ),
    )
    items: List[ReceiptItem] = Field(
        default_factory=list, description="購入品目のリスト"
    )
    tax_summary: Optional[List[TaxSummaryItem]] = Field(
        default_factory=list, description="税率別の集計リスト"
    )


class AnalyzeRequest(BaseModel):
    file_key: str


class TransactionSaveRequest(BaseModel):
    transaction_date: Optional[str] = Field("2026-05-23")
    shop_name: Optional[str] = Field("不明な店舗")
    total_amount: Optional[int] = Field(0)
    category_name: Optional[str] = Field("その他")
    items: Optional[List[ReceiptItem]] = Field(default_factory=list)
    tax_summary: Optional[List[TaxSummaryItem]] = Field(default_factory=list)
    receipt_s3_key: Optional[str] = None
    memo: Optional[str] = ""


# --- API エンドポイント ---


@app.get("/health")
def health_check():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


@app.get("/api/users/me")
def get_me(current_user: dict = Depends(get_current_user)):  # noqa: B008
    """
    現在ログイン中のユーザープロフィール情報を返します。
    """
    return {
        "user_id": current_user["sub"],
        "email": current_user["email"],
        "groups": current_user["groups"],
        "is_admin": "Admins" in current_user["groups"],
    }


@app.get("/api/receipts/presigned-url", response_model=PresignedUrlResponse)
def get_presigned_url(filename: str, current_user: dict = Depends(get_current_user)):  # noqa: B008
    """
    フロントエンドがレシート画像をS3に直接アップロードするための署名付きURLを生成します。
    """
    file_extension = os.path.splitext(filename)[1].lower()
    if file_extension not in [".jpg", ".jpeg", ".png"]:
        raise HTTPException(
            status_code=400, detail="Only JPG, JPEG, and PNG images are allowed."
        )

    # 重複を避けるため一意なキーを作成
    file_key = f"uploads/{uuid.uuid4()}{file_extension}"

    ext = file_extension[1:] if file_extension != ".jpg" else "jpeg"
    content_type = f"image/{ext}"

    try:
        presigned_url = s3_client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": BUCKET_NAME,
                "Key": file_key,
                "ContentType": content_type,
            },
            ExpiresIn=300,  # 5分間有効
        )
        return PresignedUrlResponse(upload_url=presigned_url, file_key=file_key)
    except ClientError as e:
        raise HTTPException(
            status_code=500, detail="Failed to generate upload URL"
        ) from e


@app.post("/api/receipts/analyze", response_model=ReceiptAnalysisResult)
def analyze_receipt(
    payload: AnalyzeRequest,
    current_user: dict = Depends(get_current_user),  # noqa: B008
):
    """
    S3にアップロードされた画像を Amazon Bedrock (Nova Lite) で解析し、
    JSONに構造化して返却します。
    """
    # 0. Validate S3 File Key
    # Prevent Path Traversal and Arbitrary Object Read
    if not payload.file_key.startswith("uploads/"):
        raise HTTPException(
            status_code=400, detail="Invalid file_key: Must start with 'uploads/'"
        )
    if ".." in payload.file_key:
        raise HTTPException(
            status_code=400, detail="Invalid file_key: Path traversal not allowed"
        )

    # 1. S3から画像データを取得
    try:
        response = s3_client.get_object(Bucket=BUCKET_NAME, Key=payload.file_key)
        image_bytes = response["Body"].read()
    except ClientError as e:
        raise HTTPException(
            status_code=404, detail="Uploaded image not found in S3"
        ) from e

    # 2. Bedrock (Nova Lite) を使用してマルチモーダル解析を実行
    try:
        file_extension = os.path.splitext(payload.file_key)[1].lower()
        image_format = "jpeg" if file_extension in [".jpg", ".jpeg"] else "png"

        prompt = """
            あなたは日本語レシート画像を解析し、支出管理アプリ用のJSONを生成する専門アシスタントです。

            提供されたレシート画像から、以下の情報を抽出してください。

            - transaction_date: 購入日
            - shop_name: 店舗名
            - total_amount: 支払合計金額
            - category_name: 支出カテゴリ
            - items: 購入品目リスト（消費税情報を含む）
            - tax_summary: 消費税区分別の集計リスト

            必ず指定されたJSONスキーマに完全準拠したJSONのみを出力してください。
            説明文、Markdown、コードブロック、コメントは一切出力しないでください。

            【重要ルール】
            1. レシートに記載されている情報のみを使用してください。
            2. 読み取れない値や存在しない値は null にしてください。
            3. 金額はすべて支払金額ベースで、数値のみを出力してください。円記号、カンマ、単位は含めないでください。
            4. 日付は YYYY-MM-DD 形式に正規化してください。
            5. 年が記載されていない場合は、画像または文脈から確実に判断できる場合のみ補完してください。判断できない場合は null にしてください。
            6. 店舗名はレシート上部の正式な店舗名を優先してください。
            7. 合計金額は「合計」「総合計」「お買上計」「お支払い金額」「領収金額」など、実際に支払った金額を優先してください。
            8. 小計、税額、預り金、お釣り、ポイント利用額は total_amount として扱わないでください。
            9. 品目リストには、購入商品・サービスのみを含めてください。小計、税、合計、値引き合計、預り金、お釣りは items に含めないでください。
            10. 値引き商品がある場合は、可能なら値引き後の実支払価格を price にしてください。判断できない場合はレシート上の商品行の金額を使用してください。
            11. qty は数量です。数量が明記されていない場合は 1 にしてください。
            12. price はその品目行の金額を入れてください。単価ではなく、数量反映後の金額です。
            13. 同じ商品が複数行に分かれている場合は、無理に統合せず、レシートの明細行に従って出力してください。
            14. OCR誤認識が疑われる場合でも、確実に読める範囲で抽出し、不確かな値は null にしてください。
            15. JSONとして不正な trailing comma は絶対に付けないでください。
            16. 出力するすべての文字列フィールド（店舗名を除く）に含まれるスペースは必ず全角スペース（　）を使用してください。半角スペースは使わないでください。ただし、店舗名(shop_name)についてはスペースを一切含めず、すべて詰めてください。
            17. 店舗名(shop_name)には、レシートに「〇〇店」「〇〇館」「〇〇号店」「〇〇支店」などの詳細な店舗情報の記載があれば、それらを省略せずに必ず含めてください。また、店舗名に含まれるすべてのスペース（全角・半角ともに）は完全に除去し、すべて詰めて（寄せて）出力してください。（例：レシート表記が「スーパーサンプル 渋谷店」や「スーパーサンプル　渋谷店」の場合は「スーパーサンプル渋谷店」とする）
            18. 品目名(items.name)は、レシートに記載されている文字列をそのまま（略称や表記揺れ、記号なども含め）抽出してください。一般的な名前への変換や、勝手な省略、翻訳などは行わないでください。（例：レシート上の表記が「コカコーラ５００」であれば、そのまま「コカコーラ５００」と出力し、「コカ・コーラ」や「炭酸飲料」などに書き換えないでください）

            【税情報の抽出ルール】
            1. 品目ごとの税率抽出 (tax_rate):
               - 各品目の消費税率が読み取れる場合は、数値の 8 または 10 を入力してください。
               - レシートに「※」「軽」「軽%」「減」などの軽減税率印がある場合は 8 を、何も印がないか標準税率印がある場合は 10 または適切な税率を入力してください。非課税品目（切手、商品券、Suicaチャージ、一部手数料など）や判断できない場合は null（または非課税と確実な場合は 0）にしてください。
            2. 品目ごとの税込・税抜の判断 (tax_included):
               - その品目の price（金額）が税込金額である場合は true、税抜金額である場合は false を指定してください。
               - 日本の多くのスーパーやドラッグストアでは品目単体の金額は税抜（false）で印字され、レシート下部でまとめて消費税が計算されます。一方、コンビニや飲食店などでは品目単体の金額が税込（true）で印字される傾向があります。レシート全体の構成（「税抜計」「内税」などの表記）から慎重に判断してください。
            3. 税印マークの抽出 (tax_marker):
               - レシート上でその品目の金額の横に印字されている税区分マーク（例: 「※」, 「軽」, 「非」, 「減」, 「テ」 など）があれば、その文字列をそのまま入力してください。印がない場合は null にしてください。
            4. 税率別集計 (tax_summary):
               - レシート下部に「8%対象」「10%対象」「軽税対象」「消費税」「内税」などの税率別の集計欄がある場合、その情報を正確に抽出してリストとして出力してください。
               - tax_rate: 税率 (8 または 10)
               - taxable_amount: その税率の課税対象額（「8%対象額」「税抜額」など、内税の場合は内税対象額。数値のみ）
               - tax_amount: その税率の消費税額（「消費税」「内税」など。数値のみ）
               - tax_included: 対象額が税込ベース（内税）である場合は true、税抜ベース（外税）である場合は false

            【カテゴリ分類ルール】
            category_name は以下のいずれか1つを必ず選択してください。

            選択肢:
            ["食費", "日用品", "交際費", "交通費", "エンタメ", "その他"]

            分類基準:
            - 食費: 食品、飲料、お菓子、調味料、惣菜、外食、カフェ、スーパーやコンビニでの食品の購入など。
              ※重要※ 購入された品目の大部分が食料品・飲料・食材である場合は、購入した店舗（スーパー、ドラッグストア、コンビニ等）に関わらず、必ず「食費」に分類してください。
            - 日用品: 生活用品、日用消耗品、洗剤、化粧品、シャンプー、ティッシュ、文房具、衣類、医薬品、雑貨など（食品以外の生活必需品）。
            - 交際費: プレゼント、贈答品、お土産、冠婚葬祭、交際を目的とした外食（飲み会・会食・接待など）の費用。
            - 交通費: 電車、バス、タクシー、駐車場、ガソリン、高速料金、定期券など。
            - エンタメ: 映画、書籍、雑誌、ゲーム、イベント、レジャー、サブスク、おもちゃ、ホビーなど。
            - その他: 上記のいずれにも該当しないもの、または明確に判断できないもの。

            【分類の優先手順】
            1. レシート内の全品目を精査し、それぞれの品目がどのカテゴリに該当するか判断します。
            2. カテゴリ別の合計金額を比較し、最も金額の大きいカテゴリを全体の `category_name` として選択します。
            3. 何でも安易に「日用品」や「その他」に分類せず、品目の実態（特に食品の有無）に基づいて正確に判定してください。

            【出力JSONスキーマ】
            {
              "transaction_date": "YYYY-MM-DD または null",
              "shop_name": "店舗名 または null",
              "total_amount": 数値 または null,
              "category_name": "食費 | 日用品 | 交際費 | 交通費 | エンタメ | その他",
              "items": [
                {
                  "name": "品目名",
                  "price": 数値 または null,
                  "qty": 数値,
                  "tax_rate": 8 | 10 | 0 | null,
                  "tax_included": true | false | null,
                  "tax_marker": "※" 等のマーク または null
                }
              ],
              "tax_summary": [
                {
                  "tax_rate": 8 | 10,
                  "taxable_amount": 数値 または null,
                  "tax_amount": 数値 または null,
                  "tax_included": true | false
                }
              ]
            }

            【出力例】
            {
              "transaction_date": "2026-05-30",
              "shop_name": "スーパーサンプル渋谷店",
              "total_amount": 1280,
              "category_name": "食費",
              "items": [
                {
                  "name": "牛乳",
                  "price": 220,
                  "qty": 1,
                  "tax_rate": 8,
                  "tax_included": false,
                  "tax_marker": "※"
                },
                {
                  "name": "ハミガキコ",
                  "price": 330,
                  "qty": 1,
                  "tax_rate": 10,
                  "tax_included": false,
                  "tax_marker": null
                }
              ],
              "tax_summary": [
                {
                  "tax_rate": 8,
                  "taxable_amount": 220,
                  "tax_amount": 17,
                  "tax_included": false
                },
                {
                  "tax_rate": 10,
                  "taxable_amount": 330,
                  "tax_amount": 33,
                  "tax_included": false
                }
              ]
            }
        """

        # Bedrock Converse API を使用してマルチモーダルリクエストを送信
        bedrock_response = bedrock_client.converse(
            modelId=MODEL_ID,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "image": {
                                "format": image_format,
                                "source": {"bytes": image_bytes},
                            }
                        },
                        {"text": prompt},
                    ],
                }
            ],
            inferenceConfig={"temperature": 0, "maxTokens": 2000},
        )

        # 解析結果のテキストを取得
        text_output = bedrock_response["output"]["message"]["content"][0][
            "text"
        ].strip()

        # AIがMarkdown of ```json ... ``` で囲んで出力した場合のトリミング処理
        if "```json" in text_output:
            text_output = text_output.split("```json")[1].split("```")[0].strip()
        elif "```" in text_output:
            text_output = text_output.split("```")[1].split("```")[0].strip()

        # JSONをパースし、Pydanticモデルでバリデーション
        try:
            analysis_result = ReceiptAnalysisResult.model_validate_json(text_output)
            return analysis_result
        except Exception as ve:
            print(f"[ERROR] Pydantic Validation Failed: {ve}")
            print(f"[ERROR] Raw AI response was: {text_output}")
            import json

            try:
                raw_dict = json.loads(text_output)
                # Pydanticスキーマエラーを回避するため、安全な値に補完した辞書を返します
                safe_result = {
                    "transaction_date": raw_dict.get("transaction_date")
                    or "2026-05-23",
                    "shop_name": raw_dict.get("shop_name") or "不明な店舗",
                    "total_amount": raw_dict.get("total_amount") or 0,
                    "category_name": raw_dict.get("category_name") or "その他",
                    "items": raw_dict.get("items") or [],
                    "tax_summary": raw_dict.get("tax_summary") or [],
                }
                # itemsの中身も安全に検証
                cleaned_items = []
                for item in safe_result["items"]:
                    if isinstance(item, dict):
                        cleaned_items.append(
                            {
                                "name": item.get("name") or "不明な品目",
                                "price": item.get("price")
                                if item.get("price") is not None
                                else 0,
                                "qty": item.get("qty")
                                if item.get("qty") is not None
                                else 1,
                                "tax_rate": item.get("tax_rate"),
                                "tax_included": item.get("tax_included"),
                                "tax_marker": item.get("tax_marker"),
                            }
                        )
                safe_result["items"] = cleaned_items

                # tax_summaryの中身も安全に検証
                cleaned_summary = []
                for t in safe_result["tax_summary"]:
                    if isinstance(t, dict):
                        cleaned_summary.append(
                            {
                                "tax_rate": t.get("tax_rate"),
                                "taxable_amount": t.get("taxable_amount"),
                                "tax_amount": t.get("tax_amount"),
                                "tax_included": t.get("tax_included"),
                            }
                        )
                safe_result["tax_summary"] = cleaned_summary

                print(
                    f"[DEBUG] Safely recovered from validation failure and returning: {safe_result}"
                )
                return safe_result
            except Exception as je:
                print(f"[ERROR] JSON parsing also failed: {je}")
                raise HTTPException(
                    status_code=500, detail="AI output validation failed"
                ) from je

    except Exception as e:
        raise HTTPException(
            status_code=500, detail="Bedrock AI processing failed"
        ) from e


@app.post("/api/transactions")
def save_transaction(
    payload: TransactionSaveRequest,
    current_user: dict = Depends(get_current_user),  # noqa: B008
):
    """
    確定した家計簿データをDynamoDBに保存します。
    """
    try:
        user_id = current_user["sub"]
        table = dynamodb.Table(TABLE_NAME)
        transaction_id = f"TX#{payload.transaction_date}#{uuid.uuid4()}"

        item = {
            "PK": f"USER#{user_id}",
            "SK": transaction_id,
            "transaction_date": payload.transaction_date,
            "shop_name": payload.shop_name,
            "total_amount": payload.total_amount,
            "category_name": payload.category_name,
            "items": [item.model_dump() for item in payload.items]
            if payload.items
            else [],
            "tax_summary": [t.model_dump() for t in payload.tax_summary]
            if payload.tax_summary
            else [],
            "receipt_s3_key": payload.receipt_s3_key,
            "memo": payload.memo,
            "created_at": datetime.utcnow().isoformat(),
        }

        table.put_item(Item=item)
        return {"status": "success", "transaction_id": transaction_id}
    except ClientError as e:
        raise HTTPException(
            status_code=500, detail="Failed to save transaction to DynamoDB"
        ) from e


@app.get("/api/transactions")
def list_transactions(current_user: dict = Depends(get_current_user)):  # noqa: B008
    """
    ユーザーの取引履歴を取得します。
    """
    try:
        user_id = current_user["sub"]
        table = dynamodb.Table(TABLE_NAME)
        # ユーザーに紐づくデータをDynamoDBからQuery
        response = table.query(
            KeyConditionExpression="PK = :pk",
            ExpressionAttributeValues={":pk": f"USER#{user_id}"},
            ScanIndexForward=False,  # 新しい日付順に取得
        )
        return response.get("Items", [])
    except ClientError as e:
        raise HTTPException(status_code=500, detail="Failed to query DynamoDB") from e


@app.put("/api/transactions/{transaction_id}")
def update_transaction(
    transaction_id: str,
    payload: TransactionSaveRequest,
    current_user: dict = Depends(get_current_user),  # noqa: B008
):
    """
    指定された取引履歴を編集してDynamoDBに保存します。
    """
    try:
        user_id = current_user["sub"]
        table = dynamodb.Table(TABLE_NAME)

        # 存在確認と所有権確認
        response = table.get_item(Key={"PK": f"USER#{user_id}", "SK": transaction_id})
        if "Item" not in response:
            raise HTTPException(status_code=404, detail="Transaction not found")

        existing_item = response["Item"]

        item = {
            "PK": f"USER#{user_id}",
            "SK": transaction_id,
            "transaction_date": payload.transaction_date,
            "shop_name": payload.shop_name,
            "total_amount": payload.total_amount,
            "category_name": payload.category_name,
            "items": [item.model_dump() for item in payload.items]
            if payload.items
            else [],
            "tax_summary": [t.model_dump() for t in payload.tax_summary]
            if payload.tax_summary
            else [],
            "receipt_s3_key": payload.receipt_s3_key
            or existing_item.get("receipt_s3_key"),
            "memo": payload.memo,
            "created_at": existing_item.get("created_at")
            or datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
        }

        table.put_item(Item=item)
        return {"status": "success", "message": f"Transaction {transaction_id} updated"}
    except ClientError as e:
        msg = "Failed to update transaction in DynamoDB"
        raise HTTPException(status_code=500, detail=msg) from e


@app.delete("/api/transactions/{transaction_id}")
def delete_transaction(
    transaction_id: str,
    current_user: dict = Depends(get_current_user),  # noqa: B008
):
    """
    指定された取引履歴をDynamoDBから削除します。
    """
    try:
        user_id = current_user["sub"]
        table = dynamodb.Table(TABLE_NAME)
        table.delete_item(Key={"PK": f"USER#{user_id}", "SK": transaction_id})
        return {"status": "success", "message": f"Transaction {transaction_id} deleted"}
    except ClientError as e:
        msg = "Failed to delete transaction from DynamoDB"
        raise HTTPException(status_code=500, detail=msg) from e


# AWS Lambda用のハンドラー
handler = Mangum(app)
