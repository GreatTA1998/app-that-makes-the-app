<script lang="ts">
  import { onMount } from 'svelte'
  import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore'
  import { db } from '$lib/db/init.js'
  import { getFirestoreCollection, getFirestoreQuery, createFirestoreQuery } from '$lib/db/helpers.js'
  import TrendChart from '$lib/TrendChart.svelte'

  // Profile docs at analytics/{uid}, refreshed by the daily snapshot function.
  type Profile = {
    uid: string
    email: string | null
    cohort: string
    lastRefreshedAt: string | null
    taskCount: number
    taskCountChange?: number | null
  }
  type ErrorLog = { id: string; subject?: string; content?: string }
  type TaskCountDoc = { dateISO: string; count: number }

  let profiles = $state.raw<Profile[]>([])
  let loading = $state(true)
  let error = $state<string | null>(null)
  let selected = $state<Profile | null>(null)
  let logs = $state.raw<ErrorLog[]>([])
  let logsLoading = $state(false)
  let expandedLogs = $state<Record<string, boolean>>({})
  let taskSeries = $state.raw<{ date: string; count: number }[]>([])
  let taskSeriesLoading = $state(false)

  onMount(async () => {
    try {
      const docs = (await getFirestoreCollection('/analytics')) as Profile[]
      profiles = docs
        .filter((d) => d.email) // no email = anonymous account from the home page
        .sort((a, b) =>
          // Last active is shown at day granularity, so compare days first,
          // then break ties by most recent cohort.
          dayFloor(b.lastRefreshedAt) - dayFloor(a.lastRefreshedAt) ||
          b.cohort.localeCompare(a.cohort)
        )
      loadDeltas()
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      loading = false
    }
  })

  // Δ 1d = difference between each user's two most recent daily snapshots.
  async function loadDeltas () {
    profiles = await Promise.all(
      profiles.map(async (p) => {
        const snap = await getDocs(
          query(collection(db, `analytics/${p.uid}/taskCounts`), orderBy('dateISO', 'desc'), limit(2))
        )
        const [latest, prev] = snap.docs.map((d) => d.data() as TaskCountDoc)
        return { ...p, taskCountChange: latest && prev ? latest.count - prev.count : null }
      })
    )
  }

  async function select (p: Profile) {
    selected = p
    expandedLogs = {}
    logsLoading = true
    taskSeriesLoading = true
    loadTaskSeries(p)
    try {
      logs = (await getFirestoreQuery(
        createFirestoreQuery({ collectionPath: '/errors', criteriaTerms: ['uid', '==', p.uid] })
      )) as ErrorLog[]
    } finally {
      logsLoading = false
    }
  }

  async function loadTaskSeries (p: Profile) {
    try {
      const docs = (await getFirestoreCollection(`/analytics/${p.uid}/taskCounts`)) as TaskCountDoc[]
      const series = docs
        .map((d) => ({ date: d.dateISO, count: d.count }))
        .sort((a, b) => a.date.localeCompare(b.date))
      // A later click may have superseded this request.
      if (selected?.uid === p.uid) taskSeries = series
    } finally {
      if (selected?.uid === p.uid) taskSeriesLoading = false
    }
  }

  function dayFloor (iso: string | null) {
    return iso ? Math.floor(Date.parse(iso) / 86_400_000) : -1
  }

  // Rough check for whether the content would exceed the 2-line clamp.
  function isClampable (content: string | undefined) {
    if (!content) return false
    return content.split('\n').length > 2 || content.length > 160
  }

  function delta (n: number | null | undefined) {
    if (n == null) return '—'
    if (n > 0) return `+${n}`
    return String(n)
  }

  function ago (iso: string | null) {
    if (!iso) return 'never'
    const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
    return days === 0 ? 'today' : `${days}d ago`
  }
</script>

