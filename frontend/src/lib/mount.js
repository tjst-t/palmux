import { mount, unmount } from 'svelte';

/**
 * Mount a Svelte component into a DOM element from vanilla JS.
 * Returns a handle with an unmount() method.
 *
 * @param {typeof import('svelte').SvelteComponent} Component
 * @param {HTMLElement} target
 * @param {Record<string, any>} props
 * @returns {{ unmount: () => void }}
 */
export function mountComponent(Component, target, props = {}) {
  const component = mount(Component, { target, props });
  return {
    unmount() {
      unmount(component);
    },
  };
}
