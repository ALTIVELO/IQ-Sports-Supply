'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import type { Role } from '@/lib/types';
import { Tag } from '@/components/ui';

export interface NavBadges {
  backorderUnits: number;
  packing: number;
  applications: number;
}

type Item = { href: string; label: string; roles?: Role[]; badge?: keyof NavBadges };

const ITEMS: Item[] = [
  { href: '/staff/order', label: 'Order desk' },
  { href: '/staff/orders', label: 'Orders' },
  { href: '/staff/supplier', label: 'Supplier', badge: 'backorderUnits' },
  { href: '/staff/packing', label: 'Packing', badge: 'packing' },
  { href: '/staff/invoices', label: 'Invoices' },
  { href: '/staff/catalogue', label: 'Catalogue' },
  { href: '/staff/clients', label: 'Clients' },
  { href: '/staff/applications', label: 'Applications', roles: ['admin', 'accounts'], badge: 'applications' },
  { href: '/staff/locations', label: 'Locations', roles: ['admin'] },
  { href: '/staff/import', label: 'Import', roles: ['admin', 'accounts'] },
  { href: '/staff/outbox', label: 'Outbox' },
  { href: '/staff/settings', label: 'Settings', roles: ['admin', 'accounts'] },
];

export default function StaffNav({
  badges, role, email,
}: { badges: NavBadges; role: Role; email: string | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = ITEMS.filter((i) => !i.roles || i.roles.includes(role));

  return (
    <>
      {/* Mobile bar */}
      <div className="lg:hidden fixed top-0 inset-x-0 z-40 bg-ink text-parch flex items-center justify-between px-4 h-14">
        <Link href="/staff" className="flex items-center gap-2">
          <span className="bg-cobalt text-white font-extrabold text-sm rounded px-1.5 py-0.5">IQ</span>
          <span className="font-bold text-[15px] text-white">Sports Supply</span>
        </Link>
        <button onClick={() => setOpen(!open)} className="text-[13px] font-semibold px-2 py-1">
          {open ? 'Close' : 'Menu'}
        </button>
      </div>

      <nav
        className={`bg-ink text-parch w-[200px] flex-shrink-0 flex flex-col py-[22px]
          fixed lg:static inset-y-0 left-0 z-30 overflow-y-auto
          ${open ? 'flex' : 'hidden lg:flex'}`}
      >
        <Link href="/staff" className="flex items-center gap-2.5 px-5 pb-1">
          <span className="bg-cobalt text-white font-extrabold text-base rounded px-[7px] py-[3px] tracking-[0.02em]">IQ</span>
          <span className="font-bold text-[17px] text-white leading-tight tracking-[-0.02em]">Sports Supply</span>
        </Link>
        <div className="text-[11px] text-[#8DA0B0] px-5 pt-1.5 pb-5">Trade order book</div>

        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          const count = item.badge ? badges[item.badge] : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={`flex justify-between items-center px-[17px] py-2.5 text-[13px] font-medium border-l-[3px]
                ${active
                  ? 'bg-cobalt/[0.28] border-cobalt text-white'
                  : 'border-transparent text-[#AEBDC9] hover:text-white'}`}
            >
              {item.label}
              {count > 0 && <Tag tone="cobalt">{count}</Tag>}
            </Link>
          );
        })}

        <div className="mt-auto px-5 pt-4 text-[11px] text-[#7C93A6] break-all">
          <div className="capitalize text-[#AEBDC9] font-semibold">{role}</div>
          {email}
          <form action="/api/signout" method="post" className="mt-2">
            <button className="text-[11px] text-[#7C93A6] hover:text-white underline">Sign out</button>
          </form>
        </div>
      </nav>

      {/* Spacer so the fixed mobile bar never covers content */}
      <div className="lg:hidden h-14 w-0" aria-hidden />
    </>
  );
}
