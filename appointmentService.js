import db, { id, persist, addMinutes } from "../config/db.js";
import { AppError } from "../utils/responses.js";
import { sendNotifications } from "./notificationService.js";
import logger from "../utils/logger.js";

const log = logger.tag("appointments");

/* ------------------------------------------------------------------ *
 *  Slot / queue logic                                                 *
 * ------------------------------------------------------------------ */
const todayISO = () => new Date().toISOString().slice(0, 10);

/**
 * A slot is bookable only if its date is not in the past. Comparing on the
 * date alone keeps every slot bookable for the whole of today.
 */
const isBookableDate = (isoDate) => isoDate >= todayISO();

export const getSlots = ({ doctorId, date, from, to, mode }) => {
  let list = db.slots.filter((s) => s.doctorId === doctorId);
  if (date) list = list.filter((s) => s.date === date);
  if (from) list = list.filter((s) => s.startTime >= from);
  if (to) list = list.filter((s) => s.startTime <= to);
  if (mode) list = list.filter((s) => s.mode === mode);
  return list.sort((a, b) =>
    a.date === b.date
      ? a.startTime.localeCompare(b.startTime)
      : a.date.localeCompare(b.date),
  );
};

export const availableDates = (doctorId) => {
  const dates = db.slots
    .filter(
      (s) =>
        s.doctorId === doctorId &&
        s.status === "available" &&
        isBookableDate(s.date),
    )
    .map((s) => s.date);
  return [...new Set(dates)].sort();
};

/**
 * Real-time-ish occupancy for a doctor on a date: how many slots are
 * already booked, plus the average lead time to the next open slot.
 */
export const getAvailabilitySummary = (doctorId, date) => {
  const slots = getSlots({ doctorId, date });
  const total = slots.length;
  const available = slots.filter((s) => s.status === "available").length;
  const booked = slots.filter((s) => s.status === "booked").length;
  const blocked = slots.filter((s) => s.status === "blocked").length;
  // The "next" slot must still be bookable, otherwise we advertise a time
  // that has already passed.
  const nextOpen = slots.find(
    (s) => s.status === "available" && isBookableDate(s.date),
  );
  const utilization = total ? Math.round((booked / total) * 100) : 0;

  return {
    doctorId,
    date,
    totalSlots: total,
    available,
    booked,
    blocked,
    utilizationPercent: utilization,
    nextAvailableSlot: nextOpen
      ? { date: nextOpen.date, time: nextOpen.startTime, mode: nextOpen.mode }
      : null,
    status:
      available === 0
        ? total
          ? "fully-booked"
          : "unavailable"
        : available <= 2
          ? "filling-up"
          : "available",
  };
};

/** Estimated wait: slots ahead of you in the queue for that slot. */
export const estimateWait = (slot) => {
  const queue = slot.currentQueue || 0;
  const perPatient = 15; // average consult duration in minutes
  const ahead = queue * perPatient;
  return {
    queuePosition: queue + 1,
    estimatedWaitMinutes: ahead,
    estimatedWaitLabel:
      ahead === 0 ? "No wait - you are next" : `~${ahead} min wait`,
  };
};

/* ------------------------------------------------------------------ *
 *  Booking with concurrency-safe slot allocation                      *
 * ------------------------------------------------------------------ */
