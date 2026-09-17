import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Wordmark, LogoGlyph } from '@/components/Logo';
import { getSessionUser, isStaff } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'IQ Sports Supply — Shimano components at trade prices',
  description:
    'Trade supply of Shimano road components and Di2 groupsets to shops, clubs and '
    + 'distributors in the UK. Accounts are opened by application; pricing is set per account.',
};

/**
 * The public front door.
 *
 * It sells the account, not the catalogue. Prices are set per customer and are
 * commercially confidential, so nothing priced appears here and nothing here
 * implies stock we have not committed to — every claim on this page is one the
 * business can stand behind on the phone.
 */
export default async function Home() {
  const user = await getSessionUser();
  if (user) redirect(isStaff(user.role) ? '/staff' : '/portal');

  return (
    <main className="min-h-screen flex flex-col bg-white">
      <Header />
      <Hero />
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

          <h1 className="text-[40px] sm:text-[54px] font-semibold leading-[1.04]
                         tracking-[-0.03em] mt-6">
            Shimano components,
            <br />
            at your trade price.
          </h1>

          <p className="text-[15px] sm:text-[16px] text-[#C3D0DA] mt-6 leading-relaxed max-w-xl">
            We supply Shimano road groupsets and componentry to bike shops, clubs and
            distributors. Accounts are opened by application, priced to the account, and
            everything after that runs through your own ordering portal.
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
 * What we carry, said in the supplier's own vocabulary.
 *
 * A buyer scanning this is checking whether we hold the group they fit, so the
 * series numbers matter more than the adjectives.
 */
const RANGE = [
  { name: 'Dura-Ace Di2 R9200', detail: 'Shifters, mechs, chainsets, cassettes, chains' },
  { name: 'Ultegra Di2 R8100', detail: 'The full component set, in every crank length' },
  { name: 'Power meter chainsets', detail: 'Dura-Ace and Ultegra, 50/34 through 54/40' },
  { name: 'Disc rotors', detail: 'CL900, CL800, CL700 and SM series, 140–203mm' },
  { name: 'Bottom brackets', detail: 'UN300, ES300, Hollowtech II and press-fit' },
  { name: 'Brake pads', detail: 'Resin and metal, alloy and steel backed, bulk packs' },
];

function Range() {
  return (
    <Section
      eyebrow="The range"
      title="Road groupsets and the parts that go with them"
      lead="We are a Shimano house. The catalogue runs from a single bottom bracket to a
            complete Di2 groupset built to the rider's cranks, rings and cassette."
    >
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-line border border-line
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
    title: 'Build a groupset to spec',
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
    body: 'Keep your shop, your warehouse and a race address on the account, and pick '
        + 'the one you want at checkout.',
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
    name: 'Bike shops',
    body: 'Workshop consumables through to complete groupsets, on an account that '
        + 'settles on terms rather than on the card every time.',
  },
  {
    name: 'Clubs & elite teams',
    body: 'Equip a squad from one account, with its own pricing and one invoice '
        + 'per order rather than a pile of receipts.',
  },
  {
    name: 'Distributors',
    body: 'Volume pricing, and a catalogue that says plainly what we can supply '
        + 'rather than making you ring to find out.',
  },
];

function WhoFor() {
  return (
    <Section eyebrow="Who we supply" title="Trade only">
      <div className="grid sm:grid-cols-3 gap-6 mt-8">
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
