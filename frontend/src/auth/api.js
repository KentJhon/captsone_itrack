// frontend/src/auth/api.js
import axios from "axios";

const API_BASE = "http://localhost:8000"; // or http://127.0.0.1:8000, just be consistent

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true, // ✅ send cookies for refresh
});

// simple refresh-once interceptor
let isRefreshing = false;
let pending = [];

function onRefreshed() {
  pending.forEach((cb) => cb());
  pending = [];
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;

    // if there's no response (network error, CORS, etc.), just bubble it up
    if (!error.response) {
      return Promise.reject(error);
    }

    const status = error.response.status;
    const url = original?.url || "";

    // ❌ Do NOT try refresh for:
    // - /login (bad credentials, etc.)
    // - /refresh (already failed)
    // - /logout (no need to refresh)
    const isAuthEndpoint =
      url.includes("/login") ||
      url.includes("/refresh") ||
      url.includes("/logout");

    if (status === 401 && !original._retry && !isAuthEndpoint) {
      if (isRefreshing) {
        // wait until refresh is done, then retry
        await new Promise((resolve) => pending.push(resolve));
        original._retry = true;
        return api(original);
      }

      try {
        isRefreshing = true;
        // use a plain axios call so this interceptor does NOT recurse
        await axios.post(`${API_BASE}/refresh`, null, {
          withCredentials: true,
        });

        onRefreshed();
        original._retry = true;
        return api(original);
      } catch (e) {
        // refresh failed → user is effectively logged out
        return Promise.reject(e);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default api;
