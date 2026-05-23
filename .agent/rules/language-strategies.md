---
trigger: always_on
globs: ["**/*"]
---

# Language Strategies (言語戦略)

## 1. Internal Reasoning (内部推論)
- エージェントの推論精度を最大化するため、**思考プロセス（Chain of Thought）および内部の調査記録は「英語（English）」**で行うことを強く推奨/許可します。

## 2. User-Facing Output (ユーザー向け出力)
- ユーザーに対する最終的な回答、説明、チャットメッセージは、必ず**親切で簡潔な「日本語（Japanese）」**で記述しなければなりません。

## 3. Tool Metadata & Task Parameters (ツールパラメータ)
- `run_command` や `browser_subagent` などのツールを呼び出す際の、メタデータパラメータは以下のルールを厳守してください：
  - **`TaskName`**: 必ず **日本語** で記述すること（英語は禁止）。
  - **`TaskSummary`**: 必ず **日本語** で記述すること。
  - **`toolAction` / `toolSummary`**: 必ず **日本語** で記述すること。

## 4. Code & Variables (コード規約)
- ソースコード中の変数名、関数名、クラス名、コメント、ドキュメント文字列（Docstring）は、業界標準に従い**標準的な「英語（English）」**を使用してください。
- ユーザーに提示するダッシュボード上のUI表示テキストやメッセージなどは、**日本語**で記述します。

## 5. Artifacts (成果物ファイル)
- `task.md`, `implementation_plan.md` などのプロジェクトルートに生成されるドキュメントファイルは、必ず **日本語** で記述してください。