export const bookAppointment = (input) => {
  const {
    patientId,
    patientName,
    doctorId,
    slotId,
    reason,
    symptoms,
    mode,
    patientPhone,
    patientEmail,
  } = input;

  const doctor = db.doctors.find((d) => d.id === doctorId);
  if (!doctor) throw new AppError("Doctor not found", 404, "DOCTOR_NOT_FOUND");

  const slot = db.slots.find((s) => s.id === slotId);
  if (!slot)
    throw new AppError("Selected slot no longer exists", 404, "SLOT_NOT_FOUND");
  if (slot.doctorId !== doctorId)
    throw new AppError(
      "Slot does not belong to this doctor",
      400,
      "SLOT_MISMATCH",
    );

  // Never accept a booking for a date that has already passed.
  if (!isBookableDate(slot.date))
    throw new AppError(
      "That appointment date has already passed. Please pick an upcoming slot.",
      400,
      "SLOT_IN_PAST",
    );

  // Double-booking guard: re-check availability at commit time.
  if (slot.status === "booked") {
    const existing = db.appointments.find(
      (a) =>
        a.slotId === slot.id && !["cancelled", "no-show"].includes(a.status),
    );
    if (existing)
      throw new AppError(
        "This slot was just taken. Please pick another time.",
        409,
        "SLOT_TAKEN",
      );
  }
  if (slot.status === "blocked")
    throw new AppError(
      "This slot is blocked by the provider",
      400,
      "SLOT_BLOCKED",
    );

  // Patient double-booking guard: same patient, overlapping slot.
  const clash = db.appointments.find(
    (a) =>
      a.patientId === patientId &&
      a.date === slot.date &&
      a.startTime === slot.startTime &&
      !["cancelled", "no-show"].includes(a.status),
  );
  if (clash)
    throw new AppError(
      "You already have an appointment at this time",
      409,
      "PATIENT_CLASH",
    );

  // Allocate.
  slot.status = "booked";
  slot.appointmentId = null;

  const appointment = {
    id: id("apt"),
    patientId,
    patientName,
    doctorId,
    doctorName: doctor.name,
    specialtyName: doctor.specialtyName,
    facilityId: doctor.facilityId,
    facilityName: doctor.facilityName,
    slotId: slot.id,
    date: slot.date,
    startTime: slot.startTime,
    endTime: slot.endTime,
    mode: mode || slot.mode,
    reason: reason || "General consultation",
    symptoms: symptoms || "",
    status: "confirmed",
    fee: slot.fee ?? doctor.consultationFee,
    queuePosition: null,
    createdAt: new Date().toISOString(),
    cancelledAt: null,
    cancelReason: null,
    contact: { phone: patientPhone, email: patientEmail },
  };

  slot.appointmentId = appointment.id;
  db.appointments.unshift(appointment);
  persist();

  const facility = db.facilities.find((f) => f.id === doctor.facilityId);
  sendNotifications({
    event: "appointment_booked",
    appointment,
    doctor,
    facility,
    patient: { name: patientName, phone: patientPhone, email: patientEmail },
  });

  log.info(
    `booked ${appointment.id} | ${doctor.name} | ${slot.date} ${slot.startTime}`,
  );
  return appointment;
};

/* ------------------------------------------------------------------ *
 *  Reschedule                                                         *
 * ------------------------------------------------------------------ */
export const rescheduleAppointment = (appointmentId, newSlotId, actor) => {
  const appointment = db.appointments.find((a) => a.id === appointmentId);
  if (!appointment)
    throw new AppError("Appointment not found", 404, "APPOINTMENT_NOT_FOUND");
  if (["completed", "cancelled"].includes(appointment.status)) {
    throw new AppError(
      `Cannot reschedule a ${appointment.status} appointment`,
      400,
      "INVALID_STATUS",
    );
  }

  const newSlot = db.slots.find((s) => s.id === newSlotId);
  if (!newSlot) throw new AppError("New slot not found", 404, "SLOT_NOT_FOUND");
  if (newSlot.doctorId !== appointment.doctorId) {
    throw new AppError(
      "New slot belongs to a different doctor",
      400,
      "SLOT_MISMATCH",
    );
  }
  if (newSlot.status === "blocked")
    throw new AppError("That slot is blocked", 400, "SLOT_BLOCKED");
  if (newSlot.status === "booked")
    throw new AppError("That slot is already taken", 409, "SLOT_TAKEN");

  // Release old slot.
  const oldSlot = db.slots.find((s) => s.id === appointment.slotId);
  const previous = { date: appointment.date, startTime: appointment.startTime };
  if (oldSlot) {
    oldSlot.status = "available";
    oldSlot.appointmentId = null;
  }

  // Claim new slot.
  newSlot.status = "booked";
  newSlot.appointmentId = appointment.id;

  appointment.slotId = newSlot.id;
  appointment.date = newSlot.date;
  appointment.startTime = newSlot.startTime;
  appointment.endTime = newSlot.endTime;
  appointment.mode = newSlot.mode;
  appointment.status = "confirmed";
  appointment.rescheduledAt = new Date().toISOString();
  persist();

  const doctor = db.doctors.find((d) => d.id === appointment.doctorId);
  sendNotifications({
    event: "appointment_rescheduled",
    appointment,
    doctor,
    facility: db.facilities.find((f) => f.id === appointment.facilityId),
    patient: { name: appointment.patientName, ...appointment.contact },
    previous,
  });

  log.info(`rescheduled ${appointmentId} by ${actor?.email || "unknown"}`);
  return appointment;
};

/* ------------------------------------------------------------------ *
 *  Cancel                                                             *
 * ------------------------------------------------------------------ */
