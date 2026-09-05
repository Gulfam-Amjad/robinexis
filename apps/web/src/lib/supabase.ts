import { createClient, type Session } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL || "";
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export type AuthPlan = "starter" | "pro";
export type AuthIntent = { plan?: AuthPlan; returnTo: string };
export type AuthCallbackResult = AuthIntent & { accessToken: string };

type CallbackAuthClient = Pick<
  NonNullable<typeof supabase>["auth"],
  "getSession" | "exchangeCodeForSession"
>;

export const AUTH_INTENT_STORAGE = "robinexis_auth_intent";
export const SELECTED_PLAN_STORAGE = "robinexis_selected_plan";

export const supabase = url && anonKey
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: "pkce",
      },
    })
  : null;

export function validPlan(value: string | null | undefined): AuthPlan | undefined {
  return value === "starter" || value === "pro" ? value : undefined;
}

export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  if (["/login", "/signup", "/auth/callback"].some((path) => value.startsWith(path))) {
    return "/dashboard";
  }
  return value;
}

export function saveAuthIntent(intent: Partial<AuthIntent> = {}): AuthIntent {
  const safe = { plan: validPlan(intent.plan), returnTo: safeReturnTo(intent.returnTo) };
  localStorage.setItem(AUTH_INTENT_STORAGE, JSON.stringify(safe));
  if (safe.plan) localStorage.setItem(SELECTED_PLAN_STORAGE, safe.plan);
  return safe;
}

export function readAuthIntent(): AuthIntent {
  try {
    const stored = JSON.parse(localStorage.getItem(AUTH_INTENT_STORAGE) || "{}") as Partial<AuthIntent>;
    return { plan: validPlan(stored.plan), returnTo: safeReturnTo(stored.returnTo) };
  } catch {
    return { returnTo: "/dashboard" };
  }
}

export function selectedPlan(): AuthPlan | undefined {
  return validPlan(localStorage.getItem(SELECTED_PLAN_STORAGE));
}

export async function currentSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function sessionForCallback(
  code: string | null,
  auth: CallbackAuthClient,
): Promise<Session | null> {
  if (code) {
    const { data, error } = await auth.exchangeCodeForSession(code);
    if (error) throw error;
    return data.session;
  }
  const { data, error } = await auth.getSession();
  if (error) throw error;
  return data.session;
}

function callbackUrl() {
  return `${window.location.origin}/auth/callback`;
}

export async function signInWithGoogle(intent: Partial<AuthIntent> = {}) {
  if (!supabase) throw new Error("Supabase is not configured for this frontend.");
  saveAuthIntent(intent);
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callbackUrl() },
  });
  if (error) throw error;
}

export async function signInWithEmail(email: string, intent: Partial<AuthIntent> = {}) {
  if (!supabase) throw new Error("Supabase is not configured for this frontend.");
  saveAuthIntent(intent);
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: callbackUrl() },
  });
  if (error) throw error;
}

export async function completeAuthCallback(currentUrl = window.location.href): Promise<AuthCallbackResult> {
  if (!supabase) throw new Error("Supabase is not configured for this frontend.");
  const callback = new URL(currentUrl);
  const providerError = callback.searchParams.get("error_description") || callback.searchParams.get("error");
  if (providerError) throw new Error(providerError);

  const code = callback.searchParams.get("code");
  const session = await sessionForCallback(code, supabase.auth);
  if (!session) throw new Error("The sign-in callback did not contain a valid session.");

  const intent = readAuthIntent();
  if (intent.plan && session.user.user_metadata?.planned_plan !== intent.plan) {
    const { error } = await supabase.auth.updateUser({ data: { planned_plan: intent.plan } });
    if (error) throw error;
  }
  localStorage.removeItem(AUTH_INTENT_STORAGE);
  return { ...intent, accessToken: session.access_token };
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}
