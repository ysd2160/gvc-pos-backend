import express from "express";
import asyncHandler from "express-async-handler";
import Product from "../models/Product.js";
import StockLog from "../models/StockLog.js";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { getShop } from "../config/shop.js";

const router = express.Router();

// @route   GET /api/products
// @desc    Get all products (both admin & staff can view, needed for billing)
// @access  Private
router.get(
  "/",
  protect,
  asyncHandler(async (req, res) => {
    const { search, category, lowStock } = req.query;
    const filter = { isActive: true };

    if (search) {
      filter.name = { $regex: search, $options: "i" };
    }
    if (category) {
      filter.category = category;
    }

    let products = await Product.find(filter).sort({ name: 1 });

    if (lowStock === "true") {
      products = products.filter((p) => p.trackStock !== false && p.quantity <= p.lowStockThreshold);
    }

    res.json(products);
  })
);

// @route   GET /api/products/:id
// @access  Private
router.get(
  "/:id",
  protect,
  asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id);
    if (!product) {
      res.status(404);
      throw new Error("Product not found");
    }
    res.json(product);
  })
);

// @route   POST /api/products
// @desc    Add new product
// @access  Private/Admin
router.post(
  "/",
  protect,
  authorize("admin"),
  asyncHandler(async (req, res) => {
    const { name, category, hsn, unit, costPrice, sellingPrice, gstPercent, quantity, lowStockThreshold, trackStock } = req.body;
    const gstOn = getShop().gstEnabled; // cafe mein GST/HSN store hi nahi hoga

    if (!name || costPrice == null || sellingPrice == null) {
      res.status(400);
      throw new Error("Name, cost price and selling price are required");
    }

    const tracked = trackStock !== false && trackStock !== "false";
    const product = await Product.create({
      name,
      category,
      hsn: gstOn ? hsn : "",
      unit,
      costPrice,
      sellingPrice,
      gstPercent: gstOn ? gstPercent || 0 : 0,
      trackStock: tracked,
      quantity: tracked ? quantity || 0 : 0,
      lowStockThreshold: lowStockThreshold || 5,
      createdBy: req.user._id,
    });

    if (tracked && product.quantity > 0) {
      await StockLog.create({
        product: product._id,
        type: "IN",
        quantity: product.quantity,
        reason: "Initial stock on product creation",
        performedBy: req.user._id,
      });
    }

    res.status(201).json(product);
  })
);

// @route   PUT /api/products/:id
// @desc    Update product details (not stock quantity directly - use /stock endpoint)
// @access  Private/Admin
router.put(
  "/:id",
  protect,
  authorize("admin"),
  asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id);
    if (!product) {
      res.status(404);
      throw new Error("Product not found");
    }

    const { name, category, hsn, unit, costPrice, sellingPrice, gstPercent, lowStockThreshold, isActive, trackStock } = req.body;
    const gstOn = getShop().gstEnabled;

    if (name !== undefined) product.name = name;
    if (category !== undefined) product.category = category;
    if (hsn !== undefined && gstOn) product.hsn = hsn;
    if (unit !== undefined) product.unit = unit;
    if (costPrice !== undefined) product.costPrice = costPrice;
    if (sellingPrice !== undefined) product.sellingPrice = sellingPrice;
    if (gstPercent !== undefined && gstOn) product.gstPercent = gstPercent;
    if (trackStock !== undefined) product.trackStock = trackStock !== false && trackStock !== "false";
    if (lowStockThreshold !== undefined) product.lowStockThreshold = lowStockThreshold;
    if (isActive !== undefined) product.isActive = isActive;

    const updated = await product.save();
    res.json(updated);
  })
);

// @route   PATCH /api/products/:id/stock
// @desc    Adjust stock quantity manually (add new stock / correction)
// @access  Private/Admin
router.patch(
  "/:id/stock",
  protect,
  authorize("admin"),
  asyncHandler(async (req, res) => {
    const { quantity, type, reason } = req.body; // type: "IN" | "ADJUSTMENT"

    if (quantity == null || !type) {
      res.status(400);
      throw new Error("Quantity and type are required");
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      res.status(404);
      throw new Error("Product not found");
    }

    if (type === "IN") {
      product.quantity += Number(quantity);
    } else if (type === "ADJUSTMENT") {
      // Set to an exact value (correction) - quantity here IS the new absolute value
      product.quantity = Number(quantity);
    } else {
      res.status(400);
      throw new Error("Invalid stock adjustment type");
    }

    await product.save();

    await StockLog.create({
      product: product._id,
      type,
      quantity: Number(quantity),
      reason: reason || (type === "IN" ? "Stock added" : "Manual correction"),
      performedBy: req.user._id,
    });

    res.json(product);
  })
);

// @route   DELETE /api/products/:id
// @desc    Soft-delete a product (marks inactive, preserves bill history integrity)
// @access  Private/Admin
router.delete(
  "/:id",
  protect,
  authorize("admin"),
  asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id);
    if (!product) {
      res.status(404);
      throw new Error("Product not found");
    }
    product.isActive = false;
    await product.save();
    res.json({ message: "Product removed" });
  })
);

// @route   GET /api/products/:id/stock-history
// @access  Private/Admin
router.get(
  "/:id/stock-history",
  protect,
  authorize("admin"),
  asyncHandler(async (req, res) => {
    const logs = await StockLog.find({ product: req.params.id })
      .populate("performedBy", "name")
      .sort({ createdAt: -1 });
    res.json(logs);
  })
);

export default router;
