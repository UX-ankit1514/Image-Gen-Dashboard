import type { Asset, Batch, Card, CardVersion, Design, ExportRecord, Feedback, Job, Project, Scan, SourcePage } from '@acs/types';

export type ProjectX = Project & { coverUrls: string[] };
export type CardX = Card & { thumbUrl: string | null; previewUrl: string | null };
export type VersionX = CardVersion & { thumbUrl: string | null; previewUrl: string | null };
export type AssetX = Asset & { url: string | null; thumbUrl: string | null; previewUrl: string | null };
export type ExportX = ExportRecord & { zipUrl: string | null; fileUrls: { name: string; url: string }[]; projectName?: string };

export interface Bootstrap {
  workspace: { id: string; name: string; settings: { namingTemplate: string; defaultProvider: string } };
  recipes: { id: string; name: string; description: string; width: number; height: number; builtin: boolean }[];
  gradientPresets: { id: string; name: string; description: string; editable: boolean }[];
  dimensionPresets: { label: string; width: number; height: number }[];
  rejectTags: string[];
  statusLabels: Record<string, string>;
  inboxCategories: { key: string; label: string }[];
}

export interface ScanView {
  scan: Scan & { sources?: { url: string; kind: string; label: string; count: number }[]; changes?: number; ingestBatchId?: string | null };
  pages: SourcePage[];
  assets: AssetX[];
  ingest: Batch | null;
  cardsByPage: Record<string, string>;
}

export interface CardBundle {
  project: ProjectX;
  card: CardX;
  version: CardVersion | null;
  base: Design;
  baseRev: string;
  design: Design;
  page: SourcePage | null;
  versions: VersionX[];
  feedback: Feedback[];
  assets: AssetX[];
}

export interface JobsView { jobs: Omit<Job, 'input'>[]; batches: Batch[] }
