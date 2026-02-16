// file-preview.js - File preview panel
// Renders file content based on file type: Markdown, code, images, etc.

import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';

// Import specific languages to keep bundle size small
import javascript from 'highlight.js/lib/languages/javascript';
import go from 'highlight.js/lib/languages/go';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import yaml from 'highlight.js/lib/languages/yaml';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml'; // also handles HTML
import css from 'highlight.js/lib/languages/css';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import rust from 'highlight.js/lib/languages/rust';
import cpp from 'highlight.js/lib/languages/cpp';
import c from 'highlight.js/lib/languages/c';
import java from 'highlight.js/lib/languages/java';
import ruby from 'highlight.js/lib/languages/ruby';
import php from 'highlight.js/lib/languages/php';
import swift from 'highlight.js/lib/languages/swift';
import kotlin from 'highlight.js/lib/languages/kotlin';
import ini from 'highlight.js/lib/languages/ini'; // handles .toml too
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import makefile from 'highlight.js/lib/languages/makefile';
import markdown from 'highlight.js/lib/languages/markdown';

// Register languages
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('jsx', javascript);
hljs.registerLanguage('go', go);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('json', json);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('htm', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('rs', rust);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', c);
hljs.registerLanguage('h', c);
hljs.registerLanguage('java', java);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('rb', ruby);
hljs.registerLanguage('php', php);
hljs.registerLanguage('swift', swift);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('kt', kotlin);
hljs.registerLanguage('ini', ini);
hljs.registerLanguage('toml', ini);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('makefile', makefile);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);

// Configure marked for GFM with highlight.js
marked.setOptions({
  gfm: true,
  breaks: false,
});

/**
 * Extension sets for file type classification.
 */
const MARKDOWN_EXTS = ['.md'];

const CODE_EXTS = [
  '.go', '.js', '.py', '.sh', '.yaml', '.yml', '.json', '.toml', '.css',
  '.html', '.htm', '.sql', '.rs', '.ts', '.tsx', '.jsx', '.c', '.h',
  '.cpp', '.java', '.rb', '.php', '.swift', '.kt',
];

const PLAINTEXT_EXTS = ['.txt', '.log', '.csv', '.env', '.gitignore'];

const PLAINTEXT_NAMES = ['Makefile', 'Dockerfile'];

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'];

const PDF_EXTS = ['.pdf'];

/**
 * Determine the file preview type from extension and filename.
 * @param {string} ext - File extension (e.g., '.go')
 * @param {string} name - File name (e.g., 'Makefile')
 * @returns {string} 'markdown' | 'code' | 'plaintext' | 'image' | 'pdf' | 'unknown'
 */
export function getPreviewType(ext, name) {
  const lowerExt = (ext || '').toLowerCase();

  if (MARKDOWN_EXTS.includes(lowerExt)) return 'markdown';
  if (CODE_EXTS.includes(lowerExt)) return 'code';
  if (PLAINTEXT_EXTS.includes(lowerExt)) return 'plaintext';
  if (PLAINTEXT_NAMES.includes(name)) return 'plaintext';
  if (IMAGE_EXTS.includes(lowerExt)) return 'image';
  if (PDF_EXTS.includes(lowerExt)) return 'pdf';

  return 'unknown';
}

/**
 * Get the highlight.js language name for a given file extension.
 * @param {string} ext - File extension (e.g., '.go')
 * @returns {string} Language name for highlight.js
 */
export function getLanguageFromExt(ext) {
  const map = {
    '.go': 'go',
    '.js': 'javascript',
    '.jsx': 'jsx',
    '.py': 'python',
    '.sh': 'bash',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.json': 'json',
    '.toml': 'toml',
    '.css': 'css',
    '.html': 'html',
    '.htm': 'html',
    '.sql': 'sql',
    '.rs': 'rust',
    '.ts': 'typescript',
    '.tsx': 'tsx',
    '.c': 'c',
    '.h': 'c',
    '.cpp': 'cpp',
    '.java': 'java',
    '.rb': 'ruby',
    '.php': 'php',
    '.swift': 'swift',
    '.kt': 'kotlin',
  };
  return map[(ext || '').toLowerCase()] || '';
}

/**
 * Format file size for display in the preview header.
 * @param {number} bytes
 * @returns {string}
 */
