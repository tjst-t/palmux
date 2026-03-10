// @vitest-environment happy-dom
import { mount, unmount, flushSync } from 'svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import VoiceInput from '../VoiceInput.svelte';

// --- Mock SpeechRecognition ---

class MockSpeechRecognition {
  constructor() {
    this.continuous = false;
    this.interimResults = false;
    this.lang = '';
    this.onresult = null;
    this.onerror = null;
    this.onend = null;
    this._started = false;
    // Store the instance globally for test access
    MockSpeechRecognition._lastInstance = this;
  }

  start() { this._started = true; }
  stop() { this._started = false; }
  abort() { this._started = false; }

  _fireResult(transcript, isFinal = true) {
    if (!this.onresult) return;
    const event = {
      results: [[{ transcript }]],
      resultIndex: 0,
    };
    event.results[0].isFinal = isFinal;
    this.onresult(event);
  }

  _fireError(error) {
    if (this.onerror) this.onerror({ error });
  }

  _fireEnd() {
    if (this.onend) this.onend();
  }
}

function installSpeechAPI() {
  globalThis.webkitSpeechRecognition = MockSpeechRecognition;
}

function removeSpeechAPI() {
  delete globalThis.SpeechRecognition;
  delete globalThis.webkitSpeechRecognition;
}

function getRecognition() {
  return MockSpeechRecognition._lastInstance;
}

