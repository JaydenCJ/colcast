/**
 * String similarity primitives for the fuzzy fallback stage.
 *
 * The final score is a hybrid: the maximum of Jaro-Winkler (good at
 * typos and short strings, rewards shared prefixes) and a token-set
 * Levenshtein ratio (good at re-ordered / partially-overlapping
 * multi-word headers like "Work Email" vs "Email (work)"). All scores
 * are in [0, 1] and fully deterministic.
 */

/** Classic Levenshtein edit distance (iterative, two-row). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] as number) + 1, // deletion
        (curr[j - 1] as number) + 1, // insertion
        (prev[j - 1] as number) + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] as number;
}

/** Levenshtein similarity ratio: 1 - distance / max length. */
export function levRatio(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const d = levenshtein(a, b);
  return 1 - d / Math.max(a.length, b.length);
}

/** Jaro similarity (transposition-aware match ratio). */
export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const window = Math.max(Math.floor(Math.max(a.length, b.length) / 2) - 1, 0);
  const aMatch = new Array<boolean>(a.length).fill(false);
  const bMatch = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(b.length - 1, i + window);
    for (let j = lo; j <= hi; j++) {
      if (bMatch[j] || a[i] !== b[j]) continue;
      aMatch[i] = true;
      bMatch[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const m = matches;
  return (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;
}

/** Jaro-Winkler: Jaro boosted for a common prefix (up to 4 chars, p=0.1). */
export function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b);
  if (j < 0.7) return j; // standard boost threshold
  let prefix = 0;
  const max = Math.min(4, a.length, b.length);
  while (prefix < max && a[prefix] === b[prefix]) prefix++;
  return j + prefix * 0.1 * (1 - j);
}

/**
 * Token-set ratio: compares the sorted token intersection against each
 * sorted token set, so word order and duplicated words stop mattering
 * ("email address work" vs "work email address" scores 1) while extra
 * words still cost something — a pure subset match is strong but not
 * perfect, so "date" never ties with an exact match on "date of birth".
 */
export function tokenSetRatio(aTokens: string[], bTokens: string[]): number {
  const aSet = [...new Set(aTokens)].sort();
  const bSet = [...new Set(bTokens)].sort();
  if (aSet.length === 0 && bSet.length === 0) return 1;
  if (aSet.length === 0 || bSet.length === 0) return 0;
  const inter = aSet.filter((t) => bSet.includes(t));
  const interStr = inter.join(" ");
  const aStr = aSet.join(" ");
  const bStr = bSet.join(" ");
  if (interStr === "") return levRatio(aStr, bStr);
  // Averaging both directions makes extra tokens on either side cost;
  // the plain ratio floor keeps near-identical strings from being punished.
  const combinedA = levRatio(interStr, aStr);
  const combinedB = levRatio(interStr, bStr);
  return Math.max(levRatio(aStr, bStr), (combinedA + combinedB) / 2);
}

/** Hybrid similarity used by the matcher (inputs already normalized). */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const aTok = a === "" ? [] : a.split(" ");
  const bTok = b === "" ? [] : b.split(" ");
  const score = Math.max(jaroWinkler(a, b), tokenSetRatio(aTok, bTok));
  // Clamp float noise so thresholds behave predictably.
  return Math.min(1, Math.round(score * 1e6) / 1e6);
}
