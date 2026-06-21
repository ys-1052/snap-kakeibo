#!/usr/bin/env python3
import argparse
import sys

import boto3
from botocore.exceptions import ClientError


def get_cognito_user_pool_id(cognito_client, pool_name: str) -> str:
    """ユーザープール名からIDを取得します"""
    try:
        paginator = cognito_client.get_paginator("list_user_pools")
        for page in paginator.paginate(MaxResults=60):
            for pool in page.get("UserPools", []):
                if pool["Name"] == pool_name:
                    return pool["Id"]
    except ClientError as e:
        print(f"❌ ユーザープールの取得に失敗しました: {e}")
        sys.exit(1)

    print(f"❌ ユーザープール '{pool_name}' が見つかりませんでした。")
    sys.exit(1)


def find_cognito_user_by_email(cognito_client, pool_id: str, email: str):
    """メールアドレスからCognitoのユーザーを検索します"""
    try:
        # email属性でフィルタリングして検索
        response = cognito_client.list_users(
            UserPoolId=pool_id, Filter=f'email = "{email}"', Limit=1
        )
        users = response.get("Users", [])
        if not users:
            return None

        user = users[0]
        # sub (Cognitoの一意なID) を探す
        sub = None
        for attr in user.get("Attributes", []):
            if attr["Name"] == "sub":
                sub = attr["Value"]
                break

        return {
            "Username": user["Username"],  # 通常はUUID
            "sub": sub,
            "UserStatus": user.get("UserStatus"),
        }
    except ClientError as e:
        print(f"❌ ユーザーの検索中にエラーが発生しました: {e}")
        sys.exit(1)


def delete_s3_receipts(s3_client, bucket_name: str, items: list) -> bool:
    """取引明細レコードからS3キーを抽出してS3から画像を削除します"""
    s3_keys = []
    for item in items:
        # receipt_s3_key属性がある場合は追加
        if "receipt_s3_key" in item and item["receipt_s3_key"]:
            s3_keys.append({"Key": item["receipt_s3_key"]})

    if not s3_keys:
        print("ℹ️ 削除対象 of S3レシート画像はありません。")
        return True

    print(f"🔄 S3から {len(s3_keys)} 件のレシート画像を削除中...")
    try:
        # delete_objectsは最大1000件まで一括削除可能
        # 今回はスキャン数制限があるため25〜30件程度を想定、一括で問題ありません
        response = s3_client.delete_objects(
            Bucket=bucket_name, Delete={"Objects": s3_keys}
        )
        deleted = response.get("Deleted", [])
        errors = response.get("Errors", [])
        if deleted:
            print(f"✅ S3から {len(deleted)} 件の画像を正常に削除しました。")
        if errors:
            print(f"⚠️ S3の画像削除中にいくつかのエラーが発生しました: {errors}")
        return len(errors) == 0
    except ClientError as e:
        print(f"❌ S3画像の一括削除に失敗しました: {e}")
        return False


