/** The persistent domain model (PRD §9, §41, §50–51), as stored in Firestore. */
import { z } from 'zod';
import type { Design, Overrides } from './design';

export type Iso = string;

// ---------------------------------------------------------------- review states (PRD §41)
export const CardStatus = z.enum([
  'draft', 'needs_review', 'approved', 'rejected', 'needs_image', 'needs_copy', 'exported', 'archived',
]);
export type CardStatus = z.infer<typeof CardStatus>;

export const CARD_STATUS_LABEL: Record<CardStatus, string> = {
  draft: 'Draft',
  needs_review: 'Needs Review',
  approved: 'Approved',
  rejected: 'Rejected',
  needs_image: 'Needs New Image',
  needs_copy: 'Needs Copy Fix',
  exported: 'Exported',
  archived: 'Archived',
};

/** The approval pipeline, tracked separately from the review status. */
export const CardStage = z.enum(['imported', 'source_verified', 'image_ready', 'rendered', 'needs_review', 'approved', 'exported']);
export type CardStage = z.infer<typeof CardStage>;

export const REJECT_TAGS = [
  'Wrong subject', 'Wrong country', 'Wrong style', 'Looks AI-generated', 'Too busy', 'Bad crop',
  'Too similar to another image', 'Contains text', 'Contains fake logo', 'Logo collision',
  'Bad typography', 'Wrong copy', 'Headline overflow', 'Subheading overflow', 'Low resolution',
  'Incorrect image assigned', 'Other',
] as const;
export type RejectTag = (typeof REJECT_TAGS)[number];

/** Tags that mean the picture has to change, and tags that mean the words do. */
export const IMAGE_TAGS: RejectTag[] = [
  'Wrong subject', 'Wrong country', 'Wrong style', 'Looks AI-generated', 'Too busy', 'Bad crop',
  'Too similar to another image', 'Contains text', 'Contains fake logo', 'Low resolution', 'Incorrect image assigned',
];
export const COPY_TAGS: RejectTag[] = ['Wrong copy', 'Headline overflow', 'Subheading overflow'];

// ---------------------------------------------------------------- warnings / exception inbox (PRD §48)
export const WarningCode = z.enum([
  'missing_image', 'low_res', 'duplicate', 'possible_text', 'text_in_photo', 'logo_conflict',
  'logo_edge', 'logo_contrast', 'missing_heading', 'missing_subheading', 'headline_overflow',
  'subheading_overflow', 'key_line_contrast', 'unmatched_upload', 'failed_scrape', 'failed_generation',
  'failed_render', 'rejected_image', 'source_changed', 'source_removed', 'aspect_mismatch', 'no_highlights',
]);
export type WarningCode = z.infer<typeof WarningCode>;

export interface CardWarning {
  code: WarningCode;
  severity: 'info' | 'warning' | 'error';
  message: string;
  detail?: string;
}

export const INBOX_CATEGORIES: { key: string; label: string; codes: WarningCode[] }[] = [
  { key: 'missing_image', label: 'Missing image', codes: ['missing_image'] },
  { key: 'low_res', label: 'Low resolution', codes: ['low_res'] },
  { key: 'duplicate', label: 'Duplicate', codes: ['duplicate'] },
  { key: 'text', label: 'Text in photograph', codes: ['possible_text', 'text_in_photo'] },
  { key: 'logo', label: 'Possible logo conflict', codes: ['logo_conflict', 'logo_edge', 'logo_contrast'] },
  { key: 'missing_heading', label: 'Missing heading', codes: ['missing_heading'] },
  { key: 'missing_subheading', label: 'Missing subheading', codes: ['missing_subheading', 'no_highlights'] },
  { key: 'overflow', label: 'Overflow', codes: ['headline_overflow', 'subheading_overflow'] },
  { key: 'unmatched_upload', label: 'Unmatched upload', codes: ['unmatched_upload'] },
  { key: 'failed_scrape', label: 'Failed scrape', codes: ['failed_scrape', 'source_removed'] },
  { key: 'failed_generation', label: 'Failed generation', codes: ['failed_generation', 'failed_render'] },
  { key: 'rejected', label: 'Rejected image', codes: ['rejected_image'] },
];

// ---------------------------------------------------------------- entities
export type Role = 'owner' | 'editor' | 'viewer';

export interface Workspace {
  id: string;
  name: string;
  /** No auth in V1 (Cloudflare Access gates the app); roles are modelled for later (PRD §79). */
  members: Record<string, Role>;
  settings: { namingTemplate: string; defaultProvider: ProviderChoice; /** What Export downloads (default jpg, as the shipped cards were). */ exportFormat?: 'png' | 'jpg' | 'webp' };
  createdAt: Iso;
}

