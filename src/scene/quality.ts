export type QualityTier = "high" | "medium" | "low";

export interface QualitySettings {
  tier: QualityTier;
  pixelRatio: number;
  errorTarget: number;
  shadowMap: number;
  ao: boolean;
  aoHalf: boolean;
  reflections: boolean;
  reflectionScale: number;
  bloom: boolean;
  waterSegments: number;
}

export function detectQuality(): QualitySettings {
  const params = new URLSearchParams(location.search);
  const forced = params.get("tier");
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const narrow = window.innerWidth < 820;
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  let tier: QualityTier = "medium";
  if (forced === "high" || forced === "medium" || forced === "low") tier = forced;
  else if (coarse || narrow || cores <= 4 || memory <= 4) tier = "low";
  else if (cores >= 8 && memory >= 8 && window.innerWidth >= 1280) tier = "high";
  return settingsFor(tier);
}

export function settingsFor(tier: QualityTier): QualitySettings {
  const dpr = window.devicePixelRatio || 1;
  if (tier === "high") {
    return {
      tier,
      pixelRatio: Math.min(2, dpr),
      errorTarget: 4,
      shadowMap: 4096,
      ao: true,
      aoHalf: false,
      reflections: true,
      reflectionScale: 0.55,
      bloom: true,
      waterSegments: 180,
    };
  }
  if (tier === "low") {
    return {
      tier,
      pixelRatio: Math.min(1.25, dpr),
      errorTarget: 14,
      shadowMap: 1024,
      ao: false,
      aoHalf: true,
      reflections: false,
      reflectionScale: 0,
      bloom: true,
      waterSegments: 64,
    };
  }
  return {
    tier,
    pixelRatio: Math.min(1.5, dpr),
    errorTarget: 8,
    shadowMap: 2048,
    ao: true,
    aoHalf: true,
    reflections: true,
    reflectionScale: 0.4,
    bloom: true,
    waterSegments: 110,
  };
}
