/**
 * AI Connections (PRD §58–62). Bring your own subscription: ChatGPT and Claude connect through the
 * official CLIs on a paired Local Companion. No API keys, no passwords, no cookies — and never a
 * silent switch to paid API usage. "Sign in with ChatGPT" asks the companion to open ChatGPT's own
 * sign-in page on the Mac (the Codex CLI's login); the sign-in never passes through Creative Studio.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Check, CircleCheck, Copy, Laptop, Link2, Loader2, LogIn, Minus, Plug, ShieldCheck, X } from 'lucide-react';
import type { ProviderConnection } from '@acs/types';
import { api } from '../lib/api';
import { ago } from '../lib/format';
import { PageHeader } from '../shell/AppShell';
import { Badge, Button, cx, Dialog, Spinner } from '../ui';
import { useConnections, type ConnectionsView } from '../editor/ai/useAi';

const NAME = { openai: 'ChatGPT', claude: 'Claude' } as const;
const MANAGE = { openai: 'https://chatgpt.com/#settings/Subscription', claude: 'https://claude.ai/settings/usage' } as const;

function statusOf(c: ProviderConnection) {
  if (c.status === 'connected') return { dot: 'bg-ok', text: c.mode === 'local-companion' ? (c.provider === 'claude' ? 'Connected locally' : 'Connected via companion') : 'Connected' };
  if (c.status === 'limited') return { dot: 'bg-warn', text: c.usageLimit?.reached ? 'Usage limit reached' : 'Needs attention' };
  if (c.status === 'unavailable') return { dot: 'bg-[#bdbdbd]', text: 'Companion offline' };
  return { dot: 'bg-[#d4d4d4]', text: 'Not connected' };
}

function Cap({ label, value }: { label: string; value: 'yes' | 'no' | 'depends' | 'off' }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-[13px]">
      <span>{label}</span>
      <span className={cx('flex items-center gap-1.5 text-[12.5px]', value === 'yes' ? 'text-ok' : value === 'depends' ? 'text-warn' : 'text-muted')}>
        {value === 'yes' ? <><Check className="size-3.5" />Available</> : value === 'depends' ? 'Provider dependent' : value === 'off' ? <><Minus className="size-3.5" />Unavailable</> : <><X className="size-3.5" />Not supported</>}
      </span>
    </div>
  );
}

export function ConnectionsPage() {
  const [connecting, setConnecting] = useState(false);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const { data, isLoading } = useConnections(connecting || !!pairing);
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const [welcome, setWelcome] = useState<'openai' | 'claude' | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['connections'] });
  const code = useMutation({ mutationFn: () => api.post<{ code: string; expiresAt: string }>('/connections/pairing-code'), onSuccess: setPairing, onError: (e) => toast.error(e.message) });
  const toggle = useMutation({ mutationFn: ({ id, on }: { id: string; on: boolean }) => api.post(`/connections/${id}/${on ? 'enable' : 'disable'}`), onSuccess: refresh, onError: (e) => toast.error(e.message) });
  const revoke = useMutation({ mutationFn: (id: string) => api.post(`/companion/devices/${id}/revoke`), onSuccess: () => { refresh(); toast.success('Companion unpaired'); } });

  // PRD §59: say plainly whose allowance is used, once, after connecting
  useEffect(() => {
    if (!data) return;
    const connected = params.get('connected') as 'openai' | null;
    if (connected) { setWelcome(connected); setParams({}); return; }
    for (const c of data.connections) {
      const k = `acs-welcomed-${c.id}`;
      // the sign-in dialog says the same thing itself
      try { if (c.status === 'connected' && !localStorage.getItem(k)) { localStorage.setItem(k, '1'); if (!connecting) setWelcome(c.provider); break; } } catch { /* storage blocked */ }
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps


  if (isLoading || !data) return <Spinner className="mx-auto mt-24" />;
  const origin = window.location.origin;

  return (
    <div className="mx-auto max-w-[1080px] pb-16">
      <PageHeader title="AI Connections" sub="Connect the ChatGPT and Claude subscriptions you already have. Creative Studio never asks for an API key." />
      <div className="grid grid-cols-2 gap-4 px-8">
        {data.connections.map((c) => {
          const st = statusOf(c);
          const caps = c.capabilities;
          const imageValue = c.provider === 'claude' ? 'no' : caps.imageGeneration ? 'depends' : c.status === 'connected' ? 'off' : 'depends';
          return (
            <div key={c.id} className="rounded-xl border border-line bg-panel p-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[17px] font-semibold">{NAME[c.provider]}</div>
                  <div className="mt-1 flex items-center gap-2 text-[13px]"><span className={cx('size-2 rounded-full', st.dot)} />{st.text}</div>
                </div>
                {c.status === 'connected' ? <Badge tone="ok">{c.provider === 'openai' ? 'Using ChatGPT plan' : c.planLabel ?? 'Claude plan'}</Badge> : null}
              </div>
              {c.accountLabel ? <div className="mt-2 text-[12.5px] text-muted">Account: {c.accountLabel}</div> : null}
              {c.cli?.version && c.deviceId ? <div className="text-[12px] text-faint">{c.provider === 'claude' ? 'Claude Code' : 'Codex CLI'} {c.cli.version} · {c.cli.authMethod ? `signed in with ${c.cli.authMethod}` : 'not signed in'}</div> : null}
              <div className="mt-4 border-t border-line pt-2">
                <Cap label={c.provider === 'claude' ? 'Reasoning' : 'Text reasoning'} value={caps.textGeneration ? 'yes' : 'off'} />
                <Cap label="Vision" value={caps.visionAnalysis ? 'yes' : 'off'} />
                <Cap label="Image generation" value={imageValue} />
              </div>
              {c.usageLimit?.message ? <div className="mt-3 rounded-md bg-warn-bg px-3 py-2 text-[12.5px] text-[#7a4f10]">{c.usageLimit.message}{c.usageLimit.resetAt ? ` Resets around ${new Date(c.usageLimit.resetAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : ''}</div> : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <a href={MANAGE[c.provider]} target="_blank" rel="noreferrer"><Button size="sm">Manage</Button></a>
                {c.status === 'disconnected' && (c as { disabled?: boolean }).disabled
                  ? <Button size="sm" onClick={() => toggle.mutate({ id: c.id, on: true })}>Reconnect</Button>
                  : c.status !== 'disconnected' ? <Button size="sm" variant="danger" onClick={() => toggle.mutate({ id: c.id, on: false })}>Disconnect</Button> : null}
                {c.provider === 'openai' && c.status !== 'connected' && !(c as { disabled?: boolean }).disabled
                  ? <Button size="sm" variant="primary" icon={<LogIn className="size-3.5" />} onClick={() => setConnecting(true)} data-testid="chatgpt-sign-in">Sign in with ChatGPT</Button> : null}
                {c.provider === 'openai' && data.oauth.openai ? <a href="/api/connections/openai/oauth/start"><Button size="sm" variant="primary">Continue with ChatGPT</Button></a> : null}
              </div>
              {c.provider === 'openai' ? (
                <p className="mt-3 text-[12px] leading-relaxed text-muted">Signing in opens ChatGPT’s own sign-in page on your Mac, through the companion and the official Codex CLI. Your password and tokens stay with ChatGPT and the CLI; generation then uses your ChatGPT plan.</p>
              ) : null}
              {c.provider === 'claude' ? <p className="mt-3 text-[12px] leading-relaxed text-muted">Claude runs through Claude Code on your Mac, signed in with your Claude subscription. It reads and writes; it does not generate images.</p> : null}
            </div>
          );
        })}
      </div>

      <section className="mx-8 mt-6 rounded-xl border border-line bg-panel p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[15px] font-semibold"><Laptop className="size-4" />Local Companion</div>
            <p className="mt-1 max-w-2xl text-[13px] text-muted">A small helper on your Mac that runs the official Claude Code and Codex CLIs with your own sign-in, and sends back only the results. Pair it once with a 6-digit code.</p>
          </div>
          <Button variant="primary" icon={<Plug className="size-3.5" />} loading={code.isPending} onClick={() => code.mutate()}>Pair a companion</Button>
        </div>
        <div className="mt-4 divide-y divide-line">
          {data.companion.devices.length ? data.companion.devices.map((d) => {
            const online = d.lastSeenAt && Date.now() - Date.parse(d.lastSeenAt) < 3 * 60_000;
            return (
              <div key={d.id} className="flex items-center gap-3 py-2.5 text-[13px]">
                <span className={cx('size-2 rounded-full', online ? 'bg-ok' : 'bg-[#cfcfcf]')} />
                <span className="font-medium">{d.name}</span><span className="text-muted">{(d as { platform?: string }).platform}</span>
                <span className="text-faint">{online ? 'online' : d.lastSeenAt ? `last seen ${ago(d.lastSeenAt)}` : 'never seen'}</span>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => revoke.mutate(d.id)}>Unpair</Button>
              </div>
            );
          }) : <div className="py-3 text-[13px] text-muted">No companion paired yet.</div>}
        </div>
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-hover px-3 py-2.5 text-[12px] text-muted">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
          <span>The companion refuses API-key sign-ins and strips API keys from the environment before running a CLI, so your subscriptions are never swapped for paid API usage. Passwords, cookies and tokens never leave your Mac.</span>
        </div>
      </section>

      {connecting ? <ConnectChatGpt view={data} origin={origin} onClose={() => setConnecting(false)} /> : null}

      <Dialog open={!!pairing} onOpenChange={(v) => !v && setPairing(null)} title="Pair the Local Companion" width={560}
        footer={<Button variant="primary" onClick={() => setPairing(null)}>Done</Button>}>
        {pairing ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-center gap-2 rounded-xl bg-hover py-5 font-mono text-[34px] font-semibold tracking-[0.3em] tabular-nums" data-testid="pairing-code">{pairing.code}</div>
            <div className="text-center text-[12px] text-muted">Valid for 10 minutes · single use</div>
            <div>
              <div className="mb-1.5 text-[12.5px] font-medium">On your Mac, in the Creative Studio folder, run:</div>
              <CopyLine text={`npm run companion -- pair --url ${origin} --code ${pairing.code}`} />
              <div className="mt-2 text-[12px] text-muted">Then keep it running with <code className="rounded bg-hover px-1">npm run companion</code>. This page updates when it checks in.</div>
            </div>
          </div>
        ) : null}
      </Dialog>

      <Dialog open={!!welcome} onOpenChange={() => setWelcome(null)} title={welcome === 'openai' ? "You're using your ChatGPT plan." : "You're using your Claude plan."}
        footer={<Button variant="primary" onClick={() => setWelcome(null)}>Got it</Button>}>
        <p className="text-[13.5px]">Eligible AI requests in Creative Studio will use your existing {welcome === 'openai' ? 'ChatGPT' : 'Claude'} allowance. Creative Studio does not provide unlimited AI usage, and it never switches to paid API billing.</p>
      </Dialog>
    </div>
  );
}

/** One step of the ChatGPT connection, numbered, with a tick once it is done. */
function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children?: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className={cx('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold', done ? 'bg-ok text-white' : 'bg-hover text-ink')}>
        {done ? <Check className="size-3.5" strokeWidth={3} /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold">{title}</div>
        {children ? <div className="mt-1.5 flex flex-col gap-2 text-[13px] text-muted">{children}</div> : null}
      </div>
    </div>
  );
}

/**
 * "Sign in with ChatGPT": 1. the companion runs on this Mac (paired with this site), 2. it opens
 * ChatGPT's sign-in in the browser and reports back. When the companion is already running, the
 * click goes straight to the sign-in.
 */
function ConnectChatGpt({ view, origin, onClose }: { view: ConnectionsView; origin: string; onClose: () => void }) {
  const qc = useQueryClient();
  const openai = view.connections.find((c) => c.provider === 'openai')!;
  const online = view.companion.online;
  const device = view.companion.devices.find((d) => d.lastSeenAt && Date.now() - Date.parse(d.lastSeenAt) < 3 * 60_000) ?? view.companion.devices[0];
  const noCli = online && device?.codexInstalled === false;
  const connected = openai.status === 'connected';
  const s = openai.signIn ?? null;
  const [asked, setAsked] = useState(false);
  const code = useMutation({ mutationFn: () => api.post<{ code: string; expiresAt: string }>('/connections/pairing-code') });
  const signIn = useMutation({
    mutationFn: () => api.post<ConnectionsView>('/connections/openai/sign-in'),
    onSuccess: (v) => { qc.setQueryData(['connections'], v); setAsked(true); },
    onError: (e) => toast.error(e.message),
  });
  // a pairing code is only needed when no companion runs; asked once per dialog
  useEffect(() => { if (!view.companion.paired) code.mutate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // the companion is up and ChatGPT isn't signed in: the click on "Sign in with ChatGPT" means go
  useEffect(() => {
    if (online && !noCli && !connected && !asked && !signIn.isPending && s?.state !== 'requested' && s?.state !== 'opened') signIn.mutate();
  }, [online, noCli, connected]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (connected) toast.success('ChatGPT is connected'); }, [connected]);

  const pending = s?.state === 'requested' || s?.state === 'opened' || signIn.isPending;
  const mac = device?.name ? `“${device.name}”` : 'your Mac';
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} width={560} title="Sign in with ChatGPT"
      description="Generation uses your own ChatGPT plan. Creative Studio never sees your password or asks for an API key."
      footer={<Button variant="primary" onClick={onClose}>{connected ? 'Done' : 'Close'}</Button>}>
      <div className="flex flex-col gap-5" data-testid="connect-chatgpt">
        <Step n={1} title={online ? `The companion is running on ${mac}` : 'Start the companion on your Mac'} done={online}>
          {online ? null : view.companion.paired ? (
            <>
              <span>It is paired but not running. In the Creative Studio folder on your Mac, run:</span>
              <CopyLine text="npm run companion" />
            </>
          ) : (
            <>
              <span>In the Creative Studio folder on your Mac, run this once:</span>
              {code.data ? <CopyLine text={`npm run companion -- pair --url ${origin} --code ${code.data.code}`} /> : <Spinner className="size-4" />}
              <span>then keep it running with <code className="rounded bg-hover px-1">npm run companion</code>. If it already runs for another site, it picks this up by itself. This window moves on when it checks in.</span>
            </>
          )}
          {!online ? <span className="flex items-center gap-1.5 text-[12px]"><Loader2 className="size-3 animate-spin" />Waiting for the companion…</span> : null}
        </Step>

        <Step n={2} title={connected ? 'Signed in with ChatGPT' : 'Sign in with ChatGPT'} done={connected}>
          {connected ? <span className="flex items-center gap-1.5 text-ok"><CircleCheck className="size-3.5" />Connected. Generation now uses your ChatGPT plan.</span>
            : !online ? <span>Next, ChatGPT’s sign-in page opens in your browser.</span>
            : noCli ? (
              <>
                <span>The Codex CLI isn’t installed on {mac}. Install it, then try again:</span>
                <CopyLine text="npm i -g @openai/codex" />
                <div><Button size="sm" onClick={() => signIn.mutate()} loading={signIn.isPending}>Try again</Button></div>
              </>
            ) : s?.state === 'failed' && !signIn.isPending ? (
              <>
                <span className="flex items-start gap-1.5 text-err"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{s.message}</span>
                <div><Button size="sm" variant="primary" icon={<LogIn className="size-3.5" />} onClick={() => signIn.mutate()}>Try again</Button></div>
              </>
            ) : pending ? (
              <span className="flex items-start gap-1.5"><Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" />
                {s?.state === 'opened' ? `ChatGPT’s sign-in page is open in the browser on ${mac}. Sign in there and come back; this updates by itself.` : `Asking ${mac} to open ChatGPT’s sign-in page…`}
              </span>
            ) : (
              <div><Button size="sm" variant="primary" icon={<LogIn className="size-3.5" />} onClick={() => signIn.mutate()}>Sign in with ChatGPT</Button></div>
            )}
        </Step>
      </div>
    </Dialog>
  );
}

function CopyLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2">
      <Link2 className="size-3.5 text-muted" />
      <code className="min-w-0 flex-1 truncate text-[12px]">{text}</code>
      <button className="press rounded p-1 hoverable" aria-label="Copy" onClick={() => { void navigator.clipboard.writeText(text); toast.success('Copied'); }}><Copy className="size-3.5" /></button>
    </div>
  );
}
