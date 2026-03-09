<script>
  // Sample Svelte component to verify the build pipeline works.
  // This will be replaced with real components in later phases.
  let { message = 'Svelte is ready' } = $props();
</script>

<div class="svelte-ready" data-testid="svelte-ready">
  {message}
</div>

<style>
  .svelte-ready {
    display: none;
  }
</style>
