# Palmux - ユーザー目線の仕様書

> 本ドキュメントは 2026年3月時点の Palmux 全機能をユーザー目線でまとめたものです。
> ゼロから作り直す際の仕様定義として使用してください。

## コアコンセプト：階層構造

Palmux のネイティブな概念モデルは以下の 3 階層で構成される。

```
Repository（ghq 管理）
└── Branch（git worktree 管理）
    ├── Claude タブ   × 1（AI アシスタント）
    ├── Files タブ    × 1（ファイルブラウザ）
    ├── Git タブ      × 1（git 操作）
    └── Bash タブ     × 1〜n（ターミナル）
```

### Repository（リポジトリ）

- `ghq` で管理された GitHub リポジトリ（例: `github.com/user/palmux`）
- Drawer の最上位グループとして表示
- リポジトリ単位で Branch の一覧を持つ

### Branch（ブランチ）

- git worktree で管理された開発単位
- **開発作業はブランチ単位で行う**（ブランチ = 1 つの作業コンテキスト）
- 各ブランチは独立した worktree ディレクトリを持つ
- Drawer でリポジトリを展開するとブランチ一覧が表示される
- ブランチを選択すると、そのブランチのタブセットが TabBar に展開される

### タブセット（Branch に紐づく固定タブ）

各ブランチは以下のタブを **必ず 1 つ以上** 持つ：

| タブ | 数 | 内容 |
|---|---|---|
| **Claude** | 1 | tmux ウィンドウ上で `claude` コマンドを実行した AI アシスタント |
| **Files** | 1 | そのブランチの worktree をルートとしたファイルブラウザ |
| **Git** | 1 | そのブランチの diff / log / stage 等の Git 操作 UI |
| **Bash** | 1〜n | 自由に使えるターミナル（追加・削除可能） |

- Claude / Files / Git は各ブランチに 1 つ固定で存在する（削除不可）
- Bash タブは必ず 1 つ以上存在し、[+] で追加できる
- タブの実体は tmux ウィンドウ（Bash / Claude）またはフロントエンドビュー（Files / Git）

### バックエンド実装との対応

| Palmux 概念 | tmux / git の実体 |
|---|---|
| Repository | `ghq list` で管理されるローカルリポジトリ |
| Branch | `git worktree add` で作成された worktree |
| タブセット全体 | tmux セッション 1 つ（ブランチごと） |
| Claude タブ | tmux ウィンドウ（`claude` コマンド実行中） |
| Bash タブ | tmux ウィンドウ（シェル） |
| Files タブ | フロントエンドビュー（tmux ウィンドウではない） |
| Git タブ | フロントエンドビュー（tmux ウィンドウではない） |

### 現状の問題（作り直しの背景）

現行実装は **tmux セッション・ウィンドウが一級の概念** になっている。その結果：

- Drawer が「tmux セッション一覧 + ウィンドウ一覧」という tmux の生の構造を直接表示している
- Repository / Branch という開発上の文脈が UI に反映されておらず、ユーザーが手動で対応を把握しなければならない
- Files タブ・Git タブが tmux ウィンドウと同列に並ぶため、「ブランチごとのタブセット」という概念が成立しにくい
- tmux セッション/ウィンドウの増減がそのまま UI に影響し、状態が不安定になりやすい

**作り直しでは Repository > Branch > タブセットを Palmux ネイティブの一級概念とし、tmux はその裏側の実装詳細として隠蔽する。**

### タブの実装バックエンド

タブの実体は tmux に限らない。Palmux タブは「何かを表示するビュー」であり、その実装は以下のいずれか：

| タブ種別 | 実装 |
|---|---|
| Bash タブ | tmux ウィンドウ（pty） |
| Claude タブ | tmux ウィンドウ（pty、`claude` 実行） |
| Files タブ | フロントエンドビュー（REST API） |
| Git タブ | フロントエンドビュー（REST API） |

tmux はあくまで Bash / Claude タブの実装手段の一つ。将来的に別のバックエンド（例: SSH 直接接続）に差し替えることも概念上は妨げない。

