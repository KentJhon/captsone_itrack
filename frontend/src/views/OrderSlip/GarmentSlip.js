import React, { useEffect, useMemo, useRef, useState } from "react";
import "../OrderSlip/style/Slips.css";
import API_BASE_URL from "../../config";

export default function GarmentSlip({ onClose }) {
  const API = useMemo(() => API_BASE_URL, []);
  const today = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "2-digit",
    year: "numeric",
  });

  const [customerName, setCustomerName] = useState("");
  const [course, setCourse] = useState("");
  const [catalog, setCatalog] = useState([]);
  const [lines, setLines] = useState([{ item_id: "", quantity: 1 }]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Hidden buffer for scanner input
  const scanBuffer = useRef("");

  // ---------- helper: parse QR ----------
  const parseQrValue = (raw) => {
    if (!raw) return { name: "", course: "" };

    const cleaned = String(raw).replace(/\r?\n/g, "").trim();
    let parts = cleaned
      .split("\t")
      .map((p) => p.trim())
      .filter(Boolean);

    let name = "";
    let course = "";

    if (parts.length >= 3) {
      name = parts[0];
      course = parts.slice(2).join(" ");
    } else {
      const tokens = cleaned.split(/\s+/).filter(Boolean);
      if (tokens.length >= 3) {
        course = tokens[tokens.length - 1];
        name = tokens.slice(0, tokens.length - 2).join(" ");
      } else if (tokens.length === 2) {
        name = tokens[0];
        course = tokens[1];
      } else if (tokens.length === 1) {
        name = tokens[0];
      }
    }
    return { name, course };
  };

  // ---------- load items (only Garments, with dummy fallback) ----------
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError("");

        const res = await fetch(`${API}/items`);
        const data = await res.json();

        // ✅ Filter only category = "Garments" (case-insensitive, trimmed)
        const garments = (data || []).filter((item) => {
          return (
            String(item.category || "")
              .trim()
              .toLowerCase() === "garments"
          );
        });

        if (garments.length > 0) {
          setCatalog(garments);
        } else {
          // fallback dummy garments if none returned
          setCatalog([
            { item_id: 9991, name: "USTP Polo Shirt", price: 350 },
            { item_id: 9992, name: "USTP Hoodie", price: 600 },
            { item_id: 9993, name: "USTP Lanyard", price: 80 },
          ]);
          setError("No garments found from API. Using dummy items.");
        }
      } catch (e) {
        console.error(e);
        // fallback on error
        setCatalog([
          { item_id: 9991, name: "USTP Polo Shirt", price: 350 },
          { item_id: 9992, name: "USTP Hoodie", price: 600 },
          { item_id: 9993, name: "USTP Lanyard", price: 80 },
        ]);
        setError("Failed to load items. Using dummy garments.");
      } finally {
        setLoading(false);
      }
    })();
  }, [API]);

  // ---------- GLOBAL scanner listener (but *not* when typing in fields) ----------
  useEffect(() => {
    const isFormElement = (el) =>
      el &&
      (el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" ||
        el.isContentEditable);

    const handleKeydown = (e) => {
      // If user is typing in a field, don't treat as scanner input
      if (isFormElement(document.activeElement)) return;

      // From here on, we assume it's the scanner
      e.preventDefault();

      if (e.key === "Escape") {
        scanBuffer.current = "";
        return;
      }

      // ENTER finalizes a full scan
      if (e.key === "Enter") {
        const raw = scanBuffer.current.trim();
        scanBuffer.current = "";
        if (!raw) return;

        const parsed = parseQrValue(raw);
        if (parsed.name) setCustomerName(parsed.name);
        if (parsed.course) setCourse(parsed.course);
        return;
      }

      // TAB = treat as \t
      if (e.key === "Tab") {
        scanBuffer.current += "\t";
        return;
      }

      // Printable characters
      if (e.key && e.key.length === 1) {
        scanBuffer.current += e.key;
      }
    };

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, []);

  // ---------- line item operations ----------
  const addLine = () => setLines((l) => [...l, { item_id: "", quantity: 1 }]);
  const removeLine = (idx) => setLines((l) => l.filter((_, i) => i !== idx));
  const updateLine = (idx, field, value) =>
    setLines((l) =>
      l.map((row, i) => (i === idx ? { ...row, [field]: value } : row))
    );

  const total = lines.reduce((sum, row) => {
    const found = catalog.find(
      (c) => String(c.item_id) === String(row.item_id)
    );
    if (!found) return sum;
    const price = Number(found.price || 0);
    const qty = Number(row.quantity || 0);
    return sum + price * qty;
  }, 0);

  // ---------- submit ----------
  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const userId = JSON.parse(localStorage.getItem("user"))?.id;
    if (!userId) return setError("You must be logged in.");

    const validLines = lines
      .filter((r) => r.item_id && Number(r.quantity) > 0)
      .map((r) => ({
        item_id: Number(r.item_id),
        quantity: Number(r.quantity),
      }));

    if (!customerName.trim()) return setError("Customer name is required.");
    if (validLines.length === 0) return setError("Add at least one item.");

    const payload = {
      user_id: userId,
      customer_name: customerName,
      OR_number: null,
      student_id: null,
      course: course || null,
      items: validLines,
    };

    try {
      setSubmitting(true);
      const res = await fetch(`${API}/api/sales`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const id = data.sale_id ?? data.order_id;
      const amount = data.total_price ?? 0;

      alert(`Order #${id} saved. Total ₱${Number(amount).toFixed(2)}`);
      window.print();
      onClose();
    } catch (e) {
      console.error(e);
      setError(e.message || "Failed to submit order.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="orderslip-overlay">
      <div className="orderslip-container">
        <div className="orderslip-header">
          <h3>Garment Slip</h3>
        </div>

        <div className="orderslip-date">{today}</div>

        {error && <div className="orderslip-error">{error}</div>}

        <form className="orderslip-form" onSubmit={onSubmit}>
          <label>
            Name:
            <input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Enter name"
              required
            />
          </label>

          <label>
            Course:
            <input
              value={course}
              onChange={(e) => setCourse(e.target.value)}
              placeholder="e.g. BSIT"
            />
          </label>

          <div className="orderslip-lines">
            {lines.map((row, idx) => (
              <div key={idx} className="line-row">
                <label>
                  Item:
                  <select
                    value={row.item_id}
                    onChange={(e) => updateLine(idx, "item_id", e.target.value)}
                    disabled={loading}
                    required
                  >
                    <option value="">
                      {loading ? "Loading garments..." : "Select garment"}
                    </option>
                    {catalog.map((it) => (
                      <option key={it.item_id} value={it.item_id}>
                        {it.name} — ₱{Number(it.price).toFixed(2)}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Quantity:
                  <input
                    type="number"
                    min="1"
                    value={row.quantity}
                    onChange={(e) =>
                      updateLine(idx, "quantity", e.target.value)
                    }
                    required
                  />
                </label>

                <button
                  type="button"
                  className="btn-remove-line"
                  onClick={() => removeLine(idx)}
                >
                  Remove
                </button>
              </div>
            ))}

            <button type="button" className="btn-add-line" onClick={addLine}>
              + Add another item
            </button>
          </div>

          <div className="orderslip-total">
            <strong>Total:</strong> ₱{total.toFixed(2)}
          </div>

          {error && <div className="orderslip-error">{error}</div>}

          <div className="orderslip-actions">
            <button
              type="button"
              className="btn-cancel"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button type="submit" className="btn-print" disabled={submitting}>
              {submitting ? "Saving..." : "Save & Print"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
