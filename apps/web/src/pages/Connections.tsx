/**
 * AI Connections (PRD §58–62). Bring your own subscription: ChatGPT and Claude connect through the
 * official CLIs on a paired Local Companion (called the "helper app" on screen). No API keys, no
 * passwords, no cookies — and never a silent switch to paid API usage. "Sign in with ChatGPT" asks
 * the helper to open ChatGPT's own sign-in page in the browser (the Codex CLI's login, on Mac and
 * Windows); the sign-in never passes through Creative Studio. Setting the helper up is one screen:
 * copy a connect code, double-click one file, paste.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Check, ChevronRight, CircleCheck, Copy, FileCode2, Laptop, Link2, Loader2, LogIn, Minus, Plug, ShieldCheck, X } from 'lucide-react';
import type { ProviderConnection } from '@acs/types';
import { api } from '../lib/api';
import { ago } from '../lib/format';
import { PageHeader } from '../shell/AppShell';
import { Badge, Button, cx, Dialog, Segmented, Spinner } from '../ui';
import { useConnections, type ConnectionsView } from '../editor/ai/useAi';

const NAME = { openai: 'ChatGPT', claude: 'Claude' } as const;
const MANAGE = { openai: 'https://chatgpt.com/#settings/Subscription', claude: 'https://claude.ai/settings/usage' } as const;

function statusOf(c: ProviderConnection) {
  if (c.status === 'connected') return { dot: 'bg-ok', text: c.mode === 'local-companion' ? (c.provider === 'claude' ? 'Connected locally' : 'Connected via helper app') : 'Connected' };
  if (c.status === 'limited') return { dot: 'bg-warn', text: c.usageLimit?.reached ? 'Usage limit reached' : 'Needs attention' };
  if (c.status === 'unavailable') return { dot: 'bg-[#bdbdbd]', text: 'Helper app offline' };
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
  const [pairing, setPairing] = useState(false);
  const { data, isLoading } = useConnections(connecting || pairing);
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const [welcome, setWelcome] = useState<'openai' | 'claude' | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['connections'] });
  const toggle = useMutation({ mutationFn: ({ id, on }: { id: string; on: boolean }) => api.post(`/connections/${id}/${on ? 'enable' : 'disable'}`), onSuccess: refresh, onError: (e) => toast.error(e.message) });
  const revoke = useMutation({ mutationFn: (id: string) => api.post(`/companion/devices/${id}/revoke`), onSuccess: () => { refresh(); toast.success('Computer disconnected'); } });

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
                <p className="mt-3 text-[12px] leading-relaxed text-muted">Opens ChatGPT’s own sign-in in your browser. Sign in the way you normally do. Your password never reaches Creative Studio, and generation uses your ChatGPT plan.</p>
              ) : null}
              {c.provider === 'claude' ? <p className="mt-3 text-[12px] leading-relaxed text-muted">Claude runs through Claude Code on your computer, signed in with your Claude subscription. It reads and writes; it does not generate images.</p> : null}
            </div>
          );
        })}
      </div>

      <section className="mx-8 mt-6 rounded-xl border border-line bg-panel p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[15px] font-semibold"><Laptop className="size-4" />Helper app</div>
            <p className="mt-1 max-w-2xl text-[13px] text-muted">A small app on your Mac or Windows PC that uses your own ChatGPT and Claude sign-ins and sends back only the results. Set it up once.</p>
          </div>
          <Button variant="primary" icon={<Plug className="size-3.5" />} onClick={() => setPairing(true)}>Connect this computer</Button>
        </div>
        <div className="mt-4 divide-y divide-line">
          {data.companion.devices.length ? data.companion.devices.map((d) => {
            const online = d.lastSeenAt && Date.now() - Date.parse(d.lastSeenAt) < 3 * 60_000;
            return (
              <div key={d.id} className="flex items-center gap-3 py-2.5 text-[13px]">
                <span className={cx('size-2 rounded-full', online ? 'bg-ok' : 'bg-[#cfcfcf]')} />
                <span className="font-medium">{d.name}</span><span className="text-muted">{(d as { platform?: string }).platform}</span>
                <span className="text-faint">{online ? 'online' : d.lastSeenAt ? `last seen ${ago(d.lastSeenAt)}` : 'never seen'}</span>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => revoke.mutate(d.id)}>Disconnect</Button>
              </div>
            );
          }) : <div className="py-3 text-[13px] text-muted">No computer connected yet.</div>}
        </div>
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-hover px-3 py-2.5 text-[12px] text-muted">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
          <span>The helper refuses API-key sign-ins and removes API keys before running anything, so your subscriptions are never swapped for paid API usage. Passwords, cookies and tokens never leave your computer.</span>
        </div>
      </section>

      {connecting ? <ConnectChatGpt view={data} onClose={() => setConnecting(false)} /> : null}
      {pairing ? <ConnectComputer view={data} onClose={() => setPairing(false)} /> : null}

      <Dialog open={!!welcome} onOpenChange={() => setWelcome(null)} title={welcome === 'openai' ? "You're using your ChatGPT plan." : "You're using your Claude plan."}
        footer={<Button variant="primary" onClick={() => setWelcome(null)}>Got it</Button>}>
        <p className="text-[13.5px]">Eligible AI requests in Creative Studio will use your existing {welcome === 'openai' ? 'ChatGPT' : 'Claude'} allowance. Creative Studio does not provide unlimited AI usage, and it never switches to paid API billing.</p>
      </Dialog>
    </div>
  );
}


// ---------------------------------------------------------------- setting up the helper app
type Os = 'mac' | 'windows';
const guessOs = (): Os => (typeof navigator !== 'undefined' && /Win/i.test(navigator.userAgent) ? 'windows' : 'mac');
const LAUNCHER = { mac: 'Creative Studio Helper.command', windows: 'Creative Studio Helper.bat' } as const;

/** One step: a numbered dot, a plain sentence, an optional detail under it. */
function Step({ n, title, done, children }: { n: number; title: ReactNode; done?: boolean; children?: ReactNode }) {
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

/** The one-line connect code (site + a code that works once for ten minutes), made when it is needed. */
function useConnectCode(enabled: boolean) {
  const gen = useMutation({ mutationFn: () => api.post<{ code: string; expiresAt: string }>('/connections/pairing-code'), onError: (e) => toast.error(e.message) });
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (enabled) gen.mutate(); }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);
  return {
    line: gen.data ? `${window.location.origin}/#${gen.data.code}` : null,
    expired: !!gen.data && Date.parse(gen.data.expiresAt) <= now,
    loading: gen.isPending,
    renew: () => gen.mutate(),
  };
}