### 分割表示（Split）

分割は **Palmux タブに対して適用する一級機能**。tmux のペイン分割とは無関係。

- 画面を左右に分割し、**任意の 2 タブを並べて表示**できる
- 分割されるのはブランチをまたいでもよい（例: 左パネルに branch-A の Claude タブ、右パネルに branch-B の Bash タブ）
- 分割の境界線（Divider）はドラッグで幅を調整可能
- 分割状態は localStorage に保存される
- 各パネルは独立したフォーカスを持ち、`Ctrl+Shift+←/→` で切り替える

---

## 概要

**Palmux**（パーマックス）は、tmux セッション・ウィンドウ・ペインをブラウザから操作できる Web ベースのターミナルクライアント。PC・スマートフォン両対応で、Go シングルバイナリとしてデプロイ可能。

- **バックエンド**: Go（net/http, nhooyr.io/websocket, creack/pty）
- **フロントエンド**: React + TypeScript（Vite でバンドル）
- **ターミナルエミュレータ**: xterm.js
- **デプロイ**: シングルバイナリ（フロントエンドを embed.FS で埋め込み）
- **認証**: Bearer トークン（起動時に自動生成または固定指定可）

---

## 1. UI 全体構造

### 画面レイアウト

```
┌──────────────────────────────────────────────────┐
│ ☰  Branch名   [Portman] [GitHub] [⚙]  [⊟]       │  ← Header
├──────────────────────────────────────────────────┤
│ [Claude] [Files] [Git] [Bash] [Bash2] [+]        │  ← TabBar
├──────────────────────────────────────────────────┤
│                    │                             │
│  タブコンテンツ     │  タブコンテンツ             │  ← Main Area（分割時）
│                    │                             │
├──────────────────────────────────────────────────┤
│ Ctrl Alt Esc Tab ↑↓←→ [A-][A+] [あ] [🎤]        │  ← Toolbar（表示/非表示切り替え可）
└──────────────────────────────────────────────────┘
```

### PC 時のデフォルト状態

- Drawer: 左側に常時表示（ピン固定、幅調整可能）
- Toolbar: 非表示（必要に応じてトグル）
- Split Mode: 有効化可能（幅 ≥ 900px）

### モバイル時のデフォルト状態

- Drawer: 非表示（☰ で開くモーダル）
- Toolbar: 常時表示
- Split Mode: 無効（幅 < 900px 時は自動的に片パネルのみ）

---

## 2. 各 UI 要素の機能・インタラクション

### 2.1 ヘッダー（Header）

**構成要素:**
- ハンバーガーメニューボタン（☰）— Drawer を開く（モバイル）/ ピン解除時に表示
- 現在のブランチ名表示
- [Portman] ボタン — Portman が管理するポート公開情報を表示（ポートリースがある場合のみ表示）
- [GitHub] ボタン — リポジトリの GitHub Issues ページを新タブで開く（GitHub リポジトリの場合のみ表示）
- [⚙] ボタン — 設定メニュー（テーマ切り替え等）
- ツールバートグル [⊟] — Toolbar の表示/非表示
- **接続状態ドロップダウン** (▼) — ヘッダー右端。WebSocket 接続状態（connected / connecting / disconnected）を表示。タップで詳細メニューを開く

### 2.2 Drawer（リポジトリ・ブランチ管理パネル）

左側の Repository / Branch 管理パネル。PC ではデフォルトでピン固定、モバイルでは ☰ をタップして開くモーダル。

**表示内容:**
```
Repositories
├── ▼ github.com/user/palmux
│   ├── main ●                    (● = 現在アクティブ)
│   ├── feature/new-ui
│   └── fix/reconnect-bug
├── ▶ github.com/user/other-repo
└── [+ Clone Repository]
```

