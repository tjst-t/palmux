<script>
  import { onMount, onDestroy } from 'svelte';
  import { PalmuxTerminal } from '../../js/terminal.js';

  let {
    onSend = undefined,
    onConnect = undefined,
    onClientStatus = undefined,
    onNotificationUpdate = undefined,
    onDisconnect = undefined,
    onReconnectFlush = undefined,
  } = $props();

  /** @type {PalmuxTerminal|null} */
  let terminal = $state(null);

  function initTerminal(container) {
    terminal = new PalmuxTerminal(container);

    if (onConnect) terminal.setOnConnect(onConnect);
    if (onClientStatus) terminal.setOnClientStatus(onClientStatus);
    if (onNotificationUpdate) terminal.setOnNotificationUpdate(onNotificationUpdate);
    if (onReconnectFlush) terminal.setOnReconnectFlush(onReconnectFlush);

    return {
      destroy() {
        if (terminal) {
          terminal.disconnect();
          terminal = null;
        }
      },
    };
  }

  onDestroy(() => {
    if (terminal) {
      terminal.disconnect();
      terminal = null;
    }
  });

  export function connect(wsUrl, disconnectCb) {
    terminal?.connect(wsUrl, disconnectCb ?? onDisconnect);
  }

  export function reconnect(wsUrl, disconnectCb) {
    terminal?.reconnect(wsUrl, disconnectCb ?? onDisconnect);
  }

  export function disconnect() {
    terminal?.disconnect();
  }

  export function fit() {
    terminal?.fit();
  }

  export function sendInput(data) {
    terminal?.sendInput(data);
  }

  export function setToolbar(toolbar) {
    terminal?.setToolbar(toolbar);
  }

  export function setIMEMode(enabled) {
    terminal?.setIMEMode(enabled);
  }

  export function setKeyboardMode(mode) {
    terminal?.setKeyboardMode(mode);
  }

  export function setGlobalKeyHandlerEnabled(enabled) {
    terminal?.setGlobalKeyHandlerEnabled(enabled);
  }

  export function setFitEnabled(enabled) {
    terminal?.setFitEnabled(enabled);
  }

  export function setOnConnect(cb) {
    terminal?.setOnConnect(cb);
  }

  export function setOnClientStatus(cb) {
    terminal?.setOnClientStatus(cb);
  }

  export function setOnNotificationUpdate(cb) {
    terminal?.setOnNotificationUpdate(cb);
  }

  export function setOnReconnectFlush(cb) {
    terminal?.setOnReconnectFlush(cb);
  }

  export function focus() {
    terminal?.focus();
  }

  export function getCellFromPoint(x, y) {
    return terminal?.getCellFromPoint(x, y) ?? null;
  }

  export function getLineText(viewportRow) {
    return terminal?.getLineText(viewportRow) ?? '';
  }

  export function select(col, row, length) {
    terminal?.select(col, row, length);
  }

  export function getSelection() {
    return terminal?.getSelection() ?? '';
  }

  export function clearSelection() {
    terminal?.clearSelection();
  }

  export function getCols() {
    return terminal?.getCols() ?? 0;
  }

  export function setFontSize(size) {
    terminal?.setFontSize(size);
  }

  export function increaseFontSize() {
    terminal?.increaseFontSize();
  }

  export function decreaseFontSize() {
    terminal?.decreaseFontSize();
  }

  export function getFontSize() {
    return terminal?.getFontSize() ?? 14;
  }
</script>

<div class="terminal-container" use:initTerminal></div>
