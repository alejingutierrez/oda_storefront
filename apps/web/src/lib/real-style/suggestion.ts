import type { StyleProfileRow } from "@/lib/taxonomy/types";
import { isRealStyleKey, REAL_STYLE_KEYS, type RealStyleKey } from "./constants";

export type RealStyleSuggestionSource = "style_primary" | "style_tags" | null;

export type RealStyleSuggestion = {
  realStyle: RealStyleKey | null;
  source: RealStyleSuggestionSource;
  score: number;
};

type RealStyleMatch = {
  realStyle: RealStyleKey;
  score: number;
};

export type RealStyleSuggestionContext = {
  realStyleTagSets: Map<RealStyleKey, Set<string>>;
  profileToRealStyle: Map<string, RealStyleMatch>;
};

function toTagSet(tags: string[] | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(tags)) return out;
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (!value) continue;
    out.add(value);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const value of small) {
    if (large.has(value)) intersection += 1;
  }
  if (intersection === 0) return 0;
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function bestMatchForTags(
  tags: Set<string>,
  realStyleTagSets: Map<RealStyleKey, Set<string>>,
): RealStyleMatch | null {
  if (tags.size === 0) return null;

  let best: RealStyleMatch | null = null;
  for (const key of REAL_STYLE_KEYS) {
    const candidate = realStyleTagSets.get(key);
    if (!candidate || candidate.size === 0) continue;
    const score = jaccard(tags, candidate);
    if (score <= 0) continue;

    if (!best || score > best.score || (score === best.score && key < best.realStyle)) {
      best = { realStyle: key, score };
    }
  }

  return best;
}

export function buildRealStyleSuggestionContext(
  styleProfiles: StyleProfileRow[],
): RealStyleSuggestionContext {
  const profileByKey = new Map(styleProfiles.map((profile) => [profile.key, profile]));

  const realStyleTagSets = new Map<RealStyleKey, Set<string>>();
  for (const key of REAL_STYLE_KEYS) {
    const profile = profileByKey.get(key);
    realStyleTagSets.set(key, toTagSet(profile?.tags));
  }

  const profileToRealStyle = new Map<string, RealStyleMatch>();
  for (const profile of styleProfiles) {
    if (isRealStyleKey(profile.key)) {
      profileToRealStyle.set(profile.key, { realStyle: profile.key, score: 1 });
      continue;
    }

    const match = bestMatchForTags(toTagSet(profile.tags), realStyleTagSets);
    if (!match) continue;
    profileToRealStyle.set(profile.key, match);
  }

  return { realStyleTagSets, profileToRealStyle };
}

export function suggestRealStyle(params: {
  stylePrimary: string | null;
  styleTags: string[];
  context: RealStyleSuggestionContext;
}): RealStyleSuggestion {
  const stylePrimary = params.stylePrimary?.trim() || null;
  if (stylePrimary && isRealStyleKey(stylePrimary)) {
    return { realStyle: stylePrimary, source: "style_primary", score: 1 };
  }

  if (stylePrimary) {
    const mapped = params.context.profileToRealStyle.get(stylePrimary);
    if (mapped && mapped.score > 0) {
      return {
        realStyle: mapped.realStyle,
        source: "style_primary",
        score: Number(mapped.score.toFixed(4)),
      };
    }
  }

  const fallback = bestMatchForTags(toTagSet(params.styleTags), params.context.realStyleTagSets);
  if (fallback && fallback.score > 0) {
    return {
      realStyle: fallback.realStyle,
      source: "style_tags",
      score: Number(fallback.score.toFixed(4)),
    };
  }

  return { realStyle: null, source: null, score: 0 };
}