**機能:**
- **リポジトリ展開**: クリック / タップで ▼/▶ を切り替え、ブランチ一覧を表示/非表示
- **ブランチ選択**: クリック / タップでそのブランチのタブセットを TabBar に展開
- **ブランチピッカー**: "Open Branch..." ボタンをクリックするとフィルタ付きブランチ一覧 UI が開き、選択すると worktree + セッションを作成して接続
- **ブランチ作成**: worktree として新規ブランチを作成
- **ブランチ削除**: 右クリック / 長押し → Delete（マージ済み確認付き）
- **通知バッジ**: Claude Code 入力待ちのブランチに amber パルスドット表示
- **ピン固定**: Drawer を常時表示にピン固定（localStorage 永続化）
  - PC: `window.innerWidth > 600` で自動ピン
  - モバイル: 手動でピン設定が必要
- **幅調整**: Drawer 右端をドラッグして幅を変更（200〜600px、localStorage に保存）
- **ソート**: ブランチを最終アクティビティ順 / 名前順でソート
- **Other Sessions**: ghq リポジトリに対応しない tmux セッション（手動作成等）は「Other Sessions」折りたたみセクションにまとめて表示

### 2.3 TabBar（タブ切り替えバー）

選択中のブランチに紐づくタブを表示する水平スクロール可能なバー。

**タブ構成（ブランチごと固定）:**
1. [🧠 Claude] タブ — 削除・リネーム不可（protected）
2. [📁 Files] タブ — 削除不可
3. [⎇ Git] タブ — 削除不可
4. [$ Bash] タブ — 1 つ以上必須
5. [+] ボタン — Bash タブを追加

**操作:**
- **クリック / タップ**: タブを切り替え
- **右クリック（PC）/ 長押し（モバイル）**: コンテキストメニュー表示
- **ドラッグスクロール**: タブ数が多い場合に横スクロール（5px 以上でドラッグ判定、クリック無効）
- **通知バッジ**: Claude 停止中・入力待ち状態を表示

**タブキャッシュ:**
- タブ切り替え時にターミナル / ブラウザのインスタンスを保持する
- 一度表示したタブは WebSocket 再接続なしで即座に切り替わる
- タブキーの形式: `"terminal:0"`, `"terminal:1"`, `"files"`, `"git"`

**TabBar コンテキストメニュー:**
- Claude タブ: Restart（モデル選択ダイアログ）/ Resume（続行）
- Bash タブ: Rename / Delete（最後の 1 つは削除不可）

### 2.4 分割画面（Split Mode）

任意の 2 タブを左右に並べて表示する機能。ブランチをまたいだ組み合わせも可能。

**操作:**
- Header の分割ボタンで有効化
- **Divider ドラッグ**: 境界線をマウスでドラッグして左右幅を調整（20〜80%）
  - ドラッグ中はカーソルが `col-resize` に変化
  - 幅は localStorage に保存
- **パネル間フォーカス切り替え**: `Ctrl+Shift+←` / `Ctrl+Shift+→`
- 左右パネルそれぞれで独立したタブを表示・操作

**制約:**
- ブラウザ幅 < 900px では自動的に片パネルのみ表示

### 2.5 Toolbar（修飾キーツールバー）

ターミナル下部に表示される、物理キー不足をカバーするツールバー。4 つのモードを持つ。

**ツールバーモード:**

| モード | 切り替え | 表示内容 |
|---|---|---|
| **通常モード** | デフォルト | 修飾キー（Ctrl/Alt）+ 特殊キー（Esc/Tab）+ 矢印キー + フォント + IME |
| **ショートカットモード** | `<` ボタン | ^C, ^Z, ^D, ^L, ^R, ^A, ^E, ^W, ^U, ^K などの制御キー一覧 |
| **コマンドモード** | `>` ボタン | Makefile / package.json 等から自動検出したコマンド一覧 |
| **Claude モード** | Claude タブ表示時に自動切替 | y, n, ↑, Return, ^C, Esc のクイックアクション |

- `<` / `>` ボタンで通常 ↔ ショートカット ↔ コマンドモードを循環切り替え
- Claude タブにフォーカスが移ると自動的に Claude モードに切り替わる

**通常モードのボタン定義:**

