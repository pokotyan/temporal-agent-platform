# TAP --- Temporal Agent Platform

Temporal の Durable Execution で Claude Code のスキルを数珠繋ぎにする基盤

複数の Claude セッションをステップとして定義し、条件分岐・ループ・並列実行・定期実行を耐障害性のある形で実行する。

## コンセプト

このリポジトリが担うのは **オーケストレーション** だけ。

- **「何をするか」** はワークフロー YAML で定義（`task:` フィールド）
- **「どうやるか」** は Claude Code に任せる（スキル・MCP・ツールはすべて引き継がれる）
- **「いつ・何回・どの順で」** を Temporal が保証する

各ステップは `claude -p` を起動する。ローカルの Claude Code 設定（MCP・スキル・sandbox）がそのまま適用されるため、ローカルで Claude Code を動かすのと同じ UX になる。セキュリティモデルの詳細は [Design Notes](#design-notes) を参照。

## Architecture

```text
ホスト
  ├─ Docker
  │    └─ Temporal Server (:7233 gRPC, :8233 Web UI)
  │
  └─ Node.js
       ├─ Orchestrator Worker  — pieceWorkflow / stepWorkflow 実行
       ├─ Agent Worker         — claude -p 呼び出し (Activity)
       └─ UI Server (:8234)    — ワークフロー管理 Web UI
```

各ステップは Temporal Child Workflow (`stepWorkflow`) として実行されるため、独立した実行履歴・リトライ・キャンセルが可能。

## Quick Start

### Prerequisites

- **Docker** --- Temporal dev server
- **Node.js 22+**
- **Claude Code** --- `claude` コマンドが PATH に存在すること
- **terminal-notifier** --- ワークフロー完了時の macOS 通知に使用（`brew install terminal-notifier`）

### Claude Code の認証

`claude -p` は Claude Code CLI のローカル認証（Claude Max / OAuth）をそのまま使用する。`ANTHROPIC_API_KEY` の設定は不要。

### Setup

```bash
npm install && make build
```

### Start

```bash
make start   # Temporal + Workers + UI Server を起動
make ui      # Web UI を開く → http://localhost:8234
```

### 自動起動 (SessionStart Hook)

Claude Code のセッション開始時に TAP サーバーを自動起動できる。`.claude/settings.json` に以下を追加:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/temporal-agent-platform/scripts/session-start-hook.js",
            "timeout": 120
          }
        ]
      }
    ]
  }
}
```

既にサーバーが動いていればスキップされる。セッション終了時にサーバーは停止しない（バックグラウンドで動き続ける）。手動停止は `make stop`。

### Stop

```bash
make stop
```

## Web UI

`http://localhost:8234` でワークフローの管理・監視ができる。

- **ダッシュボード** (`/`) --- 実行中・完了・定期実行中のワークフロー一覧、タイムライン、ステップ出力
- **ビジュアルエディター** (`/editor`) --- React Flow ベースのワークフローキャンバスで GUI 作成・編集

フロントエンドは React + TypeScript + Vite で構築。`frontend/` でソースを管理し、`make build` で `ui/` にビルド出力される。

## Workflow Definition (YAML)

ワークフローは `resources/workflows/*.yaml` に定義する。YAML スキーマの詳細・エージェント定義・使用例・TAP 独自フィールドと Temporal 由来フィールドの分類については以下を参照:

**[docs/architecture-temporal-mapping.md](docs/architecture-temporal-mapping.md)**

## Project Structure

```text
temporal-agent-platform/
├── frontend/            # React + TypeScript + Vite（Web UI ソース）
│   ├── src/
│   │   ├── pages/       # Dashboard, Editor
│   │   ├── components/  # dashboard/, editor/ コンポーネント
│   │   ├── api.ts       # REST API クライアント
│   │   └── types.ts     # フロントエンド型定義
│   ├── vite.config.ts   # ビルド設定（出力先: ../ui/）
│   └── package.json
├── packages/
│   ├── shared/          # 型定義、Zod スキーマ、YAML ローダー
│   ├── workflows/       # Temporal Workflow 定義 (pieceWorkflow, stepWorkflow)
│   ├── activities/      # Activity 実装 (claude -p 呼び出し、ルール評価)
│   ├── workers/         # Orchestrator / Agent Worker プロセス
│   └── cli/             # tap コマンド
├── resources/
│   ├── workflows/       # YAML ワークフロー定義
│   └── agents/default/  # エージェントプロンプト設定
├── scripts/
│   ├── tap-service-manager.js   # サービス起動・停止管理
│   ├── tap-ui-server.js         # Web UI サーバー（SPA 対応）
│   ├── session-start-hook.js    # SessionStart フック
│   └── mcp-server.js            # Claude Code MCP サーバー
├── ui/                  # Vite ビルド出力（git 管理外）
└── Makefile
```

