/**
 * The prompt bar (PRD §30–32). The request is classified first; edits the rules understand are
 * previewed instantly without AI. Everything is a preview until Apply — the designer stays in control.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, Loader2, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { applyRouted, INTENT_LABEL, isLocalIntent, routeByRules } from '@acs/providers';
import { diffOverrides } from '@acs/renderer';
import type { BatchAction, Job, RouterResult, Scope, TextLayer } from '@acs/types';
import { api } from '../../lib/api';
import { useEditor } from '../store';
import { useEditorCtx } from '../context';
import { Badge, Button, cx, Menu, MenuItem } from '../../ui';
import { pickProvider, planLabel, useConnections, waitForJob } from './useAi';
import { UsageLimitDialog } from './UsageLimitDialog';

const SCOPES: { value: Scope; label: string }[] = [
  { value: 'card', label: 'This card' }, { value: 'selected', label: 'Selected cards' }, { value: 'project', label: 'Whole project' }, { value: 'project_default', label: 'Project default' },
];

type Pending =
  | { kind: 'preview'; result: RouterResult; text: string }
  | { kind: 'working'; text: string; jobId?: string; intent?: string }
  | { kind: 'copy'; layerId: string; options: string[]; rationale?: string; text: string; provider: string }
  | { kind: 'critique'; summary: string; issues: { text: string; severity?: string }[]; rules: string[]; provider: string }
  | { kind: 'message'; text: string; tone?: 'warn' | 'err' };

export function PromptBar({ selectedCardIds, presetText }: { selectedCardIds?: string[]; presetText?: { text: string; layerId?: string; intentHint?: string; nonce: number } | null }) {
  const ctx = useEditorCtx();
  const design = useEditor((s) => s.design);
  const setPreview = useEditor((s) => s.setPreview);
  const apply = useEditor((s) => s.apply);
  const { data: conns } = useConnections();
  const [text, setText] = useState('');
  const [scope, setScope] = useState<Scope>('card');
  const [pending, setPending] = useState<Pending | null>(null);
  const [limit, setLimit] = useState<{ provider: string; resetAt: string | null } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const project = ctx.bundle.project;
  const textProvider = pickProvider(conns, project.provider, 'textGeneration');

  useEffect(() => {
    if (!presetText) return;
    if (presetText.text) run(presetText.text, presetText.layerId, presetText.intentHint);
    else { input.current?.focus(); }
  }, [presetText?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const discard = () => { setPending(null); setPreview(null); };

  async function run(raw: string, layerId?: string, intentHint?: string) {
    if (!design) return;
    const routed = routeByRules(raw, design);
    if (!intentHint && isLocalIntent(routed)) {
      const bgId = design.layers.find((l) => l.type === 'background' && 'assetId' in l) as { assetId: string | null } | undefined;
      const asset = bgId?.assetId ? ctx.assets.get(bgId.assetId) : null;
      const preview = applyRouted(design, routed, asset ? { width: asset.width, height: asset.height } : null);
      setPreview({ versionId: 'prompt', design: preview, label: INTENT_LABEL[routed.intent] });
      setPending({ kind: 'preview', result: routed, text: raw });
      return;
    }
    const intent = intentHint ?? routed.intent;
    if ((intent === 'GENERATE_BACKGROUND' || intent === 'GENERATE_VARIATIONS' || intent === 'EDIT_BACKGROUND')) {
      ctx.runAi(raw, { intentHint: intent });
      setPending(null);
      return;
    }
    if (!textProvider) {
      setPending({ kind: 'message', tone: 'warn', text: intent === 'UNKNOWN' ? "I couldn't tell what to change, and no AI is connected to work it out. Try: “make the gradient darker”, “hide the logo”, “move the headline up”." : 'This needs AI. Connect ChatGPT or Claude under AI Connections; everything else keeps working without it.' });
      return;
    }
    setPending({ kind: 'working', text: raw, intent });
    try {
      const { job } = await api.post<{ job: Job }>('/ai/prompt', {
        projectId: ctx.bundle.project.id, cardId: ctx.bundle.card.id, text: raw, scope, provider: textProvider.provider, intent, layerId,
        overrides: diffOverrides(ctx.bundle.base, design), baseRev: ctx.bundle.baseRev,
      });
      setPending({ kind: 'working', text: raw, jobId: job.id, intent });
      const done = await waitForJob(job.id);
      handleResult(done, raw);
    } catch (e) {
      setPending({ kind: 'message', tone: 'err', text: (e as Error).message });
    }
  }

  function handleResult(j: Job, raw: string) {
    if (j.status === 'paused') {
      setLimit({ provider: j.provider ?? 'AI', resetAt: j.resumeAt });
      setPending({ kind: 'message', tone: 'warn', text: 'Paused: provider usage limit. The request is kept and can resume later.' });
      return;
    }
    if (j.status !== 'completed' || !j.output) {
      setPending({ kind: 'message', tone: 'err', text: j.error ?? 'The AI could not complete this.' });
      return;
    }
    const o = j.output as Record<string, any>;
    const provider = j.provider ?? '';
    if (o.kind === 'route' && o.result) {
      const r = o.result as RouterResult;
      if (isLocalIntent(r) || r.intent === 'EDIT_GRADIENT') {
        const preview = applyRouted(useEditor.getState().design!, r);
        setPreview({ versionId: 'prompt', design: preview, label: INTENT_LABEL[r.intent] });
        setPending({ kind: 'preview', result: r, text: raw });
        return;
      }
      if (r.intent === 'GENERATE_BACKGROUND' || r.intent === 'GENERATE_VARIATIONS' || r.intent === 'EDIT_BACKGROUND') {
        ctx.runAi(r.imagePrompt ?? raw, { intentHint: r.intent });
        setPending(null);
        return;
      }
      setPending({ kind: 'message', text: r.explanation });
      return;
    }
    if (o.kind === 'copy') setPending({ kind: 'copy', layerId: o.layerId, options: [o.text, ...(o.alternatives ?? [])].filter(Boolean).slice(0, 3), rationale: o.rationale, text: raw, provider });
    else if (o.kind === 'gradient') {
      const r: RouterResult = { intent: 'EDIT_GRADIENT', confidence: 1, targets: ['gradient'], gradient: o.patch, explanation: o.explanation ?? 'Gradient change', source: 'ai' };
      setPreview({ versionId: 'prompt', design: applyRouted(useEditor.getState().design!, r), label: 'Gradient edit' });
      setPending({ kind: 'preview', result: r, text: raw });
    } else if (o.kind === 'critique') setPending({ kind: 'critique', summary: o.summary, issues: o.issues ?? [], rules: o.suggestedRules ?? [], provider });
    else setPending({ kind: 'message', text: o.message ?? 'Done.' });
  }

  function batchOp(r: RouterResult): BatchAction | null {
    if (r.intent === 'EDIT_GRADIENT' && r.gradient) return { action: 'apply_gradient', patch: r.gradient };
    if (r.intent === 'CHANGE_DIMENSIONS' && r.dimensions) return { action: 'resize', width: r.dimensions.width, height: r.dimensions.height, mode: 'scale', fit: 'cover' };
    if (r.intent === 'CHANGE_LAYOUT' && r.layout?.moves.length === 1 && r.layout.moves[0].visible !== undefined) return { action: 'toggle_layer', layerId: r.layout.moves[0].layerId, visible: r.layout.moves[0].visible };
    return null;
  }

  function applyPreview(where: Scope) {
    if (pending?.kind !== 'preview') return;
    const r = pending.result;
    if (where === 'card') {
      const bg = design?.layers.find((l) => l.type === 'background') as { assetId: string | null } | undefined;
      const asset = bg?.assetId ? ctx.assets.get(bg.assetId) : null;
      apply((d) => applyRouted(d, r, asset ? { width: asset.width, height: asset.height } : null), `prompt:${Date.now()}`);
      setPreview(null);
      void ctx.commit(r.explanation.replace(/\.$/, ''), { prompt: pending.text, provider: r.source === 'ai' ? textProvider?.provider : undefined });
    } else {
      const op = batchOp(r);
      if (!op) { toast.error('This change applies to one card at a time.'); return; }
      ctx.applyBeyond(where as Exclude<Scope, 'card'>, op);
      setPreview(null);
    }
    setPending(null);
    setText('');
  }

  const scopeLabel = SCOPES.find((s) => s.value === scope)!.label;
  const canBeyond = pending?.kind === 'preview' && !!batchOp(pending.result);

  return (
    <div className="border-t border-line bg-panel px-4 py-2.5">
      {pending ? (
        <div className="mx-auto mb-2 max-w-[860px] rounded-lg border border-line bg-panel px-3 py-2.5 text-[13px] shadow-[var(--shadow-card)]">
          {pending.kind === 'working' ? (
            <div className="flex items-center gap-2 text-muted"><Loader2 className="size-3.5 animate-spin" />{pending.intent && pending.intent !== 'UNKNOWN' ? INTENT_LABEL[pending.intent as RouterResult['intent']] : 'Working out the request'}… <span className="text-faint">{planLabel(textProvider)}</span><button onClick={discard} className="ml-auto text-faint hover:text-ink"><X className="size-3.5" /></button></div>
          ) : pending.kind === 'preview' ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info">{INTENT_LABEL[pending.result.intent]}</Badge>
              <span className="min-w-0 flex-1">{pending.result.explanation} <span className="text-faint">Previewing in the canvas.</span></span>
              <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} onClick={() => applyPreview(scope === 'card' ? 'card' : scope)}>Apply{scope !== 'card' ? ` to ${scopeLabel.toLowerCase()}` : ''}</Button>
              {canBeyond && scope === 'card' && selectedCardIds?.length ? <Button size="sm" onClick={() => applyPreview('selected')}>Apply to all selected</Button> : null}
              <Button size="sm" variant="ghost" onClick={discard}>Discard</Button>
            </div>
          ) : pending.kind === 'copy' ? (
            <div>
              <div className="mb-1.5 flex items-center gap-2 text-muted"><Sparkles className="size-3.5" />Suggestions for the {pending.layerId}. The source copy is kept as the original. <span className="text-faint">{pending.provider === 'openai' ? 'ChatGPT' : 'Claude'}</span><button onClick={discard} className="ml-auto text-faint hover:text-ink"><X className="size-3.5" /></button></div>
              <div className="flex flex-col gap-1">
                {pending.options.map((o, i) => (
                  <button key={i} className="press flex items-center justify-between gap-3 rounded-md border border-line px-2.5 py-1.5 text-left hover:border-ink" onClick={() => {
                    const l = design?.layers.find((x) => x.id === pending.layerId) as TextLayer | undefined;
                    if (!l) return;
                    useEditor.getState().updateLayer(l.id, { text: o, provenance: { kind: 'ai', original: l.provenance.original ?? l.text, ref: l.provenance.ref ?? null } } as Partial<TextLayer>);
                    void ctx.commit(`${l.role === 'headline' ? 'Heading' : 'Subheading'} edited with AI`, { prompt: pending.text, provider: pending.provider });
                    setPending(null);
                  }}>
                    <span>{o}</span><span className="text-[11.5px] text-muted">Use</span>
                  </button>
                ))}
              </div>
              {pending.rationale ? <div className="mt-1.5 text-[12px] text-faint">{pending.rationale}</div> : null}
            </div>
          ) : pending.kind === 'critique' ? (
            <div>
              <div className="mb-1 flex items-center gap-2 font-medium"><Sparkles className="size-3.5" />Review<button onClick={discard} className="ml-auto text-faint hover:text-ink"><X className="size-3.5" /></button></div>
              <div className="text-muted">{pending.summary}</div>
              <ul className="mt-1.5 flex flex-col gap-1">{pending.issues.map((i, k) => <li key={k} className="flex gap-2"><span className={cx('mt-1.5 size-1.5 shrink-0 rounded-full', i.severity === 'high' ? 'bg-err' : 'bg-warn')} />{i.text}</li>)}</ul>
              {pending.rules.length ? (
                <div className="mt-2 border-t border-line pt-2">
                  <div className="text-[12px] text-muted">Suggested project rules: nothing changes unless you accept.</div>
                  {pending.rules.map((r) => <SuggestedRule key={r} text={r} />)}
                </div>
              ) : null}
            </div>
          ) : (
            <div className={cx('flex items-start gap-2', pending.tone === 'err' ? 'text-err' : pending.tone === 'warn' ? 'text-warn' : 'text-muted')}>
              <span className="flex-1">{pending.text}</span><button onClick={discard} className="text-faint hover:text-ink"><X className="size-3.5" /></button>
            </div>
          )}
        </div>
      ) : null}
      <form className="mx-auto flex max-w-[860px] items-center gap-2 rounded-xl border border-line bg-canvas px-2 py-1.5 focus-within:border-ink"
        onSubmit={(e) => { e.preventDefault(); if (text.trim()) void run(text.trim()); }}>
        <Sparkles className="ml-1 size-4 text-muted" />
        <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask AI to change this design…" data-testid="prompt-input"
          className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-faint" />
        <span className="hidden text-[11.5px] text-faint lg:inline">{planLabel(textProvider) ?? 'Rules only: no AI connected'}</span>
        <Menu align="end" trigger={<button type="button" className="press h-7 rounded-md px-2 text-[12px] text-muted hoverable">Apply to: <span className="text-ink">{scopeLabel}</span></button>}>
          {SCOPES.map((s) => <MenuItem key={s.value} onSelect={() => setScope(s.value)} icon={scope === s.value ? <Check className="size-3.5" /> : null}>{s.label}</MenuItem>)}
        </Menu>
        <button type="submit" disabled={!text.trim() || pending?.kind === 'working'} aria-label="Send" className="press flex size-7 items-center justify-center rounded-lg bg-ink text-white disabled:bg-[#cfcfcf]">
          {pending?.kind === 'working' ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUp className="size-4" />}
        </button>
      </form>
      {limit ? <UsageLimitDialog open onOpenChange={() => setLimit(null)} provider={limit.provider} resetAt={limit.resetAt} /> : null}
    </div>
  );
}

/** Creative observations never become rules on their own (PRD §90). */
function SuggestedRule({ text }: { text: string }) {
  const ctx = useEditorCtx();
  const [state, setState] = useState<'open' | 'done'>('open');
  if (state === 'done') return null;
  const accept = async (where: 'project' | 'template') => {
    try {
      if (where === 'project') await api.post(`/projects/${ctx.bundle.project.id}/rules`, { text, source: 'suggestion' });
      else await api.patch(`/recipes/${ctx.bundle.project.recipeId}`, { brief: `${ctx.bundle.project.brief}\n${text}`.trim() });
      toast.success(where === 'project' ? 'Added to the project rules' : 'Added to the template brief');
      setState('done');
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-md bg-hover px-2.5 py-1.5">
      <span className="min-w-0 flex-1 text-[12.5px]">{text}</span>
      <Button size="sm" variant="ghost" onClick={() => { toast('Noted for this card only; no rule saved.'); setState('done'); }}>This card only</Button>
      <Button size="sm" onClick={() => accept('project')}>Apply to project</Button>
      <Button size="sm" onClick={() => accept('template')}>Apply to template</Button>
      <Button size="sm" variant="ghost" onClick={() => setState('done')}>Ignore</Button>
    </div>
  );
}