| グループ | ボタン | 機能 |
|---|---|---|
| 修飾キー | Ctrl | Ctrl 修飾を追加（ワンショット/ロック） |
| 修飾キー | Alt | Alt 修飾を追加（ワンショット/ロック） |
| 特殊キー | Esc | \x1b（ESC）送信 |
| 特殊キー | Tab | \t（TAB）送信 |
| 矢印キー | ↑↓←→ | カーソル移動（長押しで連続送信） |
| ページング | PgUp / PgDn | ページング |
| ポップアップキー | / | 上スワイプで `\|` を送信 |
| ポップアップキー | - | 上スワイプで `_` を送信 |
| フォント | A- / A+ | フォントサイズ減 / 増 |
| IME | あ | キーボードモードを循環切り替え（none → direct → ime → none） |
| 音声入力 | 🎤 | 音声入力開始（Web Speech API 対応ブラウザのみ表示） |

**修飾キーのインタラクション（Ctrl / Alt）:**
- **シングルタップ / クリック**: ワンショット — 次の 1 キー入力に修飾を付与して自動解除
- **長押し（400ms）**: ロック — 以降の全キー入力に修飾を付与し続ける
- **ロック状態での再タップ / クリック**: ロック解除

**矢印キー・Backspace:**
- 長押しで連続送信（初期遅延 400ms → 80ms 間隔）

**ショートカットモードのボタン:**
- ^C, ^Z, ^D, ^O, ^L, ^R, ^A, ^E, ^W, ^U, ^K を横スクロール可能なボタン列で表示
- タップ / クリックで対応する制御文字をターミナルに送信

**Claude モードのボタン:**
```
上段（クイックアクション行）: [y] [n] [↑] [⏎] [^C] [Esc]
下段（スラッシュコマンド行）: [/compact] [/clear] [/help] [/cost] [/status]（横スクロール）
```
- Claude タブにフォーカスすると自動切り替え
- 上段は承認・否認・カーソル・確定・中断・エスケープのクイック操作
- 下段は Claude Code のスラッシュコマンドを 1 タップで送信

**コマンド自動検出（コマンドモード）:**
- 以下のファイルが存在する場合、コマンド一覧をツールバーに表示（30 秒キャッシュ）:
  - `Makefile` → make ターゲット
  - `package.json` → scripts
  - `Cargo.toml` → cargo コマンド
  - `pyproject.toml` → scripts / tasks
  - `go.mod` → go コマンド
- Makefile がない場合は Cargo.toml / pyproject.toml / go.mod から固定コマンドセットを生成
- タップ / クリックでターミナルにコマンドを送信

**表示切り替え:**
- ヘッダーの [⊟] トグルボタンで表示/非表示（localStorage に保存）
- PC デフォルト: 非表示 / モバイル デフォルト: 表示

### 2.6 IME Input（日本語入力フィールド）

ツールバーの [あ] / [A] ボタンでモード切り替え。

**キーボードモード（3 状態）:**

| モード | 状態 | IME バー |
|---|---|---|
| **none** | キーボード非表示（初期状態） | 非表示 |
| **direct** | xterm.js に直接キー入力（英数字・修飾キー対応） | 非表示 |
| **ime** | テキストフィールドで変換入力可能 | 表示 |

- [あ] ボタンを押すたびに **none → direct → ime → none** の順で循環切り替え

**表示・非表示のタイミング:**
- Toolbar が表示されている場合のみ IME バーが存在する
- キーボードモードが `ime` のときのみ IME バーのテキストフィールドが表示される
- Toolbar を非表示にすると IME バーも同時に非表示になり、`none` モードに戻る

**Direct モードでのキー入力フロー:**

```
物理キー / ソフトキーボード入力
        ↓
xterm.js の onData ハンドラ
        ↓
Toolbar の修飾キー（Ctrl/Alt）が有効か確認
  ├─ 有効 → consumeModifiers() で修飾を取得し制御文字に変換
  │          例: Ctrl+C → \x03、Alt+X → \x1b X
  └─ 無効 → そのまま通過
        ↓
WebSocket で { "type": "input", "data": "..." } を送信
```

