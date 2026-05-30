import os
import uuid
from datetime import datetime
from typing import List, Optional

import boto3
import jwt
import requests
from botocore.exceptions import ClientError
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from mangum import Mangum
from pydantic import BaseModel, Field

app = FastAPI(title="SnapKakeibo API", version="1.0.0")

# CORS設定 (フロントエンドからのアクセスを許可)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 開発用にすべて許可。本番時はCloudFrontドメインに制限
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# AWSクライアントの初期化
s3_client = boto3.client("s3")

# ローカルDynamoDBまたはAWS DynamoDBへの接続切り替え
DYNAMODB_ENDPOINT_URL = os.environ.get("DYNAMODB_ENDPOINT_URL")
if DYNAMODB_ENDPOINT_URL:
    dynamodb = boto3.resource("dynamodb", endpoint_url=DYNAMODB_ENDPOINT_URL)
else:
    dynamodb = boto3.resource("dynamodb")
# Bedrock Runtimeクライアントの初期化 (東京リージョン ap-northeast-1)
bedrock_client = boto3.client(
    "bedrock-runtime", region_name=os.environ.get("AWS_REGION", "ap-northeast-1")
)

# 環境変数から設定を取得
TABLE_NAME = os.environ.get("DYNAMODB_TABLE", "snap_kakeibo_transactions")
BUCKET_NAME = os.environ.get("S3_BUCKET", "snap-kakeibo-receipts")
MODEL_ID = "amazon.nova-lite-v1:0"  # Bedrock の超低コストマルチモーダルモデル

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
    # Cognito未設定時はローカル擬似認証モードを適用（マルチユーザー再現可）
    if not COGNITO_USER_POOL_ID:
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
        raise HTTPException(status_code=401, detail="Token has expired") from e
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}") from e
    except Exception as e:
        raise HTTPException(
            status_code=401, detail=f"Authentication failed: {str(e)}"
        ) from e


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
    name: str = Field(description="品目名（例：牛乳）")
    price: int = Field(description="単価")
    qty: int = Field(description="数量")


class ReceiptAnalysisResult(BaseModel):
    transaction_date: str = Field(description="購入日 (YYYY-MM-DD形式)")
    shop_name: str = Field(description="店舗名。不明な場合は '不明な店舗'")
    total_amount: int = Field(description="合計金額")
    category_name: str = Field(
        description=(
            "カテゴリ名。"
            "'食費', '日用品', '交際費', '交通費', 'エンタメ', 'その他' のいずれか"
        )
    )
    items: List[ReceiptItem] = Field(
        default_factory=list, description="購入品目のリスト"
    )


class AnalyzeRequest(BaseModel):
    file_key: str


class TransactionSaveRequest(BaseModel):
    transaction_date: str
    shop_name: str
    total_amount: int
    category_name: str
    items: List[ReceiptItem]
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
            status_code=500, detail=f"Failed to generate upload URL: {str(e)}"
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
    # 1. S3から画像データを取得
    try:
        response = s3_client.get_object(Bucket=BUCKET_NAME, Key=payload.file_key)
        image_bytes = response["Body"].read()
    except ClientError as e:
        raise HTTPException(
            status_code=404, detail=f"Uploaded image not found in S3: {str(e)}"
        ) from e

    # 2. Bedrock (Nova Lite) を使用してマルチモーダル解析を実行
    try:
        file_extension = os.path.splitext(payload.file_key)[1].lower()
        image_format = "jpeg" if file_extension in [".jpg", ".jpeg"] else "png"

        prompt = """
        提供された日本語のレシート画像から、購入日(transaction_date)、店舗名(shop_name)、合計金額(total_amount)、品目リスト(items)、および最適なカテゴリ(category_name)を正確に抽出し、指定のJSONスキーマに沿ったJSONのみを出力してください。余計な説明文やMarkdownマークアップは一切含めないでください。

        【抽出ルール】
        1. 日本語を正確に処理してください。
        2. 各品目の単価と数量を抽出してください。
        3. カテゴリ名は以下のいずれかから最も適したものを選択してください。
           選択肢: ["食費", "日用品", "交際費", "交通費", "エンタメ", "その他"]

        【出力JSONフォーマット】
        {
          "transaction_date": "YYYY-MM-DD",
          "shop_name": "店舗名",
          "total_amount": 1000,
          "category_name": "食費",
          "items": [
            { "name": "牛乳", "price": 200, "qty": 1 }
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
        analysis_result = ReceiptAnalysisResult.model_validate_json(text_output)
        return analysis_result

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Bedrock AI processing failed: {str(e)}"
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
            "items": [item.model_dump() for item in payload.items],
            "receipt_s3_key": payload.receipt_s3_key,
            "memo": payload.memo,
            "created_at": datetime.utcnow().isoformat(),
        }

        table.put_item(Item=item)
        return {"status": "success", "transaction_id": transaction_id}
    except ClientError as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to save transaction to DynamoDB: {str(e)}"
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
        raise HTTPException(
            status_code=500, detail=f"Failed to query DynamoDB: {str(e)}"
        ) from e


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
        msg = f"Failed to delete transaction from DynamoDB: {str(e)}"
        raise HTTPException(status_code=500, detail=msg) from e


# AWS Lambda用のハンドラー
handler = Mangum(app)
