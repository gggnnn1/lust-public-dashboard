/* Pure client-side age check: a frozen GitHub JSON cannot certify freshness. */
(function (root) {
  "use strict";
  function freshness(data, nowMs) {
    const health = (data && data.health) || {};
    const generated = data && typeof data.generated_at === "string" ? Date.parse(data.generated_at) : NaN;
    const threshold = typeof health.stale_after_seconds === "number" && Number.isFinite(health.stale_after_seconds) && health.stale_after_seconds > 0
      ? Math.min(4200, health.stale_after_seconds) : 4200;
    if (!Number.isFinite(generated) || !Number.isFinite(nowMs)) return {status: "unknown", ageSeconds: null, stale: true};
    const clientAge = (nowMs - generated) / 1000;
    if (clientAge < -300) return {status: "unknown", ageSeconds: null, stale: true};
    const serverAge = typeof health.age_seconds === "number" && Number.isFinite(health.age_seconds) ? Math.max(0, health.age_seconds) : 0;
    const age = Math.max(0, clientAge, serverAge);
    if (health.status === "error" || health.collector_status === "error" || data.status === "error")
      return {status: "error", ageSeconds: age, stale: true};
    if (age > threshold || health.stale === true || data.stale === true || health.status === "stale")
      return {status: "stale", ageSeconds: age, stale: true};
    const status = ["ok", "partial"].includes(health.status) ? health.status : "unknown";
    return {status, ageSeconds: age, stale: status === "unknown"};
  }
  if (typeof module === "object" && module.exports) module.exports = freshness;
  else root.PublicDashboardFreshness = freshness;
})(typeof globalThis === "object" ? globalThis : this);
