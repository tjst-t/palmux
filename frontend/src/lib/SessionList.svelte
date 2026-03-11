<script>
/**
 * SessionList.svelte - セッション一覧 / ウィンドウ一覧を表示する
 */

let {
  mode = 'sessions',
  sessionName = null,
  sessions = [],
  windows = [],
  loading = false,
  error = null,
  onSelectSession = null,
  onSelectWindow = null,
} = $props();
</script>

<div class="session-list-content">
  {#if loading}
    <div class="loading">Loading {mode === 'sessions' ? 'sessions' : 'windows'}...</div>
  {:else if error}
    <div class="error-message">{error}</div>
  {:else if mode === 'sessions'}
    {#if sessions.length === 0}
      <div class="empty-message">No tmux sessions found.</div>
    {:else}
      {#each sessions as session}
        <div class="session-item" role="button" tabindex="0"
          onclick={() => onSelectSession?.(session.name)}
          onkeydown={(e) => e.key === 'Enter' && onSelectSession?.(session.name)}>
          <div class="session-name">{session.name}</div>
          <div class="session-info">
            {session.windows || 0} window{(session.windows || 0) !== 1 ? 's' : ''} | {session.attached ? 'attached' : 'detached'}
          </div>
        </div>
      {/each}
    {/if}
  {:else if mode === 'windows'}
    {#if windows.length === 0}
      <div class="empty-message">No windows found.</div>
    {:else}
      {#each windows as win}
        <div class="session-item window-item" role="button" tabindex="0"
          onclick={() => onSelectWindow?.(sessionName, win.index)}
          onkeydown={(e) => e.key === 'Enter' && onSelectWindow?.(sessionName, win.index)}>
          <div class="session-name">{win.index}: {win.name}</div>
          <div class="session-info">
            {#if win.active}
              <span class="active-indicator">&#9679;</span> active
            {/if}
          </div>
        </div>
      {/each}
    {/if}
  {/if}
</div>
