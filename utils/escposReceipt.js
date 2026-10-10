// 58mm thermal printer ke liye raw ESC/POS bytes banata hai.
// RawBT (Android app) ye bytes leke Bluetooth/USB/WiFi printer par bhejta hai.
//
// Thermal printer ke font mein ₹ nahi hota, isliye "Rs." print hota hai.
// Bill ka layout shop ke hisaab se badalta hai:
//   - GST wali shop  -> Subtotal + GST lines dikhte hain
//   - bina GST wali  -> sirf items + TOTAL (clean cafe receipt)
import path from "path";
import { LOGO_DIR } from "../config/shop.js";
import { loadLogoRaster } from "./escposImage.js";

const ESC = 0x1b;
const GS = 0x1d;
const WIDTH = 32; // characters per line (58mm, Font A)

const CMD = {
  init: Buffer.from([ESC, 0x40]),
  alignLeft: Buffer.from([ESC, 0x61, 0]),
  alignCenter: Buffer.from([ESC, 0x61, 1]),
  boldOn: Buffer.from([ESC, 0x45, 1]),
  boldOff: Buffer.from([ESC, 0x45, 0]),
  sizeNormal: Buffer.from([ESC, 0x21, 0x00]),
  sizeTall: Buffer.from([ESC, 0x21, 0x10]), // double height (same width)
  sizeBig: Buffer.from([ESC, 0x21, 0x30]), // double width + height (16 chars/line)
  feed: (n) => Buffer.from([ESC, 0x64, n]),
  cut: Buffer.from([GS, 0x56, 0x00]),
};

// Printer sirf ASCII samajhta hai - baaki characters hata do (garbage se bachne ke liye)
const clean = (s) => String(s ?? "").replace(/[^\x20-\x7E]/g, "").trim();
const line = (s = "") => Buffer.from(`${String(s).replace(/[^\x20-\x7E]/g, "")}\n`, "utf8");
const rule = (ch = "-") => line(ch.repeat(WIDTH));

const wrap = (str, width = WIDTH) => {
  const words = clean(str).split(" ");
  const lines = [];
  let cur = "";
  words.forEach((w) => {
    if ((cur ? `${cur} ${w}` : w).length > width) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  });
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
};

const row = (label, value, width = WIDTH) => {
  const gap = Math.max(width - label.length - value.length, 1);
  return `${label}${" ".repeat(gap)}${value}`;
};

const rupee = (n) => `Rs.${Number(n || 0).toFixed(2)}`;

const formatDateTimeIST = (date) => {
  const d = new Date(date);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(d);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const time = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  return `${map.day}-${map.month}-${map.year} ${time}`;
};

export const buildReceiptEscPos = async (bill, shop) => {
  const chunks = [CMD.init, CMD.alignCenter];

  // ---- Logo (agar backend/assets/logos/<shop>.png rakhi hai) ----
  const logo = await loadLogoRaster(path.join(LOGO_DIR, shop.logoFile), {
    maxWidth: Number(process.env.LOGO_PRINT_WIDTH) || 240,
  });
  if (logo) {
    chunks.push(logo, CMD.feed(1));
  }

  // ---- Shop name + details ----
  chunks.push(CMD.sizeBig, CMD.boldOn);
  wrap(shop.name, 16).forEach((l) => chunks.push(line(l)));
  chunks.push(CMD.sizeNormal, CMD.boldOff);
  if (shop.address) wrap(shop.address, WIDTH).forEach((l) => chunks.push(line(l)));
  if (shop.phone) chunks.push(line(`Ph: ${shop.phone}`));
  if (shop.gstEnabled && shop.gstin) chunks.push(line(`GSTIN: ${shop.gstin}`));
  chunks.push(rule());

  // ---- Bill info ----
  chunks.push(CMD.alignLeft);
  chunks.push(line(`Bill No: ${bill.billNumber}`));
  chunks.push(line(`Date: ${formatDateTimeIST(bill.createdAt)}`));
  const ch = bill.orderChannel || bill.orderType;
  if (ch) {
    chunks.push(line(`Channel: ${ch}${bill.tableNo ? `  Table: ${bill.tableNo}` : ""}`));
  }
  if (bill.customerName && bill.customerName !== "Walk-in Customer") {
    chunks.push(line(`Customer: ${bill.customerName}`));
  }
  if (bill.createdBy?.name) chunks.push(line(`Cashier: ${bill.createdBy.name}`));
  chunks.push(rule());

  // ---- Items ----
  bill.items.forEach((item) => {
    wrap(item.name, WIDTH).forEach((l) => chunks.push(line(l)));
    const amount = rupee(item.lineTotal + item.gstAmount);
    chunks.push(line(row(`  ${item.quantity} x ${rupee(item.price)}`, amount)));
  });
  chunks.push(rule());

  // ---- Totals ----
  if (shop.gstEnabled || bill.discount > 0) {
    chunks.push(line(row("Subtotal", rupee(bill.subtotal))));
  }
  if (shop.gstEnabled) chunks.push(line(row("GST", rupee(bill.totalGst))));
  if (bill.discount > 0) chunks.push(line(row("Discount", `-${rupee(bill.discount)}`)));
  chunks.push(CMD.sizeTall, CMD.boldOn);
  chunks.push(line(row("TOTAL", rupee(bill.grandTotal))));
  chunks.push(CMD.sizeNormal, CMD.boldOff);

  // ---- Payment (mode-wise) + cash change ----
  (bill.payments || []).forEach((p) => chunks.push(line(row(`Paid (${p.mode})`, rupee(p.amount)))));
  if (bill.changeReturned > 0) {
    chunks.push(line(row("Cash Given", rupee(bill.cashReceived))));
    chunks.push(CMD.boldOn);
    chunks.push(line(row("Change Returned", rupee(bill.changeReturned))));
    chunks.push(CMD.boldOff);
  }
  if (bill.balanceDue > 0) {
    chunks.push(CMD.boldOn);
    chunks.push(line(row("BALANCE DUE", rupee(bill.balanceDue))));
    chunks.push(CMD.boldOff);
  }
  chunks.push(rule());

  // ---- Footer ----
  chunks.push(CMD.alignCenter);
  wrap(shop.footer || "Thank you! Visit again", WIDTH).forEach((l) => chunks.push(line(l)));
  chunks.push(CMD.feed(3));
  chunks.push(CMD.cut);

  return Buffer.concat(chunks);
};