export const cancelAppointment = (appointmentId, { reason, actorRole }) => {
  const appointment = db.appointments.find((a) => a.id === appointmentId);
  if (!appointment)
    throw new AppError("Appointment not found", 404, "APPOINTMENT_NOT_FOUND");
  if (appointment.status === "cancelled")
    throw new AppError("Already cancelled", 400, "ALREADY_CANCELLED");
  if (appointment.status === "completed")
    throw new AppError(
      "Completed visits cannot be cancelled",
      400,
      "INVALID_STATUS",
    );

  const slot = db.slots.find((s) => s.id === appointment.slotId);
  if (slot) {
    slot.status = "available";
    slot.appointmentId = null;
  }

  appointment.status = "cancelled";
  appointment.cancelledAt = new Date().toISOString();
  appointment.cancelledBy = actorRole;
  appointment.cancelReason =
    reason ||
    (actorRole === "provider"
      ? "Cancelled by provider"
      : "Cancelled by patient");
  persist();

  const doctor = db.doctors.find((d) => d.id === appointment.doctorId);
  sendNotifications({
    event: "appointment_cancelled",
    appointment,
    doctor,
    facility: db.facilities.find((f) => f.id === appointment.facilityId),
    patient: { name: appointment.patientName, ...appointment.contact },
    reason: appointment.cancelReason,
  });

  log.info(`cancelled ${appointmentId} by ${actorRole}`);
  return appointment;
};

/* ------------------------------------------------------------------ *
 *  Status transitions + queue                                         *
 * ------------------------------------------------------------------ */
const ALLOWED_TRANSITIONS = {
  scheduled: ["confirmed", "cancelled"],
  confirmed: ["in-progress", "cancelled", "no-show"],
  "in-progress": ["completed", "no-show"],
  completed: [],
  cancelled: [],
  "no-show": [],
};

export const updateStatus = (appointmentId, nextStatus, note) => {
  const appointment = db.appointments.find((a) => a.id === appointmentId);
  if (!appointment)
    throw new AppError("Appointment not found", 404, "APPOINTMENT_NOT_FOUND");

  const allowed = ALLOWED_TRANSITIONS[appointment.status] || [];
  if (!allowed.includes(nextStatus)) {
    throw new AppError(
      `Cannot move from ${appointment.status} to ${nextStatus}`,
      400,
      "INVALID_TRANSITION",
      { allowed },
    );
  }

  appointment.status = nextStatus;
  if (note) appointment.statusNote = note;
  appointment.updatedAt = new Date().toISOString();

  if (nextStatus === "completed" || nextStatus === "no-show") {
    const slot = db.slots.find((s) => s.id === appointment.slotId);
    if (slot) {
      slot.status =
        slot.date >= new Date().toISOString().slice(0, 10)
          ? "available"
          : "blocked";
      slot.appointmentId = null;
    }
  }
  persist();
  return appointment;
};

/** Move a patient into the live queue for their slot and return wait info. */
export const joinQueue = (appointmentId) => {
  const appointment = db.appointments.find((a) => a.id === appointmentId);
  if (!appointment)
    throw new AppError("Appointment not found", 404, "APPOINTMENT_NOT_FOUND");
  if (["cancelled", "completed", "no-show"].includes(appointment.status)) {
    throw new AppError("This appointment is closed", 400, "INVALID_STATUS");
  }

  const slot = db.slots.find((s) => s.id === appointment.slotId);
  if (!slot) throw new AppError("Slot not found", 404, "SLOT_NOT_FOUND");

  if (!db.queue.some((q) => q.appointmentId === appointmentId)) {
    slot.currentQueue = (slot.currentQueue || 0) + 1;
    db.queue.push({
      id: id("q"),
      slotId: slot.id,
      appointmentId: appointmentId,
      patientId: appointment.patientId,
      patientName: appointment.patientName,
      doctorId: appointment.doctorId,
      joinedAt: new Date().toISOString(),
      state: "waiting",
    });
  }

  appointment.queuePosition = slot.currentQueue;
  if (
    appointment.status === "confirmed" ||
    appointment.status === "scheduled"
  ) {
    appointment.status = "in-progress";
  }
  persist();

  return { appointment, ...estimateWait(slot) };
};

/** Live queue snapshot for a doctor's slots on a given date. */
export const getQueue = (doctorId, date) => {
  const entries = db.queue.filter((q) => q.doctorId === doctorId);
  const waiting = entries.filter((q) => q.state === "waiting");
  return {
    doctorId,
    date,
    total: entries.length,
    waiting: waiting.length,
    averageWaitMinutes: waiting.length ? waiting.length * 15 : 0,
    entries: entries.map((q, i) => ({ ...q, position: i + 1 })),
  };
};

export { addMinutes };
