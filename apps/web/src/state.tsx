import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ClientSummary, SessionActor } from "@robinexis/api-contracts";
import { AUTH_REQUIRED } from "./lib/auth";
import { api, API_KEY_STORAGE, CLIENT_STORAGE } from "./lib/api";
import { currentSession, signOut, supabase } from "./lib/supabase";

type SessionValue = {
  apiKey: string | null;
  actor?: SessionActor;
  actorLoading: boolean;
  login: (key: string) => void;
  logout: () => void;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem(API_KEY_STORAGE));
  const [authReady, setAuthReady] = useState(!AUTH_REQUIRED);
  const actorQuery = useQuery({
    queryKey: ["session-actor", apiKey],
    queryFn: api.session,
    enabled: AUTH_REQUIRED ? Boolean(apiKey && authReady) : true,
    retry: false,
  });
  const login = useCallback((key: string) => {
    sessionStorage.setItem(API_KEY_STORAGE, key.trim());
    setApiKey(key.trim());
  }, []);
  const clearSession = useCallback(() => {
    sessionStorage.removeItem(API_KEY_STORAGE);
    sessionStorage.removeItem(CLIENT_STORAGE);
    setApiKey(null);
  }, []);
  const logout = useCallback(() => {
    clearSession();
    void signOut();
  }, [clearSession]);
  useEffect(() => {
    window.addEventListener("robinexis:unauthorized", logout);
    return () => window.removeEventListener("robinexis:unauthorized", logout);
  }, [logout]);
  useEffect(() => {
    if (!AUTH_REQUIRED) return;
    if (!supabase) {
      clearSession();
      setAuthReady(true);
      return;
    }
    void currentSession()
      .then((session) => {
        if (session?.access_token) login(session.access_token);
        else clearSession();
      })
      .catch(clearSession)
      .finally(() => setAuthReady(true));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) login(session.access_token);
      else clearSession();
      setAuthReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, [clearSession, login]);
  return (
    <SessionContext.Provider
      value={{
        apiKey,
        actor: actorQuery.data,
        actorLoading: !authReady || actorQuery.isLoading,
        login,
        logout,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("SessionProvider missing");
  return value;
}

type ClientValue = {
  clients: ClientSummary[];
  activeClient?: ClientSummary;
  activeClientId?: string;
  setActiveClientId: (id: string) => void;
  isLoading: boolean;
  error: Error | null;
};

const ClientContext = createContext<ClientValue | null>(null);

function defaultClientId(clients: ClientSummary[]): string {
  return clients[0].id;
}

function readStoredClientId(): string | undefined {
  return sessionStorage.getItem(CLIENT_STORAGE) || undefined;
}

export function ClientProvider({ children }: { children: ReactNode }) {
  const { apiKey } = useSession();
  const [activeClientId, setId] = useState<string | undefined>(readStoredClientId);
  const clientsQuery = useQuery({
    queryKey: ["clients", apiKey],
    queryFn: api.clients,
    enabled: AUTH_REQUIRED ? Boolean(apiKey) : true,
    retry: false,
  });
  const clients = clientsQuery.data || [];

  useEffect(() => {
    if (!clients.length) return;
    const saved = activeClientId ? clients.find((client) => client.id === activeClientId) : undefined;
    if (saved) return;
    const nextId = defaultClientId(clients);
    setId(nextId);
    sessionStorage.setItem(CLIENT_STORAGE, nextId);
  }, [activeClientId, clients]);

  const setActiveClientId = useCallback((id: string) => {
    setId(id);
    sessionStorage.setItem(CLIENT_STORAGE, id);
  }, []);

  const value = useMemo<ClientValue>(
    () => ({
      clients,
      activeClientId,
      activeClient: clients.find((client) => client.id === activeClientId),
      setActiveClientId,
      isLoading: clientsQuery.isLoading,
      error: clientsQuery.error,
    }),
    [activeClientId, clients, clientsQuery.error, clientsQuery.isLoading, setActiveClientId],
  );

  return <ClientContext.Provider value={value}>{children}</ClientContext.Provider>;
}

export function useClient() {
  const value = useContext(ClientContext);
  if (!value) throw new Error("ClientProvider missing");
  return value;
}

type Toast = { id: number; title: string; message?: string; tone?: "success" | "error" | "info" };
type ToastValue = { push: (toast: Omit<Toast, "id">) => void };
const ToastContext = createContext<ToastValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((toast: Omit<Toast, "id">) => {
    const id = Date.now();
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4200);
  }, []);
  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div className={`toast toast-${toast.tone || "info"}`} key={toast.id}>
            <strong>{toast.title}</strong>
            {toast.message && <span>{toast.message}</span>}
            <button aria-label="Dismiss notification" onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}>×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error("ToastProvider missing");
  return value;
}
