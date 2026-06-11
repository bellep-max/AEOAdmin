import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";

interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: string;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  /** True only for role === "owner" — for owner-gated beta features. */
  isOwner: boolean;
  /** True for role === "sales" — narrowed to free-trial-only views. */
  isSales: boolean;
  /** True for role === "account-manager" — narrowed to non-free-trial views. */
  isAccountManager: boolean;
  /** True for role === "chuckslocal" — plan-scoped admin (Signal local plans).
   *  Admin-like writes, but the BE confines them to his plan slice. */
  isChucksLocal: boolean;
  /** True when the user can perform destructive / create-top-level actions.
   *  Subsumes owner. Use to gate Add/Delete buttons that should not appear
   *  for editor or viewer roles. */
  isAdmin: boolean;
  /** True when the user can edit existing entities. Subsumes admin + owner.
   *  Use to gate Edit / Patch buttons that should not appear for viewer. */
  isEditor: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

async function apiFetch(path: string, options?: RequestInit) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options?.headers as Record<string, string>) ?? {}),
  };
  if (BASE.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "true";
  const res = await fetch(BASE + path, {
    credentials: "include",
    ...options,
    headers,
  });
  return res;
}

async function parseJSON(res: Response) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON response: ${text.slice(0, 100)}`);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    apiFetch("/api/auth/me")
      .then(async (res) => {
        if (res.ok) {
          const data = await parseJSON(res);
          if (data) setUser(data);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const res = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      try {
        const err = await parseJSON(res);
        throw new Error(err?.error ?? `Login failed (${res.status})`);
      } catch (e) {
        if (e instanceof Error) throw e;
        throw new Error(`Login failed with status ${res.status}`);
      }
    }
    try {
      const userData = await parseJSON(res);
      if (!userData) throw new Error("No user data in response");
      setUser(userData);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Invalid server response",
      );
    }
  }

  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    setUser(null);
  }

  const isOwner = user?.role === "owner";
  const isSales = user?.role === "sales";
  const isAccountManager = user?.role === "account-manager";
  const isChucksLocal = user?.role === "chuckslocal";
  // Subsumptive: admin includes owner; editor includes admin + owner. Matches
  // the BE hierarchy in middlewares/role-auth.ts. chuckslocal is admin-like for
  // the UI (it needs the create/edit buttons); the BE enforces its plan scope.
  const isAdmin = user?.role === "admin" || isOwner || isChucksLocal;
  const isEditor = user?.role === "editor" || isAdmin;

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isOwner,
        isSales,
        isAccountManager,
        isChucksLocal,
        isAdmin,
        isEditor,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
