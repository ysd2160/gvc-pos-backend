import mongoose from "mongoose";

const stockLogSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    type: { type: String, enum: ["IN", "OUT", "ADJUSTMENT"], required: true },
    quantity: { type: Number, required: true }, // positive number, direction from type
    reason: { type: String, default: "" }, // e.g. "New stock purchase", "Sold via Bill #123", "Manual correction"
    relatedBill: { type: mongoose.Schema.Types.ObjectId, ref: "Bill" },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

stockLogSchema.index({ product: 1, createdAt: -1 });
stockLogSchema.index({ relatedBill: 1 });

const StockLog = mongoose.model("StockLog", stockLogSchema);
export default StockLog;
