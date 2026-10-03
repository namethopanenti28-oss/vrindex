import { Router } from "express";
import * as ctrl from "../controllers/doctorController.js";
import { requireAuth, requireRole } from "../middlewares/authMiddleware.js";
import validate from "../middlewares/validateRequest.js";

const router = Router();

/* ------------------------------------------------------------------ *
 *  Public reference data + discovery.                                *
 *  Browsing doctors before signing in is a core part of the          *
 *  patient journey, so these routes intentionally do NOT require auth. *
 * ------------------------------------------------------------------ */

// --- reference data ---
router.get("/specialties", ctrl.listSpecialties);
router.get("/services", ctrl.listServices);
router.get("/facilities", ctrl.listFacilities);

// --- discovery ---
router.get("/recommended", ctrl.getRecommended);
router.get("/", ctrl.listDoctors);

// --- public profile ---
router.get("/:id", ctrl.getDoctor);
router.get("/:id/slots", ctrl.doctorSlots);

// Everything below manages provider state and needs a session.
router.use(requireAuth);

/* --- provider self-service (declared before /:id to avoid shadowing) --- */
router.get("/me/schedule", requireRole("doctor"), ctrl.mySchedule);

// --- provider slot management ---
router.patch(
  "/:id/slots/:slotId",
  requireRole("doctor", "admin"),
  ctrl.updateSlot,
);
router.post(
  "/:id/slots",
  requireRole("doctor", "admin"),
  validate({
    date: { required: true, type: "date" },
    times: { required: true, type: "array" },
    duration: { type: "number", default: 30 },
    mode: { enum: ["in-person", "video"], default: "in-person" },
  }),
  ctrl.generateSlots,
);

export default router;
