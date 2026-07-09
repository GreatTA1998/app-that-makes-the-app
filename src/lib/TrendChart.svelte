<script lang="ts">
  type Point = { date: string; count: number }

  let { series, ariaLabel }: { series: Point[]; ariaLabel: string } = $props()

  const gradientId = $props.id()

  // Chart geometry in real pixels (container width is measured), so circles
  // stay round and strokes stay crisp — no viewBox stretching.
  let containerW = $state(600)
  const CHART_H = 150
  const PAD_TOP = 10
  const PAD_RIGHT = 12
  const PAD_LEFT = 34 // room for y-axis labels
  const PAD_BOTTOM = 20 // room for x-axis date labels
  const BASELINE = CHART_H - PAD_BOTTOM

  // Round up to 1/2/5 × 10^k so gridline steps land on friendly numbers.
  function niceCeil (v: number): number {
    const exp = Math.floor(Math.log10(v))
    const f = v / 10 ** exp
    const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10
    return nf * 10 ** exp
  }

  // Compact x-axis labels (year is shown in the parent subtitle).
  function formatAxisDate (date: string): string {
    const day = date.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return date
    const d = new Date(`${day}T00:00:00Z`)
    if (Number.isNaN(d.getTime())) return date
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    })
  }

  // Include 0 so all-positive series keep a baseline at zero, and signed
  // deltas (e.g. task change / day) can dip below the axis.
  const dataMax = $derived(Math.max(0, ...series.map((d) => d.count)))
  const dataMin = $derived(Math.min(0, ...series.map((d) => d.count)))
  // ~3 gridlines across the span; integer steps since we're counting.
  const step = $derived(Math.max(1, niceCeil(Math.max(dataMax - dataMin, 1) / 3)))
  const yMax = $derived.by(() => {
    const max = Math.ceil(dataMax / step) * step
    const min = Math.floor(dataMin / step) * step
    // Avoid a zero-height plot when every point is 0.
    return max === min ? max + step : max
  })
  const yMin = $derived(Math.floor(dataMin / step) * step)
  const ticks = $derived(
    Array.from({ length: (yMax - yMin) / step + 1 }, (_, i) => yMin + i * step)
  )
  const zeroY = $derived(yFor(0))

  // Width follows the data: ~32px per day, clamped so sparse data renders as
  // a compact sparkline instead of stretching across the page.
  const DAY_SPACING = 32
  const MIN_W = 160
  const chartW = $derived(
    Math.min(
      containerW,
      Math.max(MIN_W, PAD_LEFT + PAD_RIGHT + (series.length - 1) * DAY_SPACING)
    )
  )
  const plotW = $derived(chartW - PAD_LEFT - PAD_RIGHT)

  function yFor (count: number): number {
    return BASELINE - ((count - yMin) / (yMax - yMin)) * (BASELINE - PAD_TOP)
  }

  const points = $derived(
    series.map((d, i) => ({
      ...d,
      x:
        series.length === 1
          ? PAD_LEFT + plotW / 2
          : PAD_LEFT + (i / (series.length - 1)) * plotW,
      y: yFor(d.count),
    }))
  )
  const line = $derived(points.map((p) => `${p.x},${p.y}`).join(' '))
  // Fill to the zero line so negative deltas shade below the axis.
  const area = $derived(
    points.length > 1
      ? [
          `M ${points[0].x},${zeroY}`,
          ...points.map((p) => `L ${p.x},${p.y}`),
          `L ${points[points.length - 1].x},${zeroY}`,
          'Z',
        ].join(' ')
      : ''
  )
  // Dots make sparse data legible; hide them once the series is dense.
  // The latest point always gets a dot so "now" is easy to find.
  const showDots = $derived(series.length <= 45)
  const last = $derived(points.at(-1))
</script>

<div bind:clientWidth={containerW}>
  <svg width={chartW} height={CHART_H} class="block" role="img" aria-label={ariaLabel}>
    <defs>
      <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="currentColor" stop-opacity="0.08" />
        <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
      </linearGradient>
    </defs>

    <!-- Gridlines + y-axis labels -->
    {#each ticks as tick (tick)}
      {@const y = yFor(tick)}
      <line
        x1={PAD_LEFT}
        y1={y}
        x2={chartW - PAD_RIGHT}
        y2={y}
        stroke="currentColor"
        class={tick === 0 ? 'text-neutral-300' : 'text-neutral-200'}
        stroke-dasharray={tick === 0 ? undefined : '3 3'}
      />
      <text
        x={PAD_LEFT - 8}
        y={y}
        text-anchor="end"
        dominant-baseline="middle"
        class="fill-neutral-400 font-mono text-[11px]"
      >
        {tick}
      </text>
    {/each}

    {#if area}
      <path d={area} fill="url(#{gradientId})" class="text-neutral-900" />
    {/if}
    {#if points.length > 1}
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linejoin="round"
        stroke-linecap="round"
        class="text-neutral-800"
      />
    {/if}
    {#if showDots}
      {#each points as p (p.date)}
        <circle cx={p.x} cy={p.y} r="2.5" fill="currentColor" class="text-neutral-800" />
      {/each}
    {:else if last}
      <circle cx={last.x} cy={last.y} r="2.5" fill="currentColor" class="text-neutral-800" />
    {/if}

    <!-- X-axis date labels -->
    {#if points.length === 1}
      <text
        x={points[0].x}
        y={CHART_H - 6}
        text-anchor="middle"
        class="fill-neutral-400 font-mono text-[11px]"
      >
        {formatAxisDate(points[0].date)}
      </text>
    {:else if points.length > 1}
      <text
        x={PAD_LEFT}
        y={CHART_H - 6}
        text-anchor="start"
        class="fill-neutral-400 font-mono text-[11px]"
      >
        {formatAxisDate(points[0].date)}
      </text>
      <text
        x={chartW - PAD_RIGHT}
        y={CHART_H - 6}
        text-anchor="end"
        class="fill-neutral-400 font-mono text-[11px]"
      >
        {formatAxisDate(points[points.length - 1].date)}
      </text>
    {/if}

    <!-- Hover targets -->
    {#each points as p (p.date)}
      {@const slot = points.length > 1 ? plotW / (points.length - 1) : plotW}
      <rect
        x={Math.max(PAD_LEFT, p.x - slot / 2)}
        y="0"
        width={Math.min(slot, chartW - PAD_RIGHT - Math.max(PAD_LEFT, p.x - slot / 2))}
        height={BASELINE}
        fill="transparent"
      >
        <title>{p.date}: {p.count}</title>
      </rect>
    {/each}
  </svg>
</div>
