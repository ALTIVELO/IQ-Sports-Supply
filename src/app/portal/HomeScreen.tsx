import Link from 'next/link';
import { Card, Empty, Money, Tag, VoidTag, voidedText } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import ProductImage from '@/components/ProductImage';

export interface HomeOrder {
  id: string; number: string; date: string; status: string;
  order_lines: { id: string; qty: number; unit_price: number }[];
  invoices: { id: string; shipped: boolean; delivered: boolean; superseded: boolean }[];
}
export interface HomeParcel {
  id: string; number: string; shipped_at: string | null;
  carrier: string | null; tracking_number: string | null; tracking_url: string | null;
  orderNumber: string | null;
}
export interface HomeGroup {
  slug: string; name: string; brand: string | null; image_url: string | null;
}
export interface HomeDepartment { slug: string; name: string; total: number }

export interface HomeData {
  clientName: string;
  tier: string | null;
  productCount: number;
  outstanding: number;
  dueCount: number;
  overdueCount: number;
  earliestOverdue: string | null;
  inProgressCount: number;
  orders: HomeOrder[];
  parcel: HomeParcel | null;
  groups: HomeGroup[];
  departments: HomeDepartment[];
}

/**
 * Where a signed-in customer lands.
 *
 * It answers the two questions someone opens the portal with — what is
 * happening with my orders, and what do I owe — and then gets out of the way
 * towards the catalogue. Everything on it is a link to the screen that already
 * does the job properly; nothing here is the only place to see something.
 */