describe('VoiceInput.svelte', () => {
  let component;
  let target;

  beforeEach(() => {
    target = document.createElement('div');
    document.body.appendChild(target);
    installSpeechAPI();
    MockSpeechRecognition._lastInstance = null;
  });

  afterEach(() => {
    if (component) {
      try { unmount(component); } catch { /* already unmounted */ }
      component = null;
    }
    target.remove();
    removeSpeechAPI();
    vi.restoreAllMocks();
  });

  function mountVoice(props = {}) {
    component = mount(VoiceInput, {
      target,
      props: { onResult: vi.fn(), ...props },
    });
    flushSync();
    return component;
  }

  // --- isSupported ---

  describe('isSupported', () => {
    it('returns true when SpeechRecognition is available', () => {
      globalThis.SpeechRecognition = MockSpeechRecognition;
      const voice = mountVoice();
      expect(voice.isSupported()).toBe(true);
    });

    it('returns true when webkitSpeechRecognition is available', () => {
      delete globalThis.SpeechRecognition;
      const voice = mountVoice();
      expect(voice.isSupported()).toBe(true);
    });

    it('returns false when neither is available', () => {
      removeSpeechAPI();
      const voice = mountVoice();
      expect(voice.isSupported()).toBe(false);
    });
  });

  // --- Button rendering ---

  describe('button rendering', () => {
    it('renders a mic button', () => {
      mountVoice();
      const btn = target.querySelector('.voice-mic-btn');
      expect(btn).not.toBeNull();
    });

    it('button has minimum 44x44px tap target', () => {
      mountVoice();
      const btn = target.querySelector('.voice-mic-btn');
      expect(btn.style.minWidth).toBe('44px');
      expect(btn.style.minHeight).toBe('44px');
    });

    it('contains an SVG mic icon', () => {
      mountVoice();
      const svg = target.querySelector('.voice-mic-btn svg');
      expect(svg).not.toBeNull();
    });
  });

  // --- State transitions ---

  describe('state transitions', () => {
    it('starts in idle state', () => {
      const voice = mountVoice();
      expect(voice.getState()).toBe('idle');
    });

    it('transitions to listening on start()', () => {
      const voice = mountVoice();
      voice.start();
      expect(voice.getState()).toBe('listening');
    });

    it('transitions back to idle on stop()', () => {
      const voice = mountVoice();
      voice.start();
      voice.stop();
      expect(voice.getState()).toBe('idle');
    });

    it('transitions to idle when recognition ends', () => {
      const voice = mountVoice();
      voice.start();
      getRecognition()._fireEnd();
      expect(voice.getState()).toBe('idle');
    });

    it('adds listening class when listening', () => {
      mountVoice();
      component.start();
      flushSync();
      const btn = target.querySelector('.voice-mic-btn');
      expect(btn.classList.contains('voice-mic-btn--listening')).toBe(true);
    });

    it('removes listening class when stopped', () => {
      mountVoice();
      component.start();
      component.stop();
      flushSync();
      const btn = target.querySelector('.voice-mic-btn');
      expect(btn.classList.contains('voice-mic-btn--listening')).toBe(false);
    });
  });

  // --- toggle ---

  describe('toggle', () => {
    it('starts listening when idle', () => {
      const voice = mountVoice();
      voice.toggle();
      expect(voice.getState()).toBe('listening');
    });

    it('stops listening when listening', () => {
      const voice = mountVoice();
      voice.start();
      voice.toggle();
      expect(voice.getState()).toBe('idle');
    });

    it('is triggered by button click', () => {
      const voice = mountVoice();
      const btn = target.querySelector('.voice-mic-btn');
      btn.click();
      expect(voice.getState()).toBe('listening');
      btn.click();
      expect(voice.getState()).toBe('idle');
    });
  });

  // --- onResult ---

  describe('onResult', () => {
    it('calls onResult with final transcript', () => {
      const onResult = vi.fn();
      mountVoice({ onResult });
      component.start();
      getRecognition()._fireResult('hello world', true);
      expect(onResult).toHaveBeenCalledWith('hello world');
    });

    it('does not call onResult for interim results', () => {
      const onResult = vi.fn();
      mountVoice({ onResult });
      component.start();
      getRecognition()._fireResult('hel', false);
      expect(onResult).not.toHaveBeenCalled();
    });
  });

  // --- onInterim ---

  describe('onInterim', () => {
    it('calls onInterim with interim transcript', () => {
      const onInterim = vi.fn();
      mountVoice({ onResult: vi.fn(), onInterim });
      component.start();
      getRecognition()._fireResult('hel', false);
      expect(onInterim).toHaveBeenCalledWith('hel');
    });

    it('does not call onInterim for final results', () => {
      const onInterim = vi.fn();
      mountVoice({ onResult: vi.fn(), onInterim });
      component.start();
      getRecognition()._fireResult('hello', true);
      expect(onInterim).not.toHaveBeenCalled();
    });
  });

  // --- Error handling ---

  describe('error handling', () => {
    it('calls onError callback on recognition error', () => {
      const onError = vi.fn();
      mountVoice({ onResult: vi.fn(), onError });
      component.start();
      getRecognition()._fireError('network');
      expect(onError).toHaveBeenCalledWith('network');
    });

    it('adds error class on error', () => {
      mountVoice();
      component.start();
      getRecognition()._fireError('network');
      flushSync();
      const btn = target.querySelector('.voice-mic-btn');
      expect(btn.classList.contains('voice-mic-btn--error')).toBe(true);
    });

    it('keeps error class after onend fires following an error (bug fix)', () => {
      mountVoice();
      component.start();
      getRecognition()._fireError('not-allowed');
      getRecognition()._fireEnd();
      flushSync();
      const btn = target.querySelector('.voice-mic-btn');
      // Error state should be preserved even after recognition ends
      expect(btn.classList.contains('voice-mic-btn--error')).toBe(true);
      expect(btn.classList.contains('voice-mic-btn--listening')).toBe(false);
      expect(component.getState()).toBe('idle');
    });

    it('does not treat no-speech as an error', () => {
      const onError = vi.fn();
      mountVoice({ onResult: vi.fn(), onError });
      component.start();
      getRecognition()._fireError('no-speech');
      expect(onError).not.toHaveBeenCalled();
    });
  });

  // --- setLang ---

  describe('setLang', () => {
    it('sets the recognition language', () => {
      const voice = mountVoice({ lang: 'ja-JP' });
      expect(getRecognition().lang).toBe('ja-JP');
      voice.setLang('en-US');
      expect(getRecognition().lang).toBe('en-US');
    });
  });

  // --- Recognition initialized once (bug fix verification) ---

  describe('recognition initialization', () => {
    it('creates only one SpeechRecognition instance', () => {
      const constructorSpy = vi.fn();
      const OrigCtor = MockSpeechRecognition;
      globalThis.webkitSpeechRecognition = class extends OrigCtor {
        constructor() {
          super();
          constructorSpy();
        }
      };

      mountVoice();
      // Should be called exactly once on mount
      expect(constructorSpy).toHaveBeenCalledTimes(1);

      // Toggle multiple times - should NOT create new instances
      component.start();
      component.stop();
      component.start();
      component.stop();
      expect(constructorSpy).toHaveBeenCalledTimes(1);
    });
  });

  // --- dispose ---

  describe('dispose', () => {
    it('aborts recognition if listening', () => {
      mountVoice();
      component.start();
      const rec = getRecognition();
      const abortSpy = vi.spyOn(rec, 'abort');
      component.dispose();
      expect(abortSpy).toHaveBeenCalled();
    });

    it('sets state to idle after dispose', () => {
      const voice = mountVoice();
      voice.start();
      voice.dispose();
      expect(voice.getState()).toBe('idle');
    });
  });

  // --- getButtonElement ---

  describe('getButtonElement', () => {
    it('returns the button element', () => {
      const voice = mountVoice();
      flushSync();
      const btnEl = voice.getButtonElement();
      expect(btnEl).not.toBeNull();
      expect(btnEl.classList.contains('voice-mic-btn')).toBe(true);
    });
  });
});