- `inputmode="none"` を設定しているため、モバイルでは IME キーボードが起動せず直接文字コードが送られる
- PC では通常のキーイベントとして xterm.js が受け取る

**IME モード時の動作:**

| 操作 | 結果 |
|---|---|
| Enter | 確定テキスト + \r を送信し、フィールドクリア |
| Shift+Enter | 確定テキストのみ送信（改行なし） |
| Backspace（フィールドが空） | ターミナルに \x7f 送信 |

- 送信後もフィールドにフォーカスを維持
- Ctrl / Alt ロック中の場合、入力文字に修飾を適用して送信

### 2.7 音声入力

Toolbar の [🎤] ボタンから起動。Web Speech API を使用。

- ボタンタップで音声認識開始、もう一度タップで停止
- 認識中間結果を IME 入力フィールドに逐次表示
- 認識確定テキストをターミナルに送信
- Web Speech API 非対応ブラウザではボタン自体を非表示

### 2.8 ファイルブラウザ（Files タブ）

ブランチの worktree ディレクトリをルートとして閲覧。ghq リポジトリが検出された場合はそのルートを優先する。

**機能:**
- **ディレクトリ閲覧**: ファイル一覧（名前・サイズ・更新日時、ディレクトリ優先ソート）
- **パンくずリスト**: クリック / タップで上位ディレクトリに移動
- **ファイル名検索 / 全文検索の切り替え**:
  - ファイル名検索（デフォルト）: ファイル名パターンで絞り込み
  - 全文検索（grep）: ファイル内容を検索
  - 切り替えボタンで随時モード変更
  - 検索オプション: glob フィルタ（対象ファイル絞り込み）/ `Aa`（大文字小文字区別）/ `.*`（正規表現）トグル
  - 全文検索結果はファイルパスごとにグルーピング、マッチ箇所をハイライト表示
- **行ジャンプ**: 全文検索結果の行をタップすると、対象ファイルを開いて該当行にスクロールしてハイライト表示
- **マッチハイライト**: 全文検索結果から開いたファイルの該当行を黄色でハイライト（3 秒後にフェードアウト）

**プレビュー対応形式:**

| ファイルタイプ | プレビュー方式 |
|---|---|
| Markdown | GFM 対応（テーブル・チェックボックス・コードハイライト） |
| コード | シンタックスハイライト（Go, JS/TS, Python, Bash, YAML, JSON, HTML, CSS, SQL 等） |
| 画像 | インライン表示（PNG, JPG, GIF, SVG, WebP） |
| drawio | diagrams.net embed API でグラフィカルに表示・編集（`.drawio` / `.dio`） |
| テキスト | プレーンテキスト表示 |

- **読み取り専用**: ファイル閲覧のみ（drawio は編集可）

### 2.9 Git ブラウザ（Git タブ）

ブランチの worktree のリポジトリ情報を表示。

**機能:**
- **Git Status**: 変更ファイルの一覧（Staged / Unstaged）
- **Git Log**: コミット履歴表示
- **構造化 Diff 表示**: diff をファイル単位・hunk 単位にパースして表示
  - hunk ヘッダー横にアクションボタンを表示
  - hunk 単位で Stage / Unstage / Discard が可能
- **Git Branches**: ローカル・リモートブランチ一覧
- **Stage / Unstage**: ファイル単位 / hunk 単位でのステージング操作
- **Discard**: ファイル単位 / hunk 単位で変更を破棄（確認ダイアログ付き）

### 2.10 Claude タブ

`claude` コマンドを実行した tmux ウィンドウ。ブランチごとに 1 つ固定で存在。

**特性:**
- **削除・リネーム不可**（protected タブ）
- **自動作成**: ブランチのタブセット作成時に自動的に `claude` コマンドを起動
- **Restart**: モデル選択ダイアログ付きで `claude` を再起動
- **Resume**: `claude --resume` で前回の会話を継続
- Claude タブにフォーカスすると Toolbar が自動的に Claude モードに切り替わる

