'use client';

import { useId, useState } from 'react';
import { CURRENCY_SYMBOL, currencyOf } from '@/lib/format';

/**
 * The dashboard's two charts, drawn as inline SVG.
 *
 * Money and order counts are different scales, so they are two charts sharing
 * an x — never one plot with two y-axes, which invents a correlation out of
 * however the two scales happen to line up.
 *
 * Colour does one job here: profit is the point and cost is context, so profit
 * wears the brand accent and cost a de-emphasis grey. That pair separates by
 * ΔE 13.9 under protanopia and 29.4 under normal vision, and the grey clears
 * 3:1 on white — checked with a validator rather than by eye. Identity never
 * rests on colour alone: there is a legend, a tooltip on hover and on focus,
 * and the table below carries every figure.
 */

export const COST_FILL = '#5A6470';
export const PROFIT_FILL = '#FF4A1A';

export interface Bucket {
  bucket: string; label: string;
  orders: number; revenue: number; cost: number; profit: number;
}

const money = (n: number, currency: string) =>
  `${CURRENCY_SYMBOL[currencyOf(currency)]}`
  + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** £4,200 on an axis is noise; £4.2k is the number. */
function compact(n: number, currency: string) {
  const sym = CURRENCY_SYMBOL[currencyOf(currency)];
  if (n >= 1_000_000) return `${sym}${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}m`;
  if (n >= 1_000) return `${sym}${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `${sym}${Math.round(n)}`;
}

/** The multiples of a power of ten that read as a deliberate axis step. */
const STEPS = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];

/**
 * Axis steps a person would have chosen.
 *
 * The loop runs until a tick reaches the maximum rather than for a fixed
 * number of steps, because the top tick is also the top of the plot — stop one
 * step short and the tallest column is drawn off the top of the chart.
 *
 * `whole` is for counts. Half an order is not a thing, and an axis offering
 * one says the chart does not know what it is plotting.
 */
export function niceTicks(max: number, count = 4, whole = false): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const candidates = STEPS
    .map((m) => m * mag)
    .filter((s) => !whole || (s >= 1 && Number.isInteger(s)));
  const step = candidates.find((s) => s >= raw)
    ?? (whole ? Math.max(1, Math.ceil(raw)) : 10 * mag);

  const ticks: number[] = [];
  for (let v = 0; ; v += step) {
    ticks.push(v);
    // A hair of tolerance: repeatedly adding 2.5 lands a shade above 10 and
    // would otherwise buy a whole extra step.
    if (v >= max - step * 1e-9) break;
  }
  return ticks;
}

/** A column with a rounded cap, square where it meets the baseline. */
function capped(x: number, y: number, w: number, h: number, r = 4) {
  const radius = Math.max(0, Math.min(r, w / 2, h));
  return `M${x} ${y + h}V${y + radius}A${radius} ${radius} 0 0 1 ${x + radius} ${y}`
       + `H${x + w - radius}A${radius} ${radius} 0 0 1 ${x + w} ${y + radius}`
       + `V${y + h}Z`;
}

const GRID = '#E1E4E8';
const AXIS_TEXT = '#5A6470';
const W = 900;
const PAD = { top: 14, right: 6, bottom: 26, left: 58 };

interface Geometry {
  plotW: number; plotH: number; band: number; barW: number;
  x: (i: number) => number;
}
function geometry(count: number, height: number): Geometry {
  const plotW = W - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const band = plotW / Math.max(1, count);
  // Capped rather than filling the slot: the leftover band is the air that
  // keeps a row of columns from reading as one solid block.
  const barW = Math.min(24, band * 0.62);
  return { plotW, plotH, band, barW, x: (i) => PAD.left + band * i + (band - barW) / 2 };
}

/** Enough x labels to place the reader, never so many that they collide. */
function labelEvery(count: number) {
  return Math.max(1, Math.ceil(count / 12));
}

function Frame({ children, height, label, tooltip, active }: {
  children: React.ReactNode; height: number; label: string;
  tooltip: React.ReactNode; active: { centre: number } | null;
}) {
  // Kept off the ends: the tooltip is centred on its column, and on the first
  // or last one that would hang half of it outside the card.
  const pct = active === null
    ? 0 : Math.min(85, Math.max(15, (active.centre / W) * 100));

  return (
    <div className="relative overflow-x-auto">
      <div className="min-w-[620px]">
        <svg
          viewBox={`0 0 ${W} ${height}`} className="w-full block"
          role="group" aria-label={label}
        >
          {children}
        </svg>
        {active && tooltip && (
          <div
            className="absolute top-1 z-10 -translate-x-1/2 pointer-events-none
                       bg-ink text-white rounded px-2.5 py-2 text-[12px] whitespace-nowrap
                       shadow-[0_2px_10px_rgba(0,0,0,0.18)]"
            style={{ left: `${pct}%` }}
          >
            {tooltip}
          </div>
        )}
      </div>
    </div>
  );
}

/** One row of the tooltip: the value leads, the series name follows. */
function Row({ colour, name, value }: { colour?: string; name: string; value: string }) {
  return (
    <div className="flex items-center gap-2 leading-snug">
      {colour
        ? <span className="w-3 h-[2px] rounded-full flex-shrink-0" style={{ background: colour }} />
        : <span className="w-3 flex-shrink-0" />}
      <span className="num font-semibold">{value}</span>
      <span className="text-[#AEBDC9]">{name}</span>
    </div>
  );
}

export function SalesChart({ data, currency = 'GBP' }: {
  data: Bucket[]; currency?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const clip = useId();
  const height = 260;
  const g = geometry(data.length, height);

  const max = Math.max(1, ...data.map((d) => d.revenue));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const y = (v: number) => PAD.top + g.plotH - (v / top) * g.plotH;

  // One direct label, on the tallest column. A number on every column is
  // chaos and goes unread; the axis, the tooltip and the table carry the rest.
  const peak = data.reduce((best, d, i) => (d.revenue > data[best].revenue ? i : best), 0);
  const every = labelEvery(data.length);
  const hot = active === null ? null : data[active];

  return (
    <Frame
      height={height}
      label="Revenue by period, split into what it cost us and what was left"
      active={active === null ? null : { centre: g.x(active) + g.barW / 2 }}
      tooltip={hot && (
        <>
          <div className="font-semibold mb-1">{hot.label}</div>
          <Row name="revenue" value={money(hot.revenue, currency)} />
          <Row colour={PROFIT_FILL} name="profit" value={money(hot.profit, currency)} />
          <Row colour={COST_FILL} name="to supplier" value={money(hot.cost, currency)} />
          <Row name={hot.orders === 1 ? 'order' : 'orders'} value={String(hot.orders)} />
        </>
      )}
    >
      <defs>
        <clipPath id={clip}>
          <rect x={PAD.left} y={PAD.top - 6} width={g.plotW} height={g.plotH + 6} />
        </clipPath>
      </defs>

      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)}
            stroke={GRID} strokeWidth={1}
          />
          <text
            x={PAD.left - 8} y={y(t) + 4} textAnchor="end"
            fontSize={11} fill={AXIS_TEXT} className="num"
          >
            {compact(t, currency)}
          </text>
        </g>
      ))}

      <g clipPath={`url(#${clip})`}>
        {data.map((d, i) => {
          const costH = (d.cost / top) * g.plotH;
          const profitH = (Math.max(0, d.profit) / top) * g.plotH;
          const base = PAD.top + g.plotH;
          // A 2px gap in the surface colour is what separates the two
          // segments. A stroke round each would be data-weight ink that is
          // not data.
          const gap = profitH > 0 && costH > 0 ? 2 : 0;
          return (
            <g key={d.bucket} opacity={active === null || active === i ? 1 : 0.55}>
              {costH > 0 && (
                <path
                  d={profitH > 0
                    ? `M${g.x(i)} ${base}h${g.barW}v${-costH}h${-g.barW}Z`
                    : capped(g.x(i), base - costH, g.barW, costH)}
                  fill={COST_FILL}
                />
              )}
              {profitH > 0 && (
                <path
                  d={capped(g.x(i), base - costH - gap - profitH, g.barW, profitH)}
                  fill={PROFIT_FILL}
                />
              )}
            </g>
          );
        })}
      </g>

      {data[peak].revenue > 0 && (
        <text
          x={g.x(peak) + g.barW / 2} y={y(data[peak].revenue) - 7}
          textAnchor="middle" fontSize={11} fontWeight={600} fill="#121619" className="num"
        >
          {compact(data[peak].revenue, currency)}
        </text>
      )}

      <line
        x1={PAD.left} x2={W - PAD.right} y1={PAD.top + g.plotH} y2={PAD.top + g.plotH}
        stroke={AXIS_TEXT} strokeWidth={1}
      />

      {data.map((d, i) => (i % every === 0 ? (
        <text
          key={d.bucket} x={g.x(i) + g.barW / 2} y={height - 8}
          textAnchor="middle" fontSize={11} fill={AXIS_TEXT} className="num"
        >
          {d.label}
        </text>
      ) : null))}

      <Hits data={data} g={g} height={height} onActive={setActive}
            describe={(d) => `${d.label}: revenue ${money(d.revenue, currency)}, `
              + `profit ${money(d.profit, currency)}, ${d.orders} orders`} />
    </Frame>
  );
}

