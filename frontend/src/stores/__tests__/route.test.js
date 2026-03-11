// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseHash, buildHash, getCurrent, push, replace, navigateFromHash, suppressDuring, setCurrent } from '../route.svelte.js';

// Mock history API
beforeEach(() => {
  vi.stubGlobal('history', {
    pushState: vi.fn(),
    replaceState: vi.fn(),
  });
});

describe('parseHash', () => {
  it('should parse sessions hash', () => {
    const result = parseHash('#sessions');
    expect(result.state.view).toBe('sessions');
    expect(result.hasSplit).toBe(false);
  });

  it('should parse windows hash', () => {
    const result = parseHash('#windows/my-session');
    expect(result.state.view).toBe('windows');
    expect(result.state.session).toBe('my-session');
  });

  it('should parse terminal hash', () => {
    const result = parseHash('#terminal/dev/2');
    expect(result.state.view).toBe('terminal');
    expect(result.state.session).toBe('dev');
    expect(result.state.window).toBe(2);
  });

  it('should parse files hash with path', () => {
    const result = parseHash('#files/dev/0/src/lib');
    expect(result.state.view).toBe('files');
    expect(result.state.session).toBe('dev');
    expect(result.state.window).toBe(0);
    expect(result.state.filePath).toBe('src/lib');
  });

  it('should parse files hash without path', () => {
    const result = parseHash('#files/dev/0');
    expect(result.state.filePath).toBe('.');
  });

  it('should parse git hash', () => {
    const result = parseHash('#git/dev/1');
    expect(result.state.view).toBe('git');
    expect(result.state.session).toBe('dev');
    expect(result.state.window).toBe(1);
  });

  it('should parse split suffix', () => {
    const result = parseHash('#terminal/dev/0&split=terminal/dev/1');
    expect(result.hasSplit).toBe(true);
    expect(result.rightFragment).toBe('terminal/dev/1');
    expect(result.state.view).toBe('terminal');
  });

  it('should parse split without right panel', () => {
    const result = parseHash('#terminal/dev/0&split');
    expect(result.hasSplit).toBe(true);
    expect(result.rightFragment).toBe(null);
  });

  it('should handle empty hash', () => {
    const result = parseHash('#');
    expect(result.state.view).toBe('sessions');
  });

  it('should decode URI components', () => {
    const result = parseHash('#windows/my%20session');
    expect(result.state.session).toBe('my session');
  });
});

describe('buildHash', () => {
  it('should build sessions hash', () => {
    expect(buildHash({ view: 'sessions' })).toBe('#sessions');
  });

  it('should build windows hash', () => {
    expect(buildHash({ view: 'windows', session: 'dev' })).toBe('#windows/dev');
  });

  it('should build terminal hash', () => {
    expect(buildHash({ view: 'terminal', session: 'dev', window: 0 })).toBe('#terminal/dev/0');
  });

  it('should build files hash with path', () => {
    expect(buildHash({ view: 'files', session: 'dev', window: 0, filePath: 'src/lib' }))
      .toBe('#files/dev/0/src/lib');
  });

  it('should build files hash with default path', () => {
    expect(buildHash({ view: 'files', session: 'dev', window: 0, filePath: '.' }))
      .toBe('#files/dev/0');
  });

  it('should build git hash', () => {
    expect(buildHash({ view: 'git', session: 'dev', window: 1 })).toBe('#git/dev/1');
  });

  it('should append split suffix', () => {
    expect(buildHash({ view: 'terminal', session: 'dev', window: 0, split: true }))
      .toBe('#terminal/dev/0&split');
  });

  it('should append split with right panel', () => {
    const hash = buildHash({
      view: 'terminal', session: 'dev', window: 0,
      split: true,
      rightPanel: { view: 'terminal', session: 'dev', window: 1 },
    });
    expect(hash).toBe('#terminal/dev/0&split=terminal/dev/1');
  });

  it('should encode special characters', () => {
    expect(buildHash({ view: 'windows', session: 'my session' })).toBe('#windows/my%20session');
  });

  it('should default to sessions for unknown view', () => {
    expect(buildHash({ view: 'unknown' })).toBe('#sessions');
  });
});

describe('push', () => {
  it('should call history.pushState', () => {
    push({ view: 'sessions' });
    expect(history.pushState).toHaveBeenCalledWith(
      { view: 'sessions' },
      '',
      '#sessions'
    );
  });

  it('should not push when suppressed', async () => {
    await suppressDuring(() => {
      push({ view: 'sessions' });
    });
    expect(history.pushState).not.toHaveBeenCalled();
  });
});

describe('replace', () => {
  it('should call history.replaceState', () => {
    replace({ view: 'terminal', session: 'dev', window: 0 });
    expect(history.replaceState).toHaveBeenCalledWith(
      { view: 'terminal', session: 'dev', window: 0 },
      '',
      '#terminal/dev/0'
    );
  });
});

describe('suppressDuring', () => {
  it('should suppress and restore', async () => {
    let suppressedDuringCallback = false;
    await suppressDuring(() => {
      push({ view: 'sessions' });
      suppressedDuringCallback = true;
    });
    expect(suppressedDuringCallback).toBe(true);
    expect(history.pushState).not.toHaveBeenCalled();

    // After suppressDuring, push should work
    push({ view: 'sessions' });
    expect(history.pushState).toHaveBeenCalled();
  });
});
