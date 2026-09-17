import { requireStaff } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { Card, PageHeading } from '@/components/ui';
import PasswordCard from '@/components/PasswordCard';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Your sign-in — IQ Sports Supply' };

/**
 * A staff member's own sign-in.
 *
 * Every role, not just the two that run the company: a packer signs in as
 * often as an admin does, and the case for not going via your inbox every
 * morning is the same one.
 */
export default async function StaffAccountPage() {
  const user = await requireStaff();
  const sb = await supabaseServer();
  const { data: hasPassword } = await sb.rpc('has_password');

  return (
    <>
      <PageHeading sub="An emailed link always works. A password is there for the mornings when you would rather not go via your inbox.">
        Your sign-in
      </PageHeading>

      <div className="space-y-4 max-w-3xl">
        <Card>
          <div className="grid sm:grid-cols-2 gap-4 text-[13px]">
            <div>
              <div className="text-[11px] font-semibold text-mute uppercase tracking-wide">
                Email
              </div>
              <div className="mt-1">{user.email}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold text-mute uppercase tracking-wide">
                Role
              </div>
              <div className="mt-1 capitalize">{user.role}</div>
            </div>
          </div>
          <p className="text-[12px] text-mute mt-3">
            Your email address and role are set by an admin on the Team screen. If either
            is wrong, ask them rather than working around it.
          </p>
        </Card>

        <PasswordCard email={user.email} hasPassword={Boolean(hasPassword)} />
      </div>
    </>
  );
}
