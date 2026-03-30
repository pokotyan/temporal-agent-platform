# TAP ワークフロー YAML リファレンス

TAP は Temporal Workflow の制御構造をフル活用し、YAML DSL で宣言的に定義できるようにしたレイヤーである。

ワークフローは `resources/workflows/*.yaml` に定義する。YAML のキーは `snake_case` で記述し、内部で `camelCase` に変換される。

## スキーマ

### トップレベル

| フィールド | 型 | 必須 | デフォルト | 説明 |
| --------- | -- | ---- | --------- | ---- |
| `name` | string | YES | — | ワークフロー名。UI 表示・通知・グルーピングに使用 |
| `description` | string | — | — | 説明文 |
| `task` | string | — | — | タスク内容。テンプレート変数 `{task}` として各ステップに渡される |
| `initial_step` | string | YES | — | 最初に実行するステップ名 |
| `max_iterations` | number | — | `15` | ステップ遷移の総回数上限。`0` = 無制限 |
| `steps` | StepConfig[] | YES | — | ステップ定義の配列（1つ以上） |
| `temporal` | object | — | — | Temporal 固有の設定 |

### temporal（ワークフローレベル）

| フィールド | 型 | 必須 | 説明 |
| --------- | -- | ---- | ---- |
| `task_queue` | string | — | Activity を実行するタスクキュー |
| `workflow_execution_timeout` | string | — | ワークフロー全体のタイムアウト（`1h`, `168h` など） |
| `retry_policy.max_attempts` | number | — | 最大リトライ回数 |
| `retry_policy.backoff_coefficient` | number | — | 指数バックオフ係数 |
| `schedule.cron` | string | — | cron 式（5フィールド: `分 時 日 月 曜日`） |
| `schedule.overlap_policy` | string | — | `skip` / `cancel_other` / `allow_all` |

### steps（ステップ定義）

| フィールド | 型 | 必須 | デフォルト | 説明 |
| --------- | -- | ---- | --------- | ---- |
| `name` | string | YES | — | ステップ名（ワークフロー内で一意） |
| `agent` | string | — | — | エージェント名。`resources/agents/default/<name>.yaml` を参照 |
| `skill` | string | — | — | Claude Code スキル名。`claude -p "/<skill> {instruction}"` で実行 |
| `edit` | boolean | — | `false` | ファイル編集を許可するか |
| `model` | string | — | — | モデル指定（`opus`, `sonnet` など） |
| `instruction_template` | string | — | — | 指示テンプレート。変数展開あり（後述） |
| `pass_previous_response` | boolean | — | `false` | 前ステップの出力を `{previous_response}` で渡すか |
| `rules` | RuleConfig[] | — | — | 次ステップ判定ルール |
| `parallel` | StepConfig[] | — | — | 並列実行するサブステップ。`agent` と排他 |
| `report` | object | — | — | レポート生成設定（`name`, `format`） |
| `temporal` | object | — | — | ステップ単位の Temporal 設定オーバーライド |

`agent` と `skill` はどちらも `claude -p` でローカル設定を引き継ぐ。MCP・スキル・ツールはすべて使用可能。

### rules（遷移ルール）

| フィールド | 型 | 必須 | デフォルト | 説明 |
| --------- | -- | ---- | --------- | ---- |
| `condition` | string | YES | — | 判定条件（自然言語 or 集約関数） |
| `next` | string | — | `COMPLETE` | 遷移先ステップ名。予約語: `COMPLETE`, `ABORT` |
| `status` | string | — | — | 並列サブステップのステータスタグ |

ルール判定は 5 段階のカスケード:

1. **集約条件** --- `all("approved")` / `any("needs_fix")`（並列ステップ用）
2. **Phase 3 ステータスタグ** --- AI が出力に付与したタグ
3. **Phase 1 出力タグ** --- エージェント出力中の `[STEP:TAG]` パターン
4. **AI Judge** --- 自然言語条件を LLM が判定
5. **ABORT** --- いずれにもマッチしなかった場合

### temporal（ステップレベル）

| フィールド | 型 | 説明 |
| --------- | -- | ---- |
| `task_queue` | string | このステップの Activity キュー |
| `start_to_close_timeout` | string | Activity タイムアウト（`300s`, `10m` など） |
| `retry_policy.max_attempts` | number | リトライ回数 |
| `retry_policy.backoff_coefficient` | number | バックオフ係数 |
| `retry_policy.initial_interval` | string | 初回リトライ間隔 |
| `retry_policy.max_interval` | string | リトライ間隔上限 |

### テンプレート変数

`instruction_template` 内で使用できる変数:

