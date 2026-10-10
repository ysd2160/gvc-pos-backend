import dotenv from "dotenv";
import mongoose from "mongoose";
import Product from "./models/Product.js";
import Bill from "./models/Bill.js";
import StockLog from "./models/StockLog.js";
import User from "./models/User.js";

dotenv.config();

const CHANNELS = ["Dine In", "Takeaway", "Swiggy", "Zomato"];

export async function runMigration({ dryRun = false } = {}) {
  console.log(`\n======================================================`);
  console.log(`Starting Channel Pricing Migration [Dry Run: ${dryRun}]`);
  console.log(`======================================================\n`);

  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected to database: ${mongoose.connection.name}`);

  // Ensure indexes
  if (!dryRun) {
    console.log("Building indexes...");
    await Product.init();
    await Bill.init();
    await User.init();
    await StockLog.init();
    console.log("Indexes initialized successfully.");
  }

  const allProducts = await Product.find({});
  console.log(`Total products in database: ${allProducts.length}`);

  // Separate duplicates with brackets and canonical base products
  const bracketRegex = /^(.*?)\s*\[(.*?)\]$/;
  const duplicateRecords = [];
  const baseProductMap = new Map();

  for (const p of allProducts) {
    const match = p.name.match(bracketRegex);
    if (match) {
      duplicateRecords.push({
        product: p,
        baseName: match[1].trim(),
        channel: match[2].trim(),
      });
    } else {
      baseProductMap.set(p.name.trim().toLowerCase(), p);
    }
  }

  console.log(`Duplicate channel products found: ${duplicateRecords.length}`);
  console.log(`Base/Canonical products found: ${baseProductMap.size}`);

  const manualReviewList = [];
  const reconciledGroups = new Map();

  // Group duplicate records by baseName
  for (const item of duplicateRecords) {
    const baseKey = item.baseName.toLowerCase();
    const canonical = baseProductMap.get(baseKey);

    if (!canonical) {
      console.warn(`[MANUAL REVIEW] No base product found for: "${item.product.name}"`);
      manualReviewList.push(item);
      continue;
    }

    if (!reconciledGroups.has(canonical._id.toString())) {
      reconciledGroups.set(canonical._id.toString(), {
        canonical,
        duplicates: [],
      });
    }
    reconciledGroups.get(canonical._id.toString()).duplicates.push(item);
  }

  console.log(`\nReconciling ${reconciledGroups.size} canonical products with channel duplicates...`);

  let updatedCanonicalCount = 0;
  let reconciledDuplicatesCount = 0;
  let stockTransferredCount = 0;

  for (const { canonical, duplicates } of reconciledGroups.values()) {
    // Determine channel prices
    const pricesMap = {
      "Dine In": canonical.sellingPrice,
      "Takeaway": canonical.sellingPrice,
      "Swiggy": canonical.sellingPrice,
      "Zomato": canonical.sellingPrice,
    };

    let totalStockToAdd = 0;

    for (const dup of duplicates) {
      const chName = dup.channel;
      // Map channel to standardized name
      if (chName.toLowerCase() === "swiggy") {
        pricesMap["Swiggy"] = dup.product.sellingPrice;
      } else if (chName.toLowerCase() === "zomato") {
        pricesMap["Zomato"] = dup.product.sellingPrice;
      } else if (chName.toLowerCase() === "takeaway") {
        pricesMap["Takeaway"] = dup.product.sellingPrice;
      } else if (chName.toLowerCase() === "dine in" || chName.toLowerCase() === "dine-in") {
        pricesMap["Dine In"] = dup.product.sellingPrice;
      } else {
        // Unknown channel tag - retain as custom channel
        pricesMap[chName] = dup.product.sellingPrice;
      }

      // Check if duplicate has stock
      if (dup.product.trackStock && dup.product.quantity > 0) {
        totalStockToAdd += dup.product.quantity;
      }
    }

    const channelPricesArray = Object.entries(pricesMap).map(([channel, price]) => ({
      channel,
      price,
    }));

    if (!dryRun) {
      canonical.channelPrices = channelPricesArray;
      if (totalStockToAdd > 0) {
        canonical.quantity += totalStockToAdd;
        await StockLog.create({
          product: canonical._id,
          type: "IN",
          quantity: totalStockToAdd,
          reason: `Reconciliation stock merge from duplicates`,
          performedBy: canonical.createdBy,
        });
        stockTransferredCount += totalStockToAdd;
      }
      await canonical.save();
      updatedCanonicalCount++;

      // Safely reconcile duplicates: DO NOT DELETE, mark inactive & reconciled
      for (const dup of duplicates) {
        dup.product.isReconciledDuplicate = true;
        dup.product.canonicalProduct = canonical._id;
        dup.product.isActive = false;
        dup.product.reconciliationNotes = `Reconciled into canonical product: ${canonical.name} (${canonical._id})`;
        if (dup.product.trackStock && dup.product.quantity > 0) {
          dup.product.quantity = 0;
        }
        await dup.product.save();
        reconciledDuplicatesCount++;
      }
    } else {
      updatedCanonicalCount++;
      reconciledDuplicatesCount += duplicates.length;
    }
  }

  // Handle remaining canonical products that had no duplicates
  let standardProductsUpdated = 0;
  for (const canonical of baseProductMap.values()) {
    if (reconciledGroups.has(canonical._id.toString())) continue;

    // Check if channelPrices already populated
    if (!canonical.channelPrices || canonical.channelPrices.length === 0) {
      const channelPricesArray = CHANNELS.map((ch) => ({
        channel: ch,
        price: canonical.sellingPrice,
      }));

      if (!dryRun) {
        canonical.channelPrices = channelPricesArray;
        await canonical.save();
      }
      standardProductsUpdated++;
    }
  }

  // Flag manual review records if any
  if (!dryRun && manualReviewList.length > 0) {
    for (const item of manualReviewList) {
      item.product.needsManualReview = true;
      item.product.reconciliationNotes = `Needs manual review: Could not determine base product for channel "${item.channel}".`;
      await item.product.save();
    }
  }

  // Historical Bills Reconciliation: update orderChannel from orderType
  console.log(`\nReconciling historical bills...`);
  const bills = await Bill.find({});
  let billsUpdated = 0;
  for (const bill of bills) {
    let targetChannel = bill.orderChannel;
    if (!targetChannel) {
      if (bill.orderType === "Dine-in" || bill.orderType === "Dine In") {
        targetChannel = "Dine In";
      } else if (bill.orderType === "Takeaway") {
        targetChannel = "Takeaway";
      } else {
        targetChannel = "Dine In";
      }
    } else if (targetChannel === "Dine-in") {
      targetChannel = "Dine In";
    }

    if (bill.orderChannel !== targetChannel) {
      if (!dryRun) {
        bill.orderChannel = targetChannel;
        await bill.save();
      }
      billsUpdated++;
    }
  }

  console.log(`\n================== Migration Summary ==================`);
  console.log(`Canonical products reconciled with channel duplicates: ${updatedCanonicalCount}`);
  console.log(`Duplicates safely marked reconciled & deactivated: ${reconciledDuplicatesCount}`);
  console.log(`Standard products assigned default channel prices: ${standardProductsUpdated}`);
  console.log(`Stock units transferred from duplicates: ${stockTransferredCount}`);
  console.log(`Records flagged for manual review: ${manualReviewList.length}`);
  console.log(`Historical bills updated with orderChannel: ${billsUpdated}`);
  console.log(`======================================================\n`);

  if (!dryRun) {
    // Quick verification
    const activeProducts = await Product.find({ isActive: true });
    console.log(`Active canonical products remaining: ${activeProducts.length}`);
    const sample = await Product.findOne({ name: "Aloo Tikki Burger" });
    if (sample) {
      console.log(`Sample [Aloo Tikki Burger] prices:`, sample.channelPrices);
    }
  }

  await mongoose.disconnect();
}

if (process.argv[1]?.endsWith("migrateChannelPricing.js")) {
  const isDryRun = process.argv.includes("--dry-run");
  runMigration({ dryRun: isDryRun }).catch(console.error);
}
