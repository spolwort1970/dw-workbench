interface ErrorHint {
  pattern: RegExp;
  tip: string;
}

const ERROR_HINTS: ErrorHint[] = [
  {
    pattern: /unable to write|Cannot coerce/i,
    tip: 'Try using write(payload, "application/json") to serialize the value first.',
  },
];

export function getErrorHint(error: string): string | null {
  const match = ERROR_HINTS.find((h) => h.pattern.test(error));
  return match?.tip ?? null;
}