def delete_dynamodb_items(table, items: list) -> bool:
    """DynamoDBからユーザーの全レコードを一括削除します"""
    if not items:
        print("ℹ️ 削除対象のDynamoDBレコードはありません。")
        return True

    print(f"🔄 DynamoDBから {len(items)} 件のレコードを削除中...")
    try:
        with table.batch_writer() as batch:
            for item in items:
                batch.delete_item(Key={"PK": item["PK"], "SK": item["SK"]})
        print(f"✅ DynamoDBから {len(items)} 件の全レコードを正常に削除しました。")
        return True
    except ClientError as e:
        print(f"❌ DynamoDBレコードの一括削除に失敗しました: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(
        description="SnapKakeiboの指定したユーザーに関連するすべてのデータ（Cognito、S3、DynamoDB）を一括削除するスクリプトです。"
    )
    parser.add_argument("email", help="削除対象ユーザーのメールアドレス")
    parser.add_argument(
        "--stage", default="prod", help="デプロイステージ (デフォルト: prod)"
    )
    parser.add_argument(
        "--profile", help="AWS認証プロファイル名 (指定しない場合はデフォルトの認証情報)"
    )
    parser.add_argument(
        "--region",
        default="ap-northeast-1",
        help="AWSリージョン (デフォルト: ap-northeast-1)",
    )

    args = parser.parse_args()

    # AWSセッションの作成
    try:
        session = boto3.Session(profile_name=args.profile, region_name=args.region)
        cognito_client = session.client("cognito-idp")
        dynamodb = session.resource("dynamodb")
        s3_client = session.client("s3")
    except Exception as e:
        print(f"❌ AWSセッションの作成に失敗しました。認証情報を確認してください: {e}")
        sys.exit(1)

    # リソース名の組み立て
    service_name = "snap-kakeibo"
    user_pool_name = f"{service_name}-user-pool-{args.stage}"
    table_name = f"{service_name}-transactions-{args.stage}"
    bucket_name = f"{service_name}-receipts-{args.stage}"

    print("==================================================")
    print("   SnapKakeibo ユーザーデータ完全削除スクリプト")
    print("==================================================")
    print(f"🔍 ターゲットステージ: {args.stage}")
    print(f"🔍 対象メールアドレス: {args.email}")
    print("--------------------------------------------------")

    # 1. CognitoユーザープールIDを取得
    print("🔄 Cognito ユーザープールIDを取得中...")
    pool_id = get_cognito_user_pool_id(cognito_client, user_pool_name)
    print(f"✅ ユーザープールID: {pool_id}")

    # 2. Cognitoからユーザー情報を検索
    print(f"🔄 ユーザー '{args.email}' をCognitoで検索中...")
    user_info = find_cognito_user_by_email(cognito_client, pool_id, args.email)
    if not user_info:
        print(
            f"❌ 指定されたメールアドレス '{args.email}' のユーザーはCognito上に存在しません。"
        )
        sys.exit(1)

    user_id = user_info["sub"]
    cognito_username = user_info["Username"]
    print("✅ ユーザーが見つかりました:")
    print(f"   - Cognito Username (ID): {cognito_username}")
    print(f"   - DynamoDB User ID (sub): {user_id}")
    print(f"   - ステータス: {user_info['UserStatus']}")
    print("--------------------------------------------------")

    # 3. DynamoDBから削除対象のアイテムを事前にスキャン/確認
    table = dynamodb.Table(table_name)
    print("🔄 削除対象のDynamoDBレコードをロード中...")
    try:
        response = table.query(
            KeyConditionExpression="PK = :pk",
            ExpressionAttributeValues={":pk": f"USER#{user_id}"},
        )
        items = response.get("Items", [])
    except ClientError as e:
        print(
            f"❌ DynamoDBの検索に失敗しました。テーブル名を確認してください ({table_name}): {e}"
        )
        sys.exit(1)

    transaction_count = sum(
        1 for item in items if item["SK"].startswith("TRANSACTION#")
    )
    stats_count = sum(1 for item in items if item["SK"].startswith("STATS#"))

    print("📋 削除対象データの内訳:")
    print(f"   - S3レシート画像バケット: {bucket_name}")
    print(
        f"   - DynamoDBレコード数 (合計): {len(items)} 件 (明細: {transaction_count}件, 統計等: {stats_count}件)"
    )
    print(f"   - Cognitoユーザーアカウント: {args.email} を削除")
    print("--------------------------------------------------")

    # 4. 最終確認
    confirm = input(
        f"⚠️ 本当にユーザー {args.email} に紐づく上記すべてのデータを【完全に削除】しますか？ (yes/no): "
    )
    if confirm.lower() != "yes":
        print("🛑 削除処理はキャンセルされました。")
        sys.exit(0)

    print("\n🚀 削除処理を開始します...")

    # 5. S3画像の削除
    s3_success = delete_s3_receipts(s3_client, bucket_name, items)

    # 6. DynamoDBレコードの削除
    db_success = delete_dynamodb_items(table, items)

    # 7. Cognitoユーザーの削除
    print("🔄 Cognitoからユーザーアカウントを削除中...")
    cognito_success = False
    try:
        cognito_client.admin_delete_user(UserPoolId=pool_id, Username=cognito_username)
        print("✅ Cognitoユーザーアカウントを正常に削除しました。")
        cognito_success = True
    except ClientError as e:
        print(f"❌ Cognitoユーザーアカウントの削除に失敗しました: {e}")

    print("--------------------------------------------------")
    if s3_success and db_success and cognito_success:
        print("🎉 すべてのデータが正常に完全削除されました！")
    else:
        print(
            "⚠️ 一部の削除処理が失敗またはスキップされました。ログを確認してください。"
        )
    print("==================================================")


if __name__ == "__main__":
    main()
