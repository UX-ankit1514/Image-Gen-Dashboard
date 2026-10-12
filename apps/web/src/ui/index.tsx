/**
 * UI primitives on Radix (accessible), styled to PRD §70–74: quiet surfaces, 8–12 px radius, colour
 * for state only. Pressables scale on :active; popovers scale from their trigger; nothing animates
 * on hover for touch devices.
 */
import { Checkbox as RCheckbox, Dialog as RDialog, DropdownMenu, Popover as RPopover, Select as RSelect, Slider as RSlider, Switch as RSwitch, Tabs as RTabs, ToggleGroup, Tooltip as RTooltip } from 'radix-ui';
import { Check, ChevronDown, Loader2, X } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import type { CardStatus } from '@acs/types';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---------------------------------------------------------------- buttons
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-ink text-white hover:bg-[#2a2a2a] disabled:bg-[#bdbdbd]',
  secondary: 'bg-panel text-ink border border-line hover:border-line-strong disabled:text-faint',
  ghost: 'bg-transparent text-ink hoverable disabled:text-faint',
  danger: 'bg-panel text-err border border-line hover:border-[#e8b4ae] disabled:text-faint',
  subtle: 'bg-hover text-ink hover:bg-[#ebebeb] disabled:text-faint',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  icon?: ReactNode;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'md', icon, loading, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'press inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium disabled:cursor-not-allowed',
        size === 'sm' ? 'h-7 px-2.5 text-[12.5px]' : 'h-8 px-3 text-[13px]',
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; size?: 'sm' | 'md' }>(
  function IconButton({ label, active, size = 'md', className, children, ...rest }, ref) {
    return (
      <Tip label={label}>
        <button
          ref={ref}
          aria-label={label}
          className={cx(
            'press inline-flex shrink-0 items-center justify-center rounded-md text-ink disabled:text-faint',
            size === 'sm' ? 'size-6' : 'size-8',
            active ? 'bg-ink text-white' : 'hoverable',
            className,
          )}
          {...rest}
        >
          {children}
        </button>
      </Tip>
    );
  },
);

// ---------------------------------------------------------------- tooltip (delay once, then instant)
export function TipProvider({ children }: { children: ReactNode }) {
  return <RTooltip.Provider delayDuration={450} skipDelayDuration={400}>{children}</RTooltip.Provider>;
}

export function Tip({ label, children, side = 'top' }: { label: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content side={side} sideOffset={6} className="pop z-50 rounded-md bg-ink px-2 py-1 text-[11.5px] text-white shadow-[var(--shadow-pop)]">
          {label}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

// ---------------------------------------------------------------- inputs
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cx('h-8 w-full rounded-md border border-line bg-panel px-2.5 text-[13px] outline-none placeholder:text-faint focus:border-ink', className)}
      {...rest}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cx('w-full resize-none rounded-md border border-line bg-panel px-2.5 py-2 text-[13px] outline-none placeholder:text-faint focus:border-ink', className)}
      {...rest}
    />
  );
});

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('flex flex-col gap-1.5', className)}>
      <span className="text-[12.5px] font-medium text-ink">{label}</span>
      {children}
      {hint ? <span className="text-[11.5px] text-muted">{hint}</span> : null}
    </label>
  );
}

/** A compact numeric field for the inspector. Arrow keys step 1 (Shift: 10). */
export function NumberField({ label, value, onChange, step = 1, min, max, suffix, className, disabled }: {
  label?: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string; className?: string; disabled?: boolean;
}) {
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  return (
    <div className={cx('flex h-7 items-center gap-1 rounded-md border border-transparent bg-hover px-1.5 focus-within:border-ink', className)}>
      {label ? <span className="w-3.5 shrink-0 text-center text-[11px] text-muted">{label}</span> : null}
      <input
        type="number"
        disabled={disabled}
        value={Number.isFinite(value) ? +value.toFixed(2) : 0}
        step={step}
        onChange={(e) => e.target.value !== '' && onChange(clamp(parseFloat(e.target.value)))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const d = (e.shiftKey ? 10 : 1) * step * (e.key === 'ArrowUp' ? 1 : -1);
            onChange(clamp(+(value + d).toFixed(4)));
          }
        }}
        className="w-full min-w-0 bg-transparent text-[12.5px] tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
      />
      {suffix ? <span className="text-[11px] text-muted">{suffix}</span> : null}
    </div>
  );
}

export function ColorField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
  return (
    <div className="flex h-7 items-center gap-1.5 rounded-md bg-hover px-1.5">
      <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} className="size-4.5 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0" aria-label={label ?? 'Colour'} />
      <input value={value} onChange={(e) => onChange(e.target.value)} className="w-full min-w-0 bg-transparent text-[12.5px] uppercase tabular-nums outline-none" />
    </div>
  );
}

