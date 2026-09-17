import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Wordmark, LogoGlyph } from '@/components/Logo';
import { getSessionUser, isStaff } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'IQ Sports Supply — trade supply built around pro teams',
  description:
    'UK trade supply of components, bikes, clothing and tools to pro and elite teams, '
    + 'bike shops, clubs and distributors. Accounts are opened by application; pricing '
    + 'is set per account.',
};

/**
 * The public front door.
 *
 * It sells the account, not the catalogue. Prices are set per customer and are
 * commercially confidential, so nothing priced appears here and nothing here
 * implies stock we have not committed to.
 *
 * The range is described by department rather than by brand. What we can
 * source changes with the supplier arrangements behind it, and a homepage
 * naming a manufacturer is a homepage that has to be rewritten every time one
 * of those changes.
 */
export default async function Home() {
  const user = await getSessionUser();
  if (user) redirect(isStaff(user.role) ? '/staff' : '/portal');

  return (
    <main className="min-h-screen flex flex-col bg-white">
      <Header />
      <Hero />
      <Teams />
      <Range />
      <HowItWorks />
      <Portal />
      <WhoFor />
      <Closing />
      <Footer />
    </main>
  );
}

function Header() {
  return (
    <header className="bg-ink text-white">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
        <Wordmark tone="light" size="sm" />
        <nav className="ml-auto flex items-center gap-1 sm:gap-2">
          <Link
            href="/login"
            className="text-[13px] font-semibold text-[#AEBDC9] hover:text-white px-3 py-2
                       whitespace-nowrap"
          >
            Sign in
          </Link>
          <Link
            href="/apply"
            className="text-[13px] font-semibold bg-white text-ink rounded px-4 py-2
                       hover:bg-parch whitespace-nowrap"
          >
            Open an account
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="bg-ink text-white relative overflow-hidden">
      {/* The mark, oversized and half off the edge. The hero is a column of
          text on a wide screen and needs something on its right; a watermark
          of our own logo says nothing untrue, which a stock photograph of
          somebody else's warehouse would. */}
      {/* Opacity goes on the wrapper, not the glyph: the flame stroke inside
          the mark is a fixed brand colour and ignores currentColor, so fading
          the text alone leaves a bright orange bar bleeding off the edge. */}
      <div
        className="hidden lg:block absolute -right-16 top-1/2 -translate-y-1/2
                   opacity-[0.07] pointer-events-none"
        aria-hidden
      >
        <LogoGlyph className="w-[420px] h-[420px] text-white" />
      </div>
      <div className="max-w-5xl mx-auto px-6 pt-14 pb-16 sm:pt-20 sm:pb-24 relative">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2.5 text-[11px] font-semibold uppercase
                          tracking-[0.18em] text-[#8DA0B0]">
            <span className="w-8 h-[3px] bg-flame" aria-hidden />
            Trade supply · United Kingdom
          </div>

          <h1 className="text-[34px] sm:text-[52px] font-semibold leading-[1.06]
                         tracking-[-0.03em] mt-6">
            {/* One sentence to a line above phone width, where both fit the
                measure; below it the browser wraps them as it likes. */}
            Built around pro teams.
            <br className="hidden sm:inline" />
            {' '}Open to the trade.
          </h1>

          <p className="text-[15px] sm:text-[16px] text-[#C3D0DA] mt-6 leading-relaxed max-w-xl">
            Components, bikes, clothing and tools, supplied to teams, shops, clubs and
            distributors across the UK. Accounts are opened by application, priced to the
            account, and run the way a race programme actually needs them to be.
          </p>

          <div className="flex flex-wrap gap-3 mt-9">
            <Link
              href="/apply"
              className="bg-flame text-white text-[14px] font-semibold rounded px-6 py-3
                         hover:bg-[#E63D10]"
            >
              Apply for a trade account
            </Link>
            <Link
              href="/login"
              className="border border-white/25 text-[14px] font-semibold rounded px-6 py-3
                         hover:bg-white/10"
            >
              Sign in to your account
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}


/**
 * The claim in the headline, unpacked.
 *
 * Each of these is a thing the portal actually does — a rider-specific build,
 * an address book, buying in against an order, a PDF the moment a document is
 * raised — rather than a promise about how hard we will try.
 */
const TEAM_POINTS = [
  {
    title: 'Built to the rider, not the box',
    body: 'Crank length, chainring, cassette, rotors, wire lengths — specified on the '
        + 'order and priced as one line, so a build for one rider is one line item and '
        + 'not eleven.',
  },
  {
    title: 'Ships where the race is',
    body: 'Keep the service course, the shop and a race address on the same account, '
        + 'and choose the one you need at checkout.',
  },
  {
    title: 'Bought to your order',
    body: 'We buy in against what you order, so what you can have is not limited to '
        + 'what happens to be sitting on a shelf that week.',
  },
  {
    title: 'Paperwork that keeps up',
    body: 'Invoice, proforma or credit note, as a PDF the moment it is raised, on '
        + 'account terms rather than a card at the counter.',
  },
];

function Teams() {
  return (
    <section className="bg-white border-b border-line">
      <div className="max-w-5xl mx-auto px-6 py-14 sm:py-20 grid lg:grid-cols-[1fr_1.15fr] gap-10">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-mute">
            Why teams
          </div>
          <h2 className="text-[26px] sm:text-[32px] font-semibold tracking-[-0.025em]
                         leading-tight mt-3">
            A race week does not look like a shop week.
          </h2>
          <p className="text-[14px] text-mute mt-4 leading-relaxed">
            We built the account around the team first — the rider-by-rider builds, the
            addresses that move with the calendar, the paperwork a soigneur should not
            have to chase. Shops, clubs and distributors get the same account, and it
            turns out they wanted it too.
          </p>
          <div className="w-12 h-[3px] bg-flame mt-7" aria-hidden />
        </div>

        <ul className="space-y-6">
          {TEAM_POINTS.map((t) => (
            <li key={t.title} className="border-l-2 border-line pl-4">
              <h3 className="text-[14px] font-semibold">{t.title}</h3>
              <p className="text-[13px] text-mute mt-1.5 leading-relaxed">{t.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** The four ways the catalogue divides, matching the departments inside it. */
const RANGE = [
  { name: 'Components', detail: 'Parts, wheels and tyres, frames and forks' },
  { name: 'Bikes', detail: 'Complete bicycles, road through to track' },
  { name: 'Clothing', detail: 'Race kit, casual wear and helmets' },
  { name: 'Tools', detail: 'Workshop tools, consumables and accessories' },
];

function Range() {
  return (
    <Section
      eyebrow="The range"
      title="Components, bikes, clothing and tools"
      lead="Everything a workshop, a squad or a shop floor gets through in a season, on
            one account and one invoice. What we can source is a conversation — if it is
            not on the list yet, ask."
    >
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-line border border-line
                      rounded-card overflow-hidden mt-8">
        {RANGE.map((r) => (
          <div key={r.name} className="bg-white p-5">
            <div className="w-6 h-[3px] bg-flame mb-3.5" aria-hidden />
            <div className="text-[14px] font-semibold leading-snug">{r.name}</div>
            <div className="text-[13px] text-mute mt-1.5 leading-relaxed">{r.detail}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

const STEPS = [
  {
    n: '01',
    title: 'Apply',
    body: 'Tell us who you are and what you do — shop, club, team or distributor. '
        + 'Every application is read by a person, not a form filter.',
  },
  {
    n: '02',
    title: 'We price your account',
    body: 'Approved accounts are put on the pricing that fits the trade you do. '
        + 'You see your own prices and nobody else’s, from the first time you sign in.',
  },
  {
    n: '03',
    title: 'Order when it suits you',
    body: 'The portal is open whenever you are. Order, track it through to the door, '
        + 'and pull the invoice down as a PDF whenever your accounts need it.',
  },
];

function HowItWorks() {
  return (
    <Section
      dark
      eyebrow="Opening an account"
      title="Three steps, and a real person at the first one"
      lead="We do not sell to the public, and we do not publish prices. What a customer
            pays depends on the trade they do, which is a conversation rather than a
            checkbox."
    >
      <ol className="grid sm:grid-cols-3 gap-8 mt-10">
        {STEPS.map((s) => (
          <li key={s.n}>
            <div className="num text-[13px] font-bold text-flame tracking-[0.1em]">{s.n}</div>
            <div className="h-px bg-white/15 my-3.5" aria-hidden />
            <h3 className="text-[16px] font-semibold">{s.title}</h3>
            <p className="text-[13px] text-[#AEBDC9] mt-2 leading-relaxed">{s.body}</p>
          </li>
        ))}
      </ol>

      <div className="mt-10">
        <Link
          href="/apply"
          className="inline-block bg-flame text-white text-[14px] font-semibold rounded
                     px-6 py-3 hover:bg-[#E63D10]"
        >
          Start an application
        </Link>
      </div>
    </Section>
  );
}

const PORTAL = [
  {
    title: 'Your prices, never a list price',
    body: 'Everything in the catalogue is shown at the price your account pays, '
        + 'excluding VAT, with the VAT-inclusive figure beside it.',
  },
  {
    title: 'Build to the rider’s spec',
    body: 'Pick the crank length, chainring, cassette, rotors and wire lengths, and '
        + 'order the whole build as one line instead of eleven.',
  },
  {
    title: 'Invoices as PDFs',
    body: 'Every invoice, proforma and credit note downloads as a PDF the moment it '
        + 'is raised. Your bookkeeper never has to ask us for a copy.',
  },
  {
    title: 'Orders followed through',
    body: 'Each order shows what has been allocated, what is still to follow, and the '
        + 'carrier and tracking number once it leaves us.',
  },
  {
    title: 'More than one address',
    body: 'Keep the shop, the warehouse, the service course and a race address on the '
        + 'account, and pick the one you want at checkout.',
  },
  {
    title: 'Everything you have ever bought',
    body: 'Full order history, searchable by order number, SKU or product, so a repeat '
        + 'order is a lookup rather than an archaeology project.',
  },
];

function Portal() {
  return (
    <Section
      eyebrow="The ordering portal"
      title="The part you will actually use"
      lead="Once your account is open, this is where the work happens — built for people
            placing orders all week, not for a showroom."
    >
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-9 mt-9">
        {PORTAL.map((f) => (
          <div key={f.title}>
            <h3 className="text-[14px] font-semibold leading-snug">{f.title}</h3>
            <p className="text-[13px] text-mute mt-2 leading-relaxed">{f.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

const AUDIENCES = [
  {
    name: 'Pro & elite teams',
    body: 'Rider-by-rider builds, kit for the whole squad, and an address book that '
        + 'keeps up with the calendar.',
  },
  {
    name: 'Clubs',
    body: 'Equip a club from one account, with its own pricing and one invoice per '
        + 'order rather than a pile of receipts.',
  },
  {
    name: 'Bike shops',
    body: 'Workshop consumables through to complete bikes, on an account that settles '
        + 'on terms rather than on the card every time.',
  },
  {
    name: 'Distributors',
    body: 'Volume pricing, and a catalogue that says plainly what we can supply rather '
        + 'than making you ring to find out.',
  },
];

function WhoFor() {
  return (
    <Section eyebrow="Who we supply" title="Trade only">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
        {AUDIENCES.map((a) => (
          <div key={a.name} className="border border-line rounded-card p-5 bg-parch">
            <h3 className="text-[15px] font-semibold">{a.name}</h3>
            <p className="text-[13px] text-mute mt-2 leading-relaxed">{a.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Closing() {
  return (
    <section className="bg-parch border-y border-line">
      <div className="max-w-5xl mx-auto px-6 py-14 flex flex-wrap items-center gap-8">
        <LogoGlyph className="w-14 h-14 text-ink flex-shrink-0" />
        <div className="min-w-[260px] flex-1">
          <h2 className="text-[24px] font-semibold tracking-[-0.02em] leading-tight">
            Open a trade account
          </h2>
          <p className="text-[13px] text-mute mt-2 max-w-lg leading-relaxed">
            It takes a few minutes to apply. We will come back to you by email, and if
            we open the account your pricing is live the first time you sign in.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/apply"
            className="bg-ink text-white text-[14px] font-semibold rounded px-6 py-3
                       hover:bg-ink-soft"
          >
            Apply now
          </Link>
          <Link
            href="/login"
            className="border border-line bg-white text-[14px] font-semibold rounded px-6 py-3
                       hover:bg-white/60"
          >
            Sign in
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-white">
      <div className="max-w-5xl mx-auto px-6 py-10 flex flex-wrap gap-8 items-start">
        <Wordmark size="sm" />
        <div className="text-[12px] text-mute leading-relaxed">
          <div className="font-semibold text-ink">IQ Sports Supply Ltd</div>
          2 Carnegie Court, The Broadway,
          <br />
          Farnham Common, Slough SL2 3GQ
        </div>
        <div className="text-[12px] ml-auto flex flex-col gap-1.5">
          <Link href="/apply" className="text-flame-text font-semibold">
            Apply for a trade account
          </Link>
          <Link href="/login" className="text-flame-text font-semibold">Sign in</Link>
        </div>
      </div>
      <div className="border-t border-line">
        <div className="max-w-5xl mx-auto px-6 py-4 text-[11px] text-mute">
          Trade supply only. Prices are set per account and shown once you are signed in.
        </div>
      </div>
    </footer>
  );
}

/** One band of the page, light or dark, with a consistent measure and rhythm. */
function Section({
  eyebrow, title, lead, children, dark = false,
}: {
  eyebrow: string; title: string; lead?: string;
  children: React.ReactNode; dark?: boolean;
}) {
  return (
    <section className={dark ? 'bg-ink text-white' : 'bg-white'}>
      <div className="max-w-5xl mx-auto px-6 py-14 sm:py-20">
        <div className={`text-[11px] font-semibold uppercase tracking-[0.18em]
                         ${dark ? 'text-[#8DA0B0]' : 'text-mute'}`}>
          {eyebrow}
        </div>
        <h2 className="text-[26px] sm:text-[32px] font-semibold tracking-[-0.025em]
                       leading-tight mt-3 max-w-2xl">
          {title}
        </h2>
        {lead && (
          <p className={`text-[14px] mt-4 max-w-2xl leading-relaxed
                         ${dark ? 'text-[#AEBDC9]' : 'text-mute'}`}>
            {lead}
          </p>
        )}
        {children}
      </div>
    </section>
  );
}
