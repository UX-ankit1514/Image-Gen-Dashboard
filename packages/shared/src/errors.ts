/**
 * Errors the user sees are sentences, not stack traces (PRD §81). The technical cause stays in
 * `detail`, which goes to logs and the job's errorDetail only.
 */
export class AppError extends Error {
  constructor(
    public code: string,
    public userMessage: string,
    public status = 400,
    public detail?: string,
  ) {
    super(userMessage);
  }
}

export const notFound = (what: string) => new AppError('not_found', `We couldn't find that ${what}.`, 404);
export const invalid = (msg: string, detail?: string) => new AppError('invalid', msg, 400, detail);

const RULES: [RegExp, string][] = [
  [/connection closed|target closed|session closed|browser (has disconnected|is not connected)/i, 'The preview renderer stopped unexpectedly. Retry to render it again.'],
  [/ECONNRESET|ECONNREFUSED|socket hang up|fetch failed|network/i, "We couldn't retrieve this page."],
  [/ETIMEDOUT|timeout|timed out|AbortError/i, 'The page took too long to respond.'],
  [/ENOTFOUND|EAI_AGAIN|getaddrinfo/i, "That address doesn't resolve. Check the link."],
  [/\b404\b|not found/i, 'The page was not found (404). It may have been removed.'],
  [/\b40[13]\b|forbidden|unauthori[sz]ed/i, 'The site refused the request.'],
  [/\b5\d\d\b/, 'The site had a server error. Try again in a minute.'],
  [/blocked_url|private address|not allowed/i, 'That address is not allowed (private or internal network).'],
  [/too large|payload|size limit/i, 'The file is too large.'],
  [/unsupported image|unsupported file|magic/i, 'That file type is not supported. Use PNG, JPG or WebP.'],
  [/usage limit|rate limit|429|quota/i, 'Your AI plan has reached its current usage limit.'],
];

export function friendly(err: unknown, fallback = 'Something went wrong. Try again.') {
  if (err instanceof AppError) return err.userMessage;
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  for (const [re, msg] of RULES) if (re.test(text)) return msg;
  return fallback;
}

export function detailOf(err: unknown) {
  if (err instanceof AppError) return err.detail ?? err.message;
  if (err instanceof Error) return `${err.name}: ${err.message}\n${(err.stack ?? '').split('\n').slice(1, 6).join('\n')}`;
  return String(err);
}
