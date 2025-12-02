// frontend/src/printing/pos58Printer.js

// Check if WebUSB is available
export function isWebUsbSupported() {
  return typeof navigator !== "undefined" && "usb" in navigator;
}

// Show all USB devices (adjust with filters when you know vendor/product IDs)
const USB_FILTERS = [{}];

let device = null;
let interfaceNumber = 0;
let endpointNumber = 1;

async function openDevice(selectedDevice) {
  device = selectedDevice;

  if (!device.opened) {
    await device.open();
  }

  if (device.configuration == null) {
    await device.selectConfiguration(1);
  }

  const config = device.configuration;
  console.log("USB configuration:", config);

  // Find a bulk OUT endpoint dynamically
  outer: for (const iface of config.interfaces) {
    for (const alt of iface.alternates) {
      if (!alt.endpoints) continue;
      for (const ep of alt.endpoints) {
        if (ep.direction === "out" && ep.type === "bulk") {
          interfaceNumber = iface.interfaceNumber;
          endpointNumber = ep.endpointNumber;
          break outer;
        }
      }
    }
  }

  console.log("Using interface", interfaceNumber, "endpoint", endpointNumber);

  await device.claimInterface(interfaceNumber);
}

async function sendRaw(data) {
  if (!device) {
    throw new Error("Printer not connected");
  }
  return device.transferOut(endpointNumber, data);
}

// Public: ask user to pick a USB device and connect
export async function connectPrinter() {
  if (!isWebUsbSupported()) {
    throw new Error(
      "WebUSB is not supported. Use Chrome or Edge on desktop over HTTPS/localhost."
    );
  }

  const selectedDevice = await navigator.usb.requestDevice({
    filters: USB_FILTERS,
  });

  console.log("Selected USB device:", {
    productName: selectedDevice.productName,
    manufacturerName: selectedDevice.manufacturerName,
    vendorId: selectedDevice.vendorId.toString(16),
    productId: selectedDevice.productId.toString(16),
  });

  await openDevice(selectedDevice);
  return selectedDevice;
}

// ---------- ESC/POS helpers ----------

function escInit() {
  return Uint8Array.from([0x1b, 0x40]); // ESC @
}

function escNewLine() {
  return Uint8Array.from([0x0a]); // LF
}

function escFullCut() {
  // Many 58mm printers just feed if they don't have a cutter
  return Uint8Array.from([0x1d, 0x56, 0x41, 0x10]); // GS V A n
}

