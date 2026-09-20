import mongoose from "mongoose";

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    category: { type: String, default: "General", trim: true },
    hsn: { type: String, default: "", trim: true }, // HSN/SAC code, printed on the tax invoice
    unit: { type: String, default: "pcs" }, // pcs, kg, gm, box, packet etc.
    costPrice: { type: Number, required: true, min: 0 }, // for profit/loss calc
    sellingPrice: { type: Number, required: true, min: 0 },
    gstPercent: { type: Number, default: 0 }, // e.g. 5, 12, 18
    trackStock: { type: Boolean, default: true }, // false = made-to-order item (stock check nahi hoga)
    quantity: { type: Number, required: true, default: 0, min: 0 }, // current stock
    lowStockThreshold: { type: Number, default: 5 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

productSchema.virtual("isLowStock").get(function () {
  if (this.trackStock === false) return false;
  return this.quantity <= this.lowStockThreshold;
});

productSchema.set("toJSON", { virtuals: true });
productSchema.set("toObject", { virtuals: true });

const Product = mongoose.model("Product", productSchema);
export default Product;
