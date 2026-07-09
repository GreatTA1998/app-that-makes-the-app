<script lang="ts">
  import type { Snippet } from 'svelte'

  let { children }: { children: Snippet } = $props()

  let open = $state(false)
  let root: HTMLDivElement | undefined

  const captureRoot = (node: HTMLDivElement) => {
    root = node
    return () => {
      if (root === node) root = undefined
    }
  }

  function toggle () {
    open = !open
  }

  function onWindowKeydown (e: KeyboardEvent) {
    if (e.key === 'Escape' && open) open = false
  }

  function onWindowPointerDown (e: PointerEvent) {
    if (!open || !root) return
    if (!root.contains(e.target as Node)) open = false
  }
</script>

<svelte:window onkeydown={onWindowKeydown} onpointerdown={onWindowPointerDown} />

<div class="relative inline-flex" {@attach captureRoot}>
  <button
    type="button"
    class="inline-flex size-4 items-center justify-center rounded-full text-neutral-400 hover:text-neutral-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-400"
    aria-expanded={open}
    aria-label="How this is measured"
    onclick={toggle}
  >
    <svg class="size-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.25" />
      <path
        d="M8 7.25v3.5M8 5.25v.5"
        stroke="currentColor"
        stroke-width="1.25"
        stroke-linecap="round"
      />
    </svg>
  </button>
  {#if open}
    <div
      role="note"
      class="absolute left-0 top-full z-20 mt-1 w-64 rounded-md border border-neutral-200 bg-white p-2.5 shadow-sm text-[13px] leading-snug text-neutral-600"
    >
      {@render children()}
    </div>
  {/if}
</div>
