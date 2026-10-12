/** Audit events for important activity — not every pixel movement (PRD §80). */
import { newId, nowIso } from '@acs/shared';
import type { AuditEvent } from '@acs/types';
import { P } from '../paths';
import type { Ctx } from './context';

export type AuditType =
  | 'provider.connected' | 'provider.disconnected' | 'companion.paired' | 'companion.revoked'
  | 'project.created' | 'project.archived' | 'project.duplicated' | 'project.deleted'
  | 'scan.started' | 'cards.created' | 'batch.started' | 'card.approved' | 'card.rejected' | 'card.restored'
  | 'export.created' | 'defaults.changed' | 'rule.accepted';

export async function audit(ctx: Ctx, type: AuditType, entity: string, entityId: string, data: Record<string, unknown> = {}) {
  const ev: AuditEvent = { id: newId('aud'), workspaceId: ctx.ws, actor: ctx.actor, type, entity, entityId, data, createdAt: nowIso() };
  try {
    await ctx.db.set(P.audit(ev.id), ev);
  } catch {
    /* auditing must never break the action it records */
  }
}

export async function recentAudit(ctx: Ctx, limit = 100) {
  return ctx.db.query<AuditEvent>(P.audits, { orderBy: [['createdAt', 'desc']], limit });
}
