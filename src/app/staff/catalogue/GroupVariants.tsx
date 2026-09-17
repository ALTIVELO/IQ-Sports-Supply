'use client';

import { useState, useTransition } from 'react';
import { Button, Card, Notice, Tag } from '@/components/ui';
import { previewVariantGroups, applyVariantGroups,
         type VariantSuggestion } from './actions';

type Msg = { tone: 'error' | 'success' | 'info'; text: string } | null;

/**
 * Grouping the sizes that were already written into the product names.
 *
 * Shimano put the size in the description and nowhere else, so eighteen
 * shapes of one chainset arrived as eighteen products. This finds them and
 * offers to file them as one model with sizes under it.
 *
 * It shows what it would do before it does it. The rule is conservative but
 * it is still a rule reading English out of a supplier's abbreviations, and
 * the failure — a real product hidden behind another one's name — is one a
 * customer would find before we did.
 */
export default function GroupVariants({ onMessage }: { onMessage: (m: Msg) => void }) {
  const [groups, setGroups] = useState<VariantSuggestion[] | null>(null);
  const [pending, startTransition] = useTransition();

  function look() {
    startTransition(async () => {
      const r = await previewVariantGroups();
      if (r.ok) { setGroups(r.groups); onMessage(null); }
      else onMessage({ tone: 'error', text: r.error });
    });
  }

  function apply() {
    startTransition(async () => {
      const r = await applyVariantGroups();
      onMessage(r.ok
        ? { tone: 'success', text: r.message ?? 'Grouped' }
        : { tone: 'error', text: r.error ?? 'Could not group those products' });
      if (r.ok) setGroups(null);
    });
  }

  if (!groups) {
    return (
      <Button small kind="ghost" disabled={pending} onClick={look}>
        {pending ? 'Looking…' : 'Find variants to group'}
      </Button>
    );
  }

  return (
    <VariantProposal
      groups={groups} pending={pending}
      onApply={apply} onClose={() => setGroups(null)}
    />
  );
}

/**
 * What the grouping would do, laid out for somebody to agree with.
 *
 * Separate from the fetching above so that what is drawn can be looked at
 * without a database behind it — and because a panel that only renders is
 * easier to be sure of than one that also decides when to ask.
 */
export function VariantProposal({
  groups, pending, onApply, onClose,
}: {
  groups: VariantSuggestion[];
  pending: boolean;
  onApply: () => void;
  onClose: () => void;
}) {
  if (!groups.length) {
    return (
      <Notice tone="info">
        Nothing to group. Every product whose size is written into its name is
        already filed under a model.{' '}
        <button onClick={onClose} className="underline font-semibold">
          Close
        </button>
      </Notice>
    );
  }

  const total = groups.reduce((a, g) => a + g.sizes.length, 0);

  return (
    <Card accent className="space-y-3 w-full">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-[14px] font-semibold">
          {groups.length} model{groups.length === 1 ? '' : 's'} found,
          covering {total} SKU{total === 1 ? '' : 's'}
        </span>
        <button onClick={onClose}
                className="ml-auto text-[12px] text-mute hover:text-ink underline">
          Close
        </button>
      </div>

      <p className="text-[12px] text-mute max-w-3xl leading-relaxed">
        Each of these becomes one item in both catalogues, with its sizes to pick
        underneath. Nothing about the products themselves changes — every size keeps
        its own SKU, price, cost and stock, and stays what gets picked and invoiced.
        Anything already grouped is left alone, and a product can be taken back out
        of its group afterwards.
      </p>

      <div className="max-h-[360px] overflow-y-auto space-y-2 pr-1">
        {groups.map((g) => (
          <div key={g.model} className="border border-line rounded p-2.5 bg-white">
            <div className="flex flex-wrap items-baseline gap-2 mb-1.5">
              <span className="text-[13px] font-semibold">{g.model}</span>
              <span className="text-[11px] text-mute num">{g.sizes.length} sizes</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {g.sizes.map((s) => (
                <span key={s.productId} title={`${s.sku} — ${s.name}`}>
                  <Tag tone="line">{s.label}</Tag>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button small kind="accent" disabled={pending} onClick={onApply}>
          {pending ? 'Grouping…' : `Group all ${groups.length}`}
        </Button>
        <Button small kind="ghost" disabled={pending} onClick={onClose}>
          Leave them as they are
        </Button>
      </div>
    </Card>
  );
}
