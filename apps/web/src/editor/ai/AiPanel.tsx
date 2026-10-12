/** AI actions in the inspector (PRD §18): what the connected subscription can do here, capability-gated. */
import { Link } from 'react-router';
import { Eye, Sparkles, Wand2 } from 'lucide-react';
import { useEditorCtx } from '../context';
import { Badge, Button, SectionTitle, Tip } from '../../ui';

export function AiPanel() {
  const ctx = useEditorCtx();
  const a = ctx.aiAvailable;
  return (
    <section className="mt-auto border-t border-line px-4 pt-2 pb-4">
      <SectionTitle action={a.planLabel ? <Badge>{a.planLabel}</Badge> : null}>AI actions</SectionTitle>
      {!a.text && !a.image ? (
        <div className="text-[12.5px] text-muted">No AI connected. Everything here still works by hand. <Link to="/connections" className="text-ink underline">Connect ChatGPT or Claude</Link>, no API key needed.</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Button size="sm" icon={<Eye className="size-3.5" />} disabled={!a.vision} onClick={() => ctx.runAi('Review this card: what would you change and why?', { intentHint: 'ANALYZE_CARD' })}>Critique this card</Button>
          <Tip label={a.image ? 'Generate background variations from the project context' : 'Image generation unavailable on this connection'}>
            <span><Button size="sm" className="w-full" icon={<Sparkles className="size-3.5" />} disabled={!a.image} onClick={() => ctx.runAi('', { intentHint: 'GENERATE_VARIATIONS' })}>Generate background</Button></span>
          </Tip>
          <Button size="sm" icon={<Wand2 className="size-3.5" />} disabled={!a.text} onClick={() => ctx.runAi('', { intentHint: 'PROMPT' })}>Ask for a change…</Button>
          {!a.image ? <div className="text-[11.5px] text-faint">Image generation: unavailable on {a.provider === 'claude' ? 'Claude' : 'this connection'}.</div> : null}
        </div>
      )}
    </section>
  );
}
