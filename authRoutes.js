import { Router } from "express";
import rateLimit from "express-rate-limit";
import * as ctrl from "../controllers/authController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";
import validate from "../middlewares/validateRequest.js";

const router = Router();

// Brute-force protection on the credential endpoints. Skipped outside
// production so the smoke suite can be re-run freely; real (non-loopback)
// production traffic stays rate limited.
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV !== "production",
  message: {
    success: false,
    message: "Too many attempts, please try again later",
  },
});

router.post(
  "/register",
  authLimiter,
  validate({
    name: { required: true, type: "string", min: 2, maxLength: 80 },
    email: { required: true, type: "email" },
    password: { required: true, type: "string", min: 6, maxLength: 100 },
    phone: { type: "string" },
    role: { enum: ["patient", "provider"] },
  }),
  ctrl.register,
);

router.post(
  "/login",
  authLimiter,
  validate({
    email: { required: true, type: "email" },
    password: { required: true, type: "string" },
  }),
  ctrl.login,
);

router.get("/me", requireAuth, ctrl.me);
router.patch("/me", requireAuth, ctrl.updateProfile);

export default router;