export default function HomeScreen({ data }: { data: HomeData }) {
  return (
    <div className="space-y-6">
      {/* ── who you are, and the one button that matters ── */}
      <section className="bg-ink text-white rounded-card px-5 sm:px-7 py-6 sm:py-8">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <div className="min-w-[240px]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8DA0B0]">
              {data.tier ? `${data.tier} pricing` : 'Trade account'}
            </div>
            <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-[-0.025em]
                           leading-[1.1] mt-1.5">
              {data.clientName}
            </h1>
            <p className="text-[13px] text-[#AEBDC9] mt-2">
              {data.productCount} products at your prices, excluding VAT.
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5 ml-auto">
            <Link
              href="/portal/catalogue"
              className="bg-flame text-white text-[14px] font-semibold rounded px-5 py-2.5
                         hover:bg-[#E63D10]"
            >
              Browse the catalogue
            </Link>
            <Link
              href="/portal/history"
              className="border border-white/25 text-[14px] font-semibold rounded px-5 py-2.5
                         hover:bg-white/10"
            >
              Order again
            </Link>
          </div>
        </div>
      </section>

      {/* ── what is going on, in three numbers ── */}
      <div className="grid sm:grid-cols-3 gap-3">
        <Summary
          href="/portal/orders"
          label="Orders in progress"
          value={String(data.inProgressCount)}
          note={data.inProgressCount ? 'Still on their way to you' : 'Everything has been delivered'}
        />
        <Summary
          href="/portal/invoices"
          label="Outstanding"
          value={<Money value={data.outstanding} />}
          note={`${data.dueCount} invoice${data.dueCount === 1 ? '' : 's'} `
              + 'awaiting payment, inc VAT'}
        />
        <Summary
          href="/portal/invoices"
          label="Overdue"
          value={String(data.overdueCount)}
          note={data.earliestOverdue
            ? `Earliest was due ${fmtDate(data.earliestOverdue)}`
            : 'Nothing past its due date'}
          alarm={data.overdueCount > 0}
        />
      </div>

      {/* ── the parcel on its way ── */}
      {data.parcel?.tracking_url && (
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <Tag tone="green">Latest shipment</Tag>
            <span className="num text-[13px] font-semibold">{data.parcel.orderNumber}</span>
            <span className="text-[12px] text-mute num">
              Sent {fmtDate(data.parcel.shipped_at)} · {data.parcel.carrier}
            </span>
            <a
              href={data.parcel.tracking_url} target="_blank" rel="noreferrer"
              className="ml-auto text-[12px] font-semibold bg-ink text-white rounded px-[10px] py-[5px]"
            >
              Track {data.parcel.tracking_number}
            </a>
          </div>
        </Card>
      )}

      {/* ── recent orders ── */}
      <section>
        <Heading href="/portal/history" link="All orders">Recent orders</Heading>
        {data.orders.length === 0 ? (
          <Card>
            <Empty>
              No orders yet.{' '}
              <Link href="/portal/catalogue" className="text-flame-text font-semibold">
                Start with the catalogue
              </Link>
              .
            </Empty>
          </Card>
        ) : (
          <Card>
            <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Order</th><th>Date</th>
                  <th className="text-right">Lines</th>
                  <th className="text-right">Net</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((o) => {
                  const cancelled = o.status === 'cancelled';
                  const net = o.order_lines.reduce((a, l) => a + l.qty * Number(l.unit_price), 0);
                  const invoices = o.invoices.filter((i) => !i.superseded);
                  const delivered = invoices.length > 0 && invoices.every((i) => i.delivered);
                  const shipped = invoices.length > 0 && invoices.every((i) => i.shipped);
                  return (
                    <tr key={o.id} className={cancelled ? 'opacity-55' : ''}>
                      <td className={`num font-semibold ${cancelled ? voidedText : ''}`}>
                        <Link href="/portal/orders" className="hover:text-flame-text">
                          {o.number}
                        </Link>
                      </td>
                      <td className="num whitespace-nowrap">{fmtDate(o.date)}</td>
                      <td className="num text-right">{o.order_lines.length}</td>
                      <td className={`num text-right ${cancelled ? 'line-through' : ''}`}>
                        <Money value={net} />
                      </td>
                      <td>
                        {cancelled
                          ? <VoidTag>cancelled</VoidTag>
                          : delivered
                            ? <Tag tone="green">Delivered</Tag>
                            : shipped
                              ? <Tag tone="line">Shipped</Tag>
                              : <Tag tone="line">In progress</Tag>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </Card>
        )}
      </section>

      {/* ── things worth specifying rather than picking off a shelf ── */}
      {data.groups.length > 0 && (
        <section>
          <Heading href="/portal/catalogue" link="Whole catalogue">
            Build it to spec
          </Heading>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {data.groups.map((g) => (
              <Link
                key={g.slug}
                href={`/portal/build/${g.slug}`}
                className="group block bg-white border border-line rounded-card overflow-hidden
                           hover:border-flame focus-visible:border-flame transition-colors"
              >
                <ProductImage
                  src={g.image_url} alt=""
                  className="w-full aspect-[5/3] border-0 border-b border-line rounded-none bg-parch"
                  sizePx={320} placeholderScale="quiet"
                />
                <div className="p-3">
                  <div className="text-[13px] font-semibold leading-tight">{g.name}</div>
                  {g.brand && <div className="text-[12px] text-mute mt-0.5">{g.brand}</div>}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── straight into a department ── */}
      {data.departments.length > 0 && (
        <section>
          <Heading href="/portal/catalogue" link="All departments">Shop by department</Heading>
          <div className="flex flex-wrap gap-2">
            {data.departments.map((d) => (
              <Link
                key={d.slug}
                href={`/portal/c/${d.slug}`}
                className="text-[13px] font-medium bg-white border border-line rounded-card
                           px-3.5 py-2 hover:border-flame transition-colors"
              >
                {d.name}
                <span className="num text-mute text-[12px] ml-2">{d.total}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <p className="text-[12px] text-mute">
        Prices shown are yours alone and exclude VAT. Anything not right —
        an address, a price, an order you need changing —{' '}
        <Link href="/portal/account" className="text-flame-text font-semibold">
          your account page
        </Link>{' '}
        has your details, and we are on the end of the phone.
      </p>
    </div>
  );
}

/** One of the three numbers across the top. Each one opens the screen behind it. */
function Summary({ href, label, value, note, alarm = false }: {
  href: string; label: string; value: React.ReactNode; note: string; alarm?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`block bg-white border rounded-card p-4 transition-colors
                  ${alarm ? 'border-danger' : 'border-line hover:border-flame'}`}
    >
      <div className="text-[11px] font-semibold text-mute uppercase tracking-wide">{label}</div>
      <div className={`num text-[26px] font-semibold tracking-[-0.02em] mt-1.5
                       ${alarm ? 'text-danger' : ''}`}>
        {value}
      </div>
      <div className="text-[12px] text-mute mt-1">{note}</div>
    </Link>
  );
}

function Heading({ children, href, link }: {
  children: React.ReactNode; href: string; link: string;
}) {
  return (
    <div className="flex items-baseline gap-3 mb-2.5">
      <h2 className="text-[13px] font-semibold text-mute uppercase tracking-wide">{children}</h2>
      <Link href={href} className="ml-auto text-[12px] font-semibold text-flame-text">
        {link} →
      </Link>
    </div>
  );
}
import Link from 'next/link';
import { Card, Empty, Money, Tag, VoidTag, voidedText } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import ProductImage from '@/components/ProductImage';

export interface HomeOrder {
  id: string; number: string; date: string; status: string;
  order_lines: { id: string; qty: number; unit_price: number }[];
  invoices: { id: string; shipped: boolean; superseded: boolean }[];
}
export interface HomeParcel {
  id: string; number: string; shipped_at: string | null;
  carrier: string | null; tracking_number: string | null; tracking_url: string | null;
  orderNumber: string | null;
}
export interface HomeGroup {
  slug: string; name: string; brand: string | null; image_url: string | null;
}
export interface HomeDepartment { slug: string; name: string; total: number }

export interface HomeData {
  clientName: string;
  tier: string | null;
  productCount: number;
  outstanding: number;
  dueCount: number;
  overdueCount: number;
  earliestOverdue: string | null;
  inProgressCount: number;
  orders: HomeOrder[];
  parcel: HomeParcel | null;
  groups: HomeGroup[];
  departments: HomeDepartment[];
}

/**
 * Where a signed-in customer lands.
 *
 * It answers the two questions someone opens the portal with — what is
 * happening with my orders, and what do I owe — and then gets out of the way
 * towards the catalogue. Everything on it is a link to the screen that already
 * does the job properly; nothing here is the only place to see something.
 */
export default function HomeScreen({ data }: { data: HomeData }) {
  return (
    <div className="space-y-6">
      {/* ── who you are, and the one button that matters ── */}
      <section className="bg-ink text-white rounded-card px-5 sm:px-7 py-6 sm:py-8">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <div className="min-w-[240px]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8DA0B0]">
              {data.tier ? `${data.tier} pricing` : 'Trade account'}
            </div>
            <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-[-0.025em]
                           leading-[1.1] mt-1.5">
              {data.clientName}
            </h1>
            <p className="text-[13px] text-[#AEBDC9] mt-2">
              {data.productCount} products at your prices, excluding VAT.
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5 ml-auto">
            <Link
              href="/portal/catalogue"
              className="bg-flame text-white text-[14px] font-semibold rounded px-5 py-2.5
                         hover:bg-[#E63D10]"
            >
              Browse the catalogue
            </Link>
            <Link
              href="/portal/history"
              className="border border-white/25 text-[14px] font-semibold rounded px-5 py-2.5
                         hover:bg-white/10"
            >
              Order again
            </Link>
          </div>
        </div>
      </section>

      {/* ── what is going on, in three numbers ── */}
      <div className="grid sm:grid-cols-3 gap-3">
        <Summary
          href="/portal/orders"
          label="Orders in progress"
          value={String(data.inProgressCount)}
          note={data.inProgressCount ? 'Still on their way to you' : 'Everything has shipped'}
        />
        <Summary
          href="/portal/invoices"
          label="Outstanding"
          value={<Money value={data.outstanding} />}
          note={`${data.dueCount} invoice${data.dueCount === 1 ? '' : 's'} `
              + 'awaiting payment, inc VAT'}
        />
        <Summary
          href="/portal/invoices"
          label="Overdue"
          value={String(data.overdueCount)}
          note={data.earliestOverdue
            ? `Earliest was due ${fmtDate(data.earliestOverdue)}`
            : 'Nothing past its due date'}
          alarm={data.overdueCount > 0}
        />
      </div>

      {/* ── the parcel on its way ── */}
      {data.parcel?.tracking_url && (
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <Tag tone="green">Latest shipment</Tag>
            <span className="num text-[13px] font-semibold">{data.parcel.orderNumber}</span>
            <span className="text-[12px] text-mute num">
              Sent {fmtDate(data.parcel.shipped_at)} · {data.parcel.carrier}
            </span>
            <a
              href={data.parcel.tracking_url} target="_blank" rel="noreferrer"
              className="ml-auto text-[12px] font-semibold bg-ink text-white rounded px-[10px] py-[5px]"
            >
              Track {data.parcel.tracking_number}
            </a>
          </div>
        </Card>
      )}

      {/* ── recent orders ── */}
      <section>
        <Heading href="/portal/history" link="All orders">Recent orders</Heading>
        {data.orders.length === 0 ? (
          <Card>
            <Empty>
              No orders yet.{' '}
              <Link href="/portal/catalogue" className="text-flame-text font-semibold">
                Start with the catalogue
              </Link>
              .
            </Empty>
          </Card>
        ) : (
          <Card>
            <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Order</th><th>Date</th>
                  <th className="text-right">Lines</th>
                  <th className="text-right">Net</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((o) => {
                  const cancelled = o.status === 'cancelled';
                  const net = o.order_lines.reduce((a, l) => a + l.qty * Number(l.unit_price), 0);
                  const invoices = o.invoices.filter((i) => !i.superseded);
                  const delivered = invoices.length > 0 && invoices.every((i) => i.shipped);
                  return (
                    <tr key={o.id} className={cancelled ? 'opacity-55' : ''}>
                      <td className={`num font-semibold ${cancelled ? voidedText : ''}`}>
                        <Link href="/portal/orders" className="hover:text-flame-text">
                          {o.number}
                        </Link>
                      </td>
                      <td className="num whitespace-nowrap">{fmtDate(o.date)}</td>
                      <td className="num text-right">{o.order_lines.length}</td>
                      <td className={`num text-right ${cancelled ? 'line-through' : ''}`}>
                        <Money value={net} />
                      </td>
                      <td>
                        {cancelled
                          ? <VoidTag>cancelled</VoidTag>
                          : delivered
                            ? <Tag tone="green">Delivered</Tag>
                            : <Tag tone="line">In progress</Tag>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </Card>
        )}
      </section>

      {/* ── things worth specifying rather than picking off a shelf ── */}
      {data.groups.length > 0 && (
        <section>
          <Heading href="/portal/catalogue" link="Whole catalogue">
            Build it to spec
          </Heading>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {data.groups.map((g) => (
              <Link
                key={g.slug}
                href={`/portal/build/${g.slug}`}
                className="group block bg-white border border-line rounded-card overflow-hidden
                           hover:border-flame focus-visible:border-flame transition-colors"
              >
                <ProductImage
                  src={g.image_url} alt=""
                  className="w-full aspect-[5/3] border-0 border-b border-line rounded-none bg-parch"
                  sizePx={320} placeholderScale="quiet"
                />
                <div className="p-3">
                  <div className="text-[13px] font-semibold leading-tight">{g.name}</div>
                  {g.brand && <div className="text-[12px] text-mute mt-0.5">{g.brand}</div>}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── straight into a department ── */}
      {data.departments.length > 0 && (
        <section>
          <Heading href="/portal/catalogue" link="All departments">Shop by department</Heading>
          <div className="flex flex-wrap gap-2">
            {data.departments.map((d) => (
              <Link
                key={d.slug}
                href={`/portal/c/${d.slug}`}
                className="text-[13px] font-medium bg-white border border-line rounded-card
                           px-3.5 py-2 hover:border-flame transition-colors"
              >
                {d.name}
                <span className="num text-mute text-[12px] ml-2">{d.total}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <p className="text-[12px] text-mute">
        Prices shown are yours alone and exclude VAT. Anything not right —
        an address, a price, an order you need changing —{' '}
        <Link href="/portal/account" className="text-flame-text font-semibold">
          your account page
        </Link>{' '}
        has your details, and we are on the end of the phone.
      </p>
    </div>
  );
}

/** One of the three numbers across the top. Each one opens the screen behind it. */
function Summary({ href, label, value, note, alarm = false }: {
  href: string; label: string; value: React.ReactNode; note: string; alarm?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`block bg-white border rounded-card p-4 transition-colors
                  ${alarm ? 'border-danger' : 'border-line hover:border-flame'}`}
    >
      <div className="text-[11px] font-semibold text-mute uppercase tracking-wide">{label}</div>
      <div className={`num text-[26px] font-semibold tracking-[-0.02em] mt-1.5
                       ${alarm ? 'text-danger' : ''}`}>
        {value}
      </div>
      <div className="text-[12px] text-mute mt-1">{note}</div>
    </Link>
  );
}

function Heading({ children, href, link }: {
  children: React.ReactNode; href: string; link: string;
}) {
  return (
    <div className="flex items-baseline gap-3 mb-2.5">
      <h2 className="text-[13px] font-semibold text-mute uppercase tracking-wide">{children}</h2>
      <Link href={href} className="ml-auto text-[12px] font-semibold text-flame-text">
        {link} →
      </Link>
    </div>
  );
}
