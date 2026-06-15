async function checkAndAlert(tenant, todayUsed) {
  if (!tenant.usage_alert_webhook) return;

  const threshold = tenant.daily_limit * tenant.alert_threshold;
  if (todayUsed < threshold) return;

  const payload = {
    tenant_id: tenant.id,
    tenant_name: tenant.name,
    today_used: todayUsed,
    daily_limit: tenant.daily_limit,
    percentage: Math.round((todayUsed / tenant.daily_limit) * 100),
    alert_type: todayUsed >= tenant.daily_limit ? 'over_limit' : 'warning',
    timestamp: new Date().toISOString(),
  };

  try {
    await fetch(tenant.usage_alert_webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.error(`[Alert] webhook failed for tenant ${tenant.id}:`, err.message);
  }
}

module.exports = { checkAndAlert };
