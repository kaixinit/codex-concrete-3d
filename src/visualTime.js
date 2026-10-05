// Business-clock animation helpers. An absolute time makes pause, speed and
// seek reproducible; the local accumulator only supports older callers.
export function visualTime(clock, fallback = 0) {
  const time = clock?.current?.time;
  return Number.isFinite(time) ? time : Number(fallback) || 0;
}
export function advanceVisualTime(accumulator, clock, dt, paused = false, active = true) {
  if (Number.isFinite(clock?.current?.time)) accumulator.current = clock.current.time;
  else if (!paused && active) accumulator.current += Math.max(0, Number(dt) || 0);
  return accumulator.current;
}
export function activityTime(state, time, keys) {
  if (!state?.stages) return Math.max(0, time);
  return state.stages.reduce((sum, phase) => sum + (keys.includes(phase.key)
    ? Math.max(0, Math.min(phase.duration, time - phase.start)) : 0), 0);
}
export function loaderKinematics(state = {}, fallback = {}) {
  const bucket = Math.max(0, Math.min(1, state.loaderBucket ?? fallback.bucket ?? 0));
  const arm = state.loaderArm ?? fallback.arm ?? (-.22 + 1.28 * bucket);
  return {arm, tilt:state.loaderTilt ?? fallback.tilt ?? (-arm - Math.max(0, bucket-.65)*2.1),
    steer:state.loaderSteer ?? fallback.steer ?? 0, fill:state.loaderFill ?? fallback.fill ?? 0};
}
export function loaderLipLocal(state = {}, fallback = {}) {
  const {arm,tilt,steer}=loaderKinematics(state,fallback);
  const pitch=arm+tilt;
  const x=.63+2.6*Math.cos(arm)+1.18*Math.cos(pitch)+.27*Math.sin(pitch);
  const y=1.47+2.6*Math.sin(arm)+1.18*Math.sin(pitch)-.27*Math.cos(pitch);
  return [.4+(x-.4)*Math.cos(steer),y,-(x-.4)*Math.sin(steer)];
}
