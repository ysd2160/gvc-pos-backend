import mongoose from "mongoose";

const billItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    name: { type: String, required: true }, // snapshot at time of billing
    hsn: { type: String, default: "" }, // snapshot of product's HSN/SAC at time of billing
    unit: { type: String, default: "pcs" },
    quantity: { type: Number, required: true, min: 0.01 },
    price: { type: Number, required: true }, // selling price per unit at time of sale
    gstPercent: { type: Number, default: 0 },
    lineTotal: { type: Number, required: true }, // qty * price (before gst)
    gstAmount: { type: Number, default: 0 },
  },
  { _id: false }
);

// Split payment - e.g. 500 cash + 300 UPI
const paymentSchema = new mongoose.Schema(
  {
    mode: { type: String, enum: ["Cash", "UPI", "Card", "Credit"], required: true },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const billSchema = new mongoose.Schema(
  {
    billNumber: { type: String, required: true, unique: true },
    customerName: { type: String, default: "Walk-in Customer" },
    customerPhone: { type: String, default: "" },
    items: [billItemSchema],

    subtotal: { type: Number, required: true }, // sum of lineTotals
    totalGst: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    grandTotal: { type: Number, required: true },

    payments: [paymentSchema],
    amountPaid: { type: Number, default: 0 }, // sum of payments (sirf bill ke against lagi hui amount)
    cashReceived: { type: Number, default: 0 }, // customer ne cash mein kitna diya (e.g. 500)
    changeReturned: { type: Number, default: 0 }, // wapas kitna diya (e.g. 270)
    orderType: { type: String, enum: ["", "Dine-in", "Takeaway"], default: "" },
    tableNo: { type: String, default: "" },
    balanceDue: { type: Number, default: 0 }, // grandTotal - amountPaid (credit/udhaar)

    paymentStatus: {
      type: String,
      enum: ["Paid", "Partial", "Pending"],
      default: "Paid",
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

const Bill = mongoose.model("Bill", billSchema);
export default Bill;
