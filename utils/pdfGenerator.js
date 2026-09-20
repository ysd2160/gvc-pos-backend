import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { amountToWords } from "./numberToWords.js";
import { LOGO_DIR } from "../config/shop.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(__dirname, "../assets/fonts");

const PAGE_LEFT = 40;
const PAGE_RIGHT = 555;
const CONTENT_WIDTH = PAGE_RIGHT - PAGE_LEFT;
const ACCENT = "#6C5CE0"; // header/table accent colour
const ACCENT_LIGHT = "#F3F1FD";
const TEXT_DARK = "#1F2937";
const TEXT_MUTED = "#6B7280";

// Format a stored UTC timestamp as a dd-mm-yyyy IST calendar date, since the
// shop operates in India regardless of where the server/host is located.
const formatDateIST = (date) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(new Date(date));
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.day}-${map.month}-${map.year}`;
};

const money = (n) => `₹${Number(n || 0).toFixed(2)}`;

// Column layout (widths sum to CONTENT_WIDTH = 515).
// GST wali shop (Frozetto): HSN + GST columns hote hain.
// Bina GST wali shop: simple table.
const makeCols = (gst) => {
  const w = gst
    ? { idx: 22, name: 145, hsn: 55, qty: 45, unit: 40, price: 65, gst: 65, amount: 78 }
    : { idx: 22, name: 235, hsn: 0, qty: 55, unit: 45, price: 75, gst: 0, amount: 83 };
  const cols = {};
  let x = PAGE_LEFT;
  ["idx", "name", "hsn", "qty", "unit", "price", "gst", "amount"].forEach((k) => {
    cols[k] = { x, w: w[k] };
    x += w[k];
  });
  return cols;
};

const drawTableHeader = (doc, y, COLS, gst) => {
  doc.rect(PAGE_LEFT, y, CONTENT_WIDTH, 22).fill(ACCENT);
  doc.fillColor("#FFFFFF").font("Body-Bold").fontSize(9);
  const ty = y + 6;
  doc.text("#", COLS.idx.x + 4, ty, { width: COLS.idx.w - 4 });
  doc.text("Item Name", COLS.name.x, ty, { width: COLS.name.w });
  if (gst) doc.text("HSN/SAC", COLS.hsn.x, ty, { width: COLS.hsn.w });
  doc.text("Qty", COLS.qty.x, ty, { width: COLS.qty.w - 10, align: "right" });
  doc.text("Unit", COLS.unit.x + 4, ty, { width: COLS.unit.w - 4 });
  doc.text("Price/Unit", COLS.price.x, ty, { width: COLS.price.w, align: "right" });
  if (gst) doc.text("GST", COLS.gst.x, ty, { width: COLS.gst.w, align: "right" });
  doc.text("Amount", COLS.amount.x, ty, { width: COLS.amount.w - 4, align: "right" });
  doc.fillColor(TEXT_DARK);
  return y + 22;
};

export const generateBillPDF = (bill, res, shop) => {
  const gst = !!shop.gstEnabled;
  const COLS = makeCols(gst);
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  doc.pipe(res);

  // Register DejaVu Sans (bundled in assets/fonts) instead of the standard
  // PDF "Helvetica" family - Helvetica's built-in encoding has no glyph for
  // the Indian Rupee sign (₹), so it silently disappears when printed.
  // DejaVu Sans includes it, and works identically on every host.
  doc.registerFont("Body", path.join(FONT_DIR, "DejaVuSans.ttf"));
  doc.registerFont("Body-Bold", path.join(FONT_DIR, "DejaVuSans-Bold.ttf"));
  doc.registerFont("Body-Oblique", path.join(FONT_DIR, "DejaVuSans-Oblique.ttf"));

  const shopName = shop.name;
  const shopAddress = shop.address || "";
  const shopPhone = shop.phone || "";
  const shopEmail = shop.email || "";
  const shopGSTIN = gst ? shop.gstin || "" : "";
  const shopState = gst ? shop.state || "" : "";

  // ---------- Letterhead ----------
  doc.fillColor(TEXT_DARK).font("Body-Bold").fontSize(18).text(shopName, PAGE_LEFT, 40);
  doc.font("Body").fontSize(9).fillColor(TEXT_MUTED);
  if (shopAddress) doc.text(shopAddress, PAGE_LEFT, doc.y + 2, { width: 340 });
  if (shopPhone) doc.text(`Phone no.: ${shopPhone}`, PAGE_LEFT);
  if (shopEmail) doc.text(`Email: ${shopEmail}`, PAGE_LEFT);
  if (shopGSTIN) doc.text(`GSTIN: ${shopGSTIN}`, PAGE_LEFT);
  if (shopState) doc.text(`State: ${shopState}`, PAGE_LEFT);

  // Logo (backend/assets/logos/<shop>.png) - top right; file na ho to skip
  try {
    const logoPath = path.join(LOGO_DIR, shop.logoFile);
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, PAGE_RIGHT - 80, 34, { fit: [80, 80], align: "right" });
    }
  } catch (err) {
    console.warn("[pdf] Logo skip kiya:", err.message);
  }

  const headerBottom = Math.max(doc.y + 8, 118);
  doc.moveTo(PAGE_LEFT, headerBottom).lineTo(PAGE_RIGHT, headerBottom).lineWidth(2).strokeColor(ACCENT).stroke();

  // ---------- "Tax Invoice" title ----------
  doc.font("Body-Bold").fontSize(16).fillColor(ACCENT);
  doc.text(gst ? "Tax Invoice" : "Bill", PAGE_LEFT, headerBottom + 12, { width: CONTENT_WIDTH, align: "center" });
  doc.fillColor(TEXT_DARK);

  // ---------- Bill To / Invoice Details ----------
  let y = headerBottom + 42;
  doc.font("Body-Bold").fontSize(10);
  doc.text("Bill To", PAGE_LEFT, y);
  doc.text("Invoice Details", PAGE_LEFT + 300, y, { width: 215, align: "right" });

  y += 16;
  doc.font("Body-Bold").fontSize(11);
  doc.text(bill.customerName || "Walk-in Customer", PAGE_LEFT, y, { width: 280 });
  doc.font("Body").fontSize(9).fillColor(TEXT_MUTED);
  doc.text(`Invoice No.: ${bill.billNumber}`, PAGE_LEFT + 300, y, { width: 215, align: "right" });
  doc.text(`Date: ${formatDateIST(bill.createdAt)}`, PAGE_LEFT + 300, doc.y, { width: 215, align: "right" });

  let bottomLeftY = doc.y;
  if (bill.customerPhone) {
    doc.text(`Contact No.: ${bill.customerPhone}`, PAGE_LEFT, doc.y > bottomLeftY ? bottomLeftY : doc.y);
  }
  doc.fillColor(TEXT_DARK);

  // ---------- Items table ----------
  y = Math.max(doc.y, bottomLeftY) + 18;
  y = drawTableHeader(doc, y, COLS, gst);

  doc.font("Body").fontSize(9);
  let totalQty = 0;
  bill.items.forEach((item, idx) => {
    // Start a fresh page (with a repeated table header) if we're running out
    // of room, so a long bill never overlaps the totals/footer section.
    if (y > 720) {
      doc.addPage();
      y = 40;
      y = drawTableHeader(doc, y, COLS, gst);
      doc.font("Body").fontSize(9).fillColor(TEXT_DARK);
    }

    const rowH = 24;
    if (idx % 2 === 1) {
      doc.rect(PAGE_LEFT, y, CONTENT_WIDTH, rowH).fill(ACCENT_LIGHT);
    }
    doc.fillColor(TEXT_DARK);
    const lineTotalWithGst = item.lineTotal + item.gstAmount;
    totalQty += item.quantity;

    const ty = y + 4;
    doc.font("Body-Bold").fontSize(9);
    doc.text(String(idx + 1), COLS.idx.x + 4, ty, { width: COLS.idx.w - 4 });
    doc.text(item.name, COLS.name.x, ty, { width: COLS.name.w });
    doc.font("Body").fontSize(9);
    if (gst) doc.text(item.hsn || "-", COLS.hsn.x, ty, { width: COLS.hsn.w });
    doc.text(`${item.quantity}`, COLS.qty.x, ty, { width: COLS.qty.w - 10, align: "right" });
    doc.text(item.unit || "-", COLS.unit.x + 4, ty, { width: COLS.unit.w - 4 });
    doc.text(`₹${item.price.toFixed(2)}`, COLS.price.x, ty, { width: COLS.price.w, align: "right" });
    if (gst) {
      doc.fontSize(8);
      doc.text(`₹${item.gstAmount.toFixed(2)} (${item.gstPercent}%)`, COLS.gst.x, ty, { width: COLS.gst.w, align: "right" });
      doc.fontSize(9);
    }
    doc.text(`₹${lineTotalWithGst.toFixed(2)}`, COLS.amount.x, ty, { width: COLS.amount.w - 4, align: "right" });

    y += rowH;
  });

  // Total row
  doc.moveTo(PAGE_LEFT, y).lineTo(PAGE_RIGHT, y).strokeColor("#D1D5DB").lineWidth(1).stroke();
  y += 6;
  doc.font("Body-Bold").fontSize(9).fillColor(TEXT_DARK);
  doc.text("Total", COLS.name.x - 22, y, { width: COLS.idx.w + COLS.name.w });
  doc.text(`${totalQty}`, COLS.qty.x, y, { width: COLS.qty.w - 10, align: "right" });
  if (gst) doc.text(`₹${bill.totalGst.toFixed(2)}`, COLS.gst.x, y, { width: COLS.gst.w, align: "right" });
  doc.text(`₹${bill.grandTotal.toFixed(2)}`, COLS.amount.x, y, { width: COLS.amount.w - 4, align: "right" });
  y += 22;

  // ---------- Amount in words + Totals summary ----------
  if (y > 680) {
    doc.addPage();
    y = 40;
  }

  const summaryX = PAGE_LEFT + 300;
  const summaryW = 215;
  let sy = y;

  doc.font("Body-Bold").fontSize(9).text("Invoice Amount In Words", PAGE_LEFT, sy, { width: 280 });
  doc.font("Body").fontSize(9).fillColor(TEXT_MUTED);
  doc.text(amountToWords(bill.grandTotal), PAGE_LEFT, doc.y + 2, { width: 270 });
  doc.fillColor(TEXT_DARK);

  const sgst = bill.totalGst / 2;
  const cgst = bill.totalGst / 2;

  const summaryRow = (label, value, opts = {}) => {
    doc.font(opts.bold ? "Body-Bold" : "Body").fontSize(opts.bold ? 10 : 9);
    if (opts.highlight) {
      doc.rect(summaryX, sy - 2, summaryW, 18).fill(ACCENT_LIGHT);
      doc.fillColor(TEXT_DARK);
    }
    if (opts.red) doc.fillColor("#DC2626");
    doc.text(label, summaryX + 6, sy, { width: summaryW - 70 });
    doc.text(value, summaryX, sy, { width: summaryW - 6, align: "right" });
    doc.fillColor(TEXT_DARK);
    sy += 18;
  };

  summaryRow("Sub Total", money(bill.subtotal));
  if (gst) {
    summaryRow("SGST", money(sgst));
    summaryRow("CGST", money(cgst));
  }
  if (bill.discount > 0) summaryRow("Discount", `- ${money(bill.discount)}`);
  summaryRow("Total", money(bill.grandTotal), { bold: true, highlight: true });
  summaryRow("Received", money(bill.amountPaid));
  if (bill.changeReturned > 0) {
    summaryRow("Cash Given", money(bill.cashReceived));
    summaryRow("Change Returned", money(bill.changeReturned));
  }
  summaryRow("Balance", money(bill.balanceDue), bill.balanceDue > 0 ? { bold: true, red: true } : {});

  y = Math.max(doc.y + 10, sy + 10);

  // Payment mode breakdown (useful for the shop owner; not in the summary box)
  if (bill.payments && bill.payments.length > 1) {
    doc.font("Body").fontSize(8).fillColor(TEXT_MUTED);
    const modes = bill.payments.map((p) => `${p.mode}: ${money(p.amount)}`).join("   \u2022   ");
    doc.text(`Paid via \u2014 ${modes}`, PAGE_LEFT, y, { width: 320 });
    doc.fillColor(TEXT_DARK);
  }

  // ---------- Signature ----------
  const sigY = y + 50;
  doc.font("Body").fontSize(9).text(`For: ${shopName}`, PAGE_LEFT + 300, sigY, { width: 215, align: "right" });
  doc.font("Body-Bold").fontSize(9).text("Authorized Signatory", PAGE_LEFT + 300, sigY + 40, { width: 215, align: "right" });

  // ---------- Footer ----------
  doc.font("Body-Oblique").fontSize(9).fillColor(TEXT_MUTED);
  doc.text(shop.footer || "Thank you for your business!", PAGE_LEFT, sigY + 70, { width: CONTENT_WIDTH, align: "center" });

  doc.end();
};
