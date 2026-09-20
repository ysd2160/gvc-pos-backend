// Sample products daalne ke liye: node seedProducts.js
import dotenv from "dotenv";
import connectDB from "./config/db.js";
import Product from "./models/Product.js";
import StockLog from "./models/StockLog.js";
import User from "./models/User.js";
import mongoose from "mongoose";

dotenv.config();

// Cafe: bina GST, made-to-order (trackStock: false = stock ka jhanjhat nahi)
const products = [
  { name: "Cappuccino", category: "Coffee", unit: "cup", costPrice: 35, sellingPrice: 120 },
  { name: "Cold Coffee", category: "Coffee", unit: "glass", costPrice: 40, sellingPrice: 130 },
  { name: "Masala Chai", category: "Tea", unit: "cup", costPrice: 8, sellingPrice: 30 },
  { name: "Margherita Pizza", category: "Pizza", unit: "pcs", costPrice: 80, sellingPrice: 220 },
  { name: "French Fries", category: "Snacks", unit: "plate", costPrice: 30, sellingPrice: 100 },
].map((p) => ({ ...p, gstPercent: 0, trackStock: false, quantity: 0 }));

const run = async () => {
  await connectDB();

  const admin = await User.findOne({ role: "admin" });
  if (!admin) {
    console.log("❌ No admin found. Run 'node seedAdmin.js' first.");
    process.exit(1);
  }

  for (const p of products) {
    const exists = await Product.findOne({ name: p.name });
    if (exists) {
      console.log(`⏭️  Skipped (already exists): ${p.name}`);
      continue;
    }
    const product = await Product.create({ ...p, createdBy: admin._id });
    if (product.trackStock && product.quantity > 0) {
      await StockLog.create({
        product: product._id,
        type: "IN",
        quantity: product.quantity,
        reason: "Initial stock - seeded",
        performedBy: admin._id,
      });
    }
    console.log(`✅ Added: ${product.name} — ₹${product.sellingPrice}/${product.unit}`);
  }

  console.log("\nDone! Prices, GST%, stock sab Products page se badal sakte ho.");
  mongoose.connection.close();
  process.exit(0);
};

run();
