export type ExperienceEventInput = {
  type: string;
  path?: string;
  referrer?: string;
  productId?: string;
  variantId?: string;
  brandId?: string;
  listId?: string;
  sessionId?: string;
  utm?: Record<string, unknown>;
  properties?: Record<string, unknown>;
};

export function logExperienceEvent(input: ExperienceEventInput) {
  if (typeof window === "undefined") return;
  fetch("/api/experience/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    keepalive: true,
  }).catch(() => {
    // Non-blocking telemetry: UI should never fail because tracking fails.
  });
}