## Makefile Commands

| コマンド | 説明 |
| ------- | ---- |
| `make start` | Temporal + Workers + UI Server を起動 |
| `make stop` | 全サービス停止 |
| `make restart` | 全サービス再起動 |
| `make status` | サービス状態表示 |
| `make ui` | Web UI を開く |
| `make build` | TypeScript + フロントエンドビルド |
| `make lint` | Biome lint |
| `make typecheck` | 型チェック |
| `make test` | テスト実行 |

## Rule Evaluation

ステップ完了後、次のステップへの遷移を以下の順で判定する:

1. **並列集約条件** --- `all("approved")` / `any("needs_fix")`
2. **ステータスタグ** --- エージェント出力中の `[STEP:TAG]` タグ
3. **AI Judge** --- Temporal Activity として LLM にルール判定を委譲
4. **ABORT** --- いずれにもマッチしなかった場合

## Design Notes

**なぜ Child Workflow か**
各ステップを Child Workflow にすることで、Temporal Web UI での独立した実行履歴・個別リトライ・個別キャンセルが可能になる。

**セキュリティモデル: `bypassPermissions` + sandbox**

TAP のエージェント実行は `claude -p --permission-mode bypassPermissions` で行う。これはツール使用の承認プロンプトを全てスキップするモードであり、非インタラクティブ (`-p`) で MCP やスキルを制限なく使うために必要な設定である。

> `bypassPermissions` mode disables permission prompts and safety checks. Tool calls execute immediately...
> --- [Permission modes - Claude Code Documentation](https://code.claude.com/docs/en/permission-modes.md#skip-all-checks-with-bypasspermissions-mode)

一見リスクがある選択だが、以下の前提で安全性を担保している:

1. **sandbox が OS レベルで適用され続ける。** Permission と sandbox は独立した別レイヤーであり、`bypassPermissions` でも sandbox 制限はバイパスされない。

   > Sandboxing and permissions are complementary security layers that work together:
   > - **Permissions** control which tools Claude Code can use and are evaluated before any tool runs.
   > - **Sandboxing** provides OS-level enforcement that restricts what Bash commands can access at the filesystem and network level.
   > --- [Sandboxing - Claude Code Documentation](https://code.claude.com/docs/en/sandboxing.md)

2. **`~/.claude/settings.json` で sandbox を有効化していることが前提。** 以下の設定により、Bash ツールのファイルシステム・ネットワークアクセスが制限される:

   ```json
   {
     "sandbox": {
       "enabled": true,
       "allowUnsandboxedCommands": false
     }
   }
   ```

   `allowUnsandboxedCommands: false` により、sandbox のエスケープハッチ (`dangerouslyDisableSandbox`) も完全に無効化される。

   > You can disable this escape hatch by setting `"allowUnsandboxedCommands": false` in your sandbox settings. When disabled, the `dangerouslyDisableSandbox` parameter is completely ignored and all commands must run sandboxed.
   > --- [Sandboxing - Claude Code Documentation](https://code.claude.com/docs/en/sandboxing.md)

3. **`claude -p` はローカルの全設定を引き継ぐ。** `--bare` を付けない限り、MCP サーバー、スキル、CLAUDE.md がインタラクティブセッションと同様にロードされる。

   > Without it, `claude -p` loads the same context an interactive session would, including anything configured in the working directory or `~/.claude`.
   > --- [Headless mode - Claude Code Documentation](https://code.claude.com/docs/en/headless.md)

   TAP 側で `--allowedTools` による制限は行わない。制限を上書きすると MCP やスキルが使えなくなるため、セキュリティは settings.json の sandbox に委ねる。

**タスクは YAML に埋め込む**
実行時にタスクを入力させるのではなく、ワークフロー定義の `task:` フィールドに書く。実行 = ワークフローを選んでボタンを押すだけ。

**フロントエンドは React + Vite**
`frontend/` で開発し `ui/` にビルド出力。`ui/` は `.gitignore` で管理外。`scripts/tap-ui-server.js` が静的ファイル配信 + SPA フォールバック + REST API を提供。

## References

- [Temporal.io --- Of course you can build dynamic AI agents](https://temporal.io/blog/of-course-you-can-build-dynamic-ai-agents-with-temporal)
- [Temporal.io --- Orchestrating ambient agents](https://temporal.io/blog/orchestrating-ambient-agents-with-temporal)

## License

MIT
