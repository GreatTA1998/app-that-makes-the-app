<script lang="ts">
  import { onMount } from 'svelte'
  import { getFirestoreCollection } from '$lib/db/helpers.js'

  // One doc per month, written incrementally by the daily snapshot function.
  // Past months are frozen; only the current month still receives writes.
  type MonthDoc = {
    month: string // 'YYYY-MM'
    dailyActive?: Record<string, number> // dateISO -> DAU
    activeUids?: Record<string, string> // uid -> cohort, distinct actives this month
    conversionByCohort?: Record<string, { total: number; converted: number }>
  }

  // Profile docs at analytics/{uid}, refreshed by the daily snapshot function.
  type Profile = {
    uid: string
    email: string | null
    cohort: string
  }

  let months = $state.raw<MonthDoc[]>([])
  let profiles = $state.raw<Profile[]>([])
  let loading = $state(true)
  let error = $state<string | null>(null)
  // Segment clicks scope to that month; legend clicks span all months (month: null).
  let selected = $state<{ cohort: string; month: string | null } | null>(null)

  onMount(async () => {
    try {
      const [monthDocs, profileDocs] = await Promise.all([
        getFirestoreCollection('/analyticsMonthly'),
        getFirestoreCollection('/analytics'),
      ])
      months = (monthDocs as MonthDoc[]).sort((a, b) => a.month.localeCompare(b.month))
      // No email = anonymous account (or a stale pre-cleanup profile doc).
      profiles = (profileDocs as Profile[]).filter((p) => p.email)
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      loading = false
    }
  })

  function toggleCohort (cohort: string, month: string | null = null) {
    selected =
      selected?.cohort === cohort && selected?.month === month ? null : { cohort, month }
  }

  const profilesByUid = $derived(new Map(profiles.map((p) => [p.uid, p])))

  // Members come from the same activeUids maps the cake is drawn from, so the
  // panel always matches the chart: actives only, not the whole signup cohort.
  const cohortMembers = $derived.by(() => {
    if (!selected) return []
    const { cohort: selectedCohort, month: selectedMonth } = selected
    const uids = months
      .filter((m) => !selectedMonth || m.month === selectedMonth)
      .flatMap((m) =>
        Object.entries(m.activeUids ?? {})
          .filter(([, cohort]) => cohort === selectedCohort)
          .map(([uid]) => uid)
      )
    return [...new Set(uids)]
      .map((uid) => ({ uid, email: profilesByUid.get(uid)?.email ?? uid }))
      .sort((a, b) => a.email.localeCompare(b.email))
  })

  const cohorts = $derived(
    [...new Set(months.flatMap((m) => Object.values(m.activeUids ?? {})))].sort()
  )

  function cohortColor (cohort: string) {
    return `hsl(${(cohorts.indexOf(cohort) * 67) % 360} 65% 55%)`
  }

  // Layer cake: distinct active users per cohort, per month.
  const cake = $derived(
    months.map((m) => {
      const counts: Record<string, number> = {}
      for (const cohort of Object.values(m.activeUids ?? {})) {
        counts[cohort] = (counts[cohort] ?? 0) + 1
      }
      return { month: m.month, counts, total: Object.keys(m.activeUids ?? {}).length }
    })
  )
  const maxCakeTotal = $derived(Math.max(1, ...cake.map((c) => c.total)))

  // Conversion: each cohort is read from its own month doc, so the number is
  // frozen at that month's end (late converters are intentionally ignored).
  const conversion = $derived(
    months
      .map((m) => ({ cohort: m.month, ...m.conversionByCohort?.[m.month] }))
      .filter((c) => (c.total ?? 0) > 0) as { cohort: string; total: number; converted: number }[]
  )
</script>

<!-- display: contents — the subsections below become cells of the parent grid
     so the page can position them as separate quadrants. -->