export function OrdersChart({ data }: { data: Bucket[] }) {
  const [active, setActive] = useState<number | null>(null);
  const height = 120;
  const g = geometry(data.length, height);

  const max = Math.max(1, ...data.map((d) => d.orders));
  const ticks = niceTicks(max, 3, true);
  const top = ticks[ticks.length - 1];
  const y = (v: number) => PAD.top + g.plotH - (v / top) * g.plotH;
  const every = labelEvery(data.length);
  const hot = active === null ? null : data[active];

  return (
    <Frame
      height={height}
      label="Orders placed by period"
      active={active === null ? null : { centre: g.x(active) + g.barW / 2 }}
      tooltip={hot && (
        <>
          <div className="font-semibold mb-1">{hot.label}</div>
          <Row name={hot.orders === 1 ? 'order' : 'orders'} value={String(hot.orders)} />
        </>
      )}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)}
                stroke={GRID} strokeWidth={1} />
          <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end"
                fontSize={11} fill={AXIS_TEXT} className="num">
            {Math.round(t)}
          </text>
        </g>
      ))}

      {data.map((d, i) => {
        const h = (d.orders / top) * g.plotH;
        if (h <= 0) return null;
        return (
          <path
            key={d.bucket}
            d={capped(g.x(i), PAD.top + g.plotH - h, g.barW, h)}
            fill={COST_FILL}
            opacity={active === null || active === i ? 1 : 0.55}
          />
        );
      })}

      <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + g.plotH} y2={PAD.top + g.plotH}
            stroke={AXIS_TEXT} strokeWidth={1} />

      {data.map((d, i) => (i % every === 0 ? (
        <text key={d.bucket} x={g.x(i) + g.barW / 2} y={height - 8}
              textAnchor="middle" fontSize={11} fill={AXIS_TEXT} className="num">
          {d.label}
        </text>
      ) : null))}

      <Hits data={data} g={g} height={height} onActive={setActive}
            describe={(d) => `${d.label}: ${d.orders} orders`} />
    </Frame>
  );
}

