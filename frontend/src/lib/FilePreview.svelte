<script>
  import { onDestroy } from 'svelte';
  import { FilePreview } from '../../js/file-preview.js';

  let {
    session = undefined,
    path = undefined,
    entry = undefined,
    onBack = undefined,
    getRawURL = undefined,
    fetchFile = undefined,
    saveFile = undefined,
    onLoad = undefined,
    getLspStatus = undefined,
    getLspDefinition = undefined,
    getLspReferences = undefined,
    getLspDocumentSymbols = undefined,
    navStack = undefined,
    onNavigate = undefined,
  } = $props();

  /** @type {FilePreview|null} */
  let preview = $state(null);

  function initPreview(container) {
    preview = new FilePreview(container, {
      session,
      path,
      entry,
      onBack,
      getRawURL,
      fetchFile,
      saveFile,
      onLoad,
      getLspStatus,
      getLspDefinition,
      getLspReferences,
      getLspDocumentSymbols,
      navStack,
      onNavigate,
    });

    return {
      destroy() {
        if (preview) {
          preview.dispose();
          preview = null;
        }
      },
    };
  }

  onDestroy(() => {
    if (preview) {
      preview.dispose();
      preview = null;
    }
  });

  export function scrollToLine(lineNumber, highlightText) {
    preview?.scrollToLine(lineNumber, highlightText);
  }

  export function dispose() {
    if (preview) {
      preview.dispose();
      preview = null;
    }
  }
</script>

<div class="filepreview-container" use:initPreview></div>