export function Switch({ checked, onCheckedChange, label, disabled }: { checked: boolean; onCheckedChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <RSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className="relative h-[18px] w-[30px] shrink-0 rounded-full bg-[#d4d4d4] transition-colors duration-150 data-[state=checked]:bg-ink disabled:opacity-50"
    >
      <RSwitch.Thumb className="block size-[14px] translate-x-[2px] rounded-full bg-white shadow-sm transition-transform duration-150 ease-[var(--ease-out)] data-[state=checked]:translate-x-[14px]" />
    </RSwitch.Root>
  );
}

export function Checkbox({ checked, onCheckedChange, label, className }: { checked: boolean | 'indeterminate'; onCheckedChange: (v: boolean) => void; label?: string; className?: string }) {
  return (
    <RCheckbox.Root
      checked={checked}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
      className={cx('press flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-line-strong bg-panel data-[state=checked]:border-ink data-[state=checked]:bg-ink data-[state=indeterminate]:border-ink data-[state=indeterminate]:bg-ink', className)}
    >
      <RCheckbox.Indicator className="text-white">{checked === 'indeterminate' ? <span className="block h-[2px] w-2 bg-white" /> : <Check className="size-3" strokeWidth={3} />}</RCheckbox.Indicator>
    </RCheckbox.Root>
  );
}

export function Slider({ value, onChange, min = 0, max = 1, step = 0.01, label, onCommit }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label?: string; onCommit?: (v: number) => void }) {
  return (
    <RSlider.Root
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={([v]) => onChange(v)}
      onValueCommit={([v]) => onCommit?.(v)}
      aria-label={label}
      className="relative flex h-5 w-full touch-none select-none items-center"
    >
      <RSlider.Track className="relative h-[3px] grow rounded-full bg-line">
        <RSlider.Range className="absolute h-full rounded-full bg-ink" />
      </RSlider.Track>
      <RSlider.Thumb className="block size-3.5 rounded-full border border-line-strong bg-white shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ink" />
    </RSlider.Root>
  );
}