### 2.11 コンテキストメニュー

**PC:** 右クリックでメニューを表示（カーソル位置に表示、ビューポート外は自動調整）
**モバイル:** 長押しでメニューを表示（画面中央に表示）

**メニュー項目（対象によって変化）:**
- Bash タブ: Rename / Delete
- Claude タブ: Restart（モデル選択）/ Resume
- ブランチ: Delete

### 2.12 通知（Claude Code 連携）

**表示:**
- Drawer のブランチ行と TabBar の Claude タブに amber パルスドットを表示
- ブラウザ通知（Notification API）でポップアップ通知
- モバイルではバイブレーションも発火

**仕組み:**
1. Palmux 起動時に `~/.config/palmux/env.<port>` が生成（ポート・トークン・ベースパス）
2. Claude Code の Hook が `Stop` / `UserPromptSubmit` 時に Palmux 通知 API を呼び出す
3. WebSocket 経由でリアルタイムに Drawer / TabBar へ反映

### 2.13 Portman 連携

セッションのプロジェクトに portman のポートリース（公開ポート）がある場合、ヘッダーに [Portman] ボタンを表示。

- クリックで公開ポート一覧とアクセス URL を表示
- ポートリースがない場合はボタン自体を非表示

### 2.14 GitHub 連携

セッションのプロジェクトが GitHub リポジトリの場合、ヘッダーに [GitHub] ボタンを表示。

- クリックで GitHub Issues ページを新タブで開く
- GitHub リポジトリでない場合はボタン自体を非表示

---

## 3. キーボード・マウス操作（PC）

### 3.1 キーボードショートカット

| ショートカット | 動作 |
|---|---|
| `Ctrl+Shift+←` | 左パネルにフォーカス（分割モード） |
| `Ctrl+Shift+→` | 右パネルにフォーカス（分割モード） |
| `Ctrl+V` / `Cmd+V` | ペースト（xterm.js の `^V` 送信を抑止してネイティブペーストへ委譲） |

### 3.2 マウス操作

| 操作 | 動作 |
|---|---|
| Divider ドラッグ | 分割パネルの幅を調整 |
| Drawer 右端ドラッグ | Drawer の幅を調整（200〜600px） |
| タブ横ドラッグ | TabBar をスクロール（5px 以上でドラッグ判定、クリック無効） |
| 右クリック | コンテキストメニュー表示 |
| マウスホイール | tmux マウスモード経由でスクロール |

### 3.3 クリップボード

- **コピー**: xterm.js でテキスト選択 → 自動コピー
- **ペースト**: Ctrl+V / Cmd+V（HTTPS または localhost で有効）
- **OSC 52**: tmux コピーモード → ブラウザクリップボードに同期
- **画像ペースト**: ペースト時に画像を検出して API 経由でアップロード

---

## 4. ターミナル（xterm.js）機能

### 4.1 基本設定

| 項目 | 値 |
|---|---|
| フォント | Cascadia Code, Fira Code, Source Code Pro（フォールバック: monospace） |
| フォントサイズ | 8px〜24px（デフォルト: 14px、localStorage に保存） |
| テーマ | ライト/ダークモード自動切り替え |
| Unicode | Unicode 11 テーブルで CJK 文字幅を正確に計算 |

### 4.2 自動リサイズ

- `ResizeObserver` でコンテナサイズを監視
- コンテナサイズ変更時に `FitAddon.fit()` を呼んでターミナルを再レイアウト
- cols/rows 変更をサーバーに送信（`type: "resize"` メッセージ）
- 非表示パネル（Files/Git 表示中等）では fit() を無視

### 4.3 自動再接続

- 指数バックオフ（初回 1s → 最大 30s）
- 接続喪失時に自動再接続を試行
- **再接続オーバーレイ**: 切断中はターミナル上に "Reconnecting..." を表示する半透明の覆いを表示し、再接続が完了すると自動的に消える
- 接続状態はヘッダーの接続状態ドロップダウン（▼）にも反映

