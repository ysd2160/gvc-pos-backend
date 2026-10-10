import mongoose from "mongoose";

const channelPriceSchema = new mongoose.Schema(
  {
    channel: {
      type: String,
      required: true,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    category: { type: String, default: "General", trim: true },
    hsn: { type: String, default: "", trim: true }, // HSN/SAC code, printed on the tax invoice
    unit: { type: String, default: "pcs" }, // pcs, kg, gm, box, packet etc.
    costPrice: { type: Number, required: true, min: 0 }, // for profit/loss calc
    sellingPrice: { type: Number, required: true, min: 0 }, // base/canonical selling price (Dine In default)
    channelPrices: {
      type: [channelPriceSchema],
      default: [],
      validate: [
        function (prices) {
          if (!prices || prices.length === 0) return true;
          const channels = prices.map((p) => p.channel?.toLowerCase().trim());
          return channels.length === new Set(channels).size;
        },
        "Duplicate channel pricing entries are not allowed",
      ],
    },
    gstPercent: { type: Number, default: 0 }, // e.g. 5, 12, 18
    trackStock: { type: Boolean, default: true }, // false = made-to-order item (stock check nahi hoga)
    quantity: { type: Number, required: true, default: 0, min: 0 }, // current stock
    lowStockThreshold: { type: Number, default: 5 },
    isActive: { type: Boolean, default: true },
    isReconciledDuplicate: { type: Boolean, default: false },
    canonicalProduct: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    reconciliationNotes: { type: String, default: "" },
    needsManualReview: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

productSchema.index({ isActive: 1, isReconciledDuplicate: 1, name: 1 });
productSchema.index({ category: 1 });
productSchema.index({ canonicalProduct: 1 });

productSchema.virtual("isLowStock").get(function () {
  if (this.trackStock === false) return false;
  return this.quantity <= this.lowStockThreshold;
});

productSchema.methods.getPriceForChannel = function (channel) {
  if (!channel) return this.sellingPrice;
  const target = channel.replace("-", " ").trim().toLowerCase();
  const cp = (this.channelPrices || []).find(
    (p) => p.channel?.replace("-", " ").trim().toLowerCase() === target
  );
  if (cp && typeof cp.price === "number") {
    return cp.price;
  }
  return this.sellingPrice;
};

productSchema.set("toJSON", { virtuals: true });
productSchema.set("toObject", { virtuals: true });

const Product = mongoose.model("Product", productSchema);
export default Product;
