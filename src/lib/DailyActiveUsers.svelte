<script lang="ts">
  import { onMount } from 'svelte'
  import { getFirestoreCollection } from '$lib/db/helpers.js'
  import MetricInfo from '$lib/MetricInfo.svelte'

  // One doc per month, written incrementally by the daily snapshot function.
  // Past months are frozen; only the current month still receives writes.
  type MonthDoc = {
    month: string // 'YYYY-MM'
    dailyActiveUids?: Record<string, Record<string, string>> // dateISO -> uid -> cohort
  }

  // Profile docs at analytics/{uid}, refreshed by the daily snapshot function.
  type Profile = {
    uid: string
    email: string | null
    cohort: string
  }

  type StackPoint = { date: string; y0: number; y1: number; count: number }

  let months = $state.raw<MonthDoc[]>([])
  let profiles = $state.raw<Profile[]>([])
  let loading = $state(true)
  let error = $state<string | null>(null)
  // Layer clicks scope to that day; legend clicks span all days (date: null).
  let selected = $state<{ cohort: string; date: string | null } | null>(null)
  let hoverDayIdx = $state<number | null>(null)

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

  function toggleCohort (cohort: string, date: string | null = null) {
    selected =
      selected?.cohort === cohort && selected?.date === date ? null : { cohort, date }
  }

  const profilesByUid = $derived(new Map(profiles.map((p) => [p.uid, p])))

  // One entry per snapshotted day: who was active, stacked counts per cohort.
  const days = $derived(
    months
      .flatMap((m) => Object.entries(m.dailyActiveUids ?? {}))
      .map(([date, uids]) => {
        const counts: Record<string, number> = {}
        for (const cohort of Object.values(uids)) {
          counts[cohort] = (counts[cohort] ?? 0) + 1
        }
        return { date, uids, counts, dau: Object.keys(uids).length }
      })
      .sort((a, b) => a.date.localeCompare(b.date))
  )
  const latest = $derived(days.at(-1))

  const cohorts = $derived(
    [...new Set(days.flatMap((d) => Object.values(d.uids)))].sort()
  )

  // Growth rate: distinct actives this month (union of its days) vs last month.
  // The current month is partial, so this reads low until the month closes.
  const monthlyActives = $derived(
    months
      .map((m) => ({
        month: m.month,
        count: new Set(
          Object.values(m.dailyActiveUids ?? {}).flatMap((uids) => Object.keys(uids))
        ).size,
      }))
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

  // Members come from the same dailyActiveUids maps the layers are drawn from,
  // so the panel always matches the chart.
  const cohortMembers = $derived.by(() => {
    if (!selected) return []
    const { cohort: selectedCohort, date: selectedDate } = selected
    const uids = days
      .filter((d) => !selectedDate || d.date === selectedDate)
      .flatMap((d) =>
        Object.entries(d.uids)
          .filter(([, cohort]) => cohort === selectedCohort)
          .map(([uid]) => uid)
      )
    return [...new Set(uids)]
      .map((uid) => ({ uid, email: profilesByUid.get(uid)?.email ?? uid }))
      .sort((a, b) => a.email.localeCompare(b.email))
  })

  // Curated categorical palette (Tailwind 500s): hues spread across the wheel
  // but at matched saturation/lightness, so segments read as one family
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
    return palette[cohorts.indexOf(cohort) % palette.length]
  }

  // Plot height tracks the stack (not a fixed empty frame), so sparse days
  // still read as a cake rather than a thin ribbon in a tall box.
  const PLOT_MAX_H = 160
  // Fixed px-per-calendar-day: each month gets a comparable ~280–310px share.
  const PX_PER_DAY = 10
  const MS_PER_DAY = 86_400_000
  const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  function dayOrdinal (iso: string) {
    const [y, m, d] = iso.split('-').map(Number)
    return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY)
  }

  function monthStartOrd (iso: string) {
    const [y, m] = iso.split('-').map(Number)
    return dayOrdinal(`${y}-${String(m).padStart(2, '0')}-01`)
  }

  function monthEndOrd (iso: string) {
    const [y, m] = iso.split('-').map(Number)
    const nextM = m === 12 ? 1 : m + 1
    const nextY = m === 12 ? y + 1 : y
    return dayOrdinal(`${nextY}-${String(nextM).padStart(2, '0')}-01`) - 1
  }

  function addMonths (iso: string, delta: number) {
    const [y, m] = iso.split('-').map(Number)
    const idx = y * 12 + (m - 1) + delta
    const ny = Math.floor(idx / 12)
    const nm = (idx % 12) + 1
    return `${ny}-${String(nm).padStart(2, '0')}-01`
  }

  // Domain always spans ≥2 months so width↔time is readable (one label can't
  // establish scale). Start at first data month; end at last data day, but
  // never before the end of the month after the first — e.g. Jul data → Jul+Aug.
  const domainStart = $derived(days.length ? monthStartOrd(days[0].date) : 0)
  const domainEnd = $derived.by(() => {
    if (days.length === 0) return 0
    const dataEnd = dayOrdinal(days.at(-1)!.date)
    const twoMonthFloor = monthEndOrd(addMonths(days[0].date, 1))
    return Math.max(dataEnd, twoMonthFloor)
  })
  const spanDays = $derived(Math.max(1, domainEnd - domainStart + 1))
  const chartW = $derived(spanDays * PX_PER_DAY)
  const maxDau = $derived(Math.max(1, ...days.map((d) => d.dau)))
  const pxPerUser = $derived(Math.min(14, Math.max(8, PLOT_MAX_H / maxDau)))
  const chartH = $derived(Math.max(48, Math.round(maxDau * pxPerUser)))

  // Left edge of a calendar day's slot; center = left + PX_PER_DAY/2.
  function xLeft (ord: number) {
    return (ord - domainStart) * PX_PER_DAY
  }

  function xCenter (ord: number) {
    return xLeft(ord) + PX_PER_DAY / 2
  }

  function xAt (i: number) {
    return xCenter(dayOrdinal(days[i].date))
  }

  function yAt (users: number) {
    return chartH - users * pxPerUser
  }

  // One label per month in the domain, left-aligned at that month's start.
  const monthTicks = $derived.by(() => {
    if (days.length === 0) return [] as { key: string; label: string; x: number; boundaryX: number | null }[]
    // Walk calendar months from domainStart → domainEnd (not just data months).
    const startIso = (() => {
      const d = new Date(domainStart * MS_PER_DAY)
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
    })()
    const endIso = (() => {
      const d = new Date(domainEnd * MS_PER_DAY)
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
    })()
    const [fy, fm] = startIso.split('-').map(Number)
    const [ly, lm] = endIso.split('-').map(Number)
    const multiYear = fy !== ly
    const ticks: { key: string; label: string; x: number; boundaryX: number | null }[] = []
    let y = fy
    let m = fm
    while (y < ly || (y === ly && m <= lm)) {
      const iso = `${y}-${String(m).padStart(2, '0')}-01`
      const monthStart = dayOrdinal(iso)
      const x = xLeft(monthStart)
      const label = multiYear
        ? `${MONTH_SHORT[m - 1]} ’${String(y).slice(2)}`
        : MONTH_SHORT[m - 1]
      const boundaryX =
        monthStart > domainStart && monthStart <= domainEnd ? xLeft(monthStart) : null
      ticks.push({ key: iso.slice(0, 7), label, x, boundaryX })
      if (m === 12) {
        m = 1
        y += 1
      } else {
        m += 1
      }
    }
    return ticks
  })

  // Per-cohort stacked bands as day-wide steps on the calendar scale.
  // Each sample owns one PX_PER_DAY slot; consecutive days abut into a cake.
  const layers = $derived.by(() => {
    const stacks: Record<string, StackPoint[]> = Object.fromEntries(
      cohorts.map((c) => [c, [] as StackPoint[]])
    )
    for (const d of days) {
      let y0 = 0
      for (const cohort of cohorts) {
        const count = d.counts[cohort] ?? 0
        const y1 = y0 + count
        stacks[cohort].push({ date: d.date, y0, y1, count })
        y0 = y1
      }
    }
    return cohorts.map((cohort) => {
      const points = stacks[cohort]
      const coords: string[] = []
      for (const p of points) {
        const left = xLeft(dayOrdinal(p.date))
        const right = left + PX_PER_DAY
        coords.push(`${left},${yAt(p.y1)}`, `${right},${yAt(p.y1)}`)
      }
      for (let i = points.length - 1; i >= 0; i--) {
        const p = points[i]
        const left = xLeft(dayOrdinal(p.date))
        const right = left + PX_PER_DAY
        coords.push(`${right},${yAt(p.y0)}`, `${left},${yAt(p.y0)}`)
      }
      const path =
        coords.length === 0
          ? ''
          : `M${coords[0]} ${coords.slice(1).map((c) => `L${c}`).join(' ')} Z`
      return {
        cohort,
        points,
        path,
        hasArea: points.some((p) => p.count > 0),
      }
    })
  })

  // Nearest sample day by calendar x (not array-index fraction).
  function dayIndexFromClientX (svg: SVGSVGElement, clientX: number) {
    const rect = svg.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * chartW
    if (days.length <= 1) return 0
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < days.length; i++) {
      const dist = Math.abs(xAt(i) - x)
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    }
    return best
  }

  function onLayerPointer (e: PointerEvent, cohort: string, select: boolean) {
    const svg = (e.currentTarget as SVGElement).ownerSVGElement
    if (!svg) return
    const idx = dayIndexFromClientX(svg, e.clientX)
    hoverDayIdx = idx
    if (select) toggleCohort(cohort, days[idx]?.date ?? null)
  }

  function onChartLeave () {
    hoverDayIdx = null
  }

  const hoverDay = $derived(hoverDayIdx !== null ? days[hoverDayIdx] : null)
