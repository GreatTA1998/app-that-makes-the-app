<script lang="ts">
  import { onMount } from 'svelte'
  import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore'
  import { httpsCallable } from 'firebase/functions'
  import { db, functions } from '$lib/db/init.js'
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
  type ErrorLog = {
    id: string
    subject?: string
    content?: string
    utc?: string // date only, e.g. '2026-07-07' — the logger doesn't record time of day
    timezone?: string
    userAgent?: string
  }
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
  let refreshing = $state(false)
  let refreshError = $state<string | null>(null)

  onMount(async () => {
    try {
      await loadProfiles()
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      loading = false
    }
  })

  async function loadProfiles () {
    const docs = (await getFirestoreCollection('/analytics')) as Profile[]
    profiles = docs
      .filter((d) => d.email) // no email = anonymous account from the home page
      .filter((d) => daysAgo(d.lastRefreshedAt) <= 31) // hide users inactive > 1 month
      .sort((a, b) =>
        // Rank by the same day buckets the table displays ("today", "1d ago", …),
        // then break ties by most recent cohort.
        daysAgo(a.lastRefreshedAt) - daysAgo(b.lastRefreshedAt) ||
        b.cohort.localeCompare(a.cohort)
      )
    loadDeltas()
  }

  // Re-copies live Auth lastRefreshTime into the profile docs (the daily
  // snapshot leaves them up to a day stale), then reloads the table.
  async function refreshActivity () {
    refreshing = true
    refreshError = null
    try {
      await httpsCallable(functions, 'refreshLastActive')()
      await loadProfiles()
    } catch (e) {
      refreshError = e instanceof Error ? e.message : String(e)
    } finally {
      refreshing = false
    }
  }

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
      const fetched = (await getFirestoreQuery(
        createFirestoreQuery({ collectionPath: '/errors', criteriaTerms: ['uid', '==', p.uid] })
      )) as ErrorLog[]
      logs = fetched.sort((a, b) => (b.utc ?? '').localeCompare(a.utc ?? ''))
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

  // Calendar days (in the viewer's timezone) since the timestamp, so "today"
  // means today and doesn't flip mid-afternoon like a rolling 24h window.
  // The display and sort must agree on this.
  function daysAgo (iso: string | null) {
    if (!iso) return Number.MAX_SAFE_INTEGER // "never" sorts last
    const then = new Date(iso)
    const now = new Date()
    const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    return Math.round((dayStart(now) - dayStart(then)) / 86_400_000)
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
    const days = daysAgo(iso)
    return days === 0 ? 'today' : `${days}d ago`
  }

  // Error logs only record a UTC calendar date (no time of day), so the finest
  // granularity we can show is whole days. Diff in UTC to match how it's stored.
  function errorAgo (utc: string | undefined) {
    if (!utc) return 'unknown date'
    const [y, m, d] = utc.split('-').map(Number)
    const now = new Date()
    const days = Math.round(
      (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.UTC(y, m - 1, d)) / 86_400_000
    )
    if (days <= 0) return 'today'
    if (days === 1) return 'yesterday'
    return `${days}d ago`
  }

  // Condense a raw user agent string into e.g. "iPhone · Safari".
  function describeAgent (ua: string) {
    if (/Googlebot/i.test(ua)) return 'Googlebot'
    const device =
      /iPhone/.test(ua) ? 'iPhone'
      : /iPad/.test(ua) ? 'iPad'
      : /Android/.test(ua) ? 'Android'
      : /Macintosh/.test(ua) ? 'Mac'
      : /Windows/.test(ua) ? 'Windows'
      : /bot|crawler|spider/i.test(ua) ? 'Bot'
      : null
    const browser =
      /CriOS|Chrome\//.test(ua) ? 'Chrome'
      : /FxiOS|Firefox\//.test(ua) ? 'Firefox'
      : /EdgiOS|Edg\//.test(ua) ? 'Edge'
      : /Safari\//.test(ua) ? 'Safari'
      : null
    if (device && browser) return `${device} · ${browser}`
    return device ?? browser ?? 'unknown device'
  }
</script>

