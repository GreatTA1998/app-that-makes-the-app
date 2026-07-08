<script lang="ts">
  import { onMount } from 'svelte'
  import { collectionGroup, getDocs } from 'firebase/firestore'
  import { httpsCallable } from 'firebase/functions'
  import { db, functions } from '$lib/db/init.js'

  type TaskCount = {
    uid: string
    email?: string | null
    dateISO: string
    count: number
  }
  type SnapshotRunResult = { users: number; totalTasks: number; dau: number; dateISO: string }

  // Header label budget. 8 chars + ellipsis fits a lot of columns; bump if you
  // have long local-parts that collide.
  const MAX_LABEL = 8

  function shortLabel (email: string | undefined, uid: string) {
    const local = (email ?? uid).split('@')[0]
    return local.length > MAX_LABEL ? local.slice(0, MAX_LABEL) + '…' : local
  }

  let taskCounts = $state.raw<TaskCount[]>([])
  let loading = $state(true)
  let error = $state<string | null>(null)
  let running = $state(false)
  let runError = $state<string | null>(null)
  let lastRun = $state<SnapshotRunResult | null>(null)

  async function loadTaskCounts () {
    const result = await getDocs(collectionGroup(db, 'taskCounts'))
    // Drop records with no email — these are placeholder/anonymous accounts
    // we don't want cluttering the analytics view.
    taskCounts = result.docs
      .map((d) => d.data() as TaskCount)
      .filter((tc) => typeof tc.email === 'string' && tc.email.trim() !== '')
  }

  onMount(async () => {
    try {
      await loadTaskCounts()
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      loading = false
    }
  })

  async function runSnapshotNow () {
    running = true
    runError = null
    try {
      const call = httpsCallable<void, SnapshotRunResult>(
        functions,
        'runTaskCountSnapshotNow'
      )
      const { data } = await call()
      lastRun = data
      await loadTaskCounts()
    } catch (e) {
      runError = e instanceof Error ? e.message : String(e)
    } finally {
      running = false
    }
  }

  const pivot = $derived.by(() => {
    const grid: Record<string, Record<string, number>> = {}
    const dateSet = new Set<string>()
    const totalsByDate: Record<string, number> = {}
    const emailByUid: Record<string, string> = {}

    for (const s of taskCounts) {
      dateSet.add(s.dateISO)
      if (!grid[s.uid]) grid[s.uid] = {}
      grid[s.uid][s.dateISO] = s.count
      totalsByDate[s.dateISO] = (totalsByDate[s.dateISO] ?? 0) + s.count
      if (s.email) emailByUid[s.uid] = s.email
    }

    const dates = [...dateSet].sort().reverse()

    // Each user's most recent count (walks dates newest->oldest), used to
    // order columns from most tasks to least.
    const latestByUid: Record<string, number> = {}
    for (const uid of Object.keys(grid)) {
      for (const date of dates) {
        const v = grid[uid][date]
        if (v !== undefined) {
          latestByUid[uid] = v
          break
        }
      }
    }
    const uids = Object.keys(grid).sort(
      (a, b) => (latestByUid[b] ?? 0) - (latestByUid[a] ?? 0)
    )

    return { grid, dates, uids, totalsByDate, emailByUid }
  })
</script>

<div class="flex items-center gap-3 mb-2 text-[15px]">
  <h1 class="text-lg font-semibold tracking-tight">User Analytics</h1>

  <button
    class="px-2.5 py-1 text-[15px] border border-neutral-200 rounded-md bg-white text-neutral-900 disabled:opacity-50"
    onclick={runSnapshotNow}
    disabled={running || loading}
  >
    {running ? 'Running…' : 'Run snapshot now'}
  </button>
  {#if lastRun}
    <span class="text-neutral-500">
      Last run: {lastRun.users} users, {lastRun.totalTasks} tasks, {lastRun.dau} active ({lastRun.dateISO})
    </span>
  {/if}
  {#if runError}
    <span class="text-red-600">Run failed: {runError}</span>
  {/if}
</div>

{#if loading}
  <p class="text-[15px] text-neutral-500">Loading…</p>
{:else if error}
  <p class="text-[15px] text-red-600">Failed to load: {error}</p>
{:else if taskCounts.length === 0}
  <p class="text-[15px] text-neutral-500">
    No snapshots yet. Click <strong class="font-medium text-neutral-900">Run snapshot now</strong> above, or wait for
    <code class="font-mono text-[14px]">dailyTaskCountSnapshot</code> to write to
    <code class="font-mono text-[14px]">analytics/&#123;uid&#125;/taskCounts</code>.
  </p>
{:else}
  <table class="border-collapse font-mono text-[14px] tabular-nums">
    <thead>
      <tr>
        <th class="px-2 py-0.5 text-left font-medium text-neutral-500 bg-neutral-50 border-b border-neutral-200 sticky top-0 left-0 z-10">Date</th>
        {#each pivot.uids as uid (uid)}
          <th
            class="px-2 py-0.5 text-right font-medium text-neutral-500 bg-neutral-50 border-b border-neutral-200 sticky top-0 whitespace-nowrap"
            title={pivot.emailByUid[uid] ?? uid}
          >
            {shortLabel(pivot.emailByUid[uid], uid)}
          </th>
        {/each}
        <th class="px-2 py-0.5 text-right font-medium text-neutral-900 bg-neutral-50 border-b border-neutral-200 border-l border-l-neutral-200 sticky top-0">All</th>
      </tr>
    </thead>
    <tbody>
      {#each pivot.dates as date (date)}
        <tr>
          <td class="px-2 py-0.5 text-left text-neutral-500 bg-white sticky left-0 whitespace-nowrap">{date}</td>
          {#each pivot.uids as uid (uid)}
            {@const v = pivot.grid[uid]?.[date]}
            <td class="px-2 py-0.5 text-right whitespace-nowrap">{v ?? ''}</td>
          {/each}
          <td class="px-2 py-0.5 text-right font-medium text-neutral-900 border-l border-neutral-200 whitespace-nowrap">{pivot.totalsByDate[date]}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