export function Select<T extends string>({ value, onChange, options, className, label, size = 'md' }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string; label?: string; size?: 'sm' | 'md';
}) {
  return (
    <RSelect.Root value={value} onValueChange={(v) => onChange(v as T)}>
      <RSelect.Trigger aria-label={label} className={cx('press inline-flex w-full items-center justify-between gap-2 rounded-md border border-line bg-panel px-2.5 text-left text-[13px] outline-none data-[state=open]:border-ink', size === 'sm' ? 'h-7' : 'h-8', className)}>
        <span className="truncate"><RSelect.Value /></span>
        <ChevronDown className="size-3.5 text-muted" />
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content position="popper" sideOffset={4} className="pop z-50 max-h-80 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-line bg-panel p-1 shadow-[var(--shadow-pop)]">
          <RSelect.Viewport>
            {options.map((o) => (
              <RSelect.Item key={o.value} value={o.value} className="relative flex h-8 cursor-default select-none items-center rounded-md pr-7 pl-2 text-[13px] outline-none data-[highlighted]:bg-hover">
                <RSelect.ItemText>{o.label}</RSelect.ItemText>
                <RSelect.ItemIndicator className="absolute right-2"><Check className="size-3.5" /></RSelect.ItemIndicator>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className, size = 'md' }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; title?: string }[]; className?: string; size?: 'sm' | 'md' }) {
  return (
    <ToggleGroup.Root type="single" value={value} onValueChange={(v) => v && onChange(v as T)} className={cx('inline-flex rounded-md bg-hover p-0.5', className)}>
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          title={o.title}
          className={cx('press flex flex-1 items-center justify-center gap-1 rounded-[5px] px-2 text-[12.5px] text-muted data-[state=on]:bg-panel data-[state=on]:text-ink data-[state=on]:shadow-[var(--shadow-card)]', size === 'sm' ? 'h-6' : 'h-7')}
        >
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

// ---------------------------------------------------------------- overlays
export function Dialog({ open, onOpenChange, title, description, children, footer, width = 480 }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; width?: number;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="scrim fixed inset-0 z-40 bg-black/25" />
        <RDialog.Content
          style={{ width: `min(${width}px, calc(100vw - 32px))` }}
          className="modal fixed top-1/2 left-1/2 z-50 max-h-[calc(100vh-48px)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl bg-panel shadow-[var(--shadow-pop)] outline-none"
        >
          <div className="flex items-start justify-between gap-4 px-5 pt-4">
            <div>
              <RDialog.Title className="text-[16px] font-semibold">{title}</RDialog.Title>
              {description ? <RDialog.Description className="mt-1 text-[13px] text-muted">{description}</RDialog.Description> : <RDialog.Description className="sr-only">{String(title)}</RDialog.Description>}
            </div>
            <RDialog.Close asChild>
              <button className="press -mr-1 rounded-md p-1 text-muted hoverable" aria-label="Close"><X className="size-4" /></button>
            </RDialog.Close>
          </div>
          <div className="px-5 py-4">{children}</div>
          {footer ? <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div> : null}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function Menu({ trigger, children, align = 'end' }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'end' | 'center' }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align={align} sideOffset={4} className="pop z-50 min-w-44 rounded-lg border border-line bg-panel p-1 shadow-[var(--shadow-pop)]" onClick={(e) => e.stopPropagation()}>
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function MenuItem({ children, onSelect, icon, danger, disabled, shortcut }: { children: ReactNode; onSelect?: () => void; icon?: ReactNode; danger?: boolean; disabled?: boolean; shortcut?: string }) {
  return (
    <DropdownMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cx('flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 text-[13px] outline-none data-[disabled]:text-faint data-[highlighted]:bg-hover', danger && 'text-err')}
    >
      <span className="flex size-4 items-center justify-center text-muted">{icon}</span>
      <span className="flex-1">{children}</span>
      {shortcut ? <Kbd>{shortcut}</Kbd> : null}
    </DropdownMenu.Item>
  );
}

export const MenuSeparator = () => <DropdownMenu.Separator className="my-1 h-px bg-line" />;

export function Popover({ trigger, children, align = 'start', side = 'bottom', className }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'end' | 'center'; side?: 'top' | 'bottom' | 'left' | 'right'; className?: string }) {
  return (
    <RPopover.Root>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content align={align} side={side} sideOffset={6} className={cx('pop z-50 rounded-lg border border-line bg-panel p-3 shadow-[var(--shadow-pop)] outline-none', className)}>
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

export const Tabs = RTabs.Root;
export function TabList({ children, className }: { children: ReactNode; className?: string }) {
  return <RTabs.List className={cx('flex gap-0.5 rounded-md bg-hover p-0.5', className)}>{children}</RTabs.List>;
}
export function Tab({ value, children }: { value: string; children: ReactNode }) {
  return (
    <RTabs.Trigger value={value} className="press flex-1 rounded-[5px] px-2 py-1 text-[12.5px] text-muted data-[state=active]:bg-panel data-[state=active]:text-ink data-[state=active]:shadow-[var(--shadow-card)]">
      {children}
    </RTabs.Trigger>
  );
}
export const TabPanel = RTabs.Content;

// ---------------------------------------------------------------- state
const STATUS_STYLE: Record<CardStatus, string> = {
  draft: 'bg-hover text-muted',
  needs_review: 'bg-info-bg text-info',
  approved: 'bg-ok-bg text-ok',
  rejected: 'bg-err-bg text-err',
  needs_image: 'bg-warn-bg text-warn',
  needs_copy: 'bg-warn-bg text-warn',
  exported: 'bg-ok-bg text-ok',
  archived: 'bg-hover text-faint',
};
const STATUS_TEXT: Record<CardStatus, string> = {
  draft: 'Draft', needs_review: 'Review', approved: 'Approved', rejected: 'Rejected', needs_image: 'Needs Image', needs_copy: 'Copy Fix', exported: 'Exported', archived: 'Archived',
};

export function StatusPill({ status, className }: { status: CardStatus; className?: string }) {
  return <span className={cx('inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium', STATUS_STYLE[status], className)}>{STATUS_TEXT[status]}</span>;
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'warn' | 'err' | 'ok' | 'info' | 'dark'; className?: string }) {
  const t = { neutral: 'bg-hover text-muted', warn: 'bg-warn-bg text-warn', err: 'bg-err-bg text-err', ok: 'bg-ok-bg text-ok', info: 'bg-info-bg text-info', dark: 'bg-ink text-white' }[tone];
  return <span className={cx('inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium', t, className)}>{children}</span>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-4 animate-spin text-muted', className)} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-panel px-1 text-[10.5px] text-muted">{children}</kbd>;
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      {icon ? <div className="mb-3 text-faint">{icon}</div> : null}
      <div className="text-[15px] font-medium">{title}</div>
      {children ? <div className="mt-1 max-w-sm text-[13px] text-muted">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-8 items-center justify-between">
      <span className="text-[11px] font-semibold tracking-wider text-muted uppercase">{children}</span>
      {action}
    </div>
  );
}
