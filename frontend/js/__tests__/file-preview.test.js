// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { getPreviewType } from '../file-preview.js';

describe('getPreviewType', () => {
  // drawio support
  it('returns "drawio" for .drawio extension', () => {
    expect(getPreviewType('.drawio', 'diagram.drawio')).toBe('drawio');
  });

  it('returns "drawio" for .dio extension', () => {
    expect(getPreviewType('.dio', 'diagram.dio')).toBe('drawio');
  });

  it('returns "drawio" for uppercase .DRAWIO extension', () => {
    expect(getPreviewType('.DRAWIO', 'diagram.DRAWIO')).toBe('drawio');
  });

  it('returns "drawio" for mixed case .Dio extension', () => {
    expect(getPreviewType('.Dio', 'diagram.Dio')).toBe('drawio');
  });

  // Regression tests for existing types
  it('returns "markdown" for .md extension', () => {
    expect(getPreviewType('.md', 'README.md')).toBe('markdown');
  });

  it('returns "code" for .go extension', () => {
    expect(getPreviewType('.go', 'main.go')).toBe('code');
  });

  it('returns "code" for .js extension', () => {
    expect(getPreviewType('.js', 'index.js')).toBe('code');
  });

  it('returns "plaintext" for .txt extension', () => {
    expect(getPreviewType('.txt', 'notes.txt')).toBe('plaintext');
  });

  it('returns "plaintext" for Makefile', () => {
    expect(getPreviewType('', 'Makefile')).toBe('plaintext');
  });

  it('returns "image" for .png extension', () => {
    expect(getPreviewType('.png', 'photo.png')).toBe('image');
  });

  it('returns "pdf" for .pdf extension', () => {
    expect(getPreviewType('.pdf', 'doc.pdf')).toBe('pdf');
  });

  it('returns "html" for .html extension', () => {
    expect(getPreviewType('.html', 'index.html')).toBe('html');
  });

  it('returns "unknown" for unrecognized extension', () => {
    expect(getPreviewType('.xyz', 'file.xyz')).toBe('unknown');
  });
});