export type ProviderChoice = 'chatgpt' | 'claude' | 'auto' | 'none';

export interface ProjectStats {
  total: number;
  approved: number;
  review: number;
  needsImage: number;
  needsCopy: number;
  rejected: number;
  draft: number;
  exported: number;
  errors: number;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description: string;
  recipeId: string;
  /** Editable creative brief — AI always receives it (PRD §37). */
  brief: string;
  /** Persistent negative instructions (PRD §36). */
  negativeConstraints: string[];
  /** Accepted project rules (PRD §90): manual or accepted AI suggestions, never silent. */
  rules: { id: string; text: string; source: 'manual' | 'suggestion'; createdAt: Iso }[];
  defaults: Overrides;
  defaultsRev: string;
  width: number;
  height: number;
  status: 'active' | 'archived';
  provider: ProviderChoice;
  namingTemplate: string;
  stats: ProjectStats;
  coverThumbs: string[];        // storage keys of up to 4 card thumbnails
  exportStatus: 'none' | 'partial' | 'exported';
  lastExportAt: Iso | null;
  inputType: string;
  createdAt: Iso;
  updatedAt: Iso;
  lastEditedAt: Iso;
}

/** Immutable snapshot of a project's base design; card versions point at one (PRD §40). */
export interface DefaultsRevision {
  id: string;
  projectId: string;
  base: Design;
  reason: string;
  createdAt: Iso;
}

export interface PageImage {
  url: string;
  role: 'banner' | 'hero' | 'og' | 'slider' | 'content' | 'alternative' | 'cached';
  assetId: string | null;
  alt?: string;
}

export interface Highlight { title: string; desc: string }

export interface SourcePage {
  id: string;
  projectId: string;
  scanId: string;
  url: string;
  slug: string;
  pageType: PageKind;
  title: string;
  name: string;
  h1: string;
  subheading: string;
  highlights: Highlight[];
  benefits: string[];
  country: string | null;
  jurisdiction: string | null;
  authority: string | null;
  category: string | null;
  price: string | null;
  estTime: string | null;
  images: PageImage[];
  relatedLinks: string[];
  rawMetadata: Record<string, unknown>;
  status: 'ok' | 'failed' | 'removed';
  error: string | null;
  contentHash: string;
  lastScannedAt: Iso;
}

export type PageKind = 'detail' | 'product_listing' | 'service_section' | 'jurisdiction_listing' | 'collection' | 'unknown';

export interface Card {
  id: string;
  projectId: string;
  sourcePageId: string | null;
  name: string;
  slug: string;
  order: number;
  status: CardStatus;
  stage: CardStage;
  currentVersionId: string | null;
  /** The version a production export uses. Editing never moves it (PRD §68). */
  approvedVersionId: string | null;
  versionCount: number;
  /** The autosaved working state, ahead of the current version until it is committed. */
  draft: Overrides | null;
  draftRev: string | null;      // defaults revision the draft is relative to
  draftUpdatedAt: Iso | null;
  dirty: boolean;
  backgroundAssetId: string | null;
  thumbKey: string | null;
  previewKey: string | null;
  warnings: CardWarning[];
  sourceLabel: string;          // "Website", "Upload", "Generated", "Import"
  createdAt: Iso;
  updatedAt: Iso;
}

export interface CardVersion {
  id: string;
  cardId: string;
  projectId: string;
  number: number;
  width: number;
  height: number;
  overrides: Overrides;
  defaultsRev: string;
  previewKey: string | null;
  thumbKey: string | null;
  reason: string;
  actor: string;
  provider: string | null;
  prompt: string | null;
  jobId: string | null;
  parentVersionId: string | null;
  createdAt: Iso;
}

export interface Feedback {
  id: string;
  cardId: string;
  projectId: string;
  versionId: string | null;
  kind: 'reject' | 'approve' | 'note';
  tags: RejectTag[];
  text: string;
  backgroundAssetId: string | null;
  actor: string;
  createdAt: Iso;
}

export type AssetType = 'image' | 'logo' | 'reference' | 'preview' | 'export' | 'screenshot' | 'gradient';
export type AssetSource = 'website' | 'upload' | 'generated' | 'screenshot' | 'render' | 'import' | 'global';

export interface AssetFlags {
  lowRes?: boolean;
  duplicateOf?: string | null;
  possibleText?: boolean;
  containsText?: boolean | null;   // null = not checked (needs AI vision)
  containsLogo?: boolean | null;
  aspectMismatch?: boolean;
  /** The stored file has see-through pixels (PNG/WebP alpha); set at ingest. */
  hasAlpha?: boolean;
}