| 変数 | 内容 |
| ---- | ---- |
| `{task}` | ワークフローの `task:` フィールド |
| `{previous_response}` | 前ステップの出力（`pass_previous_response: true` 時） |
| `{iteration}` | 現在のイテレーション番号 |
| `{max_iterations}` | 上限値 |

## エージェント定義

エージェント設定は `resources/agents/default/<name>.yaml` に定義する。ステップの `agent:` フィールドで参照。

| フィールド | 型 | 必須 | デフォルト | 説明 |
| --------- | -- | ---- | --------- | ---- |
| `name` | string | YES | — | エージェント名 |
| `description` | string | — | — | 役割の説明 |
| `model` | string | — | — | モデル指定 |
| `system_prompt` | string | — | — | システムプロンプト（ペルソナ・指示） |
| `prompt_file` | string | — | — | 外部プロンプトファイルパス（`system_prompt` と排他） |
| `allowed_tools` | string[] | — | — | 許可するツール |
| `requires_edit` | boolean | — | `false` | 編集権限が必要か |
| `default_instruction` | string | — | — | ステップで `instruction_template` 未指定時のデフォルト |
| `sandbox.cpu` | string | — | — | CPU リミット（`500m`, `1` など） |
| `sandbox.memory` | string | — | — | メモリリミット（`1Gi`, `2Gi` など） |
| `sandbox.timeout` | string | — | — | 実行タイムアウト（`300s`, `10m` など） |

```yaml
name: planner
description: "タスク分析と実装計画の作成"
model: claude-sonnet-4-20250514
system_prompt: |
  あなたはソフトウェアアーキテクトです。タスクを分析し、
  具体的な実装計画を作成してください。
  コードは書かず、計画のみ行います。
sandbox:
  cpu: "500m"
  memory: "1Gi"
  timeout: "300s"
```

## 使用例

**基本（単一ステップ + 定期実行）:**

```yaml
name: レビュー待ちissueの確認
initial_step: check
max_iterations: 15

temporal:
  task_queue: agent-tasks
  schedule:
    cron: "0 */3 * * *"
    overlap_policy: skip

steps:
  - name: check
    agent: investigator
    instruction_template: |
      ZenHub の Review レーンを確認し、結果を Slack に通知する。
      MCP 経由で操作すること。
    rules:
      - condition: "常にtrue"
        next: COMPLETE
```

**複数ステップ（計画 → 実装 → レビュー）:**

```yaml
name: feature-dev
task: "ユーザー認証機能を追加する"
initial_step: plan
max_iterations: 10

temporal:
  task_queue: agent-tasks
  workflow_execution_timeout: 2h

steps:
  - name: plan
    agent: planner
    instruction_template: |
      以下のタスクを分析し、実装計画を作成してください。
      ## タスク
      {task}
    rules:
      - condition: "計画完了"
        next: implement
      - condition: "要件不明"
        next: ABORT

  - name: implement
    agent: coder
    edit: true
    pass_previous_response: true
    instruction_template: |
      以下の計画を実装してください。
      ## 計画
      {previous_response}
      ## タスク
      {task}
    rules:
      - condition: "実装完了"
        next: review
      - condition: "再計画が必要"
        next: plan

  - name: review
    agent: reviewer
    pass_previous_response: true
    instruction_template: |
      実装結果をレビューしてください。
      {previous_response}
    rules:
      - condition: "Approved"
        next: COMPLETE
      - condition: "要修正"
        next: implement
```

**並列ステップ（複数レビューの集約）:**

```yaml
  - name: review
    parallel:
      - name: arch-review
        agent: reviewer
        rules:
          - condition: "Approved"
            status: approved
          - condition: "Needs fix"
            status: needs_fix
      - name: security-review
        agent: reviewer
        rules:
          - condition: "Approved"
            status: approved
          - condition: "Needs fix"
            status: needs_fix
    rules:
      - condition: 'all("approved")'
        next: COMPLETE
      - condition: 'any("needs_fix")'
        next: fix
```

**自己参照ループ:**

```yaml
max_iterations: 0   # 無制限

steps:
  - name: monitor
    agent: investigator
    rules:
      - condition: "目標達成"
        next: COMPLETE
      - condition: "継続"
        next: monitor   # 自己参照 = ループ
```

---

## YAML フィールドの分類: TAP 独自 vs Temporal

### TAP 独自（このアプリで解釈・処理）

