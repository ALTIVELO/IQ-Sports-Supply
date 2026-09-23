'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Button, Card, Money, Notice, Tag } from '@/components/ui';
import { placeOrder } from '../actions';
import { totalsByCurrency } from '@/lib/orders/split';
import { priceRange, tierPrice } from '@/lib/orders/tier-price';
import OuterPrice, { OuterNote } from '@/components/OuterPrice';
import { hasOuter, priceAtQty } from '@/lib/catalogue/outer';
import DropshipFields from '@/components/DropshipFields';
import { emptyDropship, dropshipReady, dropshipPayload,
         type DropshipState } from '@/lib/orders/dropship';
import ProductImage from '@/components/ProductImage';
import CollectionPicker from '@/components/CollectionPicker';
import { groupCollections, idsUnderSlug, type CategoryLite } from '@/lib/catalogue/collections';
import { groupSizes } from '@/lib/catalogue/variants';
import DeskBuild from './DeskBuild';
import AgencyNotice from '@/components/AgencyNotice';
import type { AgencyBrand } from '@/lib/types';
import type { DeskProduct, DeskBuild as Build } from './page';
import QtyStepper from '@/components/QtyStepper';

interface ClientRow {
  id: string; name: string; tier_id: string; address: string | null;
  vat_exempt: boolean; default_location_id: string | null; email: string | null;
}
interface Named { id: string; name: string }

interface DraftLine {
  productId: string; sku: string; name: string; qty: number; unitPrice: number;
  /** The tier price, kept so an override is visible as an override. */
  tierPrice: number;
  /**
   * The carton, and the two prices either side of it.
   *
   * `tierPrice` above is the rate this quantity is on, which moves as the
   * quantity does — a line keyed at ten and cut to three is charged the loose
   * price by place_order whatever the screen says, so the screen has to say
   * it too, or the difference reads as an override of a price nobody is
   * charging. `outerPrice` is the advertised one and does not move, because
   * the arithmetic for "three more and the line costs £132 less" needs both.
   */
  moq: number;
  outerPrice: number;
  breakPrice: number | null;
  currency: string;
  /** The brand key where we introduce this line rather than sell it. */
  agentBrand: string | null;
}

