import jwt from "jsonwebtoken";
import db from "../config/db.js";
import { AppError } from "../utils/responses.js";

// Prototype-grade secret. Set JWT_SECRET in production.
const SECRET = process.env.JWT_SECRET || "medicare-prototype-dev-secret";
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

export const signToken = (user) =>
  jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: user.name },
    SECRET,
    { expiresIn: EXPIRES_IN },
  );

/**
 * Validates the bearer token and attaches `req.user`.
 * In production this is where you'd verify a Supabase JWT instead.
 */
export const requireAuth = (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token)
    return next(new AppError("Authentication required", 401, "NO_TOKEN"));

  try {
    const payload = jwt.verify(token, SECRET);
    const user = db.users.find((u) => u.id === payload.sub);
    if (!user)
      return next(
        new AppError("Account no longer exists", 401, "USER_NOT_FOUND"),
      );

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      profile: user.profile,
    };

    // Doctors carry their provider record for convenience.
    if (user.role === "doctor") {
      req.user.doctor = db.doctors.find((d) => d.userId === user.id) || null;
    }
    return next();
  } catch (err) {
    const message =
      err.name === "TokenExpiredError"
        ? "Session expired, please sign in again"
        : "Invalid session";
    return next(new AppError(message, 401, "INVALID_TOKEN"));
  }
};

/** Role gate. Usage: router.post('/x', requireAuth, requireRole('admin'), handler) */
export const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user)
      return next(new AppError("Authentication required", 401, "NO_TOKEN"));
    if (!roles.includes(req.user.role)) {
      return next(
        new AppError(
          `This action requires: ${roles.join(" or ")}`,
          403,
          "FORBIDDEN",
        ),
      );
    }
    return next();
  };

/** Signed-in user, but admin/doctor are also allowed - used for "my appointments". */
export const requireSelfOrAdmin = (req, res, next) => {
  if (!req.user)
    return next(new AppError("Authentication required", 401, "NO_TOKEN"));
  const targetId = req.params.patientId || req.params.id;
  if (req.user.role === "admin" || req.user.id === targetId) return next();
  return next(
    new AppError("You can only access your own records", 403, "FORBIDDEN"),
  );
};