/** Puts text on the clipboard and says whether it worked, so "Copied" is never a guess. */
async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { toast.error('Couldn’t copy. Select the text and copy it yourself.'); return false; }
}

/** Copy button that says so: the one thing a person has to do on this page. */
function CopyCode({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line-strong bg-panel p-1.5 pl-3">
      <code className="min-w-0 flex-1 break-all text-[12.5px] leading-snug text-ink" data-testid="connect-code">{text}</code>
      <Button size="sm" variant="primary" icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} data-testid="copy-connect-code"
        onClick={async () => { if (await copyText(text)) { setCopied(true); setTimeout(() => setCopied(false), 2500); } }}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

/**
 * Getting the helper app running on this computer, in three plain steps. Already connected before
 * (needsCode = false) it is one: open the same file again.
 */
function HelperSetup({ needsCode, code, waiting }: { needsCode: boolean; code: ReturnType<typeof useConnectCode>; waiting: boolean }) {
  const [os, setOs] = useState<Os>(guessOs);
  const [typing, setTyping] = useState(false);
  const file = <span className="inline-flex items-center gap-1 rounded bg-hover px-1.5 py-0.5 align-baseline text-[12.5px] font-medium text-ink"><FileCode2 className="size-3.5" />{LAUNCHER[os]}</span>;
  const hint = os === 'mac'
    ? 'If your Mac says it can’t open it, right-click the file, choose Open, then Open again.'
    : 'If Windows says it protected your PC, choose More info, then Run anyway.';
  return (
    <div className="flex flex-col gap-4" data-testid="helper-setup">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] text-muted">{needsCode ? 'One-time setup, about a minute.' : 'The helper app isn’t running right now.'}</span>
        <Segmented size="sm" value={os} onChange={setOs} options={[{ value: 'mac', label: 'Mac' }, { value: 'windows', label: 'Windows' }]} />
      </div>

      {needsCode ? (
        <Step n={1} title="Copy your connect code">
          {code.expired ? (
            <div className="flex items-center gap-2 rounded-lg bg-warn-bg px-3 py-2 text-[12.5px] text-[#7a4f10]">
              This code has expired.<Button size="sm" className="ml-auto" loading={code.loading} onClick={code.renew}>Get a new code</Button>
            </div>
          ) : code.line ? <CopyCode text={code.line} /> : <Spinner className="size-4" />}
        </Step>
      ) : null}

      <Step n={needsCode ? 2 : 1} title={<>Open the Creative Studio folder and double-click {file}</>}>
        <span>{hint}</span>
      </Step>

      <Step n={needsCode ? 3 : 2} title={needsCode ? 'Paste the code when it asks, then press Enter' : 'Just press Enter when it asks for a code (you’re already connected)'}>
        <span>Leave that window open while you use Creative Studio. This page moves on by itself.</span>
        {waiting ? <span className="flex items-center gap-1.5 text-[12px]"><Loader2 className="size-3 animate-spin" />Waiting for the helper…</span> : null}
      </Step>

      {needsCode && code.line ? (
        <div>
          <button className="flex items-center gap-1 text-[12.5px] text-muted hover:text-ink" onClick={() => setTyping((v) => !v)} aria-expanded={typing}>
            <ChevronRight className={cx('size-3.5 transition-transform duration-150', typing && 'rotate-90')} />Prefer to type a command?
          </button>
          {typing ? (
            <div className="mt-2 flex flex-col gap-1.5">
              <span className="text-[12.5px] text-muted">In a terminal (Terminal on Mac, PowerShell on Windows) opened in the Creative Studio folder:</span>
              <CopyLine text={`npm run companion -- connect "${code.line}"`} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** "Connect this computer" from the helper section: the same setup, and a tick when it checks in. */
function ConnectComputer({ view, onClose }: { view: ConnectionsView; onClose: () => void }) {
  const code = useConnectCode(true);
  const [before] = useState(() => new Set(view.companion.devices.map((d) => d.id)));
  const added = view.companion.devices.find((d) => !before.has(d.id));
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} width={540} title="Connect this computer"
      description="The helper app lets Creative Studio use your own ChatGPT and Claude sign-ins. Nothing leaves your computer except the results."
      footer={<Button variant="primary" onClick={onClose}>{added ? 'Done' : 'Close'}</Button>}>
      {added ? (
        <div className="flex items-center gap-2 text-[13.5px] text-ok" data-testid="computer-connected"><CircleCheck className="size-4" />“{added.name}” is connected.</div>
      ) : <HelperSetup needsCode code={code} waiting />}
    </Dialog>
  );
}

/**
 * "Sign in with ChatGPT": one screen. With the helper running, the click goes straight to ChatGPT's
 * sign-in in the browser; without it, the three setup steps come first and the sign-in follows by itself.
 */
function ConnectChatGpt({ view, onClose }: { view: ConnectionsView; onClose: () => void }) {
  const qc = useQueryClient();
  const openai = view.connections.find((c) => c.provider === 'openai')!;
  const online = view.companion.online;
  const device = view.companion.devices.find((d) => d.lastSeenAt && Date.now() - Date.parse(d.lastSeenAt) < 3 * 60_000) ?? view.companion.devices[0];
  const noCli = online && device?.codexInstalled === false;
  const connected = openai.status === 'connected';
  const s = openai.signIn ?? null;
  const [asked, setAsked] = useState(false);
  const started = useRef(false);
  const code = useConnectCode(!online && !view.companion.paired);
  const signIn = useMutation({
    mutationFn: () => api.post<ConnectionsView>('/connections/openai/sign-in'),
    onSuccess: (v) => { qc.setQueryData(['connections'], v); setAsked(true); },
    onError: (e) => toast.error(e.message),
  });
  // the helper is up and ChatGPT isn't signed in: the click on "Sign in with ChatGPT" means go
  useEffect(() => {
    if (started.current || !online || noCli || connected || asked || signIn.isPending || s?.state === 'requested' || s?.state === 'opened') return;
    started.current = true;
    signIn.mutate();
  }, [online, noCli, connected]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (connected) toast.success('ChatGPT is connected'); }, [connected]);

  const pending = s?.state === 'requested' || s?.state === 'opened' || signIn.isPending;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} width={540} title="Sign in with ChatGPT"
      description="A ChatGPT sign-in page opens in your browser. Sign in the way you normally do. Creative Studio never sees your password."
      footer={<Button variant="primary" onClick={onClose}>{connected ? 'Done' : 'Close'}</Button>}>
      <div data-testid="connect-chatgpt">
        {connected ? (
          <div className="flex items-center gap-2 text-[13.5px] text-ok"><CircleCheck className="size-4" />Connected. Generation now uses your ChatGPT plan.</div>
        ) : !online ? (
          <HelperSetup needsCode={!view.companion.paired} code={code} waiting />
        ) : noCli ? (
          <div className="flex flex-col gap-2 text-[13px] text-muted">
            <span className="text-[14px] font-semibold text-ink">One more thing to install</span>
            <span>ChatGPT’s tool (the Codex CLI) isn’t on this computer yet. In a terminal, run:</span>
            <CopyLine text="npm i -g @openai/codex" />
            <div><Button size="sm" onClick={() => signIn.mutate()} loading={signIn.isPending}>I installed it, try again</Button></div>
          </div>
        ) : s?.state === 'failed' && !signIn.isPending ? (
          <div className="flex flex-col gap-3">
            <span className="flex items-start gap-1.5 text-[13px] text-err"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{s.message}</span>
            <div><Button size="sm" variant="primary" icon={<LogIn className="size-3.5" />} onClick={() => signIn.mutate()}>Try again</Button></div>
          </div>
        ) : pending ? (
          <div className="flex items-start gap-2 text-[13.5px]">
            <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />
            <span>{s?.state === 'opened' ? 'ChatGPT’s sign-in page is open in your browser. Sign in there, then come back. This updates by itself.' : 'Opening ChatGPT’s sign-in page…'}</span>
          </div>
        ) : (
          <Button variant="primary" icon={<LogIn className="size-3.5" />} onClick={() => signIn.mutate()}>Sign in with ChatGPT</Button>
        )}
      </div>
    </Dialog>
  );
}

function CopyLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2">
      <Link2 className="size-3.5 shrink-0 text-muted" />
      <code className="min-w-0 flex-1 break-all text-[12px]">{text}</code>
      <button className="press rounded p-1 hoverable" aria-label="Copy" onClick={async () => { if (await copyText(text)) toast.success('Copied'); }}><Copy className="size-3.5" /></button>
    </div>
  );
}
