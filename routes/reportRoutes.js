import express from "express";
import asyncHandler from "express-async-handler";
import Bill from "../models/Bill.js";
import Product from "../models/Product.js";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { buildDateFilter } from "../utils/dateRange.js";

const router = express.Router();

// @route   GET /api/reports/sales-summary?from=&to=
// @desc    Total sales, bill count, avg bill value in a date range
// @access  Private/Admin
router.get(
  "/sales-summary",
  protect,
  authorize("admin"),
  asyncHandler(async (req, res) => {
    const { from, to } = req.query;
    const filter = buildDateFilter(from, to);

    const bills = await Bill.find(filter);

    const totalSales = bills.reduce((sum, b) => sum + b.grandTotal, 0);
    const totalGstCollected = bills.reduce((sum, b) => sum + b.totalGst, 0);
    const totalBills = bills.length;
    const totalDiscount = bills.reduce((sum, b) => sum + b.discount, 0);
    const avgBillValue = totalBills > 0 ? totalSales / totalBills : 0;

    // Day-wise breakdown.
    // Group by the IST calendar day (not UTC) — otherwise a bill made just
    // after midnight IST (e.g. 1:07 AM) lands in UTC's *previous* day and
    // shows up under the wrong date.
    const dayWise = {};
    bills.forEach((b) => {
      const istDate = new Date(new Date(b.createdAt).getTime() + 5.5 * 60 * 60 * 1000);
      const day = istDate.toISOString().split("T")[0];
      dayWise[day] = (dayWise[day] || 0) + b.grandTotal;
    });

    res.json({
      totalSales,
      totalGstCollected,
      totalBills,
      totalDiscount,
      avgBillValue,
      dayWise,
    });
  })
);

// @route   GET /api/reports/profit-loss?from=&to=
// @desc    Profit/Loss based on cost price vs selling price of items sold
// @access  Private/Admin
router.get(
  "/profit-loss",
  protect,
  authorize("admin"),
  asyncHandler(async (req, res) => {
    const { from, to } = req.query;
    const filter = buildDateFilter(from, to);

    const bills = await Bill.find(filter);

    // Need cost price per product - fetch all products once
    // Defensive: skip any item with a missing/broken product reference instead of crashing
    const productIds = [
      ...new Set(
        bills
          .flatMap((b) => b.items)
          .filter((i) => i.product)
          .map((i) => i.product.toString())
      ),
    ];
    const products = await Product.find({ _id: { $in: productIds } });
    const costMap = {};
    products.forEach((p) => (costMap[p._id.toString()] = p.costPrice));

    let totalRevenue = 0;
    let totalCost = 0;
    const productWise = {};

    bills.forEach((bill) => {
      bill.items.forEach((item) => {
        if (!item.product) return; // skip broken references safely

        const revenue = item.lineTotal || 0;
        const cost = (costMap[item.product.toString()] || 0) * (item.quantity || 0);
        totalRevenue += revenue;
        totalCost += cost;

        if (!productWise[item.name]) {
          productWise[item.name] = { quantitySold: 0, revenue: 0, cost: 0, profit: 0 };
        }
        productWise[item.name].quantitySold += item.quantity || 0;
        productWise[item.name].revenue += revenue;
        productWise[item.name].cost += cost;
        productWise[item.name].profit += revenue - cost;
      });
    });

    const grossProfit = totalRevenue - totalCost;
    const profitMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    res.json({
      totalRevenue,
      totalCost,
      grossProfit,
      profitMargin,
      productWise,
    });
  })
);

// @route   GET /api/reports/payments?from=&to=
// @desc    Payment mode breakdown + pending dues
// @access  Private/Admin
router.get(
  "/payments",
  protect,
  authorize("admin"),
  asyncHandler(async (req, res) => {
    const { from, to } = req.query;
    const filter = buildDateFilter(from, to);

    const bills = await Bill.find(filter);

    const modeWise = { Cash: 0, UPI: 0, Card: 0, Credit: 0 };
    let totalPending = 0;

    bills.forEach((bill) => {
      bill.payments.forEach((p) => {
        modeWise[p.mode] = (modeWise[p.mode] || 0) + p.amount;
      });
      totalPending += bill.balanceDue;
    });

    const pendingBills = bills
      .filter((b) => b.balanceDue > 0)
      .map((b) => ({
        billNumber: b.billNumber,
        customerName: b.customerName,
        customerPhone: b.customerPhone,
        balanceDue: b.balanceDue,
        createdAt: b.createdAt,
      }));

    res.json({
      modeWise,
      totalPending,
      pendingBills,
    });
  })
);

// @route   GET /api/reports/top-products?from=&to=&limit=
// @access  Private/Admin
router.get(
  "/top-products",
  protect,
  authorize("admin"),
  asyncHandler(async (req, res) => {
    const { from, to, limit } = req.query;
    const filter = buildDateFilter(from, to);
    const bills = await Bill.find(filter);

    const productWise = {};
    bills.forEach((bill) => {
      bill.items.forEach((item) => {
        if (!productWise[item.name]) productWise[item.name] = { quantitySold: 0, revenue: 0 };
        productWise[item.name].quantitySold += item.quantity;
        productWise[item.name].revenue += item.lineTotal;
      });
    });

    const sorted = Object.entries(productWise)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.quantitySold - a.quantitySold)
      .slice(0, Number(limit) || 10);

    res.json(sorted);
  })
);

export default router;