function concatArrays(...arrays) {
  const length = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

function encodeText(text) {
  const safeText = text.replace(/₱/g, "PHP ");
  return new TextEncoder().encode(safeText);
}

// Typical 58mm default font width
const LINE_WIDTH = 32;
// Column widths chosen so row length always equals LINE_WIDTH (include edge separators)
// 2-column rows: widths sum to 29 (29 + 3 separators = 32)
const HEADER_COLS = [11, 18]; // e.g., "BOOK CENTER" | "Document code No."
const DETAIL_COLS = [8, 21]; // e.g., "NAME :" | value
// 3-column rows: widths sum to 28 (28 + 4 separators = 32)
const REVISION_COLS = [9, 11, 8]; // e.g., "Revision No." | "Eff date" | "Page no."

function padCenter(text, width = LINE_WIDTH) {
  const len = text.length;
  if (len >= width) return text.slice(0, width);
  const left = Math.floor((width - len) / 2);
  const right = width - len - left;
  return " ".repeat(left) + text + " ".repeat(right);
}

function lineSeparator() {
  return "-".repeat(LINE_WIDTH);
}

function formatNumericDate(input) {
  if (!input) return "";
  try {
    const d = new Date(input);
    if (Number.isNaN(d.getTime())) return String(input);
    return d.toLocaleDateString("en-US", {
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
    });
  } catch (e) {
    return String(input);
  }
}

function padCell(text, width) {
  const str = String(text ?? "");
  if (str.length === width) return str;
  if (str.length < width) return str + " ".repeat(width - str.length);
  return str.slice(0, width);
}

function makeBorder(widths) {
  return `+${widths.map((w) => "-".repeat(w)).join("+")}+`;
}

function makeRow(values, widths) {
  return `|${values
    .map((v, idx) => padCell(v, widths[idx]))
    .join("|")}|`;
}

function formatDetail(label, value) {
  return makeRow([`${label}:`, value || ""], DETAIL_COLS);
}

function buildSlipTable({
  headerLeft,
  headerLeftSub,
  docCode,
  date,
  revision = "0",
  page = "1 of 1",
  name,
  item,
  price,
  orNumber,
}) {
  const lines = [];

  const effectiveDate = formatNumericDate(date);

  // Header rows
  lines.push(makeBorder(HEADER_COLS));
  lines.push(makeRow([headerLeft, "Document code No."], HEADER_COLS));
  lines.push(
    makeRow(
      [headerLeftSub || "", docCode || ""],
      HEADER_COLS
    )
  );
  lines.push(makeBorder(HEADER_COLS));

  // Revision / Effective date / Page
  lines.push(makeBorder(REVISION_COLS));
  lines.push(makeRow(["Revision No.", "Eff date", "Page no."], REVISION_COLS));
  lines.push(makeRow([revision, effectiveDate, page], REVISION_COLS));
  lines.push(makeBorder(REVISION_COLS));

  // Details
  lines.push(makeBorder(DETAIL_COLS));
  lines.push(formatDetail("NAME", name || ""));
  lines.push(makeBorder(DETAIL_COLS));

  lines.push(formatDetail("ITEM", item || ""));
  lines.push(makeBorder(DETAIL_COLS));

  lines.push(formatDetail("PRICE", price || ""));
  lines.push(makeBorder(DETAIL_COLS));

  lines.push(formatDetail("DATE", date || ""));
  lines.push(makeBorder(DETAIL_COLS));

  lines.push(formatDetail("OR #", orNumber || ""));
  lines.push(makeBorder(DETAIL_COLS));

  return lines.join("\n");
}

// ---------- Receipt builders ----------

export function buildGarmentReceipt(payload) {
  const { date, customerName, course, items = [], total } = payload;

  const firstItem = items[0];
  const itemName =
    items.length > 1
      ? `${items.length} items (e.g. ${firstItem?.name || ""})`
      : firstItem?.name || "";

  const priceText =
    typeof total === "number" && !Number.isNaN(total)
      ? `PHP ${total.toFixed(2)}`
      : "";

  return buildSlipTable({
    headerLeft: "GARMENTS",
    headerLeftSub: "USTP Display Ctr.",
    docCode: "FM-USTP-ED-018",
    date,
    name: customerName,
    item: itemName,
    price: priceText,
    orNumber: "",
  });
}

export function buildBookReceipt(payload) {
  const { date, customerName, course, items = [], total } = payload;

  const firstItem = items[0];
  const itemName =
    items.length > 1
      ? `${items.length} items (e.g. ${firstItem?.name || ""})`
      : firstItem?.name || "";

  const priceText =
    typeof total === "number" && !Number.isNaN(total)
      ? `PHP ${total.toFixed(2)}`
      : "";

  return buildSlipTable({
    headerLeft: "BOOK CENTER",
    headerLeftSub: course || "Instructional Manuals",
    docCode: "FM-USTP-ED-001",
    date,
    name: customerName,
    item: itemName,
    price: priceText,
    orNumber: "",
  });
}

// ---------- Print helpers ----------

export async function printGarmentReceipt(payload) {
  const text = buildGarmentReceipt(payload);
  const init = escInit();
  const body = encodeText(text);
  const lf = escNewLine();
  const cut = escFullCut();

  const data = concatArrays(init, body, lf, lf, cut);
  console.log("Sending bytes to printer (garment):", data);

  await sendRaw(data);
}

export async function printBookReceipt(payload) {
  const text = buildBookReceipt(payload);
  const init = escInit();
  const body = encodeText(text);
  const lf = escNewLine();
  const cut = escFullCut();

  const data = concatArrays(init, body, lf, lf, cut);
  console.log("Sending bytes to printer (book):", data);

  await sendRaw(data);
}