<section class="contents">
  {#if loading}
    <p class="text-[15px] text-neutral-500">Loading…</p>
  {:else if error}
    <p class="text-[15px] text-red-600">Failed to load: {error}</p>
  {:else if months.length === 0}
    <p class="text-[15px] text-neutral-500">
      No data yet. The nightly snapshot writes to
      <code class="font-mono text-[14px]">analyticsMonthly/&#123;YYYY-MM&#125;</code> — run it once to seed today.
    </p>
  {:else}
    <div class="space-y-1 min-w-0">
      <h2 class="font-medium text-neutral-700">Layer cake — monthly actives by signup cohort</h2>
      <div class="flex items-start gap-4">
        <div class="space-y-1 shrink-0">
          <div class="flex items-end gap-2 h-40">
            {#each cake as c (c.month)}
              <div class="flex flex-col-reverse w-12" style:height="{(c.total / maxCakeTotal) * 100}%">
                {#each cohorts as cohort (cohort)}
                  {#if c.counts[cohort]}
                    <button
                      type="button"
                      class="block w-full border-0 p-0 cursor-pointer transition-opacity {selected && selected.cohort !== cohort ? 'opacity-30' : ''}"
                      style:background={cohortColor(cohort)}
                      style:flex-grow={c.counts[cohort]}
                      title="{c.month} · cohort {cohort}: {c.counts[cohort]} active"
                      aria-pressed={selected?.cohort === cohort && selected?.month === c.month}
                      onclick={() => toggleCohort(cohort, c.month)}
                    ></button>
                  {/if}
                {/each}
              </div>
            {/each}
          </div>
          <div class="flex gap-2 font-mono text-[11px] text-neutral-500">
            {#each cake as c (c.month)}
              <div class="w-12 text-center whitespace-nowrap" title="{c.total} active">{c.month}</div>
            {/each}
          </div>
          <div class="flex flex-wrap gap-1.5 text-[13px]">
            {#each cohorts as cohort (cohort)}
              <button
                type="button"
                class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border cursor-pointer
                  {selected?.cohort === cohort
                    ? 'border-neutral-400 bg-neutral-100'
                    : 'border-transparent hover:bg-neutral-50'}"
                aria-pressed={selected?.cohort === cohort}
                onclick={() => toggleCohort(cohort)}
              >
                <span class="w-3 h-3 rounded-sm inline-block" style:background={cohortColor(cohort)}></span>
                {cohort}
              </button>
            {/each}
          </div>
        </div>
        {#if selected}
          <div class="w-fit min-w-0 border border-neutral-200 rounded-md bg-white p-2 space-y-1">
            <div class="flex items-center gap-2 text-[13px]">
              <span class="w-3 h-3 rounded-sm inline-block" style:background={cohortColor(selected.cohort)}></span>
              <span class="font-medium">Cohort {selected.cohort}</span>
              <span class="text-neutral-500">
                {cohortMembers.length} active {selected.month ? `in ${selected.month}` : 'across all months shown'}
              </span>
            </div>
            {#if cohortMembers.length === 0}
              <p class="text-[13px] text-neutral-500">No active users from this cohort.</p>
            {:else}
              <ul class="font-mono text-[13px] text-neutral-700">
                {#each cohortMembers as member (member.uid)}
                  <li class="max-w-80 truncate" title={member.email}>{member.email}</li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
      </div>
    </div>

    <div class="space-y-1 min-w-0">
      <h2 class="font-medium text-neutral-700">Home page conversion</h2>
      <table class="border-collapse font-mono text-[14px] tabular-nums">
        <thead>
          <tr>
            {#each ['Cohort', 'Visitors', 'Converted', 'Rate'] as h (h)}
              <th class="px-2 py-0.5 text-left font-medium text-neutral-500 bg-neutral-50 border-b border-neutral-200">{h}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each conversion as c (c.cohort)}
            <tr>
              <td class="px-2 py-0.5">{c.cohort}</td>
              <td class="px-2 py-0.5 text-right">{c.total}</td>
              <td class="px-2 py-0.5 text-right">{c.converted}</td>
              <td class="px-2 py-0.5 text-right">{((c.converted / c.total) * 100).toFixed(1)}%</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
