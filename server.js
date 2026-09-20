import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import connectDB from "./config/db.js";
import shopRoutes from "./routes/shopRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import billRoutes from "./routes/billRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";
import { notFound, errorHandler } from "./middleware/errorMiddleware.js";

dotenv.config();
connectDB();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Allow requests from your configured frontend URL, plus common local dev ports.
// We don't use cookies (auth is via Bearer token), so credentials:true is not needed
// and actually breaks CORS when combined with a wildcard origin.
const allowedOrigins = [
  process.env.CLIENT_URL,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
].filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      // allow requests with no origin (like mobile apps, curl, Postman)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS: " + origin));
      }
    },
  })
);
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "Good Vibes Cafe Management API is running" });
});

// Logo: backend/assets/logos/logo.png (frontend yahin se dikhata hai)
app.use("/logos", express.static(path.join(__dirname, "assets/logos"), { maxAge: "5m" }));

app.use("/api/shop", shopRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/bills", billRoutes);
app.use("/api/reports", reportRoutes);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
