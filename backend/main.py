import os
import uuid
from datetime import datetime
from typing import List, Optional

import boto3
from botocore.exceptions import ClientError
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
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
dynamodb = boto3.resource("dynamodb")
# Bedrock Runtimeクライアントの初期化 (東京リージョン ap-northeast-1)
bedrock_client = boto3.client(
    "bedrock-runtime", region_name=os.environ.get("AWS_REGION", "ap-northeast-1")
)

# 環境変数から設定を取得
TABLE_NAME = os.environ.get("DYNAMODB_TABLE", "snap_kakeibo_transactions")
BUCKET_NAME = os.environ.get("S3_BUCKET", "snap-kakeibo-receipts")
MODEL_ID = "amazon.nova-lite-v1:0"  # Bedrock の超低コストマルチモーダルモデル

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


@app.get("/api/receipts/presigned-url", response_model=PresignedUrlResponse)
def get_presigned_url(filename: str):
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
def analyze_receipt(payload: AnalyzeRequest):
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
        # Converse APIは自動でbase64処理などを行うため便利
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

        # AIがMarkdownの ```json ... ``` で囲んで出力した場合のトリミング処理
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
def save_transaction(payload: TransactionSaveRequest, user_id: str = "USER#default"):
    """
    確定した家計簿データをDynamoDBに保存します。
    """
    try:
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
def list_transactions(user_id: str = "USER#default"):
    """
    ユーザーの取引履歴を取得します。
    """
    try:
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


# AWS Lambda用のハンドラー
handler = Mangum(app)
