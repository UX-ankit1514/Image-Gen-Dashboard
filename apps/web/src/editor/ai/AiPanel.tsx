/** The two things you do to a background from anywhere in the editor: generate one, or bring your own. */
import { Link } from 'react-router';
import { ImagePlus, Sparkles } from 'lucide-react';
import { useEditorCtx } from '../context';
import { Button } from '../../ui';

export function AiPanel() {
  const ctx = useEditorCtx();
  return (
    <section className="mt-auto flex flex-col gap-1.5 border-t border-line px-4 py-4">
      <Button className="w-full" icon={<Sparkles className="size-3.5" />} disabled={!ctx.canGenerate} onClick={ctx.generateBackground}>Generate background</Button>
      <Button className="w-full" icon={<ImagePlus className="size-3.5" />} onClick={() => ctx.pickImage('background')}>Replace background</Button>
      {!ctx.canGenerate ? <div className="mt-1 text-[12px] text-muted">Generating needs ChatGPT. <Link to="/connections" className="text-ink underline">Connect it</Link>, no API key needed.</div> : null}
    </section>
  );
}
