/**
 * Fuzzy path ranking for `@` file mentions / quick open.
 * Lower score = better match. `null` = no match.
 */

export type FuzzyPathEntry = {
  name: string;
  /** Workspace-relative path with `/` separators. */
  path: string;
  kind: "file" | "dir";
};

function isWordBoundary(prev: string | undefined, ch: string): boolean {
  if (!prev) return true;
  if (prev === "/" || prev === "-" || prev === "_" || prev === "." || prev === " ") return true;
  // camelCase / PascalCase boundary
  if (/[a-z0-9]/.test(prev) && /[A-Z]/.test(ch)) return true;
  return false;
}

/**
 * Score how well `query` fuzzy-matches `target` (case-insensitive subsequence).
 * Returns a non-negative score (lower better) or null.
 */
export function scoreFuzzySubstring(query: string, target: string): number | null {
  const q = query.trim();
  if (!q) return 0;
  const ql = q.toLowerCase();
  const tl = target.toLowerCase();

  // Fast paths
  if (tl === ql) return 0;
  if (tl.startsWith(ql)) return 1;
  const idx = tl.indexOf(ql);
  if (idx === 0) return 1;
  if (idx > 0) {
    const boundaryBoost = isWordBoundary(target[idx - 1], target[idx] ?? "") ? 0 : 8;
    return 10 + idx + boundaryBoost;
  }

  // Subsequence with boundary / consecutive bonuses
  let qi = 0;
  let score = 40;
  let consecutive = 0;
  let lastMatch = -2;
  for (let ti = 0; ti < target.length && qi < q.length; ti++) {
    if (tl[ti] !== ql[qi]) {
      consecutive = 0;
      continue;
    }
    const ch = target[ti] ?? "";
    const prev = ti > 0 ? target[ti - 1] : undefined;
    if (ti === 0 || isWordBoundary(prev, ch)) {
      score -= 6;
    }
    if (ti === lastMatch + 1) {
      consecutive += 1;
      score -= Math.min(8, consecutive * 2);
    } else {
      consecutive = 0;
      score += 3;
    }
    lastMatch = ti;
    qi += 1;
  }
  if (qi < q.length) return null;
  // Prefer shorter targets when the match quality is similar
  score += Math.max(0, target.length - q.length) * 0.15;
  return score;
}

function splitQueryTokens(query: string): string[] {
  return query
    .trim()
    .replace(/\\/g, "/")
    .split(/[\s/]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Score a file/dir against a user query. Prefers basename hits over path hits.
 */
export function scoreFuzzyPathQuery(
  query: string,
  name: string,
  relPath: string,
): number | null {
  const raw = query.trim().replace(/\\/g, "/");
  if (!raw) return 0;

  const tokens = splitQueryTokens(raw);
  if (!tokens.length) return 0;

  const pathNorm = relPath.replace(/\\/g, "/");
  const dir = pathNorm.includes("/")
    ? pathNorm.slice(0, pathNorm.lastIndexOf("/"))
    : "";

  let total = 0;
  for (const token of tokens) {
    const nameScore = scoreFuzzySubstring(token, name);
    const pathScore = scoreFuzzySubstring(token, pathNorm);
    const dirScore = dir ? scoreFuzzySubstring(token, dir) : null;

    // Basename match is strongly preferred.
    let best: number | null = null;
    if (nameScore != null) best = nameScore;
    if (pathScore != null) {
      const adjusted = pathScore + 12;
      best = best == null ? adjusted : Math.min(best, adjusted);
    }
    if (dirScore != null) {
      const adjusted = dirScore + 18;
      best = best == null ? adjusted : Math.min(best, adjusted);
    }
    if (best == null) return null;
    total += best;
  }

  // Slight preference for files over directories when query is non-empty
  return total;
}

export function rankFuzzyPathEntries<T extends FuzzyPathEntry>(
  query: string,
  entries: T[],
): T[] {
  const q = query.trim();
  if (!q) return entries.slice();

  const scored: { entry: T; score: number }[] = [];
  for (const entry of entries) {
    const score = scoreFuzzyPathQuery(q, entry.name, entry.path);
    if (score == null) continue;
    // Prefer files slightly over dirs at equal fuzzy quality
    const kindBias = entry.kind === "file" ? 0 : 4;
    scored.push({ entry, score: score + kindBias });
  }
  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.entry.path.localeCompare(b.entry.path, undefined, { sensitivity: "base" });
  });
  return scored.map((s) => s.entry);
}