<section class="space-y-2">
  <h1 class="text-lg font-semibold tracking-tight">Users</h1>

  {#if loading}
    <p class="text-[15px] text-neutral-500">Loading…</p>
  {:else if error}
    <p class="text-[15px] text-red-600">Failed to load: {error}</p>
  {:else if profiles.length === 0}
    <p class="text-[15px] text-neutral-500">
      No profiles yet. The nightly snapshot writes them to
      <code class="font-mono text-[14px]">analytics/&#123;uid&#125;</code>.
    </p>
  {:else}
    <div class="flex items-start gap-3">
      <div class="min-w-0 w-fit max-w-full max-h-[28rem] overflow-y-auto border border-neutral-200 rounded-md bg-white">
        <table class="border-separate border-spacing-0 font-mono text-[14px] tabular-nums">
          <thead>
            <tr>
              {#each ['User', 'Cohort', 'Last active', 'Tasks', 'Δ 1d'] as h (h)}
                <th class="sticky top-0 z-10 px-2 py-1 text-left font-medium text-neutral-500 bg-neutral-50 border-b border-neutral-200">{h}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each profiles as p (p.uid)}
              <tr
                class="cursor-pointer hover:bg-neutral-50 {selected?.uid === p.uid ? 'bg-blue-50 text-blue-900' : ''}"
                onclick={() => select(p)}
              >
                <td class="px-2 py-1 border-b border-neutral-100">
                  <div class="max-w-64 truncate" title={p.email ?? p.uid}>{p.email ?? p.uid}</div>
                </td>
                <td class="px-2 py-1 border-b border-neutral-100">{p.cohort}</td>
                <td class="px-2 py-1 whitespace-nowrap border-b border-neutral-100" title={p.lastRefreshedAt}>{ago(p.lastRefreshedAt)}</td>
                <td class="px-2 py-1 text-right border-b border-neutral-100">{p.taskCount}</td>
                <td
                  class="px-2 py-1 text-right border-b border-neutral-100 {(p.taskCountChange ?? 0) > 0 ? 'text-emerald-600' : (p.taskCountChange ?? 0) < 0 ? 'text-red-600' : 'text-neutral-400'}"
                  title="Tasks changed since yesterday's snapshot"
                >{delta(p.taskCountChange)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <aside class="w-96 shrink-0 max-h-[28rem] overflow-y-auto border border-neutral-200 rounded-md bg-white">
        {#if selected}
          <div class="p-3 space-y-2">
            <div class="font-mono text-[14px] space-y-0.5">
              <div><span class="text-neutral-500">uid:</span> {selected.uid}</div>
              <div><span class="text-neutral-500">email:</span> {selected.email ?? '(anonymous)'}</div>
              <div><span class="text-neutral-500">lastRefreshedAt:</span> {selected.lastRefreshedAt ?? 'never'}</div>
            </div>

            <h2 class="font-medium text-neutral-700">Tasks over time</h2>
            {#if taskSeriesLoading}
              <p class="text-[15px] text-neutral-500">Loading…</p>
            {:else if taskSeries.length === 0}
              <p class="text-[15px] text-neutral-500">No daily snapshots yet for this user.</p>
            {:else}
              <TrendChart series={taskSeries} ariaLabel="Total tasks over time for {selected.email ?? selected.uid}" />
            {/if}

            <h2 class="font-medium text-neutral-700">Error logs</h2>
            {#if logsLoading}
              <p class="text-[15px] text-neutral-500">Loading…</p>
            {:else if logs.length === 0}
              <p class="text-[15px] text-neutral-500">No errors logged for this user.</p>
            {:else}
              <ul class="divide-y divide-neutral-200 border border-neutral-200 rounded-md">
                {#each logs as log (log.id)}
                  <!-- Some loggers write content with leading/trailing newlines;
                       trim so the clamp preview doesn't waste a line on it. -->
                  {@const content = (log.content ?? '').trim()}
                  <li>
                    {#if isClampable(content)}
                      <!-- Sticky disclosure header: stays pinned while scrolling an
                           expanded log, so it can be collapsed without scrolling back. -->
                      <button
                        type="button"
                        class="sticky top-0 z-10 flex w-full items-center gap-1.5 bg-white px-2 py-1.5 text-left font-medium hover:bg-neutral-50"
                        aria-expanded={expandedLogs[log.id] ?? false}
                        onclick={() => (expandedLogs[log.id] = !expandedLogs[log.id])}
                      >
                        <svg
                          class="size-3 shrink-0 text-neutral-400 transition-transform {expandedLogs[log.id] ? 'rotate-90' : ''}"
                          viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"
                        >
                          <path d="M4.5 2.5 8 6l-3.5 3.5z" />
                        </svg>
                        <span class="truncate">{log.subject || '(no subject)'}</span>
                      </button>
                    {:else}
                      <div class="px-2 py-1.5 font-medium">{log.subject || '(no subject)'}</div>
                    {/if}
                    <pre class="mx-2 mb-2 whitespace-pre-wrap break-words font-mono text-[13px] text-neutral-700 bg-neutral-50 rounded p-2 {expandedLogs[log.id] ? '' : 'line-clamp-2'}">{content}</pre>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {:else}
          <div class="flex h-full min-h-40 items-center justify-center p-3">
            <p class="text-[15px] text-neutral-400">Select a user to inspect</p>
          </div>
        {/if}
      </aside>
    </div>
  {/if}
</section>
