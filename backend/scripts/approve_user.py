#!/usr/bin/env python3
import argparse
import sys

import boto3
from botocore.exceptions import ClientError

VALID_GROUPS = {"Free", "Lite", "Premium", "Admins"}


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
        response = cognito_client.list_users(
            UserPoolId=pool_id, Filter=f'email = "{email}"', Limit=1
        )
        users = response.get("Users", [])
        if not users:
            return None

        user = users[0]
        sub = None
        for attr in user.get("Attributes", []):
            if attr["Name"] == "sub":
                sub = attr["Value"]
                break

        return {
            "Username": user["Username"],
            "sub": sub,
            "UserStatus": user.get("UserStatus"),
        }
    except ClientError as e:
        print(f"❌ ユーザーの検索中にエラーが発生しました: {e}")
        sys.exit(1)


def get_user_groups(cognito_client, pool_id: str, username: str) -> list:
    """ユーザーが現在所属しているグループ一覧を取得します"""
    try:
        response = cognito_client.admin_list_groups_for_user(
            Username=username, UserPoolId=pool_id
        )
        return [group["GroupName"] for group in response.get("Groups", [])]
    except ClientError as e:
        print(f"❌ ユーザーの所属グループの取得に失敗しました: {e}")
        sys.exit(1)


def remove_user_from_groups(cognito_client, pool_id: str, username: str, groups: list):
    """ユーザーを既存のプラン関連グループから削除します"""
    for group in groups:
        if group in VALID_GROUPS:
            print(f"🔄 グループ '{group}' からの削除中...")
            try:
                cognito_client.admin_remove_user_from_group(
                    UserPoolId=pool_id, Username=username, GroupName=group
                )
                print(f"✅ グループ '{group}' から削除しました。")
            except ClientError as e:
                print(f"❌ グループ '{group}' からの削除に失敗しました: {e}")
                sys.exit(1)


def add_user_to_group(cognito_client, pool_id: str, username: str, group_name: str):
    """ユーザーをターゲットグループに追加します"""
    print(f"🔄 グループ '{group_name}' へ追加中...")
    try:
        cognito_client.admin_add_user_to_group(
            UserPoolId=pool_id, Username=username, GroupName=group_name
        )
        print(f"✅ グループ '{group_name}' に追加しました。")
    except ClientError as e:
        print(f"❌ グループ '{group_name}' への追加に失敗しました: {e}")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="SnapKakeiboのユーザーを承認し、プラン（Cognitoグループ）を設定・変更するスクリプトです。"
    )
    parser.add_argument("email", help="対象ユーザーのメールアドレス")
    parser.add_argument(
        "--group",
        choices=list(VALID_GROUPS),
        required=False,
        help="割り当てるCognitoグループ / プラン (Free / Lite / Premium / Admins)",
    )
    parser.add_argument(
        "--stage", default="prod", help="デプロイステージ (デフォルト: prod)"
    )
    parser.add_argument("--profile", help="AWS認証プロファイル名")
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
    except Exception as e:
        print(f"❌ AWSセッションの作成に失敗しました。認証情報を確認してください: {e}")
        sys.exit(1)

    user_pool_name = f"snap-kakeibo-user-pool-{args.stage}"

    print("==================================================")
    print("      SnapKakeibo ユーザープラン設定スクリプト")
    print("==================================================")
    print(f"🔍 ターゲットステージ: {args.stage}")
    print(f"🔍 対象ユーザー: {args.email}")
    print(f"🔍 設定グループ (プラン): {args.group if args.group else '未指定（対話モード）'}")
    print("--------------------------------------------------")

    # 1. User Pool ID 取得
    print("🔄 Cognito ユーザープールIDを取得中...")
    pool_id = get_cognito_user_pool_id(cognito_client, user_pool_name)
    print(f"✅ ユーザープールID: {pool_id}")

    # 2. ユーザーを検索
    print(f"🔄 ユーザー '{args.email}' をCognitoで検索中...")
    user_info = find_cognito_user_by_email(cognito_client, pool_id, args.email)
    if not user_info:
        print(
            f"❌ 指定されたメールアドレス '{args.email}' のユーザーはCognito上に存在しません。"
        )
        sys.exit(1)

    cognito_username = user_info["Username"]
    print(f"✅ ユーザーが見つかりました (Cognito ID: {cognito_username})")

    # 3. 現在のグループを取得
    current_groups = get_user_groups(cognito_client, pool_id, cognito_username)
    print(f"📋 現在の所属グループ: {current_groups}")

    # プラン指定がない場合に対話型で選択させる
    target_group = args.group
    if not target_group:
        print("\n設定するプラン（グループ）を選択してください:")
        print("1. Free    (無料お試し・月間1回)")
        print("2. Lite    (ライト・月間30回)")
        print("3. Premium (プレミアム・無制限)")
        print("4. Admins  (管理者・無制限)")
        try:
            choice = input("選択してください (1-4) [キャンセルする場合は Enter]: ").strip()
            if choice == "1":
                target_group = "Free"
            elif choice == "2":
                target_group = "Lite"
            elif choice == "3":
                target_group = "Premium"
            elif choice == "4":
                target_group = "Admins"
            else:
                print("🛑 キャンセルされました。")
                sys.exit(0)
        except (KeyboardInterrupt, EOFError):
            print("\n🛑 キャンセルされました。")
            sys.exit(0)

    # すでに設定したいグループだけに所属している場合は何もしない
    if len(current_groups) == 1 and current_groups[0] == target_group:
        print(f"ℹ️ すでにグループ '{target_group}' に所属しています。変更は不要です。")
        print("==================================================")
        sys.exit(0)

    print("--------------------------------------------------")

    # 4. 既存グループからのクリーンアップ
    # (重複登録を防ぐため、Free, Lite, Premium, Adminsの既存所属を一度すべて削除)
    remove_user_from_groups(cognito_client, pool_id, cognito_username, current_groups)

    # 5. ターゲットグループへの追加
    add_user_to_group(cognito_client, pool_id, cognito_username, target_group)

    print("--------------------------------------------------")
    print(
        f"🎉 ユーザー '{args.email}' は正常に承認され、プラン '{target_group}' が適用されました！"
    )
    print("==================================================")


if __name__ == "__main__":
    main()
