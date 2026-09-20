import express from "express";
import asyncHandler from "express-async-handler";
import Bill from "../models/Bill.js";
import Product from "../models/Product.js";
import StockLog from "../models/StockLog.js";
import Counter from "../models/Counter.js";
import { protect } from "../middleware/authMiddleware.js";
import { generateBillPDF } from "../utils/pdfGenerator.js";
import { buildDateFilter } from "../utils/dateRange.js";
import { buildReceiptEscPos } from "../utils/escposReceipt.js";
import { computeBill, BillError } from "../utils/billCalc.js";
import { getShop } from "../config/shop.js";

const router = express.Router();

// Har shop ka apna bill number: GVC-0001 (cafe), FRZ-0001 (Frozetto) ...
// Counter atomic hai, isliye do device se ek saath bill banane par bhi duplicate nahi banega.
const getNextBillNumber = async (shop) => {
  const counter = await Counter.findOneAndUpdate(
    { _id: `bill-${shop.key}` },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `${shop.billPrefix}-${String(counter.seq).padStart(4, "0")}`;
};

// Bill dekhne ki permission: staff sirf apne bill dekh sakta hai
const loadBillForUser = async (req, res) => {
  const bill = await Bill.findById(req.params.id).populate("createdBy", "name");
  if (!bill) {
    res.status(404);
    throw new Error("Bill not found");
  }
  if (req.user.role === "staff" && bill.createdBy._id.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("Access denied");
  }
  return bill;
};

// @route   POST /api/bills
// @desc    Naya bill - stock auto minus, GST shop ke hisaab se, cash change store
// @access  Private (staff + admin)
router.post(
  "/",
  protect,
  asyncHandler(async (req, res) => {
    const shop = getShop();
    const { customerName, customerPhone, items, discount, payments, notes, orderType, tableNo } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400);
      throw new Error("Bill must have at least one item");
    }

    // Same product do baar aaye to quantity jod do (stock check sahi rahe)
    const merged = new Map();
    for (const item of items) {
      const qty = Number(item.quantity);
      if (!item.productId || !qty || qty <= 0) {
        res.status(400);
        throw new Error("Each item needs a valid productId and quantity greater than 0");
      }
      merged.set(String(item.productId), (merged.get(String(item.productId)) || 0) + qty);
    }

    // Step 1: products + stock validate (kuch bhi change karne se pehle)
    const lines = [];
    for (const [productId, quantity] of merged) {
      const product = await Product.findById(productId);
      if (!product) {
        res.status(400);
        throw new Error(`Product not found (it may have been deleted): ${productId}`);
      }
      if (!product.isActive) {
        res.status(400);
        throw new Error(`Product "${product.name}" is no longer active`);
      }
      if (product.trackStock !== false && product.quantity < quantity) {
        res.status(400);
        throw new Error(`Insufficient stock for "${product.name}". Available: ${product.quantity} ${product.unit}`);
      }
      lines.push({ product, quantity });
    }

    // Step 2: totals, GST (sirf jis shop mein on hai), payments, cash change
    let calc;
    try {
      calc = computeBill({ lines, discount, payments, shop });
    } catch (err) {
      if (err instanceof BillError) res.status(400);
      throw err;
    }

    const billNumber = await getNextBillNumber(shop);

    // Step 3: bill save
    const cleanOrderType = ["Dine-in", "Takeaway"].includes(orderType) ? orderType : "";
    const bill = await Bill.create({
      billNumber,
      customerName: customerName || "Walk-in Customer",
      customerPhone: customerPhone || "",
      ...calc,
      orderType: cleanOrderType,
      tableNo: cleanOrderType === "Dine-in" ? String(tableNo || "").trim().slice(0, 10) : "",
      createdBy: req.user._id,
      notes: notes || "",
    });

    // Step 4: stock minus (sirf tracked products ka)
    for (const { product, quantity } of lines) {
      if (product.trackStock === false) continue;
      product.quantity -= quantity;
      await product.save();

      await StockLog.create({
        product: product._id,
        type: "OUT",
        quantity,
        reason: "Sold via bill",
        relatedBill: bill._id,
        performedBy: req.user._id,
      });
    }

    res.status(201).json(bill);
  })
);

// @route   GET /api/bills
// @desc    Bills (staff = apne, admin = sab)
// @access  Private
router.get(
  "/",
  protect,
  asyncHandler(async (req, res) => {
    const { from, to, paymentStatus } = req.query;
    const filter = buildDateFilter(from, to);

    if (req.user.role === "staff") filter.createdBy = req.user._id;
    if (paymentStatus) filter.paymentStatus = paymentStatus;

    const bills = await Bill.find(filter).populate("createdBy", "name").sort({ createdAt: -1 });
    res.json(bills);
  })
);

// @route   GET /api/bills/:id
router.get(
  "/:id",
  protect,
  asyncHandler(async (req, res) => {
    res.json(await loadBillForUser(req, res));
  })
);

// @route   GET /api/bills/:id/pdf
// @desc    PDF bill (Frozetto: GST Tax Invoice, Cafe: simple bill)
router.get(
  "/:id/pdf",
  protect,
  asyncHandler(async (req, res) => {
    const bill = await loadBillForUser(req, res);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=${bill.billNumber}.pdf`);
    generateBillPDF(bill, res, getShop());
  })
);

// @route   GET /api/bills/:id/print
// @desc    Thermal printer (RawBT) ke liye ESC/POS data (base64)
router.get(
  "/:id/print",
  protect,
  asyncHandler(async (req, res) => {
    const bill = await loadBillForUser(req, res);
    const buffer = await buildReceiptEscPos(bill, getShop());
    res.json({ base64: buffer.toString("base64") });
  })
);

export default router;
