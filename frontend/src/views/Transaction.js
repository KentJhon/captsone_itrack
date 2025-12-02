import React, { useEffect, useState } from "react";
import "./style/Transaction.css";
import notify from "../utils/notify";
import confirmAction from "../utils/confirm";
import api from "../auth/api";
import { formatDateTime, formatDate } from "../utils/datetime";

function Transaction() {
  const [transactions, setTransactions] = useState([]);
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState("all");
  const [startMonth, setStartMonth] = useState("");
  const [endMonth, setEndMonth] = useState("");
  const [rangeError, setRangeError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [orInput, setOrInput] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    fetchTransactions();
  }, []);

  const fetchTransactions = async () => {
    try {
      const res = await api.get("/transactions");
      setTransactions(res.data.transactions || []);
    } catch (err) {
      console.error("Error fetching transactions:", err);
      notify.error("Failed to fetch transactions.");
    }
  };

  const getDateValue = (t) => {
    if (!t.transaction_date) return 0;
    const d = new Date(t.transaction_date);
    const time = d.getTime();
    return isNaN(time) ? 0 : time;
  };

  const parseMonthValue = (value) => {
    if (!value) return null;
    const [yearStr, monthStr] = value.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);
    if (!year || !month) return null;
    return new Date(year, month - 1, 1);
  };

  useEffect(() => {
    const start = parseMonthValue(startMonth);
    const end = parseMonthValue(endMonth || startMonth);

    if (start && end && end < start) {
      setRangeError("End month cannot be before the start month.");
    } else {
      setRangeError("");
    }
  }, [startMonth, endMonth]);

  let statusFilter = "all";
  let sortBy = "latest";

  switch (filterMode) {
    case "all":
      statusFilter = "all";
      sortBy = "latest";
      break;
    case "completed":
      statusFilter = "completed";
      sortBy = "latest";
      break;
    case "pending":
      statusFilter = "pending";
      sortBy = "latest";
      break;
    case "latest":
      statusFilter = "all";
      sortBy = "latest";
      break;
    case "oldest":
      statusFilter = "all";
      sortBy = "oldest";
      break;
    default:
      statusFilter = "all";
      sortBy = "latest";
  }

  const isWithinMonthRange = (t) => {
    if (!startMonth && !endMonth) return true;

    const dt = t.transaction_date ? new Date(t.transaction_date) : null;
    if (!dt || Number.isNaN(dt.getTime())) return false;

    const start = parseMonthValue(startMonth);
    const end = parseMonthValue(endMonth || startMonth);

    if (start && dt < start) return false;
    if (end) {
      const endExclusive = new Date(end);
      endExclusive.setMonth(endExclusive.getMonth() + 1);
      if (dt >= endExclusive) return false;
    }
    return true;
  };

  const filteredTransactions = transactions
    .filter((t) =>
      (t.customer_name || "").toLowerCase().includes(search.toLowerCase())
    )
    .filter((t) => isWithinMonthRange(t))
    .filter((t) => {
      if (statusFilter === "all") return true;
      if (statusFilter === "pending") return !t.OR_number;
      if (statusFilter === "completed") return !!t.OR_number;
      return true;
    })
    .sort((a, b) => {
      const aHasOR = !!a.OR_number;
      const bHasOR = !!b.OR_number;

      if (!aHasOR && bHasOR) return -1;
      if (aHasOR && !bHasOR) return 1;

      if (sortBy === "latest") return getDateValue(b) - getDateValue(a);
      if (sortBy === "oldest") return getDateValue(a) - getDateValue(b);

      return 0;
    });

  const handleAddOR = (transaction) => {
    setSelectedTransaction(transaction);
    setOrInput(transaction.OR_number || "");
    setErrorMsg("");
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setSelectedTransaction(null);
    setOrInput("");
    setErrorMsg("");
  };

  const handleConfirm = async () => {
    if (!selectedTransaction) return;

    const trimmed = orInput.trim();
    if (!trimmed) {
      const msg = "Please enter an O.R number before confirming.";
      setErrorMsg(msg);
      notify.error(msg);
      return;
    }

    const id = selectedTransaction.order_id;
    const payload = { OR_number: trimmed };

    try {
      const res = await api.post(`/orders/${id}/add_or`, payload);
      const json = res.data || {};

      setTransactions((prev) =>
        prev.map((t) =>
          t.order_id === id
            ? {
                ...t,
                OR_number: json.order?.OR_number ?? trimmed,
                transaction_date:
                  json.order?.transaction_date || t.transaction_date || null,
              }
            : t
        )
      );
      notify.success("O.R# updated successfully");
      closeModal();
    } catch (err) {
      const json = err?.response?.data;
      let msg = err?.message || "Unexpected error occurred";

      if (json?.detail) {
        if (Array.isArray(json.detail)) {
          msg = json.detail.map((e) => e.msg || JSON.stringify(e)).join(" | ");
        } else if (typeof json.detail === "string") {
          msg = json.detail;
        } else if (json.detail?.msg) {
          msg = json.detail.msg;
        }
      } else if (json?.message) {
        msg = json.message;
      }

      setErrorMsg(msg);
      notify.error(msg);
    }
  };

  const handleDeleteRow = async (transaction) => {
    if (!transaction) return;
    const id = transaction.order_id;

    const ok = await confirmAction(
      `Are you sure you want to delete this transaction (TR# ${id})?`
    );
    if (!ok) return;

    try {
      await api.delete(`/orders/${id}`);
      setTransactions((prev) => prev.filter((t) => t.order_id !== id));
      notify.success("Transaction deleted successfully");
    } catch (err) {
      const msg =
        err?.response?.data?.detail ||
        err.message ||
        "Error deleting transaction";
      setErrorMsg(msg);
      notify.error(msg);
    }
  };

  const handleClearMonths = () => {
    setStartMonth("");
    setEndMonth("");
    setRangeError("");
  };

  const formatMonthLabel = (value) => {
    if (!value) return "";
    const [year, month] = value.split("-");
    const d = new Date(Number(year), Number(month) - 1, 1);
    return d.toLocaleString("default", { month: "long", year: "numeric" });
  };

  const handleGeneratePdf = () => {
    if (rangeError) {
      notify.error(rangeError);
      return;
    }

    const printableRows = filteredTransactions.filter((t) => !!t.OR_number);
    if (!printableRows.length) {
      notify.error("No completed order slips for the selected month(s).");
      return;
    }

    const startLabel = formatMonthLabel(startMonth);
    const endLabel = formatMonthLabel(endMonth || startMonth);
    const label =
      startLabel && endLabel
        ? startLabel === endLabel
          ? `For ${startLabel}`
          : `For ${startLabel} to ${endLabel}`
        : "All months";

    // Bond-paper table renderer to match reference slip layout
    const escapeHtml = (str) =>
      String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    const formatNumericDate = (input) => {
      if (!input) return "";
      const d = new Date(input);
      if (Number.isNaN(d.getTime())) return String(input);
      return d.toLocaleDateString("en-US", {
        month: "2-digit",
        day: "2-digit",
        year: "numeric",
      });
    };

    const buildSlipTable = (t) => {
      const effDate = formatNumericDate(t.transaction_date) || "";
      const name = escapeHtml(t.customer_name || "");
      const item = escapeHtml(t.items || t.item_name || "");
      const price = `PHP ${Number(t.total_price || 0).toFixed(2)}`;
      const orNumber = escapeHtml(t.OR_number || "");

      return `
        <div class="slip-card">
          <table class="slip-table">
            <colgroup>
              <col style="width: 38%;">
              <col style="width: 32%;">
              <col style="width: 30%;">
            </colgroup>
            <tr class="header-row top-row">
              <td class="header-left-cell" rowspan="2">
                <div class="header-title">BOOK CENTER</div>
                <div class="header-sub">Instructional Manuals</div>
              </td>
              <td class="header-doc-cell header-blue" colspan="2">Document code No.</td>
            </tr>
            <tr class="header-row">
              <td class="header-code-cell" colspan="2">FM-USTP-ED-001</td>
            </tr>
            <tr class="rev-row label">
              <td class="label-blue">Revision No.</td>
              <td class="label-blue">Effective date</td>
              <td class="label-blue">Page no.</td>
            </tr>
            <tr class="rev-row value">
              <td>0</td>
              <td>${effDate}</td>
              <td>1 of 1</td>
            </tr>
            <tr class="detail-row">
              <td class="detail-label">NAME :</td>
              <td class="detail-value" colspan="2">${name}</td>
            </tr>
            <tr class="detail-row">
              <td class="detail-label">ITEM:</td>
              <td class="detail-value" colspan="2">${item}</td>
            </tr>
            <tr class="detail-row">
              <td class="detail-label">PRICE:</td>
              <td class="detail-value" colspan="2">${price}</td>
            </tr>
            <tr class="detail-row">
              <td class="detail-label">DATE:</td>
              <td class="detail-value" colspan="2">${effDate}</td>
            </tr>
            <tr class="detail-row">
              <td class="detail-label">OR #</td>
              <td class="detail-value" colspan="2">${orNumber}</td>
            </tr>
          </table>
        </div>
      `;
    };

    const slipHtml = printableRows.map((t) => buildSlipTable(t)).join("");

    const html = `
      <html>
        <head>
          <title>Order Slip Pack</title>
          <style>
            * { box-sizing: border-box; }
            body { margin: 0; padding: 24px; font-family: "Arial", sans-serif; background: #f8fafc; }
            h2 { margin: 0 0 4px; font-family: "Inter", system-ui, sans-serif; }
            .meta { margin: 0 0 12px; color: #475569; font-size: 13px; font-family: "Inter", system-ui, sans-serif; }
            .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
            .slip-card { background: #ffffff; border: 1px solid #1f2937; border-radius: 2px; padding: 6px; page-break-inside: avoid; }
            .slip-table { width: 100%; border-collapse: collapse; font-size: 13px; }
            .slip-table td { border: 1px solid #1f2937; padding: 4px 6px; vertical-align: middle; }
            .header-row td { font-weight: 700; font-size: 12px; }
            .header-left-cell { background: #ffffff; font-weight: 700; vertical-align: top; }
            .header-sub { font-weight: 400; font-size: 11px; margin-top: 2px; }
            .header-doc-cell { text-align: center; }
            .header-code-cell { text-align: center; font-weight: 700; background: #ffffff; }
            .header-blue { background: #1f73c7; color: #ffffff; }
            .rev-row.label td { text-align: center; font-weight: 700; background: #1f73c7; color: #ffffff; }
            .rev-row.value td { text-align: center; font-weight: 600; background: #ffffff; }
            .label-blue { background: #1f73c7; color: #ffffff; font-weight: 700; }
            .detail-row .detail-label { width: 28%; font-weight: 700; background: #f5f7fa; padding-left: 6px; }
            .detail-row .detail-value { font-weight: 600; background: #ffffff; }
            @media print {
              body { background: #ffffff; padding: 12px; }
              .slip-card { border: 1px solid #1f2937; }
              * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
            }
          </style>
        </head>
        <body>
          <h2>Order Slip Pack</h2>
          <p class="meta">${label} · Generated ${formatDate(new Date())}</p>
          <div class="grid">${slipHtml}</div>
        </body>
      </html>
    `;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      notify.error("Please allow pop-ups to view the PDF.");
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  return (
    <div className="inventory-page">
      <div className="inventory-header no-print">
        <div>
          <h2>Transaction History</h2>
          <p className="inventory-subtitle">
            {filteredTransactions.length} record
            {filteredTransactions.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      <div className="inventory-table-card">
        <div className="filters-row no-print">
          <div className="filter-group">
            <input
              type="text"
              placeholder="Search customer name..."
              className="search-field"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <select
              className="sort-select"
              value={filterMode}
              onChange={(e) => setFilterMode(e.target.value)}
            >
              <option value="all">All</option>
              <option value="completed">Completed</option>
              <option value="pending">Pending</option>
              <option value="latest">Latest</option>
              <option value="oldest">Oldest</option>
            </select>
          </div>

          <div className="filter-group month-range-group">
            <label className="filter-label">Month range:</label>
            <input
              type="month"
              className="month-input"
              value={startMonth}
              onChange={(e) => setStartMonth(e.target.value)}
            />
            <span className="range-sep">to</span>
            <input
              type="month"
              className="month-input"
              value={endMonth}
              onChange={(e) => setEndMonth(e.target.value)}
            />

            <button className="btn btn-outline" onClick={handleClearMonths}>
              Clear
            </button>
            <button className="btn btn-primary" onClick={handleGeneratePdf}>
              Generate PDF
            </button>
          </div>
        </div>

        {rangeError && (
          <div className="error-message no-print">{rangeError}</div>
        )}

        <div className="inventory-table-scroll">
          <table className="inventory-table">
            <thead>
              <tr>
                <th style={{ width: "15%" }}>O.R#</th>
                <th style={{ width: "28%" }}>Customer</th>
                <th style={{ width: "15%" }}>Total Price</th>
                <th style={{ width: "10%", whiteSpace: "nowrap" }}>Date</th>
                <th className="no-print" style={{ width: "12%" }}>
                  Processed By
                </th>
                <th className="no-print" style={{ width: "8%" }}>
                  Status
                </th>
                <th className="no-print" style={{ width: "12%" }}>
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.map((t) => (
                <tr key={t.order_id}>
                  <td>{t.OR_number || "-"}</td>
                  <td style={{ textAlign: "left" }}>{t.customer_name}</td>
                  <td>₱{Number(t.total_price).toFixed(2)}</td>
                  <td className="date-col">
                    {t.transaction_date
                      ? formatDateTime(t.transaction_date)
                      : "-"}
                  </td>
                  <td className="no-print">{t.username || "-"}</td>
                  <td className="no-print">
                    {t.OR_number ? (
                      <span className="status-pill status-done">Done</span>
                    ) : (
                      <span className="status-pill status-pending">Pending</span>
                    )}
                  </td>
                  <td className="no-print">
                    {!t.OR_number ? (
                      <div className="action-buttons">
                        <button
                          className="add-btn"
                          onClick={() => handleAddOR(t)}
                        >
                          ADD O.R#
                        </button>
                        <button
                          className="icon-delete-btn"
                          title="Delete transaction"
                          onClick={() => handleDeleteRow(t)}
                        >
                          ×
                        </button>
                      </div>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}

              {filteredTransactions.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: "12px", textAlign: "center" }}>
                    No transactions found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && selectedTransaction && (
        <div className="modal-overlay no-print" onClick={closeModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Book Center</h3>
            <p className="modal-date">{formatDate(new Date())}</p>

            <div className="modal-info">
              <p>
                <b>TR#:</b> {selectedTransaction.order_id}
              </p>
              <p>
                <b>Name:</b> {selectedTransaction.customer_name}
              </p>
              <p>
                <b>Total:</b> ₱{Number(selectedTransaction.total_price).toFixed(2)}
              </p>

              <div className="modal-input">
                <label>
                  <b>O.R#:</b>
                </label>
                <input
                  type="text"
                  placeholder="Enter O.R number"
                  value={orInput}
                  onChange={(e) => {
                    setOrInput(e.target.value);
                    setErrorMsg("");
                  }}
                />
              </div>

              {errorMsg && <p className="error-text">{errorMsg}</p>}
            </div>

            <div className="modal-buttons">
              <button className="confirm-btn" onClick={handleConfirm}>
                CONFIRM
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Transaction;