| フィールド | 説明 |
| --------- | ---- |
| `name` | UI 表示・通知・グルーピング用の名前 |
| `description` | 説明文 |
| `task` | テンプレート変数 `{task}` の値 |
| `initial_step` | 最初に実行するステップ名 |
| `max_iterations` | ステップ遷移の安全キャップ |
| `steps[].name` | ステップ識別子 |
| `steps[].agent` | エージェント YAML の参照 |
| `steps[].skill` | Claude Code スキル名 |
| `steps[].edit` | ファイル編集許可フラグ |
| `steps[].model` | モデルオーバーライド |
| `steps[].instruction_template` | 指示テンプレート + 変数展開 |
| `steps[].pass_previous_response` | 前ステップ出力の引き継ぎ |
| `steps[].rules[]` | 次ステップ判定ルール（condition, next, status） |
| `steps[].parallel[]` | 並列サブステップ定義 |
| `steps[].report` | レポート生成設定 |

### Temporal に渡される設定

| フィールド | Temporal の何に対応するか |
| --------- | ---- |
| `temporal.task_queue` | `startWorkflow()` / `proxyActivities()` の `taskQueue` |
| `temporal.workflow_execution_timeout` | `WorkflowOptions.workflowExecutionTimeout` |
| `temporal.retry_policy.*` | `WorkflowOptions.retry` / `ActivityOptions.retry` |
| `temporal.schedule.cron` | `Schedule.spec.cronExpressions` |
| `temporal.schedule.overlap_policy` | `Schedule.policies.overlap` (ScheduleOverlapPolicy) |
| `steps[].temporal.task_queue` | ステップの Activity の `taskQueue` オーバーライド |
| `steps[].temporal.start_to_close_timeout` | `ActivityOptions.startToCloseTimeout` |
| `steps[].temporal.retry_policy.*` | `ActivityOptions.retry` |

### 両方にまたがるもの

`temporal.schedule.cron` + `temporal.schedule.overlap_policy` は Temporal Schedule API にそのまま渡されるが、TAP の `tap-ui-server.js` がスケジュールの作成・更新・削除を管理している（YAML 保存時の自動同期など）。

**まとめ:** `temporal:` 配下は Temporal SDK に渡すパラメータ、それ以外は全て TAP のオーケストレーションロジックが解釈する独自設定。

## Temporal の制御構造と TAP の対応

Temporal Workflow 自体が逐次実行・並列実行・条件分岐をネイティブにサポートしている。TAP はこれらの制御構造をフル活用し、YAML から自動的にマッピングしている。

| Temporal の仕組み | TAP での使い方 |
|---|---|
| **Sequential chaining** (Activity の `.result()` で待つ) | `pieceWorkflow` の while ループ内で `startChild` → `result()` を順番に呼ぶ |
| **Fan-out / Fan-in** (複数 Future を並列起動) | `executeParallelSteps` で複数の Child Workflow を同時起動 → `Promise.all` で全完了を待つ |
| **条件分岐** (if/else) | `rules` の5段階カスケード判定で次ステップを動的に決定 |
| **Child Workflow** | 各ステップが `stepWorkflow` として Child Workflow で実行される |
| **Signal** | `userInputSignal` で外部からワークフローに入力を送信（ブロック解除） |
| **Query** | `statusQuery` / `stepOutputsQuery` で UI からワークフロー状態を取得 |
| **Schedule** | cron 付きワークフローを Temporal Schedule API で登録 |
| **Memo** | `upsertMemo({ workflowName })` で UI のグルーピング用メタデータを付与 |

## YAML から Temporal パターンへの変換

TAP の独自部分は「YAML → Temporal パターンへの変換」である。ユーザーは YAML で `rules`, `parallel`, `pass_previous_response` を書くだけで、裏では Temporal の Child Workflow・Signal・Query・Schedule が組み合わされて動く。

```
YAML 定義                          Temporal の実行
─────────────                      ──────────────

steps:
  - name: plan                 →   startChild(stepWorkflow, "plan")
    rules:                         ↓ result()
      - condition: "完了"          ↓ determineNextStep() で条件判定
        next: implement        →   startChild(stepWorkflow, "implement")

  - name: review
    parallel:                  →   Promise.all([
      - name: arch-review              startChild(stepWorkflow, "arch-review"),
      - name: sec-review               startChild(stepWorkflow, "sec-review"),
                                   ])
    rules:
      - condition: all("ok")   →   evaluateAggregateRules() で集約判定
        next: COMPLETE

temporal:
  schedule:
    cron: "0 9 * * *"         →   client.schedule.create({ spec: { cronExpressions: [...] } })
```

Temporal が提供する制御フローを TypeScript で直接書く代わりに、YAML DSL で宣言的に定義できるようにしたのが TAP の役割である。
