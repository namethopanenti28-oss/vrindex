import db, { id, persist, addMinutes } from "../config/db.js";
import { sendSuccess, AppError, asyncHandler } from "../utils/responses.js";
import logger from "../utils/logger.js";
import {
  getSlots,
  availableDates,
  getAvailabilitySummary,
  bookAppointment,
  rescheduleAppointment,
  cancelAppointment,
  updateStatus,
  joinQueue,
  getQueue,
  estimateWait,
} from "../services/appointmentService.js";
import { notifyStatusChange } from "../services/notificationService.js";

const log = logger.tag("appt-ctrl");

/* ------------------------------------------------------------------ *
 *  GET /api/appointments                                            *
 *  GET /api/appointments/my                                          *
 * ------------------------------------------------------------------ */
export const listAppointments = asyncHandler(async (req, res) => {
  const { scope = "mine", status, doctorId, patientId, from, to } = req.query;
  let list = db.appointments.slice();

  // Scope guards.
  if (req.user.role === "patient") {
    list = list.filter((a) => a.patientId === req.user.id);
  } else if (req.user.role === "doctor") {
    const me = db.doctors.find((d) => d.userId === req.user.id);
    list = list.filter((a) => a.doctorId === me?.id);
  } else if (scope === "mine" && patientId) {
    list = list.filter((a) => a.patientId === patientId);
  }

  if (status) {
    const wanted = String(status).split(",");
    list = list.filter((a) => wanted.includes(a.status));
  }
  if (doctorId) list = list.filter((a) => a.doctorId === doctorId);
  if (patientId && req.user.role === "admin")
    list = list.filter((a) => a.patientId === patientId);
  if (from) list = list.filter((a) => a.date >= from);
  if (to) list = list.filter((a) => a.date <= to);

  list.sort((a, b) =>
    a.date === b.date
      ? b.startTime.localeCompare(a.startTime)
      : b.date.localeCompare(a.date),
  );

  return sendSuccess(res, { appointments: list, count: list.length });
});

/* ------------------------------------------------------------------ *
 *  GET /api/appointments/:id                                         *
 * ------------------------------------------------------------------ */
export const getAppointment = asyncHandler(async (req, res) => {
  const a = db.appointments.find((x) => x.id === req.params.id);
  if (!a)
    throw new AppError("Appointment not found", 404, "APPOINTMENT_NOT_FOUND");

  const isOwner = a.patientId === req.user.id;
  const isProvider =
    req.user.role === "doctor" &&
    db.doctors.find((d) => d.userId === req.user.id)?.id === a.doctorId;
  if (!isOwner && !isProvider && req.user.role !== "admin") {
    throw new AppError("You cannot view this appointment", 403, "FORBIDDEN");
  }

  const slot = db.slots.find((s) => s.id === a.slotId);
  return sendSuccess(res, {
    appointment: a,
    doctor: db.doctors.find((d) => d.id === a.doctorId) || null,
    facility: db.facilities.find((f) => f.id === a.facilityId) || null,
    wait: slot ? estimateWait(slot) : null,
  });
});

/* ------------------------------------------------------------------ *
 *  POST /api/appointments                                            *
 * ------------------------------------------------------------------ */
export const createAppointment = asyncHandler(async (req, res) => {
  const { doctorId, slotId, reason, symptoms, mode } = req.body;

  const patient = db.users.find((u) => u.id === req.user.id);
  const appointment = bookAppointment({
    patientId: req.user.id,
    patientName: patient.name,
    doctorId,
    slotId,
    reason,
    symptoms,
    mode,
    patientPhone: patient.phone,
    patientEmail: patient.email,
  });

  return sendSuccess(res, { appointment }, "Appointment booked", 201);
});

/* ------------------------------------------------------------------ *
 *  PATCH /api/appointments/:id/reschedule                            *
 * ------------------------------------------------------------------ */
export const reschedule = asyncHandler(async (req, res) => {
  const { slotId } = req.body;
  const existing = db.appointments.find((a) => a.id === req.params.id);
  if (!existing)
    throw new AppError("Appointment not found", 404, "APPOINTMENT_NOT_FOUND");

  const isOwner = existing.patientId === req.user.id;
  const isProvider =
    req.user.role === "doctor" &&
    db.doctors.find((d) => d.userId === req.user.id)?.id === existing.doctorId;
  if (!isOwner && !isProvider && req.user.role !== "admin") {
    throw new AppError(
      "You cannot reschedule this appointment",
      403,
      "FORBIDDEN",
    );
  }

  const appointment = rescheduleAppointment(req.params.id, slotId, req.user);
  return sendSuccess(res, { appointment }, "Appointment rescheduled");
});

/* ------------------------------------------------------------------ *
 *  PATCH /api/appointments/:id/cancel                                *
 * ------------------------------------------------------------------ */
export const cancel = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const existing = db.appointments.find((a) => a.id === req.params.id);
  if (!existing)
    throw new AppError("Appointment not found", 404, "APPOINTMENT_NOT_FOUND");

  const isOwner = existing.patientId === req.user.id;
  const isProvider =
    req.user.role === "doctor" &&
    db.doctors.find((d) => d.userId === req.user.id)?.id === existing.doctorId;
  if (!isOwner && !isProvider && req.user.role !== "admin") {
    throw new AppError("You cannot cancel this appointment", 403, "FORBIDDEN");
  }

  const appointment = cancelAppointment(req.params.id, {
    reason,
    actorRole: isProvider
      ? "provider"
      : req.user.role === "admin"
        ? "admin"
        : "patient",
  });
  return sendSuccess(res, { appointment }, "Appointment cancelled");
});

/* ------------------------------------------------------------------ *
 *  PATCH /api/appointments/:id/status                                *
 * ------------------------------------------------------------------ */
export const changeStatus = asyncHandler(async (req, res) => {
  const { status, note } = req.body;

  if (req.user.role === "patient") {
    throw new AppError(
      "Patients cannot change appointment status directly",
      403,
      "FORBIDDEN",
    );
  }
  const appointment = updateStatus(req.params.id, status, note);
  notifyStatusChange(appointment, status);
  log.info(`status ${req.params.id} -> ${status}`);
  return sendSuccess(res, { appointment }, "Status updated");
});

/* ------------------------------------------------------------------ *
 *  Queue                                                             *
 * ------------------------------------------------------------------ */
export const checkIn = asyncHandler(async (req, res) => {
  const result = joinQueue(req.params.id);
  return sendSuccess(res, result, "Checked in to the queue");
});

export const liveQueue = asyncHandler(async (req, res) => {
  const { doctorId, date } = req.query;
  if (!doctorId)
    throw new AppError("doctorId is required", 400, "MISSING_DOCTOR");

  let resolvedDate = date;
  if (!resolvedDate) {
    const slots = getSlots({ doctorId });
    resolvedDate = slots.find((s) => s.status !== "blocked")?.date;
  }
  return sendSuccess(res, getQueue(doctorId, resolvedDate));
});

export const availabilitySummary = asyncHandler(async (req, res) => {
  const { doctorId, date } = req.query;
  if (!doctorId)
    throw new AppError("doctorId is required", 400, "MISSING_DOCTOR");
  return sendSuccess(res, getAvailabilitySummary(doctorId, date));
});

export { getSlots, availableDates, id, persist, addMinutes };
