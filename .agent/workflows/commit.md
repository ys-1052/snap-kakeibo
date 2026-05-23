---
description: 英語でGitコミットメッセージを生成し、自動でコミットを実行する
trigger: "/commit"
---

# 英語コミットメッセージ生成＆自動コミット実行ワークフロー

ユーザーが `/commit` をトリガーした際、または英語でのコミット作成を求めた際に実行されます。

## 🛠️ 実行プロセス

1. **差分の取得**:
   - `git diff --cached` を実行して、ステージングされている変更の差分を取得してください。
2. **差分がない場合の処理**:
   - ステージングされた変更がない場合、コミットメッセージの生成を行わず、次のようにユーザーへ案内を返してください：
     > *「There are no staged changes. Please stage your files using `git add` and then run `/commit` again.」*
3. **メッセージの生成**:
   - ステージングされた差分を分析し、`.agent/rules/git-commit-rules.md` の規約に100%従って、**英語の件名 (Description)** を持ったコミットメッセージを生成します。
4. **Gitコミットコマンドの実行提案 (自動実行)**:
   - 生成したコミットメッセージを使用して、**直接 `run_command` ツールを呼び出し、`git commit -m "<生成されたコミットメッセージ>"` コマンドを実行提案（または実行）してください。**
   - メッセージを提示するだけでなく、ユーザーが承認ボタン一発でコミットを完了できるようにツールを起動することが必須です。

---

## 📝 コミット規約の再確認 (英語版)

- 形式: `<type>[optional scope]: <description>` (件名は英語、末尾にピリオドなし)
- Type一覧: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`
- ❌ 絵文字、スラング、曖昧な単語 (`update`, `fix`, `change`, `modify`, `wip` など単体) の使用は厳禁。