/**
 * The hover and focus layer.
 *
 * One transparent rect per column, the full width of its band and the full
 * height of the plot — so the reader aims at a date rather than at a 24px
 * column, and a keyboard reaches every one of them.
 */
function Hits({ data, g, height, onActive, describe }: {
  data: Bucket[]; g: Geometry; height: number;
  onActive: (i: number | null) => void;
  describe: (d: Bucket) => string;
}) {
  return (
    <g>
      {data.map((d, i) => (
        <rect
          key={d.bucket}
          x={PAD.left + g.band * i} y={PAD.top - 6}
          width={g.band} height={height - PAD.top - PAD.bottom + 6}
          fill="transparent"
          tabIndex={0}
          role="img"
          aria-label={describe(d)}
          onMouseEnter={() => onActive(i)}
          onMouseLeave={() => onActive(null)}
          onFocus={() => onActive(i)}
          onBlur={() => onActive(null)}
        />
      ))}
    </g>
  );
}

/** Two series, so a legend is always present. Bars key with a rect. */
export function Legend() {
  return (
    <div className="flex items-center gap-4 text-[12px] text-mute">
      {[[PROFIT_FILL, 'Profit'], [COST_FILL, 'Cost to us']].map(([fill, name]) => (
        <span key={name} className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-[2px]" style={{ background: fill }} />
          {name}
        </span>
      ))}
      <span className="text-mute">Column height is revenue</span>
    </div>
  );
}