</script>

<section class="space-y-1">
  <div class="flex items-center gap-1.5">
    <h2 class="font-medium text-neutral-700">Daily active users</h2>
    <MetricInfo>
      <p>Users who refreshed an Auth token that UTC day, colored by signup cohort (month).</p>
      <p class="mt-1">Nightly snapshot closes the previous UTC day.</p>
    </MetricInfo>
  </div>

  {#if loading}
    <p class="text-[15px] text-neutral-500">Loading…</p>
  {:else if error}
    <p class="text-[15px] text-red-600">Failed to load: {error}</p>
  {:else if days.length === 0}
    <p class="text-[15px] text-neutral-500">
      No daily cohort data yet — it appears after the next nightly snapshot run.
    </p>
  {:else}
    {#if latest}
      <div class="flex items-end gap-3">
        <div class="leading-none">
          <span class="text-4xl font-semibold tabular-nums tracking-tight">{latest.dau}</span>
          <div class="mt-1 font-mono text-[13px] text-neutral-600">{latest.date} · UTC</div>
        </div>
        {#if momDelta !== null}
          <span
            class="pb-0.5 text-[12px] font-mono text-neutral-400"
            title="Distinct active users this month vs last month (current month is partial)"
          >
            <span class={momDelta >= 0 ? 'text-green-700/80' : 'text-red-600/80'}>
              {momDelta >= 0 ? '+' : ''}{momDelta}{#if momPct !== null}
                ({momPct >= 0 ? '+' : ''}{momPct.toFixed(1)}%){/if}
            </span>
            actives MoM
          </span>
        {:else}
          <span
            class="pb-0.5 text-[12px] font-mono text-neutral-400"
            title="Needs two months of snapshot data to compare"
          >
            — (—%) actives MoM
          </span>
        {/if}
      </div>
    {/if}

    <div class="flex items-start gap-4 pt-1">
      <div class="w-fit shrink-0 space-y-2.5">
        <div class="relative w-fit">
          <svg
            width={chartW}
            height={chartH}
            viewBox="0 0 {chartW} {chartH}"
            class="block border-b border-neutral-200"
            role="img"
            aria-label="Daily active users by signup cohort"
            onpointerleave={onChartLeave}
          >
            <!-- Track through last data day; early-month empty days are real calendar time. -->
            <rect
              x="0"
              y="0"
              width={chartW}
              height={chartH}
              class="pointer-events-none fill-neutral-50"
            />
            {#each layers as layer (layer.cohort)}
              {#if layer.hasArea}
                <path
                  d={layer.path}
                  fill={cohortColor(layer.cohort)}
                  class="cursor-pointer transition-opacity {selected && selected.cohort !== layer.cohort
                    ? 'opacity-30'
                    : 'opacity-90 hover:opacity-100'}"
                  role="button"
                  tabindex="0"
                  aria-label="Cohort {layer.cohort}"
                  aria-pressed={selected?.cohort === layer.cohort}
                  onpointermove={(e) => onLayerPointer(e, layer.cohort, false)}
                  onclick={(e) => onLayerPointer(e, layer.cohort, true)}
                  onkeydown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      // Keyboard: all-days scope (same as legend); pointer click scopes to day.
                      toggleCohort(layer.cohort)
                    }
                  }}
                >
                  <title>
                    {#if hoverDay}
                      {hoverDay.date} · cohort {layer.cohort}: {hoverDay.counts[layer.cohort] ?? 0} active
                    {:else}
                      cohort {layer.cohort}
                    {/if}
                  </title>
                </path>
              {/if}
            {/each}
            {#each monthTicks as tick (tick.key)}
              {#if tick.boundaryX !== null}
                <line
                  x1={tick.boundaryX}
                  x2={tick.boundaryX}
                  y1={0}
                  y2={chartH}
                  stroke="currentColor"
                  class="pointer-events-none text-neutral-200"
                  stroke-width="1"
                />
              {/if}
            {/each}
            {#if hoverDayIdx !== null && days.length > 1}
              <line
                x1={xAt(hoverDayIdx)}
                x2={xAt(hoverDayIdx)}
                y1={0}
                y2={chartH}
                stroke="currentColor"
                class="pointer-events-none text-neutral-400"
                stroke-width="1"
                stroke-dasharray="2 3"
              />
            {/if}
          </svg>
          {#if hoverDay}
            <div
              class="pointer-events-none absolute top-1 z-10 rounded border border-neutral-200 bg-white/95 px-1.5 py-0.5 font-mono text-[11px] text-neutral-600 shadow-sm"
              style:left="{Math.min(chartW - 120, Math.max(0, (hoverDayIdx !== null ? xAt(hoverDayIdx) : 0) - 40))}px"
            >
              {hoverDay.date} · {hoverDay.dau} active
            </div>
          {/if}
          <div class="relative h-4 w-full" style:width="{chartW}px" aria-hidden="true">
            {#each monthTicks as tick (tick.key)}
              <span
                class="absolute top-0.5 translate-x-0 pl-0.5 font-mono text-[11px] text-neutral-400"
                style:left="{tick.x}px"
              >
                {tick.label}
              </span>
            {/each}
          </div>
        </div>
        <div class="flex flex-wrap gap-1.5 text-[13px]">
          {#each cohorts as cohort (cohort)}
            <button
              type="button"
              class="inline-flex cursor-pointer items-center gap-1 rounded-md border px-1.5 py-0.5
                {selected?.cohort === cohort
                  ? 'border-neutral-400 bg-neutral-100'
                  : 'border-transparent hover:bg-neutral-50'}"
              aria-pressed={selected?.cohort === cohort}
              onclick={() => toggleCohort(cohort)}
            >
              <span class="inline-block h-3 w-3 rounded-sm" style:background={cohortColor(cohort)}></span>
              {cohort}
            </button>
          {/each}
        </div>
      </div>
      {#if selected}
        <div class="w-fit min-w-0 space-y-1 rounded-md border border-neutral-200 bg-white p-2">
          <div class="flex items-center gap-2 text-[13px]">
            <span class="inline-block h-3 w-3 rounded-sm" style:background={cohortColor(selected.cohort)}></span>
            <span class="text-neutral-500">
              {cohortMembers.length} active {selected.date ? `on ${selected.date}` : ''}
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
