let d = "";
process.stdin.on("data", (c) => {
  d += c;
});
process.stdin.on("end", () => {
  const v = JSON.parse(d);
  console.log(JSON.stringify({
    stripeSecretPrefix: String(v.STRIPE_SECRET_KEY || "").slice(0, 8),
    stripePublishablePrefix: String(v.STRIPE_PUBLISHABLE_KEY || "").slice(0, 8),
    priceIds: v.STRIPE_PRICE_IDS_JSON || null,
    featuresSet: Boolean(v.STRIPE_PRICE_FEATURES_JSON),
    webhookSecretSet: Boolean(v.STRIPE_WEBHOOK_SECRET),
    saas: v.SAAS_PROVISIONING_ENABLED,
    voiceId: v.ELEVENLABS_VOICE_ID,
    elevenWebhookPrefix: String(v.ELEVENLABS_WEBHOOK_SECRET || "").slice(0, 5),
    twilioOAuthClientSet: Boolean(v.TWILIO_OAUTH_CLIENT_ID),
    twilioOAuthSecretSet: Boolean(v.TWILIO_OAUTH_CLIENT_SECRET),
    twilioOAuthRedirect: v.TWILIO_OAUTH_REDIRECT_URI || null,
    twilioOAuthStateSecretSet: Boolean(v.TWILIO_OAUTH_STATE_SECRET),
    twilioOAuthEncryptionKeySet: Boolean(v.TWILIO_OAUTH_ENCRYPTION_KEY),
    workerApiSecretSet: Boolean(v.WORKER_API_SECRET),
    databaseUrlSet: Boolean(v.DATABASE_URL),
    databasePublicUrlSet: Boolean(v.DATABASE_PUBLIC_URL),
  }));
});
