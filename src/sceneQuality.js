export const QUALITY_PROFILES = Object.freeze({
  high: Object.freeze({quality:'high', detailLevel:2, dprMax:1.5, shadows:true, shadowMapSize:1536, siteShadowMapSize:1024}),
  balanced: Object.freeze({quality:'balanced', detailLevel:1, dprMax:1.2, shadows:true, shadowMapSize:1024, siteShadowMapSize:512}),
  low: Object.freeze({quality:'low', detailLevel:0, dprMax:.85, shadows:false, shadowMapSize:512, siteShadowMapSize:512}),
});
const TIERS = ['low', 'balanced', 'high'];
export const qualityProfile = value => QUALITY_PROFILES[value] || QUALITY_PROFILES.balanced;
export const normalizeQuality = value => value === 'auto' || QUALITY_PROFILES[value] ? value : 'auto';

// Only report measured rendered-frame intervals, including visible long stalls.
export function summarizeFrameSamples(values) {
  const samples = values.filter(value => Number.isFinite(value) && value > 0);
  if (!samples.length) return null;
  const sorted = [...samples].sort((a,b) => a-b);
  const mean = samples.reduce((sum,value) => sum+value,0)/samples.length;
  return {fps:Math.round(1000/mean), mean, p95:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))].toFixed(1),
    worst:sorted.at(-1).toFixed(1), samples:samples.length,
    longFrames:samples.filter(value => value>100).length, stalls:samples.filter(value => value>500).length};
}

export function initialQualityState(requested='auto') {
  return {effective:requested==='auto'?'balanced':qualityProfile(requested).quality,
    slowWindows:0, fastWindows:0, lastChange:-Infinity};
}

// Sustained evidence and a cooldown prevent rapid resolution/detail oscillation.
export function advanceQualityState(previous, sample, now, requested='auto') {
  const current = previous || initialQualityState(requested);
  if (requested !== 'auto') return {...current, effective:qualityProfile(requested).quality, slowWindows:0, fastWindows:0};
  if (!sample || sample.samples<60 || !Number.isFinite(Number(sample.mean)) || !Number.isFinite(Number(sample.p95))) return current;
  const slow = sample.mean>24 && Number(sample.p95)>34 || sample.longFrames>4;
  const fast = sample.mean<18.5 && Number(sample.p95)<21 && sample.longFrames===0;
  const next = {...current, slowWindows:slow?current.slowWindows+1:0, fastWindows:fast?current.fastWindows+1:0};
  const index = TIERS.indexOf(current.effective);
  if (now-current.lastChange<6000) return next;
  if (next.slowWindows>=3 && index>0) {
    return {...next,effective:TIERS[index-1],slowWindows:0,fastWindows:0,lastChange:now};
  }
  if (next.fastWindows>=8 && now-current.lastChange>=12000 && index<TIERS.length-1) {
    return {...next,effective:TIERS[index+1],slowWindows:0,fastWindows:0,lastChange:now};
  }
  return next;
}
