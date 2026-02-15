# Phase 2: Mobile UX タスク一覧

Phase 1 (MVP) が完了していることが前提。
モバイルでの操作体験を本格的に作り込むフェーズ。

---

## Task 1: 修飾キーツールバー

**対象ファイル:**
- `frontend/js/toolbar.js` (新規)
- `frontend/css/style.css` (追記)
- `frontend/js/app.js` (toolbar 統合)
- `frontend/js/terminal.js` (修飾キー合成ロジック追加)

**参照:** DESIGN.md「Mobile Key Toolbar」セクション

**内容:**
- ツールバーコンポーネント: `[Esc][Tab][Ctrl][Alt][↑][↓][←][→][PgUp][PgDn][あ]`
- ワンショットモード: ボタンをタップすると次の1キー入力に修飾が付き、入力後に自動解除
- ロックモード: ダブルタップで連続入力モード（再タップで解除）
- ボタンの視覚的状態: 非アクティブ / ワンショット(ハイライト) / ロック(強調ハイライト) の3状態
- 矢印キー・Esc・Tab・PgUp・PgDn はタップで即座に対応するエスケープシーケンスを送信
- Ctrl/Alt はトグル式で、`terminal.js` の `Terminal.onData()` で入力を受け取る際に合成
- ツールバーの表示/非表示をトグルできるボタン（画面領域を確保するため）

**合成ロジック (terminal.js):**
```
Ctrl + 'c' → '\x03'
Alt + 'x' → '\x1bx'
```

**テスト:**
- ワンショット: Ctrl タップ → 'c' 入力 → '\x03' が送信され、Ctrl が解除される
- ロック: Ctrl ダブルタップ → 'c' 入力 → '\x03' が送信され、Ctrl はロックのまま
- 矢印キー: ↑ タップ → '\x1b[A' が送信される
- ツールバー表示/非表示トグル

**完了条件:**
- モバイルブラウザでツールバーが表示され、各キーが正しいシーケンスを送信する
- ワンショット/ロックの状態遷移が正しく動作する

---

## Task 2: IME 入力フィールド

**対象ファイル:**
- `frontend/js/ime-input.js` (新規)
- `frontend/css/style.css` (追記)
- `frontend/js/app.js` (IME 入力統合)
- `frontend/js/toolbar.js` ([あ] ボタンのハンドラ追加)

**参照:** DESIGN.md「Mobile Input Strategy」セクション

**内容:**
- IME 入力フィールド: ターミナル下部に配置される `<input type="text">`
- 通常は非表示。ツールバーの [あ] ボタンでトグル
- Direct モード: xterm.js に直接入力（`inputmode="none"` で IME 抑制）
- IME モード: テキストフィールドで日本語変換を完了し、確定テキストを送信
- Enter で確定テキスト + `\n` を WebSocket に送信、フィールドクリア
- Shift+Enter で確定テキストのみ送信（`\n` なし）、フィールドクリア
- 送信後もフォーカスを維持（連続入力可能）
- IME モード時はターミナルへの直接キー入力を無効化

**テスト:**
- [あ] ボタンタップでフィールド表示/非表示
- テキスト入力 → Enter → WebSocket に `{"type": "input", "data": "テスト\n"}` 送信
- テキスト入力 → Shift+Enter → WebSocket に `{"type": "input", "data": "テスト"}` 送信
- 送信後にフィールドがクリアされフォーカスが維持される
- IME モード中にターミナルへの直接入力が無効化される

**完了条件:**
- Android Chrome + GBoard で日本語入力が文字化けなく行える
- Direct/IME モード切り替えがスムーズに動作する

---

## Task 3: セッション/ウィンドウ Drawer UI

**対象ファイル:**
- `frontend/js/drawer.js` (新規)
- `frontend/css/style.css` (追記)
- `frontend/js/app.js` (drawer 統合)
- `frontend/index.html` (drawer 用 HTML 追加)

**参照:** DESIGN.md「Session/Window Drawer」セクション

**内容:**
- ハンバーガーメニュー (☰) をヘッダー左に配置
- タップで左からスライドインする drawer パネル
- セッション一覧: 折りたたみ式。セッション名をタップで展開し、配下のウィンドウ一覧を表示
- ウィンドウ一覧: `{index}: {name}` 形式。アクティブウィンドウに ● マーク
- ウィンドウをタップで `tmux select-window` を実行し、ターミナル表示を切り替え
- セッションをタップで別セッションに切り替え（WebSocket 再接続）
- ヘッダーに現在の `session:window` を表示
- drawer 外タップまたはスワイプで閉じる
- セッション/ウィンドウ一覧は drawer を開くたびに API から再取得

