<script lang="ts">
  import { onMount } from 'svelte'
  import { getFirestoreCollection, deleteFirestoreDoc } from '$lib/db/helpers.js'

  type ErrorLog = {
    id: string
    path: string
    subject?: string
    content?: string
    uid?: string
    email?: string
  }

  let logs = $state.raw<ErrorLog[]>([])
  let loading = $state(true)
  let error = $state<string | null>(null)
  let expanded = $state<Record<string, boolean>>({})

  async function load () {
    loading = true
    error = null
    try {
      logs = (await getFirestoreCollection('/errors')) as ErrorLog[]
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      loading = false
    }
  }

  async function remove (log: ErrorLog) {
    if (!confirm(`Delete this error log?\n\n${log.subject ?? '(no subject)'}`)) return
    await deleteFirestoreDoc(log.path)
    logs = logs.filter((l) => l.id !== log.id)
  }

  onMount(load)
</script>

<section class="space-y-2">
  <div class="flex items-center gap-3">
    <h1 class="text-lg font-semibold tracking-tight">Error logs</h1>
    <button
      class="px-2.5 py-1 text-[15px] border border-neutral-200 rounded-md bg-white text-neutral-900 disabled:opacity-50"
      onclick={load}
      disabled={loading}
    >
      {loading ? 'Loading…' : 'Refresh'}
    </button>
    <span class="text-neutral-500">{logs.length} {logs.length === 1 ? 'log' : 'logs'}</span>
  </div>

  {#if loading && logs.length === 0}
    <p class="text-[15px] text-neutral-500">Loading…</p>
  {:else if error}
    <p class="text-[15px] text-red-600">Failed to load: {error}</p>
  {:else if logs.length === 0}
    <p class="text-[15px] text-neutral-500">No errors logged.</p>
  {:else}
    <ul class="divide-y divide-neutral-200 border border-neutral-200 rounded-md bg-white">
      {#each logs as log (log.id)}
        <li class="p-3 space-y-1">
          <div class="flex items-baseline gap-2">
            <button
              class="text-left font-medium text-neutral-900 hover:underline flex-1"
              onclick={() => (expanded[log.id] = !expanded[log.id])}
            >
              {log.subject || '(no subject)'}
            </button>
            <span class="text-neutral-500 text-[14px]">{log.email || log.uid || 'anonymous'}</span>
            <button
              class="px-2 py-0.5 text-[13px] border border-neutral-200 rounded-md bg-white text-neutral-600 hover:text-red-600"
              onclick={() => remove(log)}
              title="Delete"
            >
              ✕
            </button>
          </div>

          {#if expanded[log.id]}
            <pre class="whitespace-pre-wrap break-words font-mono text-[13px] text-neutral-700 bg-neutral-50 border border-neutral-200 rounded p-2">{log.content ?? ''}</pre>
            <div class="text-[12px] text-neutral-400 font-mono">{log.id}</div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>
