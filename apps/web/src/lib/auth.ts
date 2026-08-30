/** Production requires a signed-in session. Local Playwright/dev can skip with VITE_SKIP_AUTH=true. */
export const AUTH_REQUIRED = import.meta.env.VITE_SKIP_AUTH !== "true";

export const ACCESS_TOKEN_STORAGE = "robinexis_admin_api_key";
