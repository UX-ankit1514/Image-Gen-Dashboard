import type { ReactNode } from 'react';
import { cx, SectionTitle } from '../../ui';

export function Section({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('border-b border-line px-4 pt-2 pb-4', className)}>
      <SectionTitle action={action}>{title}</SectionTitle>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  );
}

export function Row({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx('grid grid-cols-[84px_1fr] items-center gap-2', className)}>
      <span className="text-[12px] text-muted">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Grid2({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-1.5">{children}</div>;
}
