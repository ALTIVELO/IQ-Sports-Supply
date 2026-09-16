import React from 'react';
import Link from 'next/link';

/* The prototype's visual language, as reusable pieces. */

export function Card({ children, className = '', accent = false }: {
  children: React.ReactNode; className?: string; accent?: boolean;
}) {
  return (
    <div className={`bg-white border rounded-card p-4 ${accent ? 'border-flame' : 'border-line'} ${className}`}>
      {children}
    </div>
  );
}

export function PageHeading({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.02em]">{children}</h1>
      {sub && <p className="text-[13px] text-mute mt-1 max-w-3xl">{sub}</p>}
    </div>
  );
}

type Tone = 'ink' | 'accent' | 'line' | 'red' | 'green' | 'amber';
const TONES: Record<Tone, string> = {
  ink: 'bg-ink text-white',
  accent: 'bg-flame text-ink',
  line: 'bg-[#E4E9EE] text-ink',
  red: 'bg-danger text-white',
  green: 'bg-success text-white',
  amber: 'bg-[#8A6100] text-white',
};

export function Tag({ children, tone = 'ink' }: { children: React.ReactNode; tone?: Tone }) {
  return (
    <span className={`${TONES[tone]} text-[11px] font-semibold rounded-[3px] px-[7px] py-[2px] whitespace-nowrap`}>
      {children}
    </span>
  );
}

type BtnKind = 'solid' | 'accent' | 'ghost' | 'danger';
const KINDS: Record<BtnKind, string> = {
  solid: 'bg-ink text-white border-transparent hover:bg-[#22323f]',
  accent: 'bg-flame text-ink border-transparent hover:bg-[#FF5C2E]',
  ghost: 'bg-transparent text-ink border-line hover:bg-parch',
  danger: 'bg-danger text-white border-transparent hover:bg-[#932c19]',
};

export function Button({
  children, kind = 'solid', small, className = '', ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: BtnKind; small?: boolean }) {
  return (
    <button
      {...rest}
      className={`rounded border font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed
        ${small ? 'text-[12px] px-[10px] py-[5px]' : 'text-[13px] px-4 py-2'} ${KINDS[kind]} ${className}`}
    >
      {children}
    </button>
  );
}

export function ButtonLink({
  children, href, kind = 'ghost', small, target, className = '',
}: {
  children: React.ReactNode; href: string; kind?: BtnKind; small?: boolean;
  target?: string; className?: string;
}) {
  return (
    <Link
      href={href}
      target={target}
      className={`inline-block rounded border font-semibold transition-colors
        ${small ? 'text-[12px] px-[10px] py-[5px]' : 'text-[13px] px-4 py-2'} ${KINDS[kind]} ${className}`}
    >
      {children}
    </Link>
  );
}

export function Field({ label, children, hint }: {
  label: string; children: React.ReactNode; hint?: string;
}) {
  return (
    <label className="block text-[12px]">
      <span className="font-semibold block mb-1">{label}</span>
      {children}
      {hint && <span className="block text-mute mt-1 font-normal">{hint}</span>}
    </label>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-[13px] text-mute">{children}</div>;
}

export function Money({ value, className = '' }: { value: number; className?: string }) {
  return (
    <span className={`num ${className}`}>
      £{value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
}

/** Form-level error/success strip used by the server-action forms. */
export function Notice({ tone = 'error', children }: {
  tone?: 'error' | 'success' | 'info'; children: React.ReactNode;
}) {
  const styles = {
    error: 'border-danger/40 bg-[#FDF2F0] text-danger',
    success: 'border-success/40 bg-[#F0F7F2] text-success',
    info: 'border-line bg-parch text-ink',
  }[tone];
  return <div className={`border rounded px-3 py-2 text-[13px] ${styles}`}>{children}</div>;
}

/**
 * How a record that no longer counts should read.
 *
 * A cancelled order and a superseded invoice are still shown — the number was
 * issued and someone will ask about it — but nothing about them should be
 * mistaken for live. Faded so the eye skips them in a list, struck through and
 * red on the number itself, which is the part anyone quotes back at you.
 *
 * Applied at two levels deliberately: striking a whole row would put a line
 * through the badge that says why, which is the one thing still worth reading.
 */
export const voidedRow = 'opacity-55';
export const voidedText = 'line-through text-danger';

/** Says what happened to it, and stays legible while the rest is struck out. */
export function VoidTag({ children }: { children: React.ReactNode }) {
  return <Tag tone="red">{children}</Tag>;
}
