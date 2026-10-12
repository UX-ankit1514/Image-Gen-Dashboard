/** PRD §60 / §97: a usage limit pauses the job; it never asks for an API key or bills another service. */
import { useNavigate } from 'react-router';
import { Button, Dialog } from '../../ui';

export function UsageLimitDialog({ open, onOpenChange, provider, resetAt }: { open: boolean; onOpenChange: (v: boolean) => void; provider: string; resetAt: string | null }) {
  const navigate = useNavigate();
  const name = provider === 'openai' ? 'ChatGPT' : provider === 'claude' ? 'Claude' : provider;
  const manage = provider === 'openai' ? 'https://chatgpt.com/#settings' : 'https://claude.ai/settings/usage';
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Your ${name} plan has reached its current usage limit.`}
      description={`The request is saved and paused${resetAt ? `; it can resume after ${new Date(resetAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}. Nothing has been sent to any paid API.`}
      footer={<>
        <a href={manage} target="_blank" rel="noreferrer"><Button>Manage usage</Button></a>
        <Button onClick={() => { onOpenChange(false); navigate('/connections'); }}>Switch provider</Button>
        <Button variant="primary" onClick={() => onOpenChange(false)}>Try later</Button>
      </>}>
      <p className="text-[13px] text-muted">You can keep editing by hand meanwhile; the canvas, uploads, scanning and export don't need AI.</p>
    </Dialog>
  );
}