export interface Asset {
  id: string;
  workspaceId: string;
  projectId: string | null;         // null = global (brand) asset
  type: AssetType;
  source: AssetSource;
  role: PageImage['role'] | null;
  sourcePageId: string | null;
  sourceUrl: string | null;
  name: string;
  storageKey: string;
  thumbKey: string | null;
  previewKey: string | null;
  width: number;
  height: number;
  mimeType: string;
  bytes: number;
  sha256: string | null;
  dhash: string | null;
  inkScore: number | null;
  flags: AssetFlags;
  analysis: { description?: string; visibleText?: string; tags?: string[]; provider?: string } | null;
  status: 'pending' | 'ready' | 'failed';
  error: string | null;
  createdAt: Iso;
}

export interface Reference {
  id: string;
  projectId: string;
  assetId: string;
  kind: 'approved' | 'rejected' | 'style' | 'direction';
  note: string;
  createdAt: Iso;
}

// ---------------------------------------------------------------- jobs (PRD §64)
export const JobStatus = z.enum(['queued', 'preparing', 'running', 'completed', 'failed', 'cancelled', 'paused']);
export type JobStatus = z.infer<typeof JobStatus>;

export type JobType =
  | 'ingest' | 'render' | 'export' | 'dedupe' | 'expand_services' | 'rescan_diff'
  | 'ai.text' | 'ai.vision' | 'ai.image' | 'ai.classify';

export interface Job {
  id: string;
  workspaceId: string;
  projectId: string | null;
  cardId: string | null;
  batchId: string | null;
  type: JobType;
  executor: 'functions' | 'companion';
  status: JobStatus;
  /** Everything needed to run (or re-run) the job — the generation context lives here, not in a chat. */
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  provider: string | null;
  error: string | null;          // user-facing (PRD §81)
  errorDetail: string | null;    // logs only
  pausedReason: string | null;
  resumeAt: Iso | null;
  attempts: number;
  claimedBy: string | null;
  createdAt: Iso;
  updatedAt: Iso;
  startedAt: Iso | null;
  endedAt: Iso | null;
}

export interface Batch {
  id: string;
  projectId: string;
  kind: string;
  label: string;
  total: number;
  completed: number;
  failed: number;
  /** Jobs stopped on purpose; they are neither done nor failed. */
  cancelled?: number;
  status: 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
  jobIds: string[];
  createdAt: Iso;
  updatedAt: Iso;
}

export interface Scan {
  id: string;
  projectId: string;
  urls: string[];
  status: 'queued' | 'scanning' | 'needs_browser' | 'enrich' | 'ingesting' | 'done' | 'failed';
  phase: string;
  progress: { done: number; total: number };
  pages: number;
  images: number;
  warnings: { code: string; message: string; url?: string }[];
  /** Records fetched from inside the page for services listings (legacy services.mjs). */
  browserRecords?: unknown[] | null;
  browserFor?: { url: string; serviceType: string; total: number } | null;
  error: string | null;
  rescanOf: string | null;
  createdAt: Iso;
  updatedAt: Iso;
}

export interface SourceChange {
  id: string;
  projectId: string;
  sourcePageId: string | null;
  scanId: string;
  kind: 'headline' | 'subheading' | 'banner' | 'page_added' | 'page_removed' | 'authority' | 'highlights';
  before: string | null;
  after: string | null;
  status: 'pending' | 'reviewed' | 'ignored';
  createdAt: Iso;
}

export interface ExportRecord {
  id: string;
  projectId: string;
  scope: 'current' | 'selected' | 'approved' | 'all';
  format: 'png' | 'jpg' | 'webp';
  scale: number;
  cardIds: string[];
  includesUnapproved: number;
  status: JobStatus;
  jobId: string | null;
  zipKey: string | null;
  files: { cardId: string; versionId: string; name: string; key: string; approved: boolean }[];
  options: { contactSheet: boolean; csv: boolean; manifest: boolean; namingTemplate: string };
  error: string | null;
  createdAt: Iso;
  completedAt: Iso | null;
}

export interface Suggestion {
  id: string;
  projectId: string;
  kind: 'rule' | 'fix' | 'consistency' | 'duplicate_subject';
  text: string;
  cardIds: string[];
  status: 'pending' | 'accepted_card' | 'accepted_project' | 'accepted_template' | 'ignored';
  provider: string | null;
  createdAt: Iso;
}

export interface AuditEvent {
  id: string;
  workspaceId: string;
  actor: string;
  type: string;
  entity: string;
  entityId: string;
  data: Record<string, unknown>;
  createdAt: Iso;
}

export interface Recipe {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  base: Design;
  createdAt: Iso;
  updatedAt: Iso;
}
