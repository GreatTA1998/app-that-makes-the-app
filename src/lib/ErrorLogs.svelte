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
    utc?: string // date only, e.g. '2026-07-07' — the logger doesn't record time of day
  }

  let logs = $state.raw<ErrorLog[]>([])
  let loading = $state(true)
  let error = $state<string | null>(null)
  let expanded = $state<Record<string, boolean>>({})

  // Error logs only record a UTC calendar date (no time of day), so the finest
  // granularity we can show is whole days. Diff in UTC to match how it's stored.
  function errorAgo (utc: string | undefined) {
    if (!utc) return ''
    const [y, m, d] = utc.split('-').map(Number)
    if (!y || !m || !d) return utc
    const now = new Date()
    const days = Math.round(
      (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.UTC(y, m - 1, d)) / 86_400_000
    )
    if (days <= 0) return 'today'
    if (days === 1) return 'yesterday'
    return `${days}d ago`
  }

  async function load () {
    loading = true
    error = null
    try {
      const fetched = (await getFirestoreCollection('/errors')) as ErrorLog[]
      // getFirestoreCollection has no orderBy — sort newest-first by utc date string
      logs = fetched.sort((a, b) => (b.utc ?? '').localeCompare(a.utc ?? ''))
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
            {#if log.utc}
              <span class="shrink-0 whitespace-nowrap text-[14px] text-neutral-400" title={log.utc}>{errorAgo(log.utc)}</span>
            {/if}
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
            <div class="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-neutral-400 font-mono">
              <span>{log.id}</span>
              {#if log.utc}
                <span title={log.utc}>{log.utc}</span>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>
