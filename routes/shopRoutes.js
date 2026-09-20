import express from "express";
import { getShop, publicShopInfo } from "../config/shop.js";

const router = express.Router();

// @route   GET /api/shop
// @desc    Shop ka naam / GST on-off / bill output (frontend isse chalta hai)
// @access  Public (login page par bhi naam/logo dikhane ke liye)
router.get("/", (req, res) => {
  res.json(publicShopInfo(getShop()));
});

export default router;
