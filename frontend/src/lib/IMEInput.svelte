<script>
  /**
   * IMEInput - IME 入力フィールドコンポーネント (Svelte 5)
   * Direct/IME モード切り替えで日本語等の変換入力をサポートする。
   *
   * - Enter（テキストあり）: 確定テキストのみ送信し、フィールドクリア
   * - Enter（テキストなし）: '\r'（Enter キー）をターミナルに送信
   * - Shift+Enter: 確定テキスト + '\r' を一括送信し、フィールドクリア
   * - 送信後もフォーカスを維持（連続入力可能）
   * - e.isComposing チェックで未確定の IME 入力中は送信しない
   */

  /** @type {{ onSend: (text: string) => void, onToggle?: (visible: boolean) => void, toolbar?: { hasCtrl: () => boolean, hasAlt: () => boolean, consumeModifiers: () => { ctrl: boolean, alt: boolean } } | null }} */
  let { onSend, onToggle = null, toolbar = null } = $props();

  let visible = $state(false);
  let inputValue = $state('');
  let previewText = $state('');
  let inputEl = $state(null);
  let barEl = $state(null);
  let toolbarRef = $state(null);

  // Keep toolbarRef in sync with prop changes
  $effect(() => {
    toolbarRef = toolbar;
  });

  /**
   * 修飾キー状態を入力データに適用する。
   * Ctrl: 単一文字の場合、制御文字に変換する（例: 'c' -> \x03）
   * Alt: ESC プレフィクスを付与する（例: 'x' -> \x1bx）
   * @param {string} data - 元の入力データ
   * @param {{ ctrl: boolean, alt: boolean }} mods - 修飾キー状態
   * @returns {string} 修飾適用後のデータ
   */
  function applyModifiers(data, mods) {
    let result = data;
    if (mods.ctrl && result.length === 1) {
      const code = result.toUpperCase().charCodeAt(0);
      if (code >= 64 && code <= 95) {
        result = String.fromCharCode(code - 64);
      }
    }
    if (mods.alt) {
      result = '\x1b' + result;
    }
    return result;
  }

  /**
   * 入力テキストを送信する。
   * @param {boolean} withEnter - テキストと一緒に '\r' も送信するか
   */
  function send(withEnter) {
    const text = inputValue;
    if (text) {
      onSend(withEnter ? text + '\r' : text);
      inputValue = '';
    } else {
      // テキストが空の場合は Enter を送信
      onSend('\r');
    }
    inputEl?.focus();
  }

  /**
   * キーダウンイベントハンドラー
   * @param {KeyboardEvent} e
   */
  function handleKeydown(e) {
    if (e.isComposing) {
      return; // IME 変換中は何もしない
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        send(true); // テキスト + Enter を一括送信
      } else {
        send(false); // テキストのみ、または空なら Enter
      }
    } else if (e.key === 'Backspace' && !inputValue) {
      // フィールドが空の場合、ターミナルに Backspace を送信
      e.preventDefault();
      onSend('\x7f');
    }
  }

  /**
   * input イベントハンドラー（修飾キー即時送信用）
   * @param {InputEvent} e
   */
  function handleInput(e) {
    // Sync the input value from the DOM element since we need real-time value
    inputValue = inputEl?.value ?? '';

    if (!toolbarRef) return;
    if (!toolbarRef.hasCtrl() && !toolbarRef.hasAlt()) return;

    const char = e.data;
    if (!char) return;

    const mods = toolbarRef.consumeModifiers();
    const modified = applyModifiers(char, mods);
    onSend(modified);

    // フィールドをクリアして composing をキャンセル
    inputValue = '';
  }

  /**
   * 送信ボタンクリックハンドラー
   */
  function handleSendClick() {
    send(false);
  }

  // --- Exported methods ---

  /**
   * IME 入力フィールドを表示する。
   */
  export function show() {
    if (!visible) {
      visible = true;
      // Need to wait for DOM update before focusing
      queueMicrotask(() => inputEl?.focus());
      onToggle?.(true);
    }
  }

  /**
   * IME 入力フィールドを非表示にする。
   */
  export function hide() {
    if (visible) {
      visible = false;
      onToggle?.(false);
    }
  }

  /**
   * IME 入力フィールドの表示/非表示をトグルする。
   */
  export function toggle() {
    if (visible) {
      hide();
    } else {
      show();
    }
  }

  /**
   * テキストを入力フィールドに追加する（音声入力結果の挿入用）。
   * @param {string} text
   */
  export function insertText(text) {
    inputValue += text;
    inputEl?.focus();
  }

  /**
   * 中間結果テキストをプレビュー表示する。空文字で非表示。
   * @param {string} text
   */
  export function setPreviewText(text) {
    previewText = text;
  }

  /**
   * ツールバーを設定する。
   * @param {object|null} tb
   */
  export function setToolbar(tb) {
    toolbarRef = tb;
  }

  /**
   * IME バー要素を返す（マイクボタン挿入用）。
   * @returns {HTMLElement}
   */
  export function getBarElement() {
    return barEl;
  }

  /**
   * IME 入力フィールドが現在表示されているか。
   * @returns {boolean}
   */
  export function getIsVisible() {
    return visible;
  }

  /**
   * リソースを解放する。
   */
  export function destroy() {
    // Svelte handles DOM cleanup on unmount; this is a no-op stub
    // for API compatibility. The adapter calls unmount() separately.
  }
</script>

<div
  class="voice-interim-text"
  style:display={previewText ? '' : 'none'}
>{previewText}</div>

<div
  class="ime-input-bar"
  style:display={visible ? 'flex' : 'none'}
  bind:this={barEl}
>
  <input
    type="text"
    class="ime-input-field"
    placeholder="日本語入力..."
    bind:this={inputEl}
    bind:value={inputValue}
    onkeydown={handleKeydown}
    oninput={handleInput}
  />
  <button
    class="ime-send-btn"
    onclick={handleSendClick}
  >送信</button>
</div>
