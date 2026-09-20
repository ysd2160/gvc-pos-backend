import mongoose from "mongoose";

// Bill numbers ke liye atomic counter (do phone se ek saath bill banao to bhi
// duplicate number nahi banega).
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // e.g. "bill-cafe"
  seq: { type: Number, default: 0 },
});

export default mongoose.model("Counter", counterSchema);
