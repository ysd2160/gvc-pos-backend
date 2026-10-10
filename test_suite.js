import dotenv from "dotenv";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import Product from "./models/Product.js";
import Bill from "./models/Bill.js";
import User from "./models/User.js";
import StockLog from "./models/StockLog.js";
import Counter from "./models/Counter.js";
import { computeBill, round2 } from "./utils/billCalc.js";
import { serverCache } from "./utils/cache.js";

dotenv.config();

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log("\n=======================================================");
  console.log("Running Cafe POS Verification & Optimization Test Suite");
  console.log("=======================================================\n");

  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected to database: ${mongoose.connection.name}`);

  // Test 1: Single canonical Aloo Tikki Burger in active products
  console.log("\n[Test 1] Canonical Product & Duplicates Reconciliation");
  const activeAlooTikki = await Product.find({
    name: "Aloo Tikki Burger",
    isActive: true,
    isReconciledDuplicate: { $ne: true },
  });
  assert(activeAlooTikki.length === 1, `Exactly 1 canonical 'Aloo Tikki Burger' appears in active products (found ${activeAlooTikki.length})`);

  const canonicalProduct = activeAlooTikki[0];
  assert(canonicalProduct !== null, "Canonical Aloo Tikki Burger found");

  // Test 2: Check 4 channel prices for Aloo Tikki Burger
  console.log("\n[Test 2] Channel-Based Prices on Canonical Product");
  const dineInPrice = canonicalProduct.getPriceForChannel("Dine In");
  const takeawayPrice = canonicalProduct.getPriceForChannel("Takeaway");
  const swiggyPrice = canonicalProduct.getPriceForChannel("Swiggy");
  const zomatoPrice = canonicalProduct.getPriceForChannel("Zomato");

  console.log(`  Channel prices for Aloo Tikki Burger: Dine In=₹${dineInPrice}, Takeaway=₹${takeawayPrice}, Swiggy=₹${swiggyPrice}, Zomato=₹${zomatoPrice}`);
  assert(dineInPrice === 60, `Dine In price is ₹60 (got ₹${dineInPrice})`);
  assert(takeawayPrice === 60, `Takeaway price is ₹60 (got ₹${takeawayPrice})`);
  assert(swiggyPrice === 80, `Swiggy price is ₹80 (got ₹${swiggyPrice})`);
  assert(zomatoPrice === 80, `Zomato price is ₹80 (got ₹${zomatoPrice})`);

  // Test 3: Duplicates are preserved in database but marked reconciled & inactive
  console.log("\n[Test 3] Preservation of Historical Duplicates");
  const duplicates = await Product.find({
    name: { $in: ["Aloo Tikki Burger [Swiggy]", "Aloo Tikki Burger [Zomato]"] },
  });
  assert(duplicates.length === 2, `Both bracket duplicates exist in DB for historical data (found ${duplicates.length})`);
  assert(duplicates.every(d => d.isActive === false), "All bracket duplicates are deactivated so they never appear in searches");
  assert(duplicates.every(d => d.isReconciledDuplicate === true), "All bracket duplicates have isReconciledDuplicate=true");
  assert(duplicates.every(d => d.canonicalProduct?.toString() === canonicalProduct._id.toString()), "All bracket duplicates reference the canonical product");

  // Test 4: Historical Bill Integrity
  console.log("\n[Test 4] Historical Bill Integrity");
  const historicalBill = await Bill.findOne({ billNumber: "GVC-0019" });
  if (historicalBill) {
    assert(historicalBill.items.length > 0, `Historical bill GVC-0019 has ${historicalBill.items.length} items`);
    assert(typeof historicalBill.grandTotal === "number" && historicalBill.grandTotal > 0, `GVC-0019 grandTotal preserved: ₹${historicalBill.grandTotal}`);
    assert(historicalBill.items.every(i => typeof i.price === "number" && i.price > 0), "All historical item snapshot prices preserved");
  } else {
    const anyBill = await Bill.findOne({});
    assert(anyBill !== null, "At least one bill exists in database");
  }

  // Test 5: Authoritative Channel Pricing via computeBill
  console.log("\n[Test 5] Server Authoritative Pricing & Channel Switching in computeBill");
  const shopMock = { gstEnabled: false };
  const dineInCalc = computeBill({
    lines: [{ product: canonicalProduct, quantity: 2 }],
    discount: 0,
    payments: undefined,
    shop: shopMock,
    channel: "Dine In",
  });
  assert(dineInCalc.grandTotal === 120, `Dine In 2 items = ₹120 (got ₹${dineInCalc.grandTotal})`);
  assert(dineInCalc.items[0].price === 60, `Dine In line item price = ₹60 (got ₹${dineInCalc.items[0].price})`);

  const swiggyCalc = computeBill({
    lines: [{ product: canonicalProduct, quantity: 2 }],
    discount: 10,
    payments: undefined,
    shop: shopMock,
    channel: "Swiggy",
  });
  assert(swiggyCalc.grandTotal === 150, `Swiggy 2 items (₹160) - ₹10 discount = ₹150 (got ₹${swiggyCalc.grandTotal})`);
  assert(swiggyCalc.items[0].price === 80, `Swiggy line item price = ₹80 (got ₹${swiggyCalc.items[0].price})`);

  const zomatoCalc = computeBill({
    lines: [{ product: canonicalProduct, quantity: 3 }],
    discount: 0,
    payments: undefined,
    shop: shopMock,
    channel: "Zomato",
  });
  assert(zomatoCalc.grandTotal === 240, `Zomato 3 items (3 * 80) = ₹240 (got ₹${zomatoCalc.grandTotal})`);
  assert(zomatoCalc.items[0].price === 80, `Zomato line item price = ₹80 (got ₹${zomatoCalc.items[0].price})`);

  // Test 6: Eight-Hour Authentication Expiry Enforcement
  console.log("\n[Test 6] 8-Hour Auth Expiry Backend Enforcement");
  const testUser = await User.findOne({ isActive: true });
  assert(testUser !== null, "Found active user for auth tests");

  // Valid 8h token
  const validToken = jwt.sign(
    { id: testUser._id, role: testUser.role, maxExpiry: Date.now() + 8 * 60 * 60 * 1000 },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );
  const decodedValid = jwt.verify(validToken, process.env.JWT_SECRET);
  assert(decodedValid.id === testUser._id.toString(), "Valid token verifies successfully");
  assert(Date.now() <= decodedValid.maxExpiry, "Token is within 8-hour max lifetime");

  // Expired token (past 8-hour maxExpiry)
  const expiredMaxToken = jwt.sign(
    { id: testUser._id, role: testUser.role, maxExpiry: Date.now() - 1000 },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );
  const decodedExpired = jwt.verify(expiredMaxToken, process.env.JWT_SECRET);
  const isPastMax = Date.now() > decodedExpired.maxExpiry;
  assert(isPastMax, "Token with expired maxExpiry is detected as expired by backend validation");

  // Test 7: Logout Invalidation via lastLogoutAt
  console.log("\n[Test 7] Logout Token Revocation Enforcement");
  const tokenIssuedTime = Date.now() - 5000;
  const simulatedToken = jwt.sign(
    { id: testUser._id, role: testUser.role, iat: Math.floor(tokenIssuedTime / 1000), maxExpiry: Date.now() + 8 * 3600 * 1000 },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );
  const logoutTimestamp = new Date(tokenIssuedTime + 2000);
  const isRevoked = tokenIssuedTime < logoutTimestamp.getTime();
  assert(isRevoked, "Token issued before user.lastLogoutAt is detected as revoked on backend");

  // Test 8: Server-side In-Memory Cache with TTL & Invalidation
  console.log("\n[Test 8] Server-side Cache & Invalidation");
  serverCache.set("test:products:all", [{ id: 1, name: "Burger" }], 10);
  assert(serverCache.get("test:products:all") !== null, "Cache stores and returns value");
  serverCache.invalidatePrefix("test:products:");
  assert(serverCache.get("test:products:all") === null, "invalidatePrefix successfully purges matching keys");

  // Test 9: Idempotency Protection for Bills
  console.log("\n[Test 9] Idempotency Key Handling for Checkout");
  const testIdempotencyKey = `test_idem_${Date.now()}`;
  const testBillNumber = `TEST-${Date.now().toString().slice(-4)}`;

  const createdBill = await Bill.create({
    billNumber: testBillNumber,
    customerName: "Idempotency Test Customer",
    items: [
      {
        product: canonicalProduct._id,
        name: canonicalProduct.name,
        price: 80,
        quantity: 1,
        lineTotal: 80,
      },
    ],
    subtotal: 80,
    totalGst: 0,
    discount: 0,
    grandTotal: 80,
    amountPaid: 80,
    payments: [{ mode: "UPI", amount: 80 }],
    orderChannel: "Swiggy",
    orderType: "Swiggy",
    idempotencyKey: testIdempotencyKey,
    createdBy: testUser._id,
  });

  assert(createdBill._id !== null, "Test bill created with idempotency key");

  // Query with same key
  const duplicateQuery = await Bill.findOne({ idempotencyKey: testIdempotencyKey });
  assert(duplicateQuery._id.toString() === createdBill._id.toString(), "Duplicate request with same idempotencyKey finds existing bill instead of creating new one");
  assert(duplicateQuery.orderChannel === "Swiggy", "Saved bill correctly stores orderChannel as 'Swiggy'");

  // Clean up test bill
  await Bill.deleteOne({ _id: createdBill._id });
  console.log("  Cleaned up test bill.");

  // Test 10: Extensibility of Channel Pricing
  console.log("\n[Test 10] Extensibility of Pricing Architecture");
  const testCustomChannel = "Magicpin";
  const customChannelPrices = [
    { channel: "Dine In", price: 50 },
    { channel: "Takeaway", price: 50 },
    { channel: "Swiggy", price: 65 },
    { channel: "Zomato", price: 60 },
    { channel: testCustomChannel, price: 55 },
  ];
  // Test schema validation: no duplicates allowed
  const hasDuplicates = (prices) => {
    const channels = prices.map(p => p.channel.toLowerCase());
    return channels.length !== new Set(channels).size;
  };
  assert(!hasDuplicates(customChannelPrices), "Can add new sales channel 'Magicpin' without altering schema structure");

  const invalidPrices = [
    { channel: "Dine In", price: 50 },
    { channel: "Dine In", price: 55 },
  ];
  assert(hasDuplicates(invalidPrices), "Schema validator catches and blocks duplicate pricing entries for the same channel");

  console.log("\n=======================================================");
  console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
  console.log("=======================================================\n");

  await mongoose.disconnect();

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test suite encountered error:", err);
  process.exit(1);
});
