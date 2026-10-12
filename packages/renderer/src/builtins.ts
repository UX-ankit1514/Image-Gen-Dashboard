/** Assets bundled with the renderer, referenced from Design JSON as "builtin:<name>". */
export const BUILTIN_ASSETS = {
  'arnifi-logo': 'brand/arnifi-logo.svg',
  'arnifi-logo-png': 'brand/arnifi-logo.png',
  grain: 'brand/grain.png',
  'light-grade': 'gradients/light-grade.png',
  'light-tint': 'gradients/light-tint.png',
  'light-grade-wide': 'gradients/light-grade-wide.png',
  'light-tint-wide': 'gradients/light-tint-wide.png',
} as const;

export type BuiltinName = keyof typeof BUILTIN_ASSETS;

export function isBuiltin(ref: string) {
  return ref.startsWith('builtin:');
}

export function builtinName(ref: string): BuiltinName | null {
  const n = ref.slice('builtin:'.length);
  return n in BUILTIN_ASSETS ? (n as BuiltinName) : null;
}