function formatFileSize(bytes) {
  if (bytes == null || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  if (i === 0) return `${bytes} B`;
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[i]}`;
}

/**
 * Escape HTML special characters.
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * FilePreview renders a file preview panel within a container.
 *
 * Supports:
 * - Markdown (.md) with GFM, tables, checkboxes, code blocks highlighted
 * - Code files with syntax highlighting and line numbers
 * - Plain text files with monospace font
 * - Images displayed inline via raw API URL
 * - PDFs via iframe or download link
 * - Unknown files with "preview not available" message
 */
export class FilePreview {
  /**
   * @param {HTMLElement} container - Container element to render into
   * @param {Object} options
   * @param {string} options.session - tmux session name
   * @param {string} options.path - File path (relative)
   * @param {Object} options.entry - File entry info { name, size, extension, mod_time, ... }
   * @param {function(): void} [options.onBack] - Callback when back button is pressed
   * @param {function(string, string): string} [options.getRawURL] - Function to get raw file URL (session, path) => url
   * @param {function(string, string): Promise<Object>} [options.fetchFile] - Function to fetch file content (session, path) => Promise
   */
  constructor(container, options) {
    this._container = container;
    this._session = options.session;
    this._path = options.path;
    this._entry = options.entry;
    this._onBack = options.onBack || null;
    this._getRawURL = options.getRawURL || null;
    this._fetchFile = options.fetchFile || null;
    this._disposed = false;

    this._render();
    this._loadContent();
  }

  /**
   * Render the preview panel skeleton (header + loading state).
   */
  _render() {
    this._container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'fp';
    this._wrapper = wrapper;

    // Header
    const header = document.createElement('div');
    header.className = 'fp-header';

    const backBtn = document.createElement('button');
    backBtn.className = 'fp-back-btn';
    backBtn.textContent = '\u2190';
    backBtn.setAttribute('aria-label', 'Back to file list');
    backBtn.addEventListener('click', () => {
      if (this._onBack) this._onBack();
    });
    header.appendChild(backBtn);

    const fileInfo = document.createElement('div');
    fileInfo.className = 'fp-file-info';

    const fileName = document.createElement('span');
    fileName.className = 'fp-file-name';
    fileName.textContent = this._entry.name || this._path.split('/').pop();
    fileInfo.appendChild(fileName);

    const fileSize = document.createElement('span');
    fileSize.className = 'fp-file-size';
    fileSize.textContent = formatFileSize(this._entry.size);
    fileInfo.appendChild(fileSize);

    header.appendChild(fileInfo);
    wrapper.appendChild(header);

    // Content area
    const content = document.createElement('div');
    content.className = 'fp-content';
    this._contentEl = content;

    // Loading state
    const loading = document.createElement('div');
    loading.className = 'fp-loading';
    loading.textContent = 'Loading...';
    content.appendChild(loading);

    wrapper.appendChild(content);
    this._container.appendChild(wrapper);
  }

  /**
   * Load and display the file content.
   */
  async _loadContent() {
    const ext = (this._entry.extension || '').toLowerCase();
    const name = this._entry.name || '';
    const previewType = getPreviewType(ext, name);

    try {
      switch (previewType) {
        case 'image':
          this._renderImage();
          break;
        case 'pdf':
          this._renderPDF();
          break;
        case 'markdown':
        case 'code':
        case 'plaintext': {
          const data = await this._fetchFileContent();
          if (this._disposed) return;
          if (!data) {
            this._renderError('Failed to load file content');
            return;
          }
          if (previewType === 'markdown') {
            this._renderMarkdown(data.content || '', data.truncated);
          } else if (previewType === 'code') {
            this._renderCode(data.content || '', ext, data.truncated);
          } else {
            this._renderPlaintext(data.content || '', data.truncated);
          }
          break;
        }
        default:
          this._renderUnknown();
          break;
      }
    } catch (err) {
      if (this._disposed) return;
      console.error('Failed to load file preview:', err);
      this._renderError(`Failed to load: ${err.message}`);
    }
  }

  /**
   * Fetch file content via the API.
   * @returns {Promise<Object|null>}
   */
  async _fetchFileContent() {
    if (!this._fetchFile) return null;
    return this._fetchFile(this._session, this._path);
  }

  /**
   * Render markdown content.
   * @param {string} content - Raw markdown content
   * @param {boolean} truncated - Whether the content was truncated
   */
  _renderMarkdown(content, truncated) {
    this._contentEl.innerHTML = '';

    const mdContainer = document.createElement('div');
    mdContainer.className = 'fp-markdown';

    // Transform relative image paths to raw API URLs
    let processedContent = content;
    if (this._getRawURL) {
      const getRawURL = this._getRawURL;
      const session = this._session;
      const dirPath = this._path.includes('/')
        ? this._path.substring(0, this._path.lastIndexOf('/'))
        : '';

      // Replace relative image paths: ![alt](./path) or ![alt](path)
      processedContent = processedContent.replace(
        /!\[([^\]]*)\]\((?!https?:\/\/|data:)([^)]+)\)/g,
        (match, alt, imgPath) => {
          // Resolve relative path
          let resolvedPath = imgPath;
          if (imgPath.startsWith('./')) {
            resolvedPath = imgPath.substring(2);
          }
          if (dirPath && !imgPath.startsWith('/')) {
            resolvedPath = dirPath + '/' + resolvedPath;
          }
          // Normalize path segments (resolve .. and .)
          resolvedPath = resolvedPath.split('/').reduce((parts, segment) => {
            if (segment === '..') parts.pop();
            else if (segment !== '.' && segment !== '') parts.push(segment);
            return parts;
          }, []).join('/');
          const url = getRawURL(session, resolvedPath);
          return `![${alt}](${url})`;
        }
      );
    }

    // Configure marked renderer with highlight.js for code blocks
    const renderer = new marked.Renderer();

    const rawHTML = marked.parse(processedContent, {
      gfm: true,
      breaks: false,
      renderer: renderer,
      highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
          try {
            return hljs.highlight(code, { language: lang }).value;
          } catch (_) {
            // fall through
          }
        }
        try {
          return hljs.highlightAuto(code).value;
        } catch (_) {
          return escapeHTML(code);
        }
      },
    });
    mdContainer.innerHTML = DOMPurify.sanitize(rawHTML, { ADD_ATTR: ['class'] });

    // Highlight code blocks that marked didn't highlight
    const codeBlocks = mdContainer.querySelectorAll('pre code');
    for (const block of codeBlocks) {
      if (!block.classList.contains('hljs')) {
        hljs.highlightElement(block);
      }
    }

    this._contentEl.appendChild(mdContainer);

    if (truncated) {
      this._contentEl.appendChild(this._createTruncatedNotice());
    }
  }

  /**
   * Render code with syntax highlighting and line numbers.
   * @param {string} content - Raw code content
   * @param {string} ext - File extension
   * @param {boolean} truncated - Whether the content was truncated
   */
  _renderCode(content, ext, truncated) {
    this._contentEl.innerHTML = '';

    const codeContainer = document.createElement('div');
    codeContainer.className = 'fp-code';

    const lang = getLanguageFromExt(ext);
    let highlightedCode;
    try {
      if (lang && hljs.getLanguage(lang)) {
        highlightedCode = hljs.highlight(content, { language: lang }).value;
      } else {
        highlightedCode = hljs.highlightAuto(content).value;
      }
    } catch (_) {
      highlightedCode = escapeHTML(content);
    }

    // Split into lines and add line numbers
    const lines = highlightedCode.split('\n');
    // Remove trailing empty line if present (common in files)
    if (lines.length > 1 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    const table = document.createElement('table');
    table.className = 'fp-code-table';

    const tbody = document.createElement('tbody');

    for (let i = 0; i < lines.length; i++) {
      const tr = document.createElement('tr');

      const lineNumTd = document.createElement('td');
      lineNumTd.className = 'fp-code-linenum';
      lineNumTd.textContent = i + 1;
      lineNumTd.setAttribute('data-line', i + 1);

      const codeTd = document.createElement('td');
      codeTd.className = 'fp-code-line';
      codeTd.innerHTML = lines[i] || ' '; // Ensure empty lines have content

      tr.appendChild(lineNumTd);
      tr.appendChild(codeTd);
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    codeContainer.appendChild(table);
    this._contentEl.appendChild(codeContainer);

    if (truncated) {
      this._contentEl.appendChild(this._createTruncatedNotice());
    }
  }

  /**
   * Render plain text content.
   * @param {string} content - Raw text content
   * @param {boolean} truncated - Whether the content was truncated
   */
  _renderPlaintext(content, truncated) {
    this._contentEl.innerHTML = '';

    const pre = document.createElement('pre');
    pre.className = 'fp-plaintext';
    pre.textContent = content;

    this._contentEl.appendChild(pre);

    if (truncated) {
      this._contentEl.appendChild(this._createTruncatedNotice());
    }
  }

  /**
   * Render image preview using the raw API URL.
   */
  _renderImage() {
    this._contentEl.innerHTML = '';

    const imgContainer = document.createElement('div');
    imgContainer.className = 'fp-image';

    const img = document.createElement('img');
    img.className = 'fp-image-el';
    img.alt = this._entry.name || 'Image';

    if (this._getRawURL) {
      img.src = this._getRawURL(this._session, this._path);
    }

    img.addEventListener('error', () => {
      imgContainer.innerHTML = '';
      const errMsg = document.createElement('div');
      errMsg.className = 'fp-error';
      errMsg.textContent = 'Failed to load image';
      imgContainer.appendChild(errMsg);
    });

    imgContainer.appendChild(img);
    this._contentEl.appendChild(imgContainer);
  }

  /**
   * Render PDF preview via iframe or download link.
   */
  _renderPDF() {
    this._contentEl.innerHTML = '';

    const pdfContainer = document.createElement('div');
    pdfContainer.className = 'fp-pdf';

    if (this._getRawURL) {
      const url = this._getRawURL(this._session, this._path);

      const iframe = document.createElement('iframe');
      iframe.className = 'fp-pdf-iframe';
      iframe.src = url;
      iframe.setAttribute('frameborder', '0');
      pdfContainer.appendChild(iframe);

      // Also show a download link as fallback
      const downloadLink = document.createElement('a');
      downloadLink.className = 'fp-pdf-download';
      downloadLink.href = url;
      downloadLink.download = this._entry.name || 'file.pdf';
      downloadLink.textContent = 'Download PDF';
      downloadLink.target = '_blank';
      downloadLink.rel = 'noopener noreferrer';
      pdfContainer.appendChild(downloadLink);
    } else {
      const msg = document.createElement('div');
      msg.className = 'fp-unknown-msg';
      msg.textContent = 'PDF preview not available';
      pdfContainer.appendChild(msg);
    }

    this._contentEl.appendChild(pdfContainer);
  }

  /**
   * Render "preview not available" message with file info.
   */
  _renderUnknown() {
    this._contentEl.innerHTML = '';

    const unknownContainer = document.createElement('div');
    unknownContainer.className = 'fp-unknown';

    const msg = document.createElement('div');
    msg.className = 'fp-unknown-msg';
    msg.textContent = 'Preview not available for this file type';
    unknownContainer.appendChild(msg);

    const info = document.createElement('div');
    info.className = 'fp-unknown-info';

    const sizeInfo = document.createElement('div');
    sizeInfo.textContent = `Size: ${formatFileSize(this._entry.size)}`;
    info.appendChild(sizeInfo);

    if (this._entry.extension) {
      const extInfo = document.createElement('div');
      extInfo.textContent = `Extension: ${this._entry.extension}`;
      info.appendChild(extInfo);
    }

    if (this._entry.mod_time) {
      const dateInfo = document.createElement('div');
      const d = new Date(this._entry.mod_time);
      dateInfo.textContent = `Modified: ${d.toLocaleString()}`;
      info.appendChild(dateInfo);
    }

    unknownContainer.appendChild(info);

    // Download link if raw URL is available
    if (this._getRawURL) {
      const url = this._getRawURL(this._session, this._path);
      const downloadLink = document.createElement('a');
      downloadLink.className = 'fp-download-link';
      downloadLink.href = url;
      downloadLink.download = this._entry.name || 'file';
      downloadLink.textContent = 'Download file';
      downloadLink.target = '_blank';
      downloadLink.rel = 'noopener noreferrer';
      unknownContainer.appendChild(downloadLink);
    }

    this._contentEl.appendChild(unknownContainer);
  }

  /**
   * Render an error message.
   * @param {string} message
   */
  _renderError(message) {
    this._contentEl.innerHTML = '';

    const error = document.createElement('div');
    error.className = 'fp-error';
    error.textContent = message;
    this._contentEl.appendChild(error);
  }

  /**
   * Create a truncated file notice element.
   * @returns {HTMLElement}
   */
  _createTruncatedNotice() {
    const notice = document.createElement('div');
    notice.className = 'fp-truncated';
    notice.textContent = 'File is large. Only partial content is shown.';
    return notice;
  }

  /**
   * Dispose of the preview and clean up.
   */
  dispose() {
    this._disposed = true;
    this._container.innerHTML = '';
    this._wrapper = null;
    this._contentEl = null;
  }
}
