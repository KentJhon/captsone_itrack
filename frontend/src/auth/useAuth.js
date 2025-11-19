// frontend/src/auth/useAuth.js
import { createContext, useContext, useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import api from "./api"; // ✅ your axios instance with baseURL=http://localhost:8000 and withCredentials:true

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);    // { id, role }
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  // 🔁 Fetch current session (runs on mount or refresh)
  async function fetchSession() {
    try {
      const res = await api.get("/me"); // backend verifies JWT cookies
      setUser({ id: res.data.sub, role: res.data.role });
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  // 🚀 Run once on app load (check for existing cookie session)
  useEffect(() => {
    fetchSession();
  }, []);

  // 🧭 If logged in and on login page → redirect to /dashboard
  useEffect(() => {
    if (!loading && user && location.pathname === "/login") {
      navigate("/dashboard", { replace: true });
    }
  }, [user, loading, location.pathname, navigate]);

  // 🧭 If logged out and trying to access protected route → send to login
  useEffect(() => {
    if (!loading && !user && location.pathname !== "/login") {
      navigate("/login", { replace: true });
    }
  }, [user, loading, location.pathname, navigate]);

  // 🧱 Expose helpers to children
  const value = {
    user,
    role: user?.role,
    loading,
    refresh: fetchSession,  // allows re-fetching after login/logout
    logout: async () => {
      try {
        await api.post("/logout");
      } catch (err) {
        console.error("Logout failed:", err);
      } finally {
        setUser(null);
        navigate("/login", { replace: true });
      }
    },
  };

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
