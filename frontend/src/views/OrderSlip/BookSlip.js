import React, { useEffect, useMemo, useRef, useState } from "react";
import "../OrderSlip/style/Slips.css";

function BookSlip({ onClose }) {
  const API = useMemo(() => "http://127.0.0.1:8000", []);
  const today = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "2-digit",
    year: "numeric",
  });

  const [name, setName] = useState("");
  const [course, setCourse] = useState("");

  const [catalog, setCatalog] = useState([]);
  const [lines, setLines] = useState([{ item_id: "", quantity: 1 }]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const scanBuffer = useRef("");

  // ---------- FETCH STATIONERY ITEMS ----------
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError("");
        const res = await fetch(`${API}/items`);
        const data = await res.json();

        const stationery = (data || []).filter((it) => {
          return (
            String(it.category || "")
              .trim()
              .toLowerCase() === "stationery"
          );
        });

        setCatalog(stationery);
      } catch (e) {
        console.error(e);
        setError("Failed to load items");
      } finally {
        setLoading(false);
      }
    })();
  }, [API]);

  // ---------- QR PARSER ----------
  const parseQrValue = (raw) => {
    if (!raw) return { name: "", course: "" };

    const cleaned = String(raw).replace(/\r?\n/g, "").trim();
    let parts = cleaned
      .split("\t")
      .map((p) => p.trim())
      .filter(Boolean);

    let parsedName = "";
    let parsedCourse = "";

    if (parts.length >= 3) {
      parsedName = parts[0];
      parsedCourse = parts.slice(2).join(" ");
    } else {
      const tokens = cleaned.split(/\s+/).filter(Boolean);
      if (tokens.length >= 3) {
        parsedCourse = tokens[tokens.length - 1];
        parsedName = tokens.slice(0, tokens.length - 2).join(" ");
      } else if (tokens.length === 2) {
        parsedName = tokens[0];
        parsedCourse = tokens[1];
      } else if (tokens.length === 1) {
        parsedName = tokens[0];
      }
    }

    return { name: parsedName, course: parsedCourse };
  };

  // ---------- GLOBAL SCANNER LISTENER ----------
  useEffect(() => {
    const isFormElement = (el) =>
      el &&
      (el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" ||
        el.isContentEditable);

    const handleKeydown = (e) => {
      if (isFormElement(document.activeElement)) return;

      e.preventDefault();

      if (e.key === "Escape") {
        scanBuffer.current = "";
        return;
      }

      if (e.key === "Enter") {
        const raw = scanBuffer.current.trim();
        scanBuffer.current = "";
        if (!raw) return;

        const parsed = parseQrValue(raw);
        if (parsed.name) setName(parsed.name);
        if (parsed.course) setCourse(parsed.course);
        return;
      }

      if (e.key === "Tab") {
        scanBuffer.current += "\t";
        return;
      }

      if (e.key && e.key.length === 1) {
        scanBuffer.current += e.key;
      }
    };

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, []);

  // ---------- LINE OPERATIONS ----------
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

  // ---------- SUBMIT: SAVE + PRINT (like GarmentSlip) ----------
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

    if (!name.trim()) return setError("Student name is required.");
    if (validLines.length === 0) return setError("Add at least one item.");

    const payload = {
      user_id: userId,
      customer_name: name, // match backend field
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
        {/* Header */}
        <div className="orderslip-header">
          <h3>Book Slip</h3>
        </div>

        {/* Date */}
        <div className="orderslip-date">{today}</div>

        {error && <div className="orderslip-error">{error}</div>}

        <form className="orderslip-form" onSubmit={onSubmit}>
          <label>
            Name:
            <input
              type="text"
              placeholder="Student name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>

          <label>
            Course:
            <input
              type="text"
              placeholder="e.g. BSIT"
              value={course}
              onChange={(e) => setCourse(e.target.value)}
            />
          </label>

          {/* Dynamic item rows */}
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
                      {loading ? "Loading..." : "Select stationery item"}
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

          {/* Buttons */}
          <div className="orderslip-actions">
            <button
              className="btn-cancel"
              type="button"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button className="btn-print" type="submit" disabled={submitting}>
              {submitting ? "Saving..." : "Save & Print"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default BookSlip;
