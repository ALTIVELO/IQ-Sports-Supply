'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/brand', label: 'Dashboard' },
  { href: '/brand/sales', label: 'Sales' },
  { href: '/brand/dispatch', label: 'To dispatch' },
];

export default function BrandNav() {
  const path = usePathname();
  return (
    <nav className="max-w-5xl mx-auto px-4 sm:px-6 flex gap-1 overflow-x-auto">
      {LINKS.map((l) => {
        const on = l.href === '/brand' ? path === '/brand' : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`text-[13px] font-semibold px-3 py-2 border-b-2 whitespace-nowrap
              ${on ? 'border-flame text-white' : 'border-transparent text-[#8DA0B0] hover:text-white'}`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
