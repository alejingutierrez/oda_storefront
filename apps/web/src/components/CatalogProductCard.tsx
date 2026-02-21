"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type TransitionEvent as ReactTransitionEvent,
} from "react";
import Image from "next/image";
import Link from "next/link";
import type { CatalogProduct } from "@/lib/catalog-data";
import FavoriteToggle from "@/components/FavoriteToggle";
import { useCompare } from "@/components/CompareProvider";
import { proxiedImageUrl } from "@/lib/image-proxy";

const IMAGE_BLUR_DATA_URL =
  "data:image/gif;base64,R0lGODlhAQABAPAAAP///wAAACwAAAAAAQABAEACAkQBADs=";

type CarouselMode = "inactive" | "desktop" | "mobile";
type CarouselRunState =
  | "idle"
  | "scheduled"
  | "playing"
  | "waiting_preload"
  | "transitioning"
  | "paused"
  | "blocked";

type CarouselConfig = {
  desktopArmDelayMs: number;
  dwellMs: number;
  retryDelayMs: number;
  preloadTimeoutMs: number;
  transitionMs: number;
  mobile: {
    startRatio: number;
    stopRatio: number;
    startDebounceMs: number;
    restartCooldownMs: number;
    scrollIdleMs: number;
  };
};

type PauseOptions = {
  runState?: CarouselRunState;
  markMobileCooldown?: boolean;
};

type LayerId = "a" | "b";

type ImageLoadState = "loading" | "loaded" | "error";

const CAROUSEL_CONFIG: CarouselConfig = {
  desktopArmDelayMs: 360,
  dwellMs: 3400,
  retryDelayMs: 1400,
  preloadTimeoutMs: 700,
  transitionMs: 680,
  mobile: {
    startRatio: 0.86,
    stopRatio: 0.58,
    startDebounceMs: 300,
    restartCooldownMs: 900,
    scrollIdleMs: 180,
  },
};

const MOBILE_OWNER_EVENT = "oda-mobile-carousel-owner-change";
const mobileCandidateRatios = new Map<string, number>();
let mobileOwnerId: string | null = null;

function emitMobileOwnerChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<{ ownerId: string | null }>(MOBILE_OWNER_EVENT, {
      detail: { ownerId: mobileOwnerId },
    }),
  );
}

function recomputeMobileOwner() {
  let bestId: string | null = null;
  let bestRatio = 0;
  for (const [id, ratio] of mobileCandidateRatios.entries()) {
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestId = id;
    }
  }
  if (bestRatio < CAROUSEL_CONFIG.mobile.startRatio) {
    bestId = null;
  }
  if (bestId === mobileOwnerId) return;
  mobileOwnerId = bestId;
  emitMobileOwnerChange();
}

function setMobileCandidateRatio(id: string, ratio: number) {
  if (ratio > 0) {
    mobileCandidateRatios.set(id, ratio);
  } else {
    mobileCandidateRatios.delete(id);
  }
  recomputeMobileOwner();
}

function removeMobileCandidate(id: string) {
  const hadEntry = mobileCandidateRatios.delete(id);
  if (!hadEntry && mobileOwnerId !== id) return;
  recomputeMobileOwner();
}

function getMobileOwnerId() {
  return mobileOwnerId;
}

function uniqStrings(values: Array<string | null | undefined>) {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    next.push(trimmed);
  }
  return next;
}

