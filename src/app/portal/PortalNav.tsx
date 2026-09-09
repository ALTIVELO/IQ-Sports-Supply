'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  ['/portal', 'Catalogue'],
  ['/portal/orders', 'Current orders'],
  ['/portal/history', 'Order history'],
  ['/portal/invoices', 'Invoices'],
  ['/portal/backorders', 'Back order'],
  ['/portal/shipping', 'Shipping'],
] as const;

export default function PortalNav() {
  const pathname = usePathname();

  return (
    <nav className="border-t border-white/10 overflow-x-auto">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 flex gap-1">
        {ITEMS.map(([href, label]) => {
          const active = href === '/portal' ? pathname === '/portal' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`text-[13px] font-medium px-3 py-2.5 whitespace-nowrap border-b-2
                ${active ? 'border-cobalt text-white' : 'border-transparent text-[#AEBDC9] hover:text-white'}`}
            >
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