### 4.4 複数デバイス同時接続

- 同一ブランチのタブセットに複数クライアントから同時接続可能
- tmux セッショングループを使用し、各クライアントが独立したウィンドウ選択を維持
- 接続ごとにグループセッションを作成し、切断時に破棄

### 4.5 WebSocket メッセージフォーマット

**Client → Server:**
```json
{ "type": "input", "data": "ls\r" }
{ "type": "resize", "cols": 80, "rows": 24 }
```

**Server → Client:**
```json
{ "type": "output", "data": "..." }
{ "type": "client-status", "session": "main", "window": 0 }
```

---

## 5. テーマ・設定

### 5.1 テーマ切り替え

ヘッダーの [⚙] メニューで Light / Dark 切り替え（localStorage に自動保存）。

**Dark モード:**
- Background: `#1a1a2e`
- Foreground: `#e0e0e0`
- Cursor: `#e0e0e0`

**Light モード:**
- Background: `#faf9f6`
- Foreground: `#333333`
- Cursor: `#0e7c86`

### 5.2 localStorage に保存される設定

| 設定項目 | PC デフォルト | モバイル デフォルト |
|---|---|---|
| テーマ | dark | dark |
| フォントサイズ | 14px | 14px |
| Toolbar 表示 | 非表示 | 表示 |
| Toolbar モード | 通常 | 通常 |
| Drawer ピン固定 | ON（幅 > 600px） | OFF |
| Drawer 幅 | 250px | - |
| Split Mode | OFF | OFF |
| 分割時 Divider 位置 | 50% | - |
| ブランチソート順 | name | name |
| 最後のアクティブタブ | （ブランチごと） | （ブランチごと） |

---

## 6. モバイル向けの特殊機能

### 6.1 タッチジェスチャー

| ジェスチャー | 動作 |
|---|---|
| 上スワイプ | スクロールアップ（tmux mouse wheel up） |
| 下スワイプ | スクロールダウン（tmux mouse wheel down） |
| 左スワイプ | 次のタブへ切り替え |
| 右スワイプ | 前のタブへ切り替え |
| ピンチズーム | フォントサイズ変更 |
| 長押し後ドラッグ | テキスト範囲選択 |

### 6.2 ソフトキーボード対応

- IME モード時は通常の HTML `<input>` を使用
- Direct モードでは `inputmode="none"` で IME キーボードを抑制
- ソフトキーボード表示時のビューポートリサイズに対応

### 6.3 PWA（Progressive Web App）

- ホーム画面に追加可能
- スタンドアロンアプリとして動作（フルスクリーン、ブラウザ UI 非表示）
- manifest.json でアプリ名・アイコン・テーマ色を指定

---

## 7. バックエンド API

### 7.1 セッション / ウィンドウ API

```
GET    /api/sessions
POST   /api/sessions                          { "name": "session-name" }
DELETE /api/sessions/{name}

GET    /api/sessions/{session}/windows
POST   /api/sessions/{session}/windows        { "name": "window-name", "command": "cmd" }
PATCH  /api/sessions/{session}/windows/{idx}  { "name": "new-name" }
DELETE /api/sessions/{session}/windows/{idx}

WS     /api/sessions/{session}/windows/{idx}/attach
```

### 7.2 ファイル API

```
GET    /api/sessions/{session}/cwd
GET    /api/sessions/{session}/files?path=.
GET    /api/sessions/{session}/files?path=README.md
GET    /api/sessions/{session}/files?path=image.png&raw=true
GET    /api/sessions/{session}/files/search?query=pattern&path=.
GET    /api/sessions/{session}/files/grep?pattern=function&path=src
```

### 7.3 Git API

```
GET    /api/sessions/{session}/git/status
GET    /api/sessions/{session}/git/log
GET    /api/sessions/{session}/git/diff
GET    /api/sessions/{session}/git/branches
POST   /api/sessions/{session}/git/stage        { "path": "file.go" }
POST   /api/sessions/{session}/git/unstage      { "path": "file.go" }
POST   /api/sessions/{session}/git/stage-hunk
POST   /api/sessions/{session}/git/unstage-hunk
POST   /api/sessions/{session}/git/discard      { "path": "file.go" }
POST   /api/sessions/{session}/git/discard-hunk
```

