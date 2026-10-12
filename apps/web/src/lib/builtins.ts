/** Renderer builtins → URLs the browser can load (Vite fingerprints them). */
import grain from '@acs/renderer/assets/brand/grain.png?url';
import logoPng from '@acs/renderer/assets/brand/arnifi-logo.png?url';
import logoSvg from '@acs/renderer/assets/brand/arnifi-logo.svg?url';
import lightGrade from '@acs/renderer/assets/gradients/light-grade.png?url';
import lightTint from '@acs/renderer/assets/gradients/light-tint.png?url';
import lightGradeWide from '@acs/renderer/assets/gradients/light-grade-wide.png?url';
import lightTintWide from '@acs/renderer/assets/gradients/light-tint-wide.png?url';

const MAP: Record<string, string> = {
  'builtin:grain': grain,
  'builtin:arnifi-logo': logoSvg,
  'builtin:arnifi-logo-png': logoPng,
  'builtin:light-grade': lightGrade,
  'builtin:light-tint': lightTint,
  'builtin:light-grade-wide': lightGradeWide,
  'builtin:light-tint-wide': lightTintWide,
};

export function builtinUrl(ref: string) {
  return MAP[ref] ?? null;
}
