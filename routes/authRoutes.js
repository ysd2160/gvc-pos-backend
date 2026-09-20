import express from "express";
import jwt from "jsonwebtoken";
import asyncHandler from "express-async-handler";
import User from "../models/User.js";
import { protect, authorize } from "../middleware/authMiddleware.js";

const router = express.Router();

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "30d" });
};

// @route   POST /api/auth/login
// @access  Public
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400);
      throw new Error("Please provide email and password");
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user || !(await user.matchPassword(password))) {
      res.status(401);
      throw new Error("Invalid email or password");
    }

    if (!user.isActive) {
      res.status(403);
      throw new Error("Your account has been deactivated. Contact admin.");
    }

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token: generateToken(user._id),
    });
  })
);

// @route   POST /api/auth/register
// @desc    Admin creates a new staff (or admin) account
// @access  Private/Admin
router.post(
  "/register",
  protect,
  authorize("admin"),
  asyncHandler(async (req, res) => {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      res.status(400);
      throw new Error("Please provide name, email and password");
    }

    const userExists = await User.findOne({ email: email.toLowerCase() });
    if (userExists) {
      res.status(400);
      throw new Error("User with this email already exists");
    }

    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password,
      role: role === "admin" ? "admin" : "staff",
    });

    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    });
  })
);

// @route   GET /api/auth/me
// @access  Private
router.get(
  "/me",
  protect,
  asyncHandler(async (req, res) => {
    res.json(req.user);
  })
);

// @route   GET /api/auth/users
// @desc    List all staff/admin users
// @access  Private/Admin
router.get(
  "/users",
  protect,
  authorize("admin"),
  asyncHandler(async (req, res) => {
    const users = await User.find({}).select("-password");
    res.json(users);
  })
);

// @route   PATCH /api/auth/users/:id/toggle-active
// @desc    Activate/deactivate a staff account
// @access  Private/Admin
router.patch(
  "/users/:id/toggle-active",
  protect,
  authorize("admin"),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) {
      res.status(404);
      throw new Error("User not found");
    }
    user.isActive = !user.isActive;
    await user.save();
    res.json({ _id: user._id, isActive: user.isActive });
  })
);

export default router;