function formatPrice(amount: string | null, currency: string | null) {
  if (!amount || Number(amount) <= 0) {
    return "Consultar";
  }
  const value = Number(amount);
  try {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: currency || "COP",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency ?? "COP"} ${value.toFixed(0)}`;
  }
}

function formatPriceRange(minPrice: string | null, maxPrice: string | null, currency: string | null) {
  if (!minPrice && !maxPrice) {
    return "Consultar";
  }
  if (!maxPrice || minPrice === maxPrice) {
    return formatPrice(minPrice ?? maxPrice, currency);
  }
  return `${formatPrice(minPrice, currency)} · ${formatPrice(maxPrice, currency)}`;
}

function CompareIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 3H5a2 2 0 0 0-2 2v5" />
      <path d="M14 21h5a2 2 0 0 0 2-2v-5" />
      <path d="M21 10V5a2 2 0 0 0-2-2h-5" />
      <path d="M3 14v5a2 2 0 0 0 2 2h5" />
      <path d="M8 12h8" />
      <path d="M12 8v8" opacity={active ? 1 : 0.45} />
    </svg>
  );
}

export default function CatalogProductCard({
  product,
  mobileAspect = "original",
  mobileCompact = false,
}: {
  product: CatalogProduct;
  mobileAspect?: "original" | "square";
  mobileCompact?: boolean;
}) {
  const compare = useCompare();
  const instanceId = useId();
  const mobileCandidateId = useMemo(() => `${product.id}:${instanceId}`, [product.id, instanceId]);

  const href = product.sourceUrl ?? "#";
  const openInNewTab = href !== "#";
  const coverUrl = proxiedImageUrl(product.imageCoverUrl, { productId: product.id, kind: "cover" });

  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const productIdRef = useRef(product.id);
  useEffect(() => {
    productIdRef.current = product.id;
  }, [product.id]);

  const [images, setImages] = useState<string[]>(() => (coverUrl ? [coverUrl] : []));
  const imagesRef = useRef(images);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(0);
  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  const [extrasLoaded, setExtrasLoaded] = useState(false);
  const extrasLoadedRef = useRef(false);
  useEffect(() => {
    extrasLoadedRef.current = extrasLoaded;
  }, [extrasLoaded]);
  const extrasLoadingRef = useRef(false);

  const [canHover, setCanHover] = useState(false);
  const canHoverRef = useRef(false);
  useEffect(() => {
    canHoverRef.current = canHover;
  }, [canHover]);

  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const prefersReducedMotionRef = useRef(false);
  useEffect(() => {
    prefersReducedMotionRef.current = prefersReducedMotion;
  }, [prefersReducedMotion]);

  const [isMobileOwner, setIsMobileOwner] = useState(false);
  const isMobileOwnerRef = useRef(false);
  useEffect(() => {
    isMobileOwnerRef.current = isMobileOwner;
  }, [isMobileOwner]);

  const [carouselMode, setCarouselMode] = useState<CarouselMode>("inactive");
  const carouselModeRef = useRef<CarouselMode>("inactive");
  const [carouselRunState, setCarouselRunState] = useState<CarouselRunState>("idle");
  const carouselRunStateRef = useRef<CarouselRunState>("idle");

  const [layerAUrl, setLayerAUrl] = useState<string | null>(() => coverUrl ?? null);
  const [layerBUrl, setLayerBUrl] = useState<string | null>(null);
  const [visibleLayer, setVisibleLayer] = useState<LayerId>("a");
  const [incomingLayer, setIncomingLayer] = useState<LayerId | null>(null);
  const pendingLayerRef = useRef<{ layer: LayerId; url: string } | null>(null);

  const viewRef = useRef<HTMLAnchorElement | null>(null);

  const playingRef = useRef(false);
  const startTimeoutRef = useRef<number | null>(null);
  const stepTimeoutRef = useRef<number | null>(null);
  const scrollIdleTimeoutRef = useRef<number | null>(null);

  const mobileVisibilityRatioRef = useRef(0);
  const mobileIntersectingRef = useRef(false);
  const mobileScrollIdleRef = useRef(true);
  const mobileCooldownUntilRef = useRef(0);

  const pendingCommitUrlRef = useRef<string | null>(null);

  const imageLoadStateRef = useRef<Map<string, ImageLoadState>>(new Map());
  const imageLoadPromiseRef = useRef<Map<string, Promise<boolean>>>(new Map());

  const pauseCarouselRef = useRef<(options?: PauseOptions) => void>(() => {});
  const onVisualCommitRef = useRef<(url: string | null) => void>(() => {});
  const evaluateMobilePlaybackRef = useRef<() => void>(() => {});

  function setCarouselModeSafe(nextMode: CarouselMode) {
    if (carouselModeRef.current === nextMode) return;
    carouselModeRef.current = nextMode;
    if (!mountedRef.current) return;
    setCarouselMode(nextMode);
  }

  function setCarouselRunStateSafe(nextState: CarouselRunState) {
    if (carouselRunStateRef.current === nextState) return;
    carouselRunStateRef.current = nextState;
    if (!mountedRef.current) return;
    setCarouselRunState(nextState);
  }

  function clearStartTimer() {
    if (!startTimeoutRef.current) return;
    window.clearTimeout(startTimeoutRef.current);
    startTimeoutRef.current = null;
  }

  function clearStepTimer() {
    if (!stepTimeoutRef.current) return;
    window.clearTimeout(stepTimeoutRef.current);
    stepTimeoutRef.current = null;
  }

  function clearScrollIdleTimer() {
    if (!scrollIdleTimeoutRef.current) return;
    window.clearTimeout(scrollIdleTimeoutRef.current);
    scrollIdleTimeoutRef.current = null;
  }

  function pauseCarousel(options?: PauseOptions) {
    clearStartTimer();
    clearStepTimer();
    playingRef.current = false;
    pendingCommitUrlRef.current = null;

    if (options?.markMobileCooldown) {
      mobileCooldownUntilRef.current = Date.now() + CAROUSEL_CONFIG.mobile.restartCooldownMs;
    }

    setCarouselRunStateSafe(options?.runState ?? "paused");
    setCarouselModeSafe("inactive");
  }

  pauseCarouselRef.current = pauseCarousel;

  function preloadImage(url: string): Promise<boolean> {
    const knownState = imageLoadStateRef.current.get(url);
    if (knownState === "loaded") return Promise.resolve(true);
    if (knownState === "error") return Promise.resolve(false);

    const inFlight = imageLoadPromiseRef.current.get(url);
    if (inFlight) return inFlight;

    if (typeof window === "undefined") {
      return Promise.resolve(false);
    }

    imageLoadStateRef.current.set(url, "loading");

    const promise = new Promise<boolean>((resolve) => {
      const img = new window.Image();
      img.decoding = "async";

      const finish = (success: boolean) => {
        imageLoadStateRef.current.set(url, success ? "loaded" : "error");
        imageLoadPromiseRef.current.delete(url);
        resolve(success);
      };

      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      img.src = url;
    });

    imageLoadPromiseRef.current.set(url, promise);
    return promise;
  }

  async function ensureImageReady(url: string, timeoutMs: number): Promise<boolean> {
    const knownState = imageLoadStateRef.current.get(url);
    if (knownState === "loaded") return true;
    if (knownState === "error") return false;

    const preloadPromise = preloadImage(url);
    if (timeoutMs <= 0) {
      return preloadPromise;
    }

    if (typeof window === "undefined") {
      return preloadPromise;
    }

    let timeoutRef: number | null = null;
    const timeoutPromise = new Promise<boolean>((resolve) => {
      timeoutRef = window.setTimeout(() => resolve(false), timeoutMs);
    });

    const result = await Promise.race([preloadPromise, timeoutPromise]);
    if (timeoutRef) {
      window.clearTimeout(timeoutRef);
    }
    return result;
  }

  async function ensureExtrasLoaded() {
    if (extrasLoadedRef.current) return;
    if (extrasLoadingRef.current) return;
    extrasLoadingRef.current = true;

    try {
      const res = await fetch(
        `/api/catalog/product-images?productId=${encodeURIComponent(productIdRef.current)}`,
        {
          cache: "force-cache",
        },
      );
      if (!res.ok) return;
      const payload = (await res.json()) as { images?: string[] };
      const nextImages = Array.isArray(payload.images) ? payload.images : [];
      const proxied = nextImages.map((url) =>
        proxiedImageUrl(url, { productId: productIdRef.current, kind: "gallery" }),
      );

      setImages((prev) => {
        const merged = uniqStrings([...prev, ...proxied]);
        imagesRef.current = merged;
        for (const url of merged) {
          if (url) {
            void preloadImage(url);
          }
        }
        return merged;
      });

      extrasLoadedRef.current = true;
      if (mountedRef.current) {
        setExtrasLoaded(true);
      }
    } catch {
      // ignore
    } finally {
      extrasLoadingRef.current = false;
    }
  }

  async function findNextReadyIndex(list: string[], currentIndex: number) {
    for (let offset = 1; offset < list.length; offset += 1) {
      const nextIndex = (currentIndex + offset) % list.length;
      const candidate = list[nextIndex];
      if (!candidate) continue;
      const ready = await ensureImageReady(candidate, CAROUSEL_CONFIG.preloadTimeoutMs);
      if (ready) {
        return nextIndex;
      }
    }
    return null;
  }

  function scheduleNextStep(delayMs: number) {
    if (!playingRef.current) return;
    clearStepTimer();
    stepTimeoutRef.current = window.setTimeout(() => {
      void runCarouselStep();
    }, delayMs);
  }

  function onVisualCommit(committedUrl: string | null) {
    if (!committedUrl) return;
    if (pendingCommitUrlRef.current && pendingCommitUrlRef.current !== committedUrl) return;
    pendingCommitUrlRef.current = null;

    if (!playingRef.current) return;

    setCarouselRunStateSafe("playing");
    scheduleNextStep(CAROUSEL_CONFIG.dwellMs);
  }

  onVisualCommitRef.current = onVisualCommit;

  async function runCarouselStep() {
    if (!playingRef.current) return;
    if (!mountedRef.current) return;

    if (typeof document !== "undefined" && document.hidden) {
      pauseCarousel({ runState: "blocked" });
      return;
    }

    if (prefersReducedMotionRef.current) {
      pauseCarousel({ runState: "blocked" });
      return;
    }

    const list = imagesRef.current;
    if (list.length <= 1) {
      pauseCarousel({ runState: "blocked" });
      return;
    }

    setCarouselRunStateSafe("waiting_preload");

    const current = activeIndexRef.current;
    const nextIndex = await findNextReadyIndex(list, current);

    if (!playingRef.current || !mountedRef.current) {
      return;
    }

    if (nextIndex === null) {
      setCarouselRunStateSafe("blocked");
      scheduleNextStep(CAROUSEL_CONFIG.retryDelayMs);
      return;
    }

    const targetUrl = list[nextIndex];
    if (!targetUrl) {
      scheduleNextStep(CAROUSEL_CONFIG.retryDelayMs);
      return;
    }

    pendingCommitUrlRef.current = targetUrl;
    setCarouselRunStateSafe("transitioning");
    setActiveIndex(nextIndex);
  }

  async function startCarousel(mode: CarouselMode) {
    if (playingRef.current) return;
    if (prefersReducedMotionRef.current) {
      setCarouselRunStateSafe("blocked");
      return;
    }
    if (typeof document !== "undefined" && document.hidden) {
      setCarouselRunStateSafe("blocked");
      return;
    }

    await ensureExtrasLoaded();

    const list = imagesRef.current;
    if (list.length <= 1) {
      setCarouselRunStateSafe("blocked");
      setCarouselModeSafe("inactive");
      return;
    }

    const nextPreview = list[(activeIndexRef.current + 1) % list.length];
    if (nextPreview) {
      void ensureImageReady(nextPreview, CAROUSEL_CONFIG.preloadTimeoutMs);
    }

    playingRef.current = true;
    setCarouselModeSafe(mode);
    setCarouselRunStateSafe("playing");
    scheduleNextStep(CAROUSEL_CONFIG.dwellMs);
  }

  function scheduleCarouselStart(mode: CarouselMode, delayMs: number) {
    if (playingRef.current) return;
    if (prefersReducedMotionRef.current) {
      setCarouselRunStateSafe("blocked");
      return;
    }
    if (startTimeoutRef.current) return;

    setCarouselModeSafe(mode);
    setCarouselRunStateSafe("scheduled");

    startTimeoutRef.current = window.setTimeout(() => {
      startTimeoutRef.current = null;
      void startCarousel(mode);
    }, delayMs);
  }

  function evaluateMobilePlayback() {
    if (canHoverRef.current) return;

    const hidden = typeof document !== "undefined" ? document.hidden : false;
    const ratio = mobileVisibilityRatioRef.current;
    const canStart =
      mobileIntersectingRef.current &&
      ratio >= CAROUSEL_CONFIG.mobile.startRatio &&
      isMobileOwnerRef.current &&
      mobileScrollIdleRef.current &&
      !hidden &&
      !prefersReducedMotionRef.current &&
      Date.now() >= mobileCooldownUntilRef.current;

    if (canStart) {
      if (!playingRef.current && !startTimeoutRef.current) {
        scheduleCarouselStart("mobile", CAROUSEL_CONFIG.mobile.startDebounceMs);
      }
      return;
    }

    if (startTimeoutRef.current) {
      const shouldCancelSchedule =
        !mobileIntersectingRef.current ||
        ratio < CAROUSEL_CONFIG.mobile.startRatio ||
        !isMobileOwnerRef.current ||
        !mobileScrollIdleRef.current ||
        hidden ||
        prefersReducedMotionRef.current;
      if (shouldCancelSchedule) {
        clearStartTimer();
        if (!playingRef.current) {
          setCarouselRunStateSafe("idle");
          setCarouselModeSafe("inactive");
        }
      }
    }

    const shouldStop =
      !mobileIntersectingRef.current ||
      ratio <= CAROUSEL_CONFIG.mobile.stopRatio ||
      !isMobileOwnerRef.current ||
      !mobileScrollIdleRef.current ||
      hidden ||
      prefersReducedMotionRef.current;

    if (shouldStop && (playingRef.current || carouselModeRef.current === "mobile")) {
      pauseCarousel({
        markMobileCooldown: true,
        runState: mobileScrollIdleRef.current ? "paused" : "blocked",
      });
      return;
    }

    if (shouldStop && !playingRef.current) {
      setCarouselRunStateSafe(hidden || prefersReducedMotionRef.current ? "blocked" : "idle");
      setCarouselModeSafe("inactive");
    }
  }

  evaluateMobilePlaybackRef.current = evaluateMobilePlayback;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setCanHover(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!prefersReducedMotion) return;
    pauseCarouselRef.current({ runState: "blocked" });
  }, [prefersReducedMotion]);

  useEffect(() => {
    imageLoadStateRef.current.clear();
    imageLoadPromiseRef.current.clear();
    pendingLayerRef.current = null;

    setImages(coverUrl ? [coverUrl] : []);
    imagesRef.current = coverUrl ? [coverUrl] : [];

    setActiveIndex(0);
    activeIndexRef.current = 0;

    setExtrasLoaded(false);
    extrasLoadedRef.current = false;
    extrasLoadingRef.current = false;

    setLayerAUrl(coverUrl ?? null);
    setLayerBUrl(null);
    setVisibleLayer("a");
    setIncomingLayer(null);

    pauseCarouselRef.current({ runState: "idle" });
  }, [coverUrl]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncOwner = () => setIsMobileOwner(getMobileOwnerId() === mobileCandidateId);
    syncOwner();

    const onOwnerChange = (event: Event) => {
      const detail = (event as CustomEvent<{ ownerId: string | null }>).detail;
      setIsMobileOwner(detail?.ownerId === mobileCandidateId);
    };

    window.addEventListener(MOBILE_OWNER_EVENT, onOwnerChange as EventListener);

    return () => {
      window.removeEventListener(MOBILE_OWNER_EVENT, onOwnerChange as EventListener);
      removeMobileCandidate(mobileCandidateId);
    };
  }, [mobileCandidateId]);

  useEffect(() => {
    evaluateMobilePlaybackRef.current();
  }, [isMobileOwner]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (canHover) {
      removeMobileCandidate(mobileCandidateId);
      mobileIntersectingRef.current = false;
      mobileVisibilityRatioRef.current = 0;
      mobileScrollIdleRef.current = true;
      clearScrollIdleTimer();
      return;
    }

    const node = viewRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        const ratio = entry.isIntersecting ? entry.intersectionRatio : 0;
        mobileIntersectingRef.current = entry.isIntersecting;
        mobileVisibilityRatioRef.current = ratio;
        setMobileCandidateRatio(mobileCandidateId, ratio);
        evaluateMobilePlaybackRef.current();
      },
      {
        threshold: [0, CAROUSEL_CONFIG.mobile.stopRatio, CAROUSEL_CONFIG.mobile.startRatio, 1],
      },
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
      removeMobileCandidate(mobileCandidateId);
      mobileIntersectingRef.current = false;
      mobileVisibilityRatioRef.current = 0;
    };
  }, [canHover, mobileCandidateId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (canHover) return;

    const onScroll = () => {
      const wasIdle = mobileScrollIdleRef.current;
      mobileScrollIdleRef.current = false;

      if (wasIdle && (playingRef.current || carouselModeRef.current === "mobile")) {
        pauseCarouselRef.current({ markMobileCooldown: true, runState: "blocked" });
      }

      clearScrollIdleTimer();
      scrollIdleTimeoutRef.current = window.setTimeout(() => {
        scrollIdleTimeoutRef.current = null;
        mobileScrollIdleRef.current = true;
        evaluateMobilePlaybackRef.current();
      }, CAROUSEL_CONFIG.mobile.scrollIdleMs);
    };

    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      clearScrollIdleTimer();
      mobileScrollIdleRef.current = true;
    };
  }, [canHover]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const onVisibility = () => {
      if (document.hidden) {
        pauseCarouselRef.current({ runState: "blocked" });
      } else {
        evaluateMobilePlaybackRef.current();
      }
    };

    const onBlur = () => {
      pauseCarouselRef.current({
        runState: "blocked",
        markMobileCooldown: carouselModeRef.current === "mobile",
      });
    };

    const onFocus = () => {
      evaluateMobilePlaybackRef.current();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    return () => {
      removeMobileCandidate(mobileCandidateId);
      clearScrollIdleTimer();
      pauseCarouselRef.current({ runState: "idle" });
    };
  }, [mobileCandidateId]);

  const activeImageUrl = images[activeIndex] ?? coverUrl ?? null;

  useEffect(() => {
    if (!activeImageUrl) {
      setLayerAUrl(null);
      setLayerBUrl(null);
      setVisibleLayer("a");
      setIncomingLayer(null);
      pendingLayerRef.current = null;
      pendingCommitUrlRef.current = null;
      return;
    }

    if (prefersReducedMotionRef.current) {
      setLayerAUrl(activeImageUrl);
      setLayerBUrl(null);
      setVisibleLayer("a");
      setIncomingLayer(null);
      pendingLayerRef.current = null;
      onVisualCommitRef.current(activeImageUrl);
      return;
    }

    const visibleUrl = visibleLayer === "a" ? layerAUrl : layerBUrl;
    if (!visibleUrl) {
      setLayerAUrl(activeImageUrl);
      setLayerBUrl(null);
      setVisibleLayer("a");
      setIncomingLayer(null);
      pendingLayerRef.current = null;
      onVisualCommitRef.current(activeImageUrl);
      return;
    }

    if (activeImageUrl === visibleUrl && !incomingLayer) {
      onVisualCommitRef.current(activeImageUrl);
      return;
    }

    const nextLayer: LayerId = visibleLayer === "a" ? "b" : "a";
    pendingLayerRef.current = { layer: nextLayer, url: activeImageUrl };
    setIncomingLayer(null);

    if (nextLayer === "a") {
      setLayerAUrl(activeImageUrl);
    } else {
      setLayerBUrl(activeImageUrl);
    }
  }, [activeImageUrl, layerAUrl, layerBUrl, visibleLayer, incomingLayer]);

  function handleLayerLoaded(layer: LayerId, url: string) {
    if (!pendingLayerRef.current) return;
    if (pendingLayerRef.current.layer !== layer) return;
    if (pendingLayerRef.current.url !== url) return;

    if (prefersReducedMotionRef.current) {
      setVisibleLayer(layer);
      setIncomingLayer(null);
      pendingLayerRef.current = null;
      onVisualCommitRef.current(url);
      return;
    }

    setIncomingLayer(layer);
  }

  function handleLayerTransitionEnd(layer: LayerId, event: ReactTransitionEvent<HTMLDivElement>) {
    if (event.propertyName !== "opacity") return;
    if (incomingLayer !== layer) return;

    const committedUrl = layer === "a" ? layerAUrl : layerBUrl;

    setVisibleLayer(layer);
    setIncomingLayer(null);
    pendingLayerRef.current = null;
    onVisualCommitRef.current(committedUrl);
  }

  const layerAOpacityClass = incomingLayer
    ? incomingLayer === "a"
      ? "opacity-100"
      : "opacity-0"
    : visibleLayer === "a"
      ? "opacity-100"
      : "opacity-0";

  const layerBOpacityClass = incomingLayer
    ? incomingLayer === "b"
      ? "opacity-100"
      : "opacity-0"
    : visibleLayer === "b"
      ? "opacity-100"
      : "opacity-0";

  const aspectClass = mobileAspect === "square" ? "aspect-square" : "aspect-[3/4]";

  const cornerSize = mobileCompact ? "h-8 w-8" : "h-9 w-9";
  const cornerInset = mobileCompact ? "left-2 top-2" : "left-3 top-3";
  const favInset = mobileCompact ? "right-2 top-2" : "right-3 top-3";

  const glassHeight =
    mobileAspect === "square"
      ? mobileCompact
        ? "h-[42%]"
        : "h-[30%]"
      : mobileCompact
        ? "h-[32%]"
        : "h-[20%]";

  const priceLabel = useMemo(
    () => formatPriceRange(product.minPrice, product.maxPrice, product.currency),
    [product.currency, product.maxPrice, product.minPrice],
  );

  const priceChangeChip =
    product.priceChangeDirection === "down"
      ? "↓ Bajó de precio"
      : product.priceChangeDirection === "up"
        ? "↑ Subió de precio"
        : null;

  const compared = compare?.isSelected(product.id) ?? false;

  return (
    <article
      data-carousel-state={`${carouselMode}:${carouselRunState}`}
      className="group relative overflow-hidden rounded-xl border border-[color:var(--oda-border)] bg-white shadow-[0_10px_20px_rgba(23,21,19,0.07)] lg:shadow-[0_12px_28px_rgba(23,21,19,0.08)] lg:transition lg:duration-500 lg:ease-out lg:[transform-style:preserve-3d] lg:hover:shadow-[0_30px_60px_rgba(23,21,19,0.14)] lg:group-hover:[transform:perspective(900px)_rotateX(6deg)_translateY(-10px)]"
      onMouseEnter={() => {
        if (!canHoverRef.current) return;
        scheduleCarouselStart("desktop", CAROUSEL_CONFIG.desktopArmDelayMs);
      }}
      onMouseLeave={() => {
        if (!canHoverRef.current) return;
        pauseCarousel({ runState: "paused" });
      }}
    >
      {compare && !mobileCompact ? (
        <div className={["absolute z-10", cornerInset].join(" ")}>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              compare.toggle(product);
            }}
            aria-pressed={compared}
            aria-label={compared ? "Quitar de comparar" : "Agregar a comparar"}
            className={[
              `inline-flex ${cornerSize} items-center justify-center rounded-full border border-white/50 shadow-[0_18px_50px_rgba(23,21,19,0.16)] backdrop-blur transition lg:h-10 lg:w-10`,
              compared
                ? "bg-[color:var(--oda-ink)] text-[color:var(--oda-cream)]"
                : "bg-white/70 text-[color:var(--oda-ink)] hover:bg-white",
            ].join(" ")}
            title={compared ? "Quitar de comparar" : "Comparar"}
          >
            <CompareIcon active={compared} />
          </button>
        </div>
      ) : null}

      <div className={["absolute z-10", favInset].join(" ")}>
        <FavoriteToggle
          productId={product.id}
          productName={product.name}
          ariaLabel={`Guardar ${product.name} en favoritos`}
          className={[cornerSize, "lg:h-10 lg:w-10"].join(" ")}
        />
      </div>

      <Link
        href={href}
        ref={viewRef}
        target={openInNewTab ? "_blank" : undefined}
        rel={openInNewTab ? "noreferrer noopener" : undefined}
        className={[
          "relative block w-full overflow-hidden bg-[color:var(--oda-stone)]",
          aspectClass,
          "lg:aspect-[3/4]",
        ].join(" ")}
      >
        {activeImageUrl ? (
          <>
            <div
              className={[
                "pointer-events-none absolute inset-0 oda-carousel-layer",
                layerAOpacityClass,
                "motion-reduce:transition-none",
              ].join(" ")}
              onTransitionEnd={(event) => handleLayerTransitionEnd("a", event)}
            >
              {layerAUrl ? (
                <Image
                  src={layerAUrl}
                  alt={product.name}
                  fill
                  unoptimized={layerAUrl.startsWith("/api/image-proxy")}
                  sizes={
                    mobileCompact
                      ? "(min-width: 1280px) 20vw, (min-width: 1024px) 22vw, (min-width: 768px) 45vw, 46vw"
                      : "(min-width: 1280px) 20vw, (min-width: 1024px) 22vw, (min-width: 768px) 45vw, 90vw"
                  }
                  className="object-cover object-center transition-transform duration-700 group-hover:scale-[1.07] group-hover:-translate-y-1 motion-reduce:transition-none"
                  placeholder="blur"
                  blurDataURL={IMAGE_BLUR_DATA_URL}
                  priority={false}
                  onLoadingComplete={() => handleLayerLoaded("a", layerAUrl)}
                />
              ) : null}
            </div>

            <div
              className={[
                "pointer-events-none absolute inset-0 oda-carousel-layer",
                layerBOpacityClass,
                "motion-reduce:transition-none",
              ].join(" ")}
              onTransitionEnd={(event) => handleLayerTransitionEnd("b", event)}
            >
              {layerBUrl ? (
                <Image
                  src={layerBUrl}
                  alt={product.name}
                  fill
                  unoptimized={layerBUrl.startsWith("/api/image-proxy")}
                  sizes={
                    mobileCompact
                      ? "(min-width: 1280px) 20vw, (min-width: 1024px) 22vw, (min-width: 768px) 45vw, 46vw"
                      : "(min-width: 1280px) 20vw, (min-width: 1024px) 22vw, (min-width: 768px) 45vw, 90vw"
                  }
                  className="object-cover object-center transition-transform duration-700 group-hover:scale-[1.07] group-hover:-translate-y-1 motion-reduce:transition-none"
                  placeholder="blur"
                  blurDataURL={IMAGE_BLUR_DATA_URL}
                  priority={false}
                  onLoadingComplete={() => handleLayerLoaded("b", layerBUrl)}
                />
              ) : null}
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-xs uppercase tracking-[0.2em] text-[color:var(--oda-taupe)]">
            Sin imagen
          </div>
        )}

        <div
          className={[
            `absolute inset-x-0 bottom-0 ${glassHeight} border-t border-white/40 bg-white/45 backdrop-blur-xl`,
            "transition duration-500",
            "lg:h-[26%] lg:translate-y-6 lg:opacity-0 lg:group-hover:translate-y-0 lg:group-hover:opacity-100",
          ].join(" ")}
        >
          <div
            className={[
              "flex h-full flex-col justify-start gap-1.5 lg:px-4 lg:py-4",
              mobileCompact ? "px-2.5 py-2" : "px-3 py-2.5",
            ].join(" ")}
          >
            <p
              className={[
                "font-semibold uppercase tracking-[0.28em] text-[color:var(--oda-ink-soft)] lg:text-[10px]",
                mobileCompact ? "text-[8px]" : "text-[9px]",
              ].join(" ")}
            >
              {product.brandName}
            </p>
            <h3
              className={[
                "font-semibold leading-snug text-[color:var(--oda-ink)] lg:text-sm",
                mobileCompact ? "text-[12px] truncate" : "text-[13px] truncate",
              ].join(" ")}
            >
              {product.name}
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <p
                className={[
                  "uppercase tracking-[0.2em] text-[color:var(--oda-ink-soft)] lg:text-xs",
                  mobileCompact ? "text-[9px]" : "text-[10px]",
                ].join(" ")}
              >
                {priceLabel}
              </p>
              {priceChangeChip ? (
                <span className="rounded-full border border-[color:var(--oda-border)] bg-white/85 px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.14em] text-[color:var(--oda-ink)]">
                  {priceChangeChip}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </Link>
    </article>
  );
}
