import { Router } from "express";
import * as ctrl from "../controllers/appointmentController.js";
import { requireAuth, requireRole } from "../middlewares/authMiddleware.js";
import validate from "../middlewares/validateRequest.js";

const router = Router();
router.use(requireAuth);

// --- patient / provider / admin actions ---
router.post(
  "/",
  requireRole("patient"),
  validate({
    doctorId: { required: true, type: "string" },
    slotId: { required: true, type: "string" },
    reason: { type: "string", maxLength: 500 },
    symptoms: { type: "string", maxLength: 1000 },
    mode: { enum: ["in-person", "video"] },
  }),
  ctrl.createAppointment,
);

router.patch(
  "/:id/reschedule",
  validate({
    slotId: { required: true, type: "string" },
  }),
  ctrl.reschedule,
);

router.patch(
  "/:id/cancel",
  validate({
    reason: { type: "string", maxLength: 300 },
  }),
  ctrl.cancel,
);

router.patch(
  "/:id/status",
  requireRole("doctor", "admin"),
  validate({
    status: {
      required: true,
      enum: [
        "scheduled",
        "confirmed",
        "in-progress",
        "completed",
        "cancelled",
        "no-show",
      ],
    },
    note: { type: "string", maxLength: 300 },
  }),
  ctrl.changeStatus,
);

router.post("/:id/check-in", ctrl.checkIn);

router.get("/queue", ctrl.liveQueue);
router.get("/availability", ctrl.availabilitySummary);

router.get("/", ctrl.listAppointments);
router.get("/:id", ctrl.getAppointment);

export default router;
