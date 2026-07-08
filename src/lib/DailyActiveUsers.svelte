<script lang="ts">
  import { onMount } from 'svelte'
  import { getFirestoreCollection } from '$lib/db/helpers.js'
  import StackedTrendChart from '$lib/StackedTrendChart.svelte'

  // One doc per month, written incrementally by the daily snapshot function.
  // Past months are frozen; only the current month still receives writes.
  type MonthDoc = {
    month: string // 'YYYY-MM'
    dailyActive?: Record<string, number> // dateISO -> DAU
    dailyActiveByCohort?: Record<string, Record<string, number>> // dateISO -> cohort -> count
    activeUids?: Record<string, string> // uid -> cohort, distinct actives this month
  }

  // Profile docs at analytics/{uid}, refreshed by the daily snapshot function.
  type Profile = {
    uid: string
    email: string | null
    cohort: string
  }

  // Days snapshotted before dailyActiveByCohort existed have a total but no
  // breakdown; they render as one neutral band pinned under the real cohorts.
  const UNKNOWN = 'unknown'

  let months = $state.raw<MonthDoc[]>([])
  let profiles = $state.raw<Profile[]>([])
  let loading = $state(true)
  let error = $state<string | null>(null)
  // Band clicks scope to that month; legend clicks span all months (month: null).
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

  // One date-sorted series across all months: total DAU plus its cohort
  // breakdown (or the whole count as "unknown" when no breakdown was stored).
  const dau = $derived(
    months
      .flatMap((m) =>
        Object.entries(m.dailyActive ?? {}).map(([date, count]) => ({
          date,
          count,
          counts: m.dailyActiveByCohort?.[date] ?? { [UNKNOWN]: count },
        }))
      )
      .sort((a, b) => a.date.localeCompare(b.date))
  )
  const latest = $derived(dau.at(-1))

  // Growth rate: distinct actives this month vs last month. The current month
  // is partial, so this reads low until the month closes.
  const monthlyActives = $derived(
    months
      .map((m) => ({ month: m.month, count: Object.keys(m.activeUids ?? {}).length }))
      .filter((m) => m.count > 0)
  )
  const thisMonth = $derived(monthlyActives.at(-1))
  const lastMonth = $derived(monthlyActives.at(-2))
  const momDelta = $derived(thisMonth && lastMonth ? thisMonth.count - lastMonth.count : null)
  const momPct = $derived(
    momDelta !== null && lastMonth && lastMonth.count > 0
      ? (momDelta / lastMonth.count) * 100
      : null
  )

  // Global chronologically-sorted cohort list ('YYYY-MM' sorts lexicographically).
  // Every day stacks in this order, so the oldest cohort is always the bottom
  // band, new cohorts only ever appear on top, and colors never shuffle.
  const cohorts = $derived(
    [
      ...new Set([
        ...months.flatMap((m) => Object.values(m.activeUids ?? {})),
        ...dau.flatMap((d) => Object.keys(d.counts)),
      ]),
    ]
      .filter((c) => c !== UNKNOWN)
      .sort()
  )

  // Curated categorical palette (Tailwind 500s): hues spread across the wheel
  // but at matched saturation/lightness, so bands read as one family
  // instead of raw HSL hue rotation.
  const palette = [
    '#6366f1', // indigo
    '#14b8a6', // teal
    '#f59e0b', // amber
    '#f43f5e', // rose
    '#0ea5e9', // sky
    '#10b981', // emerald
    '#a855f7', // purple
    '#f97316', // orange
  ]

  function cohortColor (cohort: string) {
    if (cohort === UNKNOWN) return '#d4d4d4' // neutral-300
    return palette[cohorts.indexOf(cohort) % palette.length]
  }

  function toggleCohort (cohort: string, month: string | null = null) {
    selected =
      selected?.cohort === cohort && selected?.month === month ? null : { cohort, month }
  }

  const profilesByUid = $derived(new Map(profiles.map((p) => [p.uid, p])))

  // Members come from the same activeUids maps used for monthly growth, so the
  // panel shows distinct actives for the scoped month(s), not the whole cohort.
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
</script>

<section class="space-y-1 min-w-0 lg:col-span-2">
  <h2 class="font-medium text-neutral-700">Daily active users by cohort</h2>

  {#if loading}
    <p class="text-[15px] text-neutral-500">Loading…</p>
  {:else if error}
    <p class="text-[15px] text-red-600">Failed to load: {error}</p>
  {:else if dau.length === 0}
    <p class="text-[15px] text-neutral-500">
      No DAU data yet — it appears after the next nightly snapshot run.
    </p>
  {:else}
    {#if latest}
      <div class="flex items-baseline gap-2">
        <span class="text-4xl font-semibold tabular-nums tracking-tight">{latest.count}</span>
        {#if momDelta !== null}
          <span
            class="text-[13px] font-mono {momDelta >= 0 ? 'text-green-700' : 'text-red-600'}"
            title="Distinct active users this month vs last month (current month is partial)"
          >
            {momDelta >= 0 ? '+' : ''}{momDelta}{#if momPct !== null}
              ({momPct >= 0 ? '+' : ''}{momPct.toFixed(1)}%){/if} actives MoM
          </span>
        {:else}
          <span
            class="text-[13px] font-mono text-neutral-400"
            title="Needs two months of snapshot data to compare"
          >
            — (—%) actives MoM
          </span>
        {/if}
        <span class="text-[13px] text-neutral-500 font-mono">on {latest.date}</span>
      </div>
    {/if}

    <div class="flex items-start gap-4">
      <div class="space-y-1 min-w-0 grow">
        <StackedTrendChart
          series={dau}
          layers={[UNKNOWN, ...cohorts]}
          colorFor={cohortColor}
          selected={selected?.cohort ?? null}
          onselectlayer={(cohort, month) => {
            if (cohort !== UNKNOWN) toggleCohort(cohort, month)
          }}
          ariaLabel="Daily active users over time, stacked by signup cohort"
        />
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
        <div class="w-fit min-w-0 shrink-0 border border-neutral-200 rounded-md bg-white p-2 space-y-1">
          <div class="flex items-center gap-2 text-[13px]">
            <span class="w-3 h-3 rounded-sm inline-block" style:background={cohortColor(selected.cohort)}></span>
            <span class="text-neutral-500">
              {cohortMembers.length} active {selected.month ? `in ${selected.month}` : ''}
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
  {/if}
</section>
