import argparse
import os

import boto3


def main():
    desc = (
        "AWSのデプロイ結果を取得し、"
        "フロントエンド用の環境変数ファイル .env.production を自動更新します。"
    )
    parser = argparse.ArgumentParser(description=desc)
    parser.add_argument(
        "--stage", default="dev", help="デプロイ先のステージ名 (デフォルト: dev)"
    )
    parser.add_argument("--profile", default=None, help="AWS CLI プロファイル名")
    parser.add_argument(
        "--region",
        default="ap-northeast-1",
        help="AWS リージョン (デフォルト: ap-northeast-1)",
    )
    args = parser.parse_args()

    service_name = "snap-kakeibo-backend"
    stack_name = f"{service_name}-{args.stage}"

    print(f"AWS Stack: '{stack_name}' のデプロイ結果を取得しています...")

    session = boto3.Session(
        profile_name=args.profile or os.environ.get("AWS_PROFILE"),
        region_name=args.region,
    )
    cf = session.client("cloudformation")

    try:
        response = cf.describe_stacks(StackName=stack_name)
        outputs = response["Stacks"][0].get("Outputs", [])

        api_url = ""
        client_id = ""

        for out in outputs:
            key = out["OutputKey"]
            val = out["OutputValue"]
            if key == "ApiUrl":
                api_url = val
            elif key == "CognitoClientId":
                client_id = val

        if not api_url or not client_id:
            print(
                "Warning: CloudFormation Outputs から ApiUrl または "
                "CognitoClientId が見つかりませんでした。"
                "serverless.yml の Outputs 定義を確認してください。"
            )

        env_path = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "../frontend/.env.production")
        )

        with open(env_path, "w", encoding="utf-8") as f:
            f.write(
                "# このファイルはデプロイ時に自動生成されました。"
                "手動で変更しないでください。\n"
            )
            f.write(f"VITE_API_URL={api_url}\n")
            f.write(f"VITE_COGNITO_CLIENT_ID={client_id}\n")
            f.write(f"VITE_COGNITO_REGION={args.region}\n")

        print(f"\n✨ {env_path} を自動生成しました！")
        print(f"  - VITE_API_URL: {api_url}")
        print(f"  - VITE_COGNITO_CLIENT_ID: {client_id}")
        print(f"  - VITE_COGNITO_REGION: {args.region}\n")

    except Exception as e:
        print(f"❌ エラーが発生しました: {e}")
        print(
            "AWSの認証情報が設定されているか、"
            "またはスタックが正常にデプロイされているか確認してください。"
        )


if __name__ == "__main__":
    main()
