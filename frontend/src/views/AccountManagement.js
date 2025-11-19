import React, { useEffect, useMemo, useState } from "react";
import "../views/style/AccountManagement.css";
import API_BASE_URL from "../config";

export default function AccountManagement() {
  const API = useMemo(() => ({ base: API_BASE_URL }), []);

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  // Add-user modal
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    confirm: "",
    role: "",
  });
  const [formError, setFormError] = useState("");
  const [creating, setCreating] = useState(false);

  // Delete confirm modal
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [targetUser, setTargetUser] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Edit modal state
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    id: null,
    username: "",
    email: "",
    role: "",
    password: "",
  });
  const [editing, setEditing] = useState(false);

  // Toast
  const [toast, setToast] = useState("");

  const ROLE_IDS = { Admin: 1, Staff: 2, "Enterprise Division": 3 };

  const mapUser = (u) => ({
    id: u.user_id ?? u.id,
    name: u.full_name ?? u.username ?? u.name,
    email: u.email,
    role: u.role_name ?? u.role,
  });

  const fetchUsers = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API.base}/users`, { credentials: "include" });
      if (!res.ok) throw new Error(`GET /users failed: ${res.status}`);
      const data = await res.json();
      setUsers(Array.isArray(data) ? data.map(mapUser) : []);
    } catch (err) {
      console.error(err);
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // Open Edit modal with prefilled values
  const openEdit = (user) => {
    setEditForm({
      id: user.id,
      username: user.name || "",
      email: user.email || "",
      role: user.role || "",
      password: "", // blank = keep unchanged
    });
    setEditOpen(true);
  };

  // Submit Edit
  const submitEdit = async (e) => {
    e.preventDefault();
    if (!editForm.id) return;

    setEditing(true);
    try {
      // Build payload: only include fields the user changed / allowed
      const payload = {
        username: editForm.username?.trim() || undefined,
        email: editForm.email || undefined,
        role: editForm.role || undefined,
        // send roles_id too (authoritative)
        roles_id: ROLE_IDS[editForm.role] || undefined,
      };
      if (editForm.password && editForm.password.length > 0) {
        if (editForm.password.length < 6) {
          alert("Password must be at least 6 characters");
          setEditing(false);
          return;
        }
        payload.password = editForm.password;
      }

      const res = await fetch(
        `${API.base}/users/${encodeURIComponent(editForm.id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        let msg = `Update failed: ${res.status}`;
        try {
          const err = await res.json();
          if (err?.detail)
            msg = Array.isArray(err.detail) ? err.detail[0].msg : err.detail;
        } catch {}
        throw new Error(msg);
      }

      await fetchUsers();
      setEditOpen(false);
      setToast("User updated");
      setTimeout(() => setToast(""), 2500);
    } catch (err) {
      console.error(err);
      alert(String(err.message || err));
    } finally {
      setEditing(false);
    }
  };

  // OPEN delete confirmation
  const openDeleteConfirm = (user) => {
    setTargetUser(user);
    setConfirmOpen(true);
  };

  // CONFIRM deletion
  const confirmDelete = async () => {
    if (!targetUser) return;
    setDeleting(true);

    // Optimistic UI
    const prev = users.slice();
    setUsers((p) => p.filter((u) => u.id !== targetUser.id));

    try {
      const res = await fetch(
        `${API.base}/users/${encodeURIComponent(targetUser.id)}`,
        {
          method: "DELETE",
          credentials: "include",
        }
      );
      if (!res.ok)
        throw new Error(`DELETE /users/${targetUser.id} failed: ${res.status}`);
      setToast(`Deleted ${targetUser.name}`);
      setTimeout(() => setToast(""), 2500);
      setConfirmOpen(false);
      setTargetUser(null);
    } catch (err) {
      console.error(err);
      // rollback
      setUsers(prev);
      setToast(`Delete failed`);
      setTimeout(() => setToast(""), 2500);
    } finally {
      setDeleting(false);
    }
  };

  // ---- Add User modal helpers ----
  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const validateForm = () => {
    if (!form.username.trim()) return "Username is required";
    if (!form.email.includes("@")) return "Email must contain '@'";
    if (form.password.length < 6)
      return "Password must be at least 6 characters";
    if (form.password !== form.confirm) return "Passwords do not match";
    if (!form.role) return "Please select a role";
    return "";
  };

  const submitNewUser = async (e) => {
    e.preventDefault();

    const v = validateForm();
    if (v) {
      setFormError(v);
      return;
    }

    setCreating(true);
    setFormError("");

    try {
      const roleClean = (form.role || "").trim();
      const rolesId = ROLE_IDS[roleClean];

      const fd = new FormData();
      fd.append("username", form.username);
      fd.append("email", form.email);
      fd.append("password", form.password);
      fd.append("role", roleClean);
      fd.append("roles_id", String(rolesId));

      const res = await fetch(`${API.base}/register`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });

      if (!res.ok) {
        let msg = `Register failed: ${res.status}`;
        try {
          const err = await res.json();
          if (err?.detail)
            msg = Array.isArray(err.detail) ? err.detail[0].msg : err.detail;
        } catch {}
        if (res.status === 409) msg = "Email already exists";
        throw new Error(msg);
      }

      await fetchUsers();
      setOpen(false);
      setForm({ username: "", email: "", password: "", confirm: "", role: "" });
      setToast("User created");
      setTimeout(() => setToast(""), 2500);
    } catch (err) {
      console.error(err);
      setFormError(String(err.message || err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="account-page">
      <h1 className="account-title">Account Management</h1>

      <div className="account-container">
        {/* Toast */}
        {toast && <div className="toast toast-success">{toast}</div>}

        <div className="account-header">
          <h2>Users</h2>
          <button className="btn btn-add" onClick={() => setOpen(true)}>
            + Add User
          </button>
        </div>

        {loading && <div>Loading users...</div>}
        {error && <div style={{ color: "red" }}>{error}</div>}

        {!loading && !error && (
          <table className="account-table">
            <thead>
              <tr>
                <th>User ID</th>
                <th>Full Name</th>
                <th>Email</th>
                <th>Current Role</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.id}</td>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{u.role || "—"}</td>
                  <td>
                    <button
                      className="btn btn-update"
                      onClick={() => openEdit(u)}
                      disabled={busyId === u.id}
                    >
                      Edit
                    </button>
                    &nbsp;
                    {u.role !== "Admin" && (
                      <button
                        className="btn btn-delete"
                        onClick={() => openDeleteConfirm(u)}
                        disabled={busyId === u.id}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add User Modal */}
      <div
        className={`overlay ${open ? "is-open" : ""}`}
        onClick={() => setOpen(false)}
      >
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h3>New User</h3>
          </div>

          <form onSubmit={submitNewUser}>
            <div className="form-row">
              <label>Username</label>
              <input
                className="input"
                name="username"
                value={form.username}
                onChange={onChange}
                placeholder="e.g. jcruz"
              />
            </div>

            <div className="form-row">
              <label>Email</label>
              <input
                className="input"
                name="email"
                type="email"
                value={form.email}
                onChange={onChange}
                placeholder="name@domain.com"
              />
            </div>

            <div className="form-row">
              <label>Password</label>
              <input
                className="input"
                name="password"
                type="password"
                value={form.password}
                onChange={onChange}
              />
            </div>

            <div className="form-row">
              <label>Confirm Password</label>
              <input
                className="input"
                name="confirm"
                type="password"
                value={form.confirm}
                onChange={onChange}
              />
            </div>

            <div className="form-row">
              <label>Role</label>
              <select
                className="select"
                name="role"
                value={form.role}
                onChange={onChange}
              >
                <option value="" disabled>
                  Select role…
                </option>
                <option value="Admin">Admin</option>
                <option value="Staff">Staff</option>
                <option value="Enterprise Division">Enterprise</option>
              </select>
            </div>

            {formError && <div className="form-error">{formError}</div>}

            <div className="actions">
              <button
                type="button"
                className="btn btn-cancel"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={creating}
              >
                {creating ? "Creating…" : "Create User"}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Edit User Modal */}
      <div
        className={`overlay ${editOpen ? "is-open" : ""}`}
        onClick={() => setEditOpen(false)}
      >
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h3>Edit User</h3>
          </div>

          <form onSubmit={submitEdit}>
            <div className="form-row">
              <label>Username</label>
              <input
                className="input"
                name="username"
                value={editForm.username}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, username: e.target.value }))
                }
              />
            </div>

            <div className="form-row">
              <label>Email</label>
              <input
                className="input"
                name="email"
                type="email"
                value={editForm.email}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, email: e.target.value }))
                }
              />
            </div>

            <div className="form-row">
              <label>Role</label>
              <select
                className="select"
                name="role"
                value={editForm.role}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, role: e.target.value }))
                }
              >
                <option value="" disabled>
                  Select role…
                </option>
                <option value="Admin">Admin</option>
                <option value="Staff">Staff</option>
                <option value="Enterprise_Division">Enterprise</option>
              </select>
            </div>

            <div className="form-row">
              <label>New Password</label>
              <input
                className="input"
                name="password"
                type="password"
                value={editForm.password}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, password: e.target.value }))
                }
                placeholder="Leave blank to keep current password"
              />
            </div>

            <div className="actions">
              <button
                type="button"
                className="btn btn-cancel"
                onClick={() => setEditOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={editing}
              >
                {editing ? "Updating…" : "Update"}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Delete Confirm Modal */}
      <div
        className={`overlay ${confirmOpen ? "is-open" : ""}`}
        onClick={() => setConfirmOpen(false)}
      >
        <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h3>Delete User</h3>
          </div>
          <p style={{ marginBottom: 16 }}>
            Are you sure you want to delete <strong>{targetUser?.name}</strong>?
          </p>
          <div className="actions">
            <button
              type="button"
              className="btn btn-cancel"
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-delete"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
