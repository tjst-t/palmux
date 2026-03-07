// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceInput } from '../voice-input.js';

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
  }

  start() {
    this._started = true;
  }

  stop() {
    this._started = false;
  }

  abort() {
    this._started = false;
  }

  // Test helpers
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
    if (this.onerror) {
      this.onerror({ error });
    }
  }

  _fireEnd() {
    if (this.onend) {
      this.onend();
    }
  }
}

// --- helpers ---

function createContainer() {
  const el = document.createElement('div');
  el.className = 'ime-input-bar';
  document.body.appendChild(el);
  return el;
}

function installSpeechAPI() {
  globalThis.webkitSpeechRecognition = MockSpeechRecognition;
}

function removeSpeechAPI() {
  delete globalThis.SpeechRecognition;
  delete globalThis.webkitSpeechRecognition;
}

// --- tests ---

describe('VoiceInput', () => {
  let container;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = createContainer();
    installSpeechAPI();
  });

  afterEach(() => {
    removeSpeechAPI();
  });

  // --- Feature detection ---

  describe('isSupported', () => {
    it('returns true when SpeechRecognition is available', () => {
      globalThis.SpeechRecognition = MockSpeechRecognition;
      expect(VoiceInput.isSupported()).toBe(true);
    });

    it('returns true when webkitSpeechRecognition is available', () => {
      delete globalThis.SpeechRecognition;
      globalThis.webkitSpeechRecognition = MockSpeechRecognition;
      expect(VoiceInput.isSupported()).toBe(true);
    });

    it('returns false when neither is available', () => {
      removeSpeechAPI();
      expect(VoiceInput.isSupported()).toBe(false);
    });
  });

  // --- Button rendering ---

  describe('button rendering', () => {
    it('renders a mic button into the container', () => {
      const voice = new VoiceInput(container, { onResult: vi.fn() });
      const btn = container.querySelector('.voice-mic-btn');
      expect(btn).not.toBeNull();
      voice.destroy();
    });

    it('renders the button between input and send button', () => {
      // Set up container like ime-input-bar: input + sendBtn
      const input = document.createElement('input');
      input.className = 'ime-input-field';
      const sendBtn = document.createElement('button');
      sendBtn.className = 'ime-send-btn';
      container.appendChild(input);
      container.appendChild(sendBtn);

      const voice = new VoiceInput(container, { onResult: vi.fn() });
      const children = Array.from(container.children);
      const micIdx = children.findIndex(el => el.classList.contains('voice-mic-btn'));
      const sendIdx = children.findIndex(el => el.classList.contains('ime-send-btn'));
      expect(micIdx).toBeLessThan(sendIdx);
      voice.destroy();
    });

    it('button has minimum 44x44px tap target', () => {
      const voice = new VoiceInput(container, { onResult: vi.fn() });
      const btn = container.querySelector('.voice-mic-btn');
      expect(btn.style.minWidth).toBe('44px');
      expect(btn.style.minHeight).toBe('44px');
      voice.destroy();
    });

    it('contains an SVG mic icon', () => {
      const voice = new VoiceInput(container, { onResult: vi.fn() });
      const btn = container.querySelector('.voice-mic-btn');
      const svg = btn.querySelector('svg');
      expect(svg).not.toBeNull();
      voice.destroy();
    });
  });

  // --- State transitions ---

  describe('state transitions', () => {
    it('starts in idle state', () => {
      const voice = new VoiceInput(container, { onResult: vi.fn() });
      expect(voice.state).toBe('idle');
      voice.destroy();
    });

    it('transitions to listening on start()', () => {
      const voice = new VoiceInput(container, { onResult: vi.fn() });
      voice.start();
      expect(voice.state).toBe('listening');
      voice.destroy();
    });

    it('transitions back to idle on stop()', () => {
      const voice = new VoiceInput(container, { onResult: vi.fn() });
      voice.start();
      voice.stop();
      expect(voice.state).toBe('idle');
      voice.destroy();
    });

    it('transitions to idle when recognition ends', () => {
      const voice = new VoiceInput(container, { onResult: vi.fn() });
      voice.start();
      voice._recognition._fireEnd();
      expect(voice.state).toBe('idle');
      voice.destroy();
    });

    it('adds listening class when listening', () => {
      const voice = new VoiceInput(container, { onResult: vi.fn() });
      voice.start();
      const btn = container.querySelector('.voice-mic-btn');
      expect(btn.classList.contains('voice-mic-btn--listening')).toBe(true);
      voice.destroy();
    });

    it('removes listening class when stopped', () => {
      const voice = new VoiceInput(container, { onResult: vi.fn() });
      voice.start();
      voice.stop();
      const btn = container.querySelector('.voice-mic-btn');
      expect(btn.classList.contains('voice-mic-btn--listening')).toBe(false);
      voice.destroy();
    });
  });

  // --- toggle() ---

  describe('toggle', () => {
    it('starts listening when idle', () => {
      const voice = new VoiceInput(container, { onResult: vi.fn() });
      voice.toggle();
      expect(voice.state).toBe('listening');
      voice.destroy();
    });

    it('stops listening when listening', () => {
      const voice = new VoiceInput(container, { onResult: vi.fn() });
      voice.start();
      voice.toggle();
      expect(voice.state).toBe('idle');
      voice.destroy();
    });

    it('is triggered by button click', () => {
      const voice = new VoiceInput(container, { onResult: vi.fn() });
      const btn = container.querySelector('.voice-mic-btn');
      btn.click();
      expect(voice.state).toBe('listening');
      btn.click();
      expect(voice.state).toBe('idle');
      voice.destroy();
    });
  });

  // --- onResult callback ---

  describe('onResult', () => {
    it('calls onResult with final transcript', () => {
      const onResult = vi.fn();
      const voice = new VoiceInput(container, { onResult });
      voice.start();
      voice._recognition._fireResult('hello world', true);
      expect(onResult).toHaveBeenCalledWith('hello world');
      voice.destroy();
    });

    it('does not call onResult for interim results', () => {
      const onResult = vi.fn();
      const voice = new VoiceInput(container, { onResult });
      voice.start();
      voice._recognition._fireResult('hel', false);
      expect(onResult).not.toHaveBeenCalled();
      voice.destroy();
    });
  });

  // --- onInterim callback ---

  describe('onInterim', () => {
    it('calls onInterim with interim transcript', () => {
      const onInterim = vi.fn();
      const voice = new VoiceInput(container, { onResult: vi.fn(), onInterim });
      voice.start();
      voice._recognition._fireResult('hel', false);
      expect(onInterim).toHaveBeenCalledWith('hel');
      voice.destroy();
    });

    it('does not call onInterim for final results', () => {
      const onInterim = vi.fn();
      const voice = new VoiceInput(container, { onResult: vi.fn(), onInterim });
      voice.start();
      voice._recognition._fireResult('hello', true);
      expect(onInterim).not.toHaveBeenCalled();
      voice.destroy();
    });
  });

  // --- Error handling ---

  describe('error handling', () => {
    it('calls onError callback on recognition error', () => {
      const onError = vi.fn();
      const voice = new VoiceInput(container, { onResult: vi.fn(), onError });
      voice.start();
      voice._recognition._fireError('network');
      expect(onError).toHaveBeenCalledWith('network');
      voice.destroy();
    });

    it('adds error class on error', () => {
      const voice = new VoiceInput(container, { onResult: vi.fn() });
      voice.start();
      voice._recognition._fireError('network');
      const btn = container.querySelector('.voice-mic-btn');
      expect(btn.classList.contains('voice-mic-btn--error')).toBe(true);
      voice.destroy();
    });

    it('keeps error class after onend fires following an error', () => {
      const voice = new VoiceInput(container, { onResult: vi.fn() });
      voice.start();
      voice._recognition._fireError('not-allowed');
      voice._recognition._fireEnd();
      const btn = container.querySelector('.voice-mic-btn');
      expect(btn.classList.contains('voice-mic-btn--error')).toBe(true);
      expect(btn.classList.contains('voice-mic-btn--listening')).toBe(false);
      expect(voice.state).toBe('idle');
      voice.destroy();
    });

    it('does not treat no-speech as an error', () => {
      const onError = vi.fn();
      const voice = new VoiceInput(container, { onResult: vi.fn(), onError });
      voice.start();
      voice._recognition._fireError('no-speech');
      expect(onError).not.toHaveBeenCalled();
      voice.destroy();
    });
  });

  // --- setLang ---

  describe('setLang', () => {
    it('sets the recognition language', () => {
      const voice = new VoiceInput(container, { onResult: vi.fn(), lang: 'ja-JP' });
      expect(voice._recognition.lang).toBe('ja-JP');
      voice.setLang('en-US');
      expect(voice._recognition.lang).toBe('en-US');
      voice.destroy();
    });
  });

  // --- destroy ---

  describe('destroy', () => {
    it('removes the button from the DOM', () => {
      const voice = new VoiceInput(container, { onResult: vi.fn() });
      expect(container.querySelector('.voice-mic-btn')).not.toBeNull();
      voice.destroy();
      expect(container.querySelector('.voice-mic-btn')).toBeNull();
    });

    it('aborts recognition if listening', () => {
      const voice = new VoiceInput(container, { onResult: vi.fn() });
      voice.start();
      const abortSpy = vi.spyOn(voice._recognition, 'abort');
      voice.destroy();
      expect(abortSpy).toHaveBeenCalled();
    });

    it('sets state to idle after destroy', () => {
      const voice = new VoiceInput(container, { onResult: vi.fn() });
      voice.start();
      voice.destroy();
      expect(voice.state).toBe('idle');
    });
  });
});