**API 呼び出し:**
- `GET {basePath}api/sessions` でセッション一覧取得
- `GET {basePath}api/sessions/{name}/windows` で各セッションのウィンドウ一覧取得

**テスト:**
- ☰ タップで drawer が開く
- セッション展開でウィンドウ一覧が表示される
- ウィンドウタップで切り替えが行われ drawer が閉じる
- drawer 外タップで閉じる

**完了条件:**
- セッション/ウィンドウの切り替えが drawer から行える
- アクティブウィンドウが視覚的に識別できる

---

## Task 4: タッチ操作最適化

**対象ファイル:**
- `frontend/js/touch.js` (新規)
- `frontend/js/app.js` (タッチイベント統合)
- `frontend/css/style.css` (タッチフィードバックのスタイル)

**内容:**
- 左右スワイプでウィンドウ切り替え (前/次のウィンドウ)
  - スワイプ検出: `touchstart` → `touchmove` → `touchend` で水平移動量を計算
  - 閾値: 50px 以上の水平移動でウィンドウ切り替え
  - 切り替え時に `tmux select-window -t :{index+1}` or `:{index-1}` を実行
- ピンチズームでフォントサイズ変更（Task 5 と連携）
- ダブルタップ防止: ターミナル領域のデフォルトのダブルタップズームを無効化
- ボタン・リンクのタッチターゲットサイズ: 最小 44x44px（iOS HIG 準拠）
- タップ時の視覚フィードバック（`:active` スタイル）

**テスト:**
- 右スワイプで前のウィンドウに切り替わる
- 左スワイプで次のウィンドウに切り替わる
- 閾値未満のスワイプでは切り替わらない
- 縦スクロールとの競合がない（主に垂直方向の移動は無視）

**完了条件:**
- スワイプでウィンドウ切り替えがスムーズに動作する
- 既存のターミナル操作（スクロール等）と干渉しない

---

## Task 5: フォントサイズ調整

**対象ファイル:**
- `frontend/js/terminal.js` (フォントサイズ変更メソッド追加)
- `frontend/js/toolbar.js` (フォントサイズ調整ボタン追加、またはメニュー)
- `frontend/css/style.css` (追記)

**内容:**
- ツールバーまたはヘッダーにフォントサイズ調整 UI（[A-][A+] ボタン）
- xterm.js の `Terminal.options.fontSize` を動的に変更
- 変更後に `FitAddon.fit()` を呼んで再レイアウト
- resize メッセージを WebSocket で送信（cols/rows が変わるため）
- フォントサイズを `localStorage` に保存し、次回接続時に復元
- デフォルトフォントサイズ: 14px（モバイル向け）
- 調整範囲: 8px〜24px、2px 刻み

**テスト:**
- [A+] タップでフォントサイズが増加する
- [A-] タップでフォントサイズが減少する
- 最小/最大でそれ以上変化しない
- フォントサイズ変更後に resize メッセージが送信される
- localStorage に保存され、リロード後も維持される

**完了条件:**
- フォントサイズ調整がスムーズに動作する
- resize 後のターミナルレイアウトが崩れない

---

## Task 6: PWA 対応

**対象ファイル:**
- `frontend/manifest.json` (新規)
- `frontend/sw.js` (新規: Service Worker)
- `frontend/index.html` (manifest リンク、SW 登録追加)
- `frontend/icons/` (新規: アプリアイコン)
- `Makefile` (manifest, sw.js, icons のコピーを追加)

**内容:**
- `manifest.json`: アプリ名 "Palmux"、`display: "standalone"`、テーマカラー、アイコン
- Service Worker: オフラインキャッシュ戦略
  - 静的アセット（HTML, CSS, JS）を Cache API でキャッシュ
  - API リクエストはネットワークファースト（キャッシュしない）
  - WebSocket はキャッシュ対象外
- アイコン: 192x192, 512x512 の PNG（シンプルなロゴ）
- `<meta name="apple-mobile-web-app-capable" content="yes">` 等の iOS 対応メタタグ
- `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">` でモバイル最適化

**テスト:**
- Chrome DevTools の Lighthouse で PWA チェックが主要項目パス
- 「ホーム画面に追加」でスタンドアロンアプリとして起動できる
- オフライン時に静的アセットがキャッシュから読み込まれる

**完了条件:**
- モバイル Chrome/Safari で「ホーム画面に追加」が可能
- スタンドアロンモードでアドレスバーが非表示になる
