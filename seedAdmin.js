// Run this ONCE to create your first admin account:
// node seedAdmin.js
import dotenv from "dotenv";
import connectDB from "./config/db.js";
import User from "./models/User.js";
import mongoose from "mongoose";

dotenv.config();

const run = async () => {
  await connectDB();

  const email = "admin@shop.com"; // <-- change if you want
  const password = "admin123"; // <-- CHANGE THIS after first login!

  const existing = await User.findOne({ email });
  if (existing) {
    console.log("Admin already exists with this email:", email);
    process.exit(0);
  }

  const admin = await User.create({
    name: "Shop Owner",
    email,
    password,
    role: "admin",
  });

  console.log("✅ Admin created successfully!");
  console.log("Email:", admin.email);
  console.log("Password:", password);
  console.log("⚠️  Please log in and consider changing this password.");

  mongoose.connection.close();
  process.exit(0);
};

run();