<section class="space-y-2">
  <div class="flex items-baseline gap-3">
    <h1 class="text-lg font-semibold tracking-tight">Users</h1>
    <button
      type="button"
      class="rounded border border-neutral-200 px-2 py-0.5 text-[13px] text-neutral-500 hover:bg-neutral-50 disabled:opacity-50"
      disabled={refreshing}
      title="Re-copy current Auth activity into the profiles; task counts are untouched"
      onclick={refreshActivity}
    >{refreshing ? 'Refreshing…' : 'Refresh activity'}</button>
    {#if refreshError}
      <span class="text-[13px] text-red-600">Refresh failed: {refreshError}</span>
    {/if}
  </div>

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
              {#each [['User', 'text-left'], ['Active', 'text-right'], ['Tasks', 'text-right'], ['Δ 1d', 'text-right'], ['Cohort', 'text-right']] as [h, align] (h)}
                <th class="sticky top-0 z-10 px-2 py-1 {align} font-medium text-neutral-500 bg-neutral-50 border-b border-neutral-200">{h}</th>
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
                <td class="px-2 py-1 whitespace-nowrap text-right border-b border-neutral-100" title={p.lastRefreshedAt}>{ago(p.lastRefreshedAt)}</td>
                <td class="px-2 py-1 text-right border-b border-neutral-100">{p.taskCount}</td>
                <td
                  class="px-2 py-1 text-right border-b border-neutral-100 {(p.taskCountChange ?? 0) > 0 ? 'text-emerald-600' : (p.taskCountChange ?? 0) < 0 ? 'text-red-600' : 'text-neutral-400'}"
                  title="Tasks changed since yesterday's snapshot"
                >{delta(p.taskCountChange)}</td>
                <td class="px-2 py-1 text-right border-b border-neutral-100">{p.cohort}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <aside class="flex-1 min-w-0 max-h-[28rem] border border-neutral-200 rounded-md bg-white">
        {#if selected}
          <div class="flex h-full max-h-[28rem] items-stretch">
            <div class="w-80 shrink-0 overflow-y-auto p-3 space-y-2">
              <div class="font-mono text-[14px] space-y-0.5">
                <div class="break-all"><span class="text-neutral-500">uid:</span> {selected.uid}</div>
                <div class="break-all"><span class="text-neutral-500">email:</span> {selected.email ?? '(anonymous)'}</div>
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
            </div>

            <!-- Error logs get all remaining width and scroll independently,
                 so recent errors stay scannable regardless of the chart column. -->
            <div class="flex-1 min-w-0 overflow-y-auto border-l border-neutral-200 p-3 space-y-2">
              <h2 class="font-medium text-neutral-700">
                Error logs
                {#if !logsLoading && logs.length > 0}
                  <span class="font-normal text-neutral-400">({logs.length})</span>
                {/if}
              </h2>
              {#if logsLoading}
                <p class="text-[15px] text-neutral-500">Loading…</p>
              {:else if logs.length === 0}
                <p class="text-[15px] text-neutral-500">No errors logged for this user.</p>
              {:else}
                <!-- Shared header row: title, device/timezone metadata, and age.
                     The title truncates first (shrink 2); metadata truncates next. -->
                {#snippet logHeader(log: ErrorLog)}
                  <span class="min-w-0 shrink-[2] truncate">{log.subject || '(no subject)'}</span>
                  {#if log.userAgent}
                    <span class="min-w-0 truncate font-normal text-[12px] text-neutral-400" title={log.userAgent}>{describeAgent(log.userAgent)}</span>
                  {/if}
                  {#if log.timezone}
                    <span class="min-w-0 truncate font-normal text-[12px] text-neutral-400">{log.timezone}</span>
                  {/if}
                  <span class="ml-auto shrink-0 whitespace-nowrap font-normal text-[13px] text-neutral-400" title={log.utc}>{errorAgo(log.utc)}</span>
                {/snippet}
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
                          class="sticky top-0 z-10 flex w-full items-center gap-2 bg-white px-2 py-1.5 text-left font-medium hover:bg-neutral-50"
                          aria-expanded={expandedLogs[log.id] ?? false}
                          onclick={() => (expandedLogs[log.id] = !expandedLogs[log.id])}
                        >
                          <svg
                            class="size-3 shrink-0 text-neutral-400 transition-transform {expandedLogs[log.id] ? 'rotate-90' : ''}"
                            viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"
                          >
                            <path d="M4.5 2.5 8 6l-3.5 3.5z" />
                          </svg>
                          {@render logHeader(log)}
                        </button>
                      {:else}
                        <div class="flex items-center gap-2 px-2 py-1.5 font-medium">
                          {@render logHeader(log)}
                        </div>
                      {/if}
                      <pre class="mx-2 mb-2 whitespace-pre-wrap break-words font-mono text-[13px] text-neutral-700 bg-neutral-50 rounded p-2 {expandedLogs[log.id] ? '' : 'line-clamp-2'}">{content}</pre>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
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