export default function OrderDesk({
  clients, locations, tiers, products, categories, builds, vatRate,
  company, agencyBrands, dropshipTerms,
}: {
  clients: ClientRow[]; locations: Named[]; tiers: Named[];
  products: DeskProduct[]; categories: CategoryLite[];
  builds: Build[]; vatRate: number;
  company: string; agencyBrands: AgencyBrand[];
  /** What a client accepts before we ship direct to their customer. */
  dropshipTerms: string;
}) {
  const [clientId, setClientId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [query, setQuery] = useState('');
  const [collection, setCollection] = useState<string | null>(null);
  const [openSizes, setOpenSizes] = useState<string | null>(null);
  const [openBuild, setOpenBuild] = useState<string | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [notes, setNotes] = useState('');
  const [dropship, setDropship] = useState<DropshipState>(emptyDropship);
  const [placed, setPlaced] = useState<{ id: string; warning?: string } | null>(null);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  const client = clients.find((c) => c.id === clientId);
  const tier = tiers.find((t) => t.id === client?.tier_id);
  const location = locations.find((l) => l.id === locationId);

  function chooseClient(id: string) {
    setClientId(id);
    setLines([]);
    setDropship(emptyDropship);
    setPlaced(null);
    setError('');
    const c = clients.find((x) => x.id === id);
    setLocationId(c?.default_location_id ?? locations[0]?.id ?? '');
  }

  /**
   * What this client pays for this product, or undefined where nothing prices
   * it on their tier.
   *
   * Undefined rather than zero, because zero is a price: a product nobody has
   * priced on the Distributor tier used to read "£0.00" here, which is both
   * wrong and the most expensive kind of wrong — it reads as free. place_order
   * refuses such a line anyway, so the only question is whether the person
   * finds out now or after keying forty of them.
   */
  const priceFor = (p: DeskProduct): number | undefined =>
    tierPrice(p.prices, client?.tier_id);
  /** And the one below the outer, where this tier has one for this product. */
  const breakFor = (p: DeskProduct): number | null =>
    tierPrice(p.breaks, client?.tier_id) ?? null;
  const stockAt = (p: DeskProduct, loc: string) => p.stock[loc] ?? 0;

  // brands.key is the product's brand text normalised the way the database
  // normalises it, so this is the same match it made when filing the product.
  const agencyKeys = new Set(agencyBrands.map((b) => b.key));
  const agentBrandOf = (p: DeskProduct): string | null => {
    const key = (p.brand ?? '').trim().toLowerCase();
    return agencyKeys.has(key) ? key : null;
  };
  const totalStock = (p: DeskProduct) => Object.values(p.stock).reduce((a, b) => a + b, 0);

  // Counted over the whole catalogue, not over what is currently listed, so
  // the numbers on the chips are what a collection holds rather than what is
  // left after a search.
  const collections = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of products) {
      if (p.category_id) counts.set(p.category_id, (counts.get(p.category_id) ?? 0) + 1);
    }
    return groupCollections(categories, counts);
  }, [products, categories]);
  const unfiled = useMemo(
    () => products.filter((p) => !p.category_id).length, [products]);

  /**
   * What to offer, from a collection, a search, or both.
   *
   * Browsing is the case the desk was missing: somebody on the phone asks what
   * gravel bikes there are, and a search box cannot answer that. A collection
   * lists more than a search does, because scrolling a shelf is the point.
   */
  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    const inCollection = collection === null
      ? products
      : collection === 'none'
        ? products.filter((p) => !p.category_id)
        : products.filter((p) => p.category_id
            && idsUnderSlug(categories, collection).includes(p.category_id));

    if (!term) return collection === null ? [] : inCollection;
    // A size that matches brings its whole bike with it, so searching one
    // frame's SKU still shows the range it belongs to.
    const hit = inCollection
      .filter((p) => `${p.sku} ${p.name} ${p.brand ?? ''}`.toLowerCase().includes(term));
    const wanted = new Set(hit.map((p) => p.variant_group ?? p.id));
    return inCollection.filter((p) => wanted.has(p.variant_group ?? p.id));
  }, [query, collection, products, categories]);

  // One row per bike rather than one per frame: five sizes of a Storm filling
  // the result list is the same problem the portal had, and worse here, where
  // the list is a narrow column beside a phone call.
  //
  // Capped after grouping, not before, or a bike built in five sizes would eat
  // five places in a list of eight.
  const shelves = useMemo(
    () => groupSizes(results)
      .map((shelf) => ({
        ...shelf,
        // Any size will do for the picture, but one that has a photo beats one
        // that does not: DRAG photograph the bike, not each frame.
        lead: shelf.sizes.find((p) => p.image_url) ?? shelf.lead,
        name: shelf.sizes[0].name,
        stem: shelf.sizes[0].sku,
      }))
      .slice(0, collection === null && query.trim() ? 8 : 60),
    [results, collection, query],
  );

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  /**
   * The builds worth offering: those in the collection being browsed, or all
   * of them when nothing is. A search matches a build by its own name, so
   * typing "dura-ace" finds the builder rather than only the loose SKUs.
   */
  const offeredBuilds = useMemo(() => {
    const term = query.trim().toLowerCase();
    const ids = collection && collection !== 'none'
      ? idsUnderSlug(categories, collection) : null;
    return builds.filter((b) => {
      if (ids && !(b.category_id && ids.includes(b.category_id))) return false;
      if (collection === 'none' && b.category_id) return false;
      if (term && !`${b.name} ${b.brand ?? ''}`.toLowerCase().includes(term)) return false;
      return b.steps.length > 0;
    });
  }, [builds, collection, query, categories]);

  /** Adds to an existing line rather than making a second one for the same SKU. */
  function addLine(p: DeskProduct, add = 1) {
    const price = priceFor(p);
    if (price === undefined) {
      setError(`${p.sku} has no ${tier?.name ?? 'tier'} price, so it cannot go on this order. `
             + 'Price it on the Catalogue screen first.');
      return;
    }
    setError('');
    setLines((ls) => {
      const existing = ls.find((l) => l.productId === p.id);
      if (existing) {
        return ls.map((l) => {
          if (l.productId !== p.id) return l;
          const qty = l.qty + add;
          // The tenth one added is what takes the line on to the carton price,
          // so the rate is worked out again rather than kept from the first.
          const rate = priceAtQty(
            { price: l.outerPrice, moq: l.moq, break_price: l.breakPrice }, qty);
          const overridden = l.unitPrice !== l.tierPrice;
          return { ...l, qty, tierPrice: rate, unitPrice: overridden ? l.unitPrice : rate };
        });
      }
      const rate = priceAtQty(
        { price, moq: p.moq, break_price: breakFor(p) }, add);
      return [...ls, {
        productId: p.id, sku: p.sku, name: p.name, qty: add,
        unitPrice: rate, tierPrice: rate,
        moq: p.moq, outerPrice: price, breakPrice: breakFor(p),
        currency: p.currency,
        agentBrand: agentBrandOf(p),
      }];
    });
    setQuery('');
  }

  /*
   * The brands on this draft we introduce rather than sell.
   *
   * Told while the order is still being built, because the person on the
   * phone is the one who has to say it out loud, and finding out after the
   * order is raised is finding out too late to say it.
   */
  const agencyOnOrder = useMemo(() => {
    const byKey = new Map(agencyBrands.map((b) => [b.key, b]));
    return [...new Set(lines.map((l) => l.agentBrand).filter(Boolean) as string[])]
      .map((k) => byKey.get(k))
      .filter(Boolean) as AgencyBrand[];
  }, [lines, agencyBrands]);

  // Goods we sell and goods we introduce are invoiced by different companies,
  // so each becomes its own order — the same split the portal basket makes.
  const sellerSplit =
    agencyOnOrder.length + (lines.some((l) => !l.agentBrand) ? 1 : 0);

  /**
   * One line changed — and, where the quantity moved it across an outer, the
   * rate with it.
   *
   * A line keyed at ten and cut to three is charged the loose price by
   * place_order whatever this screen says, so the screen has to say it too.
   * Only an untouched price follows: once somebody has typed over it, it is
   * theirs and the quantity does not get to change it back.
   */
  const patch = (i: number, next: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l, j) => {
      if (j !== i) return l;
      const merged = { ...l, ...next };
      if (next.qty === undefined) return merged;
      const rate = priceAtQty(
        { price: l.outerPrice, moq: l.moq, break_price: l.breakPrice }, merged.qty);
      const overridden = l.unitPrice !== l.tierPrice;
      return { ...merged, tierPrice: rate, unitPrice: overridden ? merged.unitPrice : rate };
    }));

  const effectiveVat = client?.vat_exempt ? 0 : vatRate;

  // An order and an invoice can each only ask for one currency, so a mixed
  // order is raised as one per currency. Totalled that way here, because that
  // is what each invoice will say.
  const totals = totalsByCurrency(
    lines, (l) => l.currency, (l) => l.qty * l.unitPrice, effectiveVat);
  const split = totals.length > 1;

  /** What this order will short at the chosen location, before it is placed. */
  const shortfall = lines
    .map((l) => {
      const p = products.find((x) => x.id === l.productId)!;
      const available = stockAt(p, locationId);
      return { line: l, product: p, short: Math.max(0, l.qty - available), available };
    })
    .filter((r) => r.short > 0);

  function submit() {
    if (!client || !locationId || !lines.length) return;
    setError('');
    startTransition(async () => {
      const result = await placeOrder({
        clientId: client.id,
        locationId,
        lines: lines.map((l) => ({
          product_id: l.productId,
          qty: l.qty,
          // Only send a price when staff actually changed it.
          unit_price: l.unitPrice !== l.tierPrice ? l.unitPrice : null,
        })),
        notes: notes.trim() || undefined,
        dropship: dropshipPayload(dropship),
      });
      if (result.ok) {
        setPlaced({ id: result.orderId!, warning: result.warning });
        setLines([]);
        setNotes('');
      } else {
        setError(result.error ?? 'Could not place the order');
      }
    });
  }

  return (
    <div className="space-y-4">
      {placed && (
        <Card accent>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px]">
              Order placed. The invoice has been raised and emailed to{' '}
              <strong>{client?.name}</strong>
              {' '}with the confirmation CC addresses copied in. Any shortfall has gone
              to the supplier carrying the order reference.
            </p>
            <Link
              href="/staff/orders"
              className="text-[12px] font-semibold border border-line rounded px-[10px] py-[5px] bg-white hover:bg-parch"
            >
              View orders
            </Link>
          </div>
        </Card>
      )}

      {placed?.warning && <Notice tone="info">{placed.warning}</Notice>}
      {error && <Notice>{error}</Notice>}

      {/* min-w-0 on both tracks: a grid column is sized by its widest child's
          min-content, so one dense product row with a SKU, a price and a
          thumbnail on it would otherwise stretch the whole page — including
          the client card beside it — past the edge of a narrow screen. */}
      <div className="grid lg:grid-cols-[280px_minmax(0,1fr)] gap-4 items-start">
        <Card className="space-y-3 min-w-0">
          <div>
            <div className="text-[12px] font-semibold mb-1.5">Client</div>
            <select value={clientId} onChange={(e) => chooseClient(e.target.value)}>
              <option value="">Select client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {client && (
            <>
              <div className="flex flex-wrap gap-1.5">
                <Tag tone="accent">{tier?.name} pricing</Tag>
                {client.vat_exempt && <Tag tone="line">Zero-rated / export</Tag>}
              </div>
              <p className="text-[12px] text-mute leading-relaxed">{client.address}</p>

              <div>
                <div className="text-[12px] font-semibold mb-1.5">Fulfil from</div>
                <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
                <p className="text-[11px] text-mute mt-1">
                  Allocation draws from this site only. The rest goes on back order.
                </p>
              </div>

              <div>
                <div className="text-[12px] font-semibold mb-1.5">Order note</div>
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>

              {/* The same control and the same wording the client would see
                  in the portal — taking the order on the phone must not
                  produce a different record of what was agreed. */}
              <DropshipFields
                value={dropship}
                onChange={setDropship}
                terms={dropshipTerms}
                disabled={pending}
              />
            </>
          )}

          {clients.length === 0 && (
            <p className="text-[12px] text-mute">
              No clients yet — approve a trade account application, or add one under Clients.
            </p>
          )}
        </Card>

        <Card className="min-w-0">
          <div className="text-[12px] font-semibold mb-1.5">Add products</div>
          <input
            placeholder={client ? 'Search SKU, name or brand…' : 'Choose a client first'}
            disabled={!client}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {client && (
            <div className="mt-2.5">
              <CollectionPicker
                groups={collections}
                uncategorised={unfiled}
                value={collection}
                onChange={setCollection}
                label="Browse"
              />
            </div>
          )}

          {/* Builds first: a groupset is specced, not picked off a shelf, and
              the loose fixed-spec SKUs beneath are the thing it replaces. */}
          {client && offeredBuilds.length > 0 && (
            <div className="mt-2.5 space-y-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold text-mute uppercase tracking-wide mr-1">
                  Build
                </span>
                {offeredBuilds.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => setOpenBuild(openBuild === b.id ? null : b.id)}
                    className={`text-[12px] font-semibold rounded px-[10px] py-[5px] border
                      whitespace-nowrap ${openBuild === b.id
                        ? 'bg-flame text-ink border-flame'
                        : 'bg-white border-line hover:bg-parch'}`}
                  >
                    {b.name}
                    <span className="num font-normal opacity-60"> {b.steps.length} steps</span>
                  </button>
                ))}
              </div>
              {offeredBuilds
                .filter((b) => b.id === openBuild)
                .map((b) => (
                  <DeskBuild
                    key={b.id}
                    build={b}
                    products={byId}
                    priceFor={priceFor}
                    stockAt={stockAt}
                    locationId={locationId}
                    onAdd={(picks) => picks.forEach((x) => addLine(x.product, x.qty))}
                    onClose={() => setOpenBuild(null)}
                  />
                ))}
            </div>
          )}

          {collection && shelves.length === 0 && (
            <p className="text-[12px] text-mute mt-2">
              Nothing in this collection{query ? ' matches that search' : ' yet'}.
            </p>
          )}

          {shelves.length > 0 && (
            <div className={`border border-line rounded mt-1.5 overflow-hidden
                             ${collection ? 'max-h-[420px] overflow-y-auto' : ''}`}>
              {shelves.map((shelf) => {
                const sized = shelf.sizes.length > 1;
                const lead = shelf.lead;
                const open = openSizes === shelf.key;
                const rows = sized && open ? shelf.sizes : [];
                // Over the priced sizes only. Counting an unpriced one as
                // zero made a whole bike read "from £0.00" because one frame
                // had never been priced on this client's tier.
                const { low, high, unpriced } = priceRange(shelf.sizes.map(priceFor));
                const held = shelf.sizes.reduce((a, p) => a + stockAt(p, locationId), 0);

                return (
                  <div key={shelf.key} className="border-b border-row-line last:border-b-0">
                    <button
                      onClick={() => (sized
                        ? setOpenSizes(open ? null : shelf.key)
                        : addLine(lead))}
                      aria-expanded={sized ? open : undefined}
                      className="flex w-full items-center gap-2 sm:gap-2.5 px-2.5 py-2
                                 text-[13px] text-left hover:bg-parch"
                    >
                      {/* The slot is kept even when there is no photo, so the
                          SKUs line up — but nothing is drawn in it. Most of
                          this catalogue has no pictures yet, and sixty
                          placeholder glyphs down a narrow column would be
                          worse than the gap. */}
                      <ProductImage
                        src={lead.image_url}
                        alt=""
                        className="w-10 h-10 flex-shrink-0"
                        sizePx={80}
                        placeholderScale="none"
                      />
                      {/* The fixed column keeps SKUs in line on a counter
                          screen. On a narrow one it is the difference between
                          a tidy row and a sideways scroll, so it gives way. */}
                      <span className="num font-semibold sm:min-w-[110px] truncate max-w-[45%] sm:max-w-none">
                        {sized ? shelf.stem.replace(/[-_ ]?[A-Za-z0-9]+$/, '') : lead.sku}
                      </span>
                      <span className="flex-1 min-w-0 truncate">
                        {sized ? shelf.name.split(' — ')[0] : lead.name}
                      </span>
                      {sized ? (
                        <span className="hidden md:inline text-[11px] text-mute whitespace-nowrap">
                          {shelf.sizes.length} sizes ·{' '}
                          {shelf.sizes.map((p) => p.variant_label).join(' ')}
                        </span>
                      ) : null}
                      <span className={`num text-[12px] whitespace-nowrap
                                        ${held > 0 ? 'text-success' : 'text-danger'}`}>
                        {held > 0 ? `${held} here` : 'back order'}
                      </span>
                      <span className="num font-semibold whitespace-nowrap">
                        {low === undefined ? (
                          <span className="text-[11px] font-normal text-danger">
                            no {tier?.name ?? 'tier'} price
                          </span>
                        ) : (
                          <>
                            {low !== high && <span className="text-[11px] text-mute">from </span>}
                            <Money value={low} currency={lead.currency} />
                            {/* Said out loud: a range that quietly skips the
                                sizes nobody priced is a range that lies. */}
                            {unpriced > 0 && (
                              <span className="text-[11px] font-normal text-danger">
                                {' '}· {unpriced} unpriced
                              </span>
                            )}
                          </>
                        )}
                      </span>
                      {sized && (
                        <span className="text-[11px] text-mute w-4 text-right">
                          {open ? '▾' : '▸'}
                        </span>
                      )}
                    </button>

                    {rows.map((size) => {
                      const here = stockAt(size, locationId);
                      const elsewhere = totalStock(size) - here;
                      const price = priceFor(size);
                      return (
                        <button
                          key={size.id}
                          onClick={() => addLine(size)}
                          disabled={price === undefined}
                          className="flex w-full items-center gap-2.5 pl-6 pr-2.5 py-1.5
                                     text-[12px] text-left bg-parch/60 hover:bg-parch
                                     border-t border-row-line disabled:opacity-60"
                        >
                          <span className="font-semibold w-8">{size.variant_label}</span>
                          <span className="num flex-1 min-w-0 truncate text-mute">{size.sku}</span>
                          <span className={`num ${here > 0 ? 'text-success' : 'text-danger'}`}>
                            {here > 0 ? `${here} here` : 'back order'}
                          </span>
                          {elsewhere > 0 && (
                            <span className="num text-mute">{elsewhere} elsewhere</span>
                          )}
                          <span className="num font-semibold">
                            {price === undefined
                              ? <span className="text-danger font-normal">no price</span>
                              /* Both prices before it is added, so the person
                                 on the phone quotes the right one first time. */
                              : <OuterPrice
                                  item={{ price, moq: size.moq, break_price: breakFor(size) }}
                                  qty={0}
                                  currency={size.currency}
                                />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}

          {lines.length > 0 && (
            <div className="overflow-x-auto mt-3.5">
              <table>
                <thead>
                  <tr>
                    <th>SKU</th><th>Item</th>
                    <th className="w-[140px]">Qty</th>
                    <th className="w-[100px]">Unit</th>
                    <th className="w-[90px] text-right">Line</th>
                    <th className="w-[30px]" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.productId}>
                      <td className="num">{l.sku}</td>
                      <td>{l.name}</td>
                      <td>
                        <QtyStepper
                          value={l.qty}
                          min={1}
                          label={`${l.sku} on this order`}
                          onChange={(qty) => patch(i, { qty })}
                        />
                        {hasOuter({ price: l.outerPrice, moq: l.moq, break_price: l.breakPrice }) && (
                          <div className="mt-0.5">
                            <OuterNote
                              item={{ price: l.outerPrice, moq: l.moq, break_price: l.breakPrice }}
                              qty={l.qty}
                              currency={l.currency}
                            />
                          </div>
                        )}
                      </td>
                      <td>
                        <input
                          className="num" type="number" step="0.01" min={0} value={l.unitPrice}
                          onChange={(e) => patch(i, { unitPrice: Number(e.target.value) || 0 })}
                        />
                        {l.unitPrice !== l.tierPrice && (
                          <span className="text-[10px] text-flame-text font-semibold">
                            override · tier <Money value={l.tierPrice} currency={l.currency} />
                          </span>
                        )}
                      </td>
                      <td className="num text-right">
                        <Money value={l.qty * l.unitPrice} currency={l.currency} />
                      </td>
                      <td>
                        <button
                          aria-label={`Remove ${l.sku}`}
                          onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                          className="text-mute text-[15px] leading-none hover:text-danger px-1"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {split && (
            <div className="mt-3">
              <Notice tone="info">
                This has {totals.map((t) => t.currency).join(' and ')} lines on it, so it
                will be raised as {totals.length} orders with {totals.length} invoices, one
                per currency. Both go to the same client at the same address.
              </Notice>
            </div>
          )}

          {sellerSplit > 1 && !split && (
            <div className="mt-3">
              <Notice tone="info">
                Not everything on this order is sold by us, so it will be raised as{' '}
                {sellerSplit} orders. Goods invoiced by different companies cannot
                share one invoice.
              </Notice>
            </div>
          )}

          {agencyOnOrder.map((b) => (
            <AgencyNotice
              key={b.key} className="mt-3"
              terms={b.terms} brand={b.name} company={company}
            />
          ))}

          {shortfall.length > 0 && (
            <div className="mt-3 border border-line rounded bg-parch px-3 py-2.5">
              <div className="text-[12px] font-semibold mb-1">
                Short at {location?.name} — these will back order
              </div>
              <ul className="text-[12px] text-mute space-y-0.5">
                {shortfall.map((r) => {
                  const others = locations
                    .filter((l) => l.id !== locationId && (r.product.stock[l.id] ?? 0) > 0)
                    .map((l) => `${l.name} ${r.product.stock[l.id]}`);
                  return (
                    <li key={r.line.productId} className="num">
                      {r.line.sku} — {r.short} short
                      {others.length > 0 && (
                        <span className="text-flame-text">
                          {' '}· in stock at {others.join(', ')} — switch site or raise a transfer
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {lines.length > 0 && (
            <div className="flex flex-wrap justify-end items-center gap-5 mt-3.5">
              {totals.map((t) => (
                <div key={t.currency} className="flex items-center gap-4">
                  {split && (
                    <span className="text-[11px] font-semibold text-mute uppercase tracking-wide">
                      {t.currency}
                    </span>
                  )}
                  <div className="num text-[13px] text-mute">
                    Net <Money value={t.net} currency={t.currency} />
                    {' '}· VAT ({effectiveVat}%) <Money value={t.vat} currency={t.currency} />
                  </div>
                  <div className="num text-[24px] font-semibold tracking-[-0.02em]">
                    <Money value={t.net + t.vat} currency={t.currency} />
                  </div>
                </div>
              ))}
              <Button kind="accent" onClick={submit}
                      disabled={pending || !locationId || !dropshipReady(dropship)}>
                {pending
                  ? 'Placing…'
                  : split ? `Place ${totals.length} orders` : 'Place order'}
              </Button>
              {/* Said rather than left as a dead button: the person is on the
                  phone and needs to know what to ask for next. */}
              {dropship.on && !dropshipReady(dropship) && (
                <p className="text-[11px] text-flame-text font-semibold">
                  {dropship.shipTo.trim()
                    ? 'Read the terms to the client and tick the box to place this.'
                    : 'Take their customer\u2019s address first.'}
                </p>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
