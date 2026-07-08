<script lang="ts">
  type Day = { date: string; count: number; counts: Record<string, number> }

  let {
    series,
    layers,
    colorFor,
    selected = null,
    onselectlayer,
    ariaLabel,
  }: {
    series: Day[]
    /** Bottom-to-top stack order. Fixed across all days so bands never reorder. */
    layers: string[]
    colorFor: (layer: string) => string
    /** Dim every band except this layer. */
    selected?: string | null
    /** Click on a band: layer + the 'YYYY-MM' month of the clicked day. */
    onselectlayer?: (layer: string, month: string) => void
    ariaLabel: string
  } = $props()

  // Chart geometry in real pixels (container width is measured), so strokes
  // stay crisp — no viewBox stretching. Mirrors TrendChart.
  let containerW = $state(600)
  const CHART_H = 160
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

  const maxCount = $derived(Math.max(1, ...series.map((d) => d.count)))
  // ~3 gridlines above zero; integer steps since we're counting users.
  const step = $derived(Math.max(1, niceCeil(maxCount / 3)))
  const yMax = $derived(Math.ceil(maxCount / step) * step)
  const ticks = $derived(
    Array.from({ length: yMax / step + 1 }, (_, i) => i * step)
  )

  // Width follows the data: ~32px per day, clamped so sparse data renders as
  // a compact sparkline instead of stretching across the page.
  const DAY_SPACING = 32
  const MIN_W = 160
  const BAR_W = 24 // single-day fallback: an area needs ≥2 points, so draw a bar
  const chartW = $derived(
    Math.min(
      containerW,
      Math.max(MIN_W, PAD_LEFT + PAD_RIGHT + (series.length - 1) * DAY_SPACING)
    )
  )
  const plotW = $derived(chartW - PAD_LEFT - PAD_RIGHT)

  function xFor (i: number): number {
    return series.length === 1
      ? PAD_LEFT + plotW / 2
      : PAD_LEFT + (i / (series.length - 1)) * plotW
  }
  function yFor (count: number): number {
    return BASELINE - (count / yMax) * (BASELINE - PAD_TOP)
  }

  // Cumulative stack: each layer's band sits on the running sum of the layers
  // below it, per day. Layer order is fixed by `layers`, so a band that drops
  // to zero pinches out and re-inflates later without ever changing slots.
  const stacked = $derived.by(() => {
    const running = series.map(() => 0)
    return layers
      .map((layer) => {
        let total = 0
        const bounds = series.map((d, i) => {
          const v = d.counts[layer] ?? 0
          total += v
          const lower = running[i]
          running[i] += v
          return { lower, upper: running[i] }
        })
        return { layer, bounds, total }
      })
      .filter((l) => l.total > 0)
  })

  // Band outline: upper edge left→right, then lower edge right→left.
  function areaPath (bounds: { lower: number; upper: number }[]): string {
    const top = bounds.map((b, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(b.upper)}`)
    const bottom = bounds.map((b, i) => `L ${xFor(i)} ${yFor(b.lower)}`).reverse()
    return [...top, ...bottom, 'Z'].join(' ')
  }

  // Map a click to (day from x, band from y). Mouse-only progressive
  // enhancement — keyboard users select cohorts via the legend buttons —
  // so it's a plain listener on the svg rather than per-band controls.
  function bandSelection (svg: SVGSVGElement) {
    const onClick = (e: MouseEvent) => {
      if (!onselectlayer || series.length === 0) return
      const rect = svg.getBoundingClientRect()
      const t = (e.clientX - rect.left - PAD_LEFT) / plotW
      const i =
        series.length === 1
          ? 0
          : Math.max(0, Math.min(series.length - 1, Math.round(t * (series.length - 1))))
      const v = ((BASELINE - (e.clientY - rect.top)) / (BASELINE - PAD_TOP)) * yMax
      for (const l of stacked) {
        const b = l.bounds[i]
        if (v >= b.lower && v < b.upper) {
          onselectlayer(l.layer, series[i].date.slice(0, 7))
          return
        }
      }
    }
    svg.addEventListener('click', onClick)
    return () => svg.removeEventListener('click', onClick)
  }

  // Top band first, matching the visual stack read top-down.
  function tooltip (d: Day): string {
    const lines = [`${d.date}: ${d.count} active`]
    for (const { layer } of [...stacked].reverse()) {
      const v = d.counts[layer]
      if (v) lines.push(`${layer}: ${v}`)
    }
    return lines.join('\n')
  }
</script>

<div bind:clientWidth={containerW}>
  <svg
    {@attach bandSelection}
    width={chartW}
    height={CHART_H}
    class="block"
    role="img"
    aria-label={ariaLabel}
  >
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

    <!-- Cohort bands, bottom to top -->
    {#each stacked as l (l.layer)}
      {#if series.length === 1}
        <rect
          x={xFor(0) - BAR_W / 2}
          y={yFor(l.bounds[0].upper)}
          width={BAR_W}
          height={yFor(l.bounds[0].lower) - yFor(l.bounds[0].upper)}
          fill={colorFor(l.layer)}
          class="transition-opacity {selected && selected !== l.layer ? 'opacity-30' : ''}"
        />
      {:else}
        <path
          d={areaPath(l.bounds)}
          fill={colorFor(l.layer)}
          stroke="white"
          stroke-width="0.5"
          class="transition-opacity {selected && selected !== l.layer ? 'opacity-30' : ''}"
        />
      {/if}
    {/each}

    <!-- X-axis date labels -->
    {#if series.length === 1}
      <text
        x={xFor(0)}
        y={CHART_H - 6}
        text-anchor="middle"
        class="fill-neutral-400 font-mono text-[11px]"
      >
        {series[0].date}
      </text>
    {:else if series.length > 1}
      <text
        x={PAD_LEFT}
        y={CHART_H - 6}
        text-anchor="start"
        class="fill-neutral-400 font-mono text-[11px]"
      >
        {series[0].date}
      </text>
      <text
        x={chartW - PAD_RIGHT}
        y={CHART_H - 6}
        text-anchor="end"
        class="fill-neutral-400 font-mono text-[11px]"
      >
        {series[series.length - 1].date}
      </text>
    {/if}

    <!-- Hover tooltips (clicks fall through to the svg-level band handler) -->
    <g aria-hidden="true">
      {#each series as d, i (d.date)}
        {@const slot = series.length > 1 ? plotW / (series.length - 1) : plotW}
        <rect
          x={Math.max(PAD_LEFT, xFor(i) - slot / 2)}
          y="0"
          width={Math.min(slot, chartW - PAD_RIGHT - Math.max(PAD_LEFT, xFor(i) - slot / 2))}
          height={BASELINE}
          fill="transparent"
          class={onselectlayer ? 'cursor-pointer' : ''}
        >
          <title>{tooltip(d)}</title>
        </rect>
      {/each}
    </g>
  </svg>
</div>
