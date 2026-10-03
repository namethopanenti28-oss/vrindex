import { createContext, useContext, useEffect, useMemo, useState } from "react";
import api, { setToken, clearToken, getToken } from "../api/client";

const AuthContext = createContext(null);

const USER_KEY = "medicare_user";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const cached = localStorage.getItem(USER_KEY);
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });
  const [booting, setBooting] = useState(Boolean(getToken()));

  // Validate the stored token on first paint so a revoked/expired session
  // doesn't render a broken app shell.
  useEffect(() => {
    let cancelled = false;

    async function restore() {
      if (!getToken()) {
        setBooting(false);
        return;
      }
      try {
        const data = await api.me();
        if (cancelled) return;
        setUser(data.user);
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      } catch {
        if (cancelled) return;
        clearToken();
        setUser(null);
      } finally {
        if (!cancelled) setBooting(false);
      }
    }

    restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const persistUser = (next) => {
    setUser(next);
    if (next) localStorage.setItem(USER_KEY, JSON.stringify(next));
    else localStorage.removeItem(USER_KEY);
  };

  const value = useMemo(
    () => ({
      user,
      booting,
      isAuthenticated: Boolean(user),
      role: user?.role ?? null,

      async login(email, password) {
        const data = await api.login(email, password);
        setToken(data.token);
        persistUser(data.user);
        return data.user;
      },

      async register(payload) {
        const data = await api.register(payload);
        if (data.token) {
          setToken(data.token);
          persistUser(data.user);
        }
        return data;
      },

      async refresh() {
        try {
          const data = await api.me();
          persistUser(data.user);
          return data.user;
        } catch {
          return null;
        }
      },

      async updateProfile(patch) {
        const data = await api.updateProfile(patch);
        persistUser(data.user);
        return data.user;
      },

      logout() {
        clearToken();
        setUser(null);
      },
    }),
    [user, booting],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export default AuthContext;
