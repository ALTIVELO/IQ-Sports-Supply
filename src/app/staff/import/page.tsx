import { requireStaff } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { PageHeading, Card, Tag } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import ImportScreen from './ImportScreen';

export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  await requireStaff(['admin', 'accounts']);
  const sb = await supabaseServer();

  const [{ data: tiers }, { data: locations }, { data: templates }, { data: history }] =
    await Promise.all([
      sb.from('tiers').select('id, name').order('sort'),
      sb.from('locations').select('id, name').eq('active', true).order('name'),
      sb.from('import_templates').select('scope, tier_id, header_row, mapping'),
      sb.from('price_imports')
        .select('id, date, filename, rows_added, rows_changed, effective_from, tiers(name)')
        .order('date', { ascending: false }).limit(15),
    ]);

  return (
    <>
      <PageHeading sub="Excel stays the working master — drop the quarterly sheets in here and the catalogue follows. Column mappings are remembered per tier, so after the first time it is pure drag-and-drop.">
        Import
      </PageHeading>

      <ImportScreen
        tiers={tiers ?? []}
        locations={locations ?? []}
        templates={(templates ?? []) as never}
      />

      {history && history.length > 0 && (
        <div className="mt-6">
          <h2 className="text-[12px] font-semibold text-mute uppercase tracking-wide mb-2">
            Recent imports
          </h2>
          <Card>
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>When</th><th>File</th><th>Tier</th>
                    <th className="text-right">New SKUs</th>
                    <th className="text-right">Price rows</th>
                    <th>Effective</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td className="num whitespace-nowrap">{fmtDateTime(h.date)}</td>
                      <td>{h.filename ?? '—'}</td>
                      <td>
                        <Tag tone="cobalt">
                          {(h.tiers as unknown as { name: string } | null)?.name ?? '—'}
                        </Tag>
                      </td>
                      <td className="num text-right">{h.rows_added}</td>
                      <td className="num text-right">{h.rows_changed}</td>
                      <td className="num">{h.effective_from}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