### 7.4 GHQ / プロジェクト API

```
GET    /api/ghq/repos
POST   /api/ghq/repos
DELETE /api/ghq/repos

GET    /api/projects/{project}/worktrees
POST   /api/projects/{project}/worktrees
DELETE /api/projects/{project}/worktrees/{branch}

GET    /api/projects/{project}/branches
GET    /api/projects/{project}/branch-merged/{branch}
DELETE /api/projects/{project}/branches/{branch}
```

### 7.5 通知 API（Claude Code 連携）

```
GET    /api/notifications
POST   /api/notifications   { "session": "main", "window": 0, "type": "stop" }
DELETE /api/notifications
```

### 7.6 その他

```
GET    /api/connections
GET    /api/sessions/{session}/mode
POST   /api/sessions/{session}/claude/restart
GET    /api/sessions/{session}/portman-urls
GET    /api/sessions/{session}/github-url
POST   /api/upload
```

### 7.7 認証

```
Authorization: Bearer <token>

# WebSocket ではクエリパラメータも対応
WS /api/sessions/{session}/windows/{idx}/attach?token=<token>
```

- 起動時にランダムトークンを自動生成（256bit hex）
- `--token` フラグで固定指定可能

### 7.8 ベースパス対応

`--base-path /palmux/` で指定されたベースパス下で全エンドポイントが動作。

---

## 8. コマンドラインオプション

```bash
./palmux [flags]
```

| フラグ | デフォルト | 説明 |
|---|---|---|
| `--port` | 8080 | 待ち受けポート |
| `--host` | 0.0.0.0 | 待ち受けアドレス |
| `--tmux` | tmux | tmux バイナリのパス |
| `--token` | （自動生成） | 認証トークン |
| `--base-path` | / | ベースパス（リバースプロキシ配下） |
| `--tls-cert` | （なし） | TLS 証明書ファイル |
| `--tls-key` | （なし） | TLS 秘密鍵ファイル |
| `--max-connections` | 5 | セッションあたりの最大同時接続数 |

---

## 9. デプロイ

### 9.1 ビルド

```bash
make build        # フロントエンドビルド + Go バイナリ生成
make build-linux  # Linux amd64
make build-arm    # Linux arm64
```

### 9.2 リバースプロキシ（Caddy）

```
example.com {
    route /palmux/* {
        reverse_proxy localhost:8080
    }
}
```

```bash
./palmux --port 8080 --base-path /palmux/
```

### 9.3 Claude Code 連携

Palmux 起動時に `~/.config/palmux/env.<port>` を自動生成:

```bash
export PALMUX_PORT=8080
export PALMUX_TOKEN=a1b2c3d4...
export PALMUX_BASE_PATH=/palmux/
```

Claude Code の Hook スクリプトがこれを source して通知 API を呼び出す。

---

## 10. セキュリティ

- **認証**: Bearer トークン（HTTP Authorization ヘッダー）
- **TLS**: `--tls-cert` / `--tls-key` で HTTPS 対応
- **ファイルアクセス**: パストラバーサル防止（`../` ブロック）、シンボリックリンク検証
- **接続制限**: `--max-connections` で接続数を制限

**推奨運用:**
- ローカルネットワークのみ: `--host 127.0.0.1`
- インターネット公開: TLS + リバースプロキシ必須

---

## 11. 推奨 tmux 設定

```bash
# マウスサポート（スクロール、選択コピー）
set -g mouse on

# クリップボード同期（OSC 52 経由）
set -g set-clipboard on
set -as terminal-features 'xterm-256color:clipboard'

# Palmux 内部セッション（_palmux_*）を選択メニューから除外
bind-key s choose-tree -Zs -f '#{?#{m:_palmux_*,#{session_name}},0,1}'
```
