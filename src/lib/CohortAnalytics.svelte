<script lang="ts">
  import { onMount } from 'svelte'
  import { getFirestoreCollection } from '$lib/db/helpers.js'

  // One doc per month, written incrementally by the daily snapshot function.
  // Past months are frozen; only the current month still receives writes.
  type MonthDoc = {
    month: string // 'YYYY-MM'
    conversionByCohort?: Record<string, { total: number; converted: number }>
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

  // Conversion: each cohort is read from its own month doc, so the number is
  // frozen at that month's end (late converters are intentionally ignored).
  const conversion = $derived(
    months
      .map((m) => ({ cohort: m.month, ...m.conversionByCohort?.[m.month] }))
      .filter((c) => (c.total ?? 0) > 0) as { cohort: string; total: number; converted: number }[]
  )
</script>

<section class="space-y-1 min-w-0">
  <h2 class="font-medium text-neutral-700">Home page conversion</h2>
  {#if loading}
    <p class="text-[15px] text-neutral-500">Loading…</p>
  {:else if error}
    <p class="text-[15px] text-red-600">Failed to load: {error}</p>
  {:else if conversion.length === 0}
    <p class="text-[15px] text-neutral-500">
      No data yet. The nightly snapshot writes to
      <code class="font-mono text-[14px]">analyticsMonthly/&#123;YYYY-MM&#125;</code> — run it once to seed today.
    </p>
  {:else}
    <table class="border-collapse font-mono text-[14px] tabular-nums">
      <thead>
        <tr>
          {#each ['Cohort', 'Visits', 'Sign-ups', 'Rate'] as h (h)}
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
  {/if}
</section>
