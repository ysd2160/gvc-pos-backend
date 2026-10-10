import jwt from "jsonwebtoken";
import asyncHandler from "express-async-handler";
import User from "../models/User.js";

// Verify token and attach user to req
export const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    try {
      token = req.headers.authorization.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Enforce 8-hour absolute maximum lifetime
      if (decoded.maxExpiry && Date.now() > decoded.maxExpiry) {
        res.status(401);
        throw new Error("Session expired (8-hour maximum lifetime reached). Please log in again.");
      }

      req.user = await User.findById(decoded.id).select("-password");

      if (!req.user || !req.user.isActive) {
        res.status(401);
        throw new Error("Not authorized, user not found or inactive");
      }

      // Enforce server-side token invalidation on logout
      if (req.user.lastLogoutAt) {
        const tokenIssuedAt = (decoded.iat || 0) * 1000;
        if (tokenIssuedAt < new Date(req.user.lastLogoutAt).getTime()) {
          res.status(401);
          throw new Error("Session has been logged out. Please log in again.");
        }
      }

      next();
    } catch (error) {
      res.status(401);
      throw new Error(error.message || "Not authorized, token failed");
    }
  } else {
    res.status(401);
    throw new Error("Not authorized, no token provided");
  }
});

// Restrict route to specific roles. Usage: authorize("admin")
export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403);
      throw new Error(`Access denied. Requires role: ${roles.join(" or ")}`);
    }
    next();
  };
};
