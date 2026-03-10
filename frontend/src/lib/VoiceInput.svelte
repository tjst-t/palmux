<script>
  /**
   * VoiceInput - Web Speech API を使った音声入力コンポーネント (Svelte 5)
   * 認識結果を IME 入力フィールドに挿入し、既存の IME -> WebSocket パイプラインで送信する。
   *
   * - Web Speech API 非対応ブラウザではボタンを表示しない（graceful degradation）
   * - 認識結果は onResult コールバックで返し、IMEInput 側で入力フィールドに挿入する
   * - 中間結果は onInterim コールバックで返す
   */

  /** @type {{ onResult: (text: string) => void, onInterim?: ((text: string) => void) | null, onError?: ((error: string) => void) | null, lang?: string }} */
  let { onResult, onInterim = null, onError = null, lang = 'ja-JP' } = $props();

  /** @type {'idle' | 'listening'} */
  let state = $state('idle');
  let hasError = $state(false);
  let showError = $state(false);

  /** @type {SpeechRecognition | null} */
  let recognition = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let errorTimer = $state(null);
  /** @type {HTMLButtonElement | null} */
  let btnEl = $state(null);

  /**
   * Web Speech API が利用可能かどうかを返す。
   * @returns {boolean}
   */
  export function isSupported() {
    return !!(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition);
  }

  // SpeechRecognition インスタンスを初期化
  function initRecognition() {
    const SpeechRecognitionCtor = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return null;

    const rec = new SpeechRecognitionCtor();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = lang;

    rec.onresult = (event) => {
      const result = event.results[event.resultIndex];
      const transcript = result[0].transcript;

      if (result.isFinal) {
        onResult(transcript);
      } else if (onInterim) {
        onInterim(transcript);
      }
    };

    rec.onerror = (event) => {
      // no-speech はエラーとして扱わない（タイムアウトで自然終了）
      if (event.error === 'no-speech') return;

      hasError = true;
      setErrorState();
      if (onError) {
        onError(event.error);
      }
    };

    rec.onend = () => {
      // エラー発生時は --error 表示を維持し、タイマーに任せる
      if (hasError) {
        hasError = false;
        state = 'idle';
      } else {
        state = 'idle';
        showError = false;
      }
    };

    return rec;
  }

  import { onMount, onDestroy } from 'svelte';

  // Initialize recognition on mount (run exactly once)
  onMount(() => {
    recognition = initRecognition();
  });

  onDestroy(() => {
    if (recognition && state === 'listening') {
      recognition.abort();
    }
    if (errorTimer) {
      clearTimeout(errorTimer);
    }
  });

  // Sync lang changes to the recognition instance
  $effect(() => {
    if (recognition) {
      recognition.lang = lang;
    }
  });

  /**
   * エラー状態を表示する。
   */
  function setErrorState() {
    showError = true;
    if (errorTimer) clearTimeout(errorTimer);
    errorTimer = setTimeout(() => {
      showError = false;
    }, 1500);
  }

  /**
   * 音声認識を開始する。
   */
  export function start() {
    if (state === 'listening') return;
    state = 'listening';
    recognition?.start();
  }

  /**
   * 音声認識を停止する。
   */
  export function stop() {
    if (state !== 'listening') return;
    state = 'idle';
    showError = false;
    recognition?.stop();
  }

  /**
   * 音声認識の開始/停止をトグルする。
   */
  export function toggle() {
    if (state === 'listening') {
      stop();
    } else {
      start();
    }
  }

  /**
   * 現在の状態を返す。
   * @returns {'idle' | 'listening'}
   */
  export function getState() {
    return state;
  }

  /**
   * 認識言語を変更する。
   * @param {string} newLang - BCP 47 言語タグ（例: 'ja-JP', 'en-US'）
   */
  export function setLang(newLang) {
    if (recognition) {
      recognition.lang = newLang;
    }
  }

  /**
   * ボタン要素を返す。
   * @returns {HTMLButtonElement | null}
   */
  export function getButtonElement() {
    return btnEl;
  }

  /**
   * リソースを解放する。
   */
  export function dispose() {
    if (state === 'listening' && recognition) {
      recognition.abort();
    }
    state = 'idle';
    if (errorTimer) {
      clearTimeout(errorTimer);
      errorTimer = null;
    }
  }
</script>

<button
  class="voice-mic-btn"
  class:voice-mic-btn--listening={state === 'listening'}
  class:voice-mic-btn--error={showError}
  type="button"
  style:min-width="44px"
  style:min-height="44px"
  aria-label="音声入力"
  bind:this={btnEl}
  onclick={() => toggle()}
>
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="9" y="1" width="6" height="12" rx="3"></rect>
    <path d="M5 10a7 7 0 0 0 14 0"></path>
    <line x1="12" y1="17" x2="12" y2="21"></line>
    <line x1="8" y1="21" x2="16" y2="21"></line>
  </svg>
</button>

<style>
  /* Voice Input */
  .voice-mic-btn {
    flex-shrink: 0;
    min-width: 44px;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid #2a2a4a;
    border-radius: 6px;
    color: #e0e0e0;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .voice-mic-btn:hover {
    background: rgba(126, 200, 227, 0.1);
    border-color: #7ec8e3;
  }

  .voice-mic-btn--listening {
    background: rgba(244, 67, 54, 0.2);
    border-color: #f44336;
    color: #f44336;
    animation: voice-pulse 1.5s ease-in-out infinite;
  }

  .voice-mic-btn--error {
    background: rgba(255, 152, 0, 0.2);
    border-color: #ff9800;
    color: #ff9800;
  }

  @keyframes voice-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
</style>
