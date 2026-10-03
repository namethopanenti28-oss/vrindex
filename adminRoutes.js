import { Router } from "express";
import * as ctrl from "../controllers/adminController.js";
import { requireAuth, requireRole } from "../middlewares/authMiddleware.js";
import validate from "../middlewares/validateRequest.js";

const router = Router();

// Every admin route is authenticated *and* role-gated.
router.use(requireAuth, requireRole("admin"));

/* ---------------- dashboard / analytics ---------------- */
router.get("/overview", ctrl.overview);

/* ---------------- doctors ---------------- */
router.get("/doctors", ctrl.listDoctorsAdmin);
router.patch(
  "/doctors/:id",
  validate({
    isAcceptingNew: { type: "boolean" },
    consultationFee: { type: "number" },
    facilityId: { type: "string" },
  }),
  ctrl.updateDoctor,
);

/* ---------------- facilities ---------------- */
router.get("/facilities", ctrl.listFacilitiesAdmin);
router.post(
  "/facilities",
  validate({
    name: { required: true, type: "string", min: 2, maxLength: 120 },
    address: { required: true, type: "string", maxLength: 240 },
    city: { required: true, type: "string", maxLength: 80 },
    type: { type: "string" },
  }),
  ctrl.createFacility,
);

/* ---------------- services ---------------- */
router.get("/services", ctrl.listServicesAdmin);

/* ---------------- patients ---------------- */
router.get("/patients", ctrl.listPatients);

/* ---------------- notification audit log ---------------- */
router.get("/notifications", ctrl.notificationLog);

export default router;
