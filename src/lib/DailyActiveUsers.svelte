<script lang="ts">
  import { onMount } from 'svelte'
  import { getFirestoreCollection } from '$lib/db/helpers.js'
  import TrendChart from '$lib/TrendChart.svelte'

  // One doc per month, written incrementally by the daily snapshot function.
  // Past months are frozen; only the current month still receives writes.
  type MonthDoc = {
    month: string // 'YYYY-MM'
    dailyActive?: Record<string, number> // dateISO -> DAU
    activeUids?: Record<string, string> // uid -> cohort, distinct actives this month
  }

  let months = $state.raw<MonthDoc[]>([])
  let loading = $state(true)
  let error = $state<string | null>(null)

  onMount(async () => {
    try {
      const docs = (await getFirestoreCollection('/analyticsMonthly')) as MonthDoc[]
      months = docs.sort((a, b) => a.month.localeCompare(b.month))
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      loading = false
    }
  })

  // DAU: flatten every month's dailyActive map into one date-sorted series.
  const dau = $derived(
    months
      .flatMap((m) => Object.entries(m.dailyActive ?? {}))
      .map(([date, count]) => ({ date, count }))
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
</script>

<section class="space-y-1">
  <h2 class="font-medium text-neutral-700">Daily active users</h2>

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
    <TrendChart series={dau} ariaLabel="Daily active users over time" />
  {/if}
</section>
