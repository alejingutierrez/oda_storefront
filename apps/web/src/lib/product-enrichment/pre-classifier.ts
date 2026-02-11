import type { HarvestedSignals } from "@/lib/product-enrichment/signal-harvester";
import {
  getPromptGroupForCategory,
  type PromptGroup,
} from "@/lib/product-enrichment/category-groups";

export type PromptRouteConfidence = "high" | "medium" | "low";

export type PromptRouteResult = {
  group: PromptGroup | null;
  category: string | null;
  confidence: PromptRouteConfidence;
  reason: string;
};

export const routeToPromptGroup = (
  signals: HarvestedSignals,
): PromptRouteResult => {
  const inferredGroup = getPromptGroupForCategory(signals.inferredCategory);
  if (!inferredGroup || !signals.inferredCategory) {
    return {
      group: null,
      category: null,
      confidence: "low",
      reason: "insufficient_signal_fallback_generic",
    };
  }

  if (signals.signalStrength === "strong") {
    return {
      group: inferredGroup,
      category: signals.inferredCategory,
      confidence: "high",
      reason: "strong_signals_routed",
    };
  }

  if (signals.signalStrength === "moderate" && signals.conflictingSignals.length <= 1) {
    return {
      group: inferredGroup,
      category: signals.inferredCategory,
      confidence: "medium",
      reason: "moderate_signals_routed",
    };
  }

  return {
    group: null,
    category: null,
    confidence: "low",
    reason: "weak_or_conflicting_signals_fallback_generic",
  };
};
