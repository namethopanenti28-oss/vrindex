import db, { id, persist } from "../config/db.js";
import logger from "../utils/logger.js";

const log = logger.tag("notify");

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_FROM_NUMBER;
const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL =
  process.env.NOTIFICATION_FROM_EMAIL || "notifications@medicare.demo";

export const channels = {
  sms: Boolean(TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM),
  email: Boolean(RESEND_KEY),
};

/* ------------------------------------------------------------------ *
 *  Template rendering                                                 *
 * ------------------------------------------------------------------ */
const money = (n) => `INR ${Number(n || 0).toLocaleString("en-IN")}`;

const fmtSlot = (a) => `${a.date} at ${a.startTime}`;

const TEMPLATES = {
  appointment_booked: {
    channel: "both",
    subject: "Appointment confirmed",
    body: (a, d, f) =>
      `Hi ${a.patientName}, your appointment with ${d.name} (${d.specialtyName}) is confirmed for ${fmtSlot(a)} at ${f?.name || a.facilityName}. Consultation fee ${money(a.fee)}.`,
  },
  appointment_rescheduled: {
    channel: "both",
    subject: "Appointment rescheduled",
    body: (a, d, f) =>
      `Hi ${a.patientName}, your appointment with ${d.name} has been moved to ${fmtSlot(a)} at ${f?.name || a.facilityName}.`,
  },
  appointment_cancelled: {
    channel: "both",
    subject: "Appointment cancelled",
    body: (a, d, f, meta) =>
      `Hi ${a.patientName}, your appointment with ${d.name} on ${a.date} has been cancelled. Reason: ${meta?.reason || "not specified"}.`,
  },
  appointment_reminder: {
    channel: "both",
    subject: "Appointment reminder",
    body: (a, d, f) =>
      `Reminder: your appointment with ${d.name} is on ${fmtSlot(a)} at ${f?.name || a.facilityName}. Please arrive 10 minutes early.`,
  },
  status_update: {
    channel: "both",
    subject: "Appointment status updated",
    body: (a, d, f, meta) =>
      `Your appointment with ${d.name} on ${a.date} is now "${meta?.status}".`,
  },
};

/* ------------------------------------------------------------------ *
 *  Transport (real SDK calls when keys exist, console otherwise)      *
 * ------------------------------------------------------------------ */
async function sendSms(to, body) {
  if (!channels.sms) {
    log.info(`[SMS -> console] to=${to || "n/a"} :: ${body}`);
    return { channel: "sms", delivered: false, simulated: true };
  }
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: TWILIO_FROM, Body: body }),
      },
    );
    if (!res.ok) throw new Error(`Twilio ${res.status}`);
    const json = await res.json();
    return { channel: "sms", delivered: true, sid: json.sid, simulated: false };
  } catch (err) {
    log.error(`SMS failed: ${err.message}`);
    return { channel: "sms", delivered: false, error: err.message };
  }
}

async function sendEmail(to, subject, body) {
  if (!channels.email) {
    log.info(`[EMAIL -> console] to=${to || "n/a"} :: ${subject} :: ${body}`);
    return { channel: "email", delivered: false, simulated: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `MediCare <${FROM_EMAIL}>`,
        to: [to],
        subject,
        text: body,
      }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}`);
    const json = await res.json();
    return { channel: "email", delivered: true, id: json.id, simulated: false };
  } catch (err) {
    log.error(`Email failed: ${err.message}`);
    return { channel: "email", delivered: false, error: err.message };
  }
}

/* ------------------------------------------------------------------ *
 *  Public API                                                         *
 * ------------------------------------------------------------------ */
export async function sendNotifications({
  event,
  appointment,
  doctor,
  facility,
  patient,
  reason,
  status,
}) {
  const template = TEMPLATES[event];
  if (!template) {
    log.warn(`No template for event "${event}"`);
    return [];
  }

  const phone = patient?.phone || appointment?.contact?.phone;
  const email = patient?.email || appointment?.contact?.email;
  const body = template.body(appointment, doctor, facility, { reason, status });
  const meta = { reason, status };

  const record = {
    id: id("ntf"),
    event,
    appointmentId: appointment?.id || null,
    patientId: appointment?.patientId || patient?.id || null,
    patientName: appointment?.patientName || patient?.name || null,
    channel: template.channel,
    subject: template.subject,
    body,
    phone,
    email,
    status: "queued",
    createdAt: new Date().toISOString(),
    read: false,
  };

  const tasks = [];
  if (template.channel === "both" || template.channel === "sms")
    tasks.push(sendSms(phone, body));
  if (template.channel === "both" || template.channel === "email")
    tasks.push(sendEmail(email, template.subject, body));

  const results = await Promise.allSettled(tasks);
  const delivered = results.some(
    (r) => r.status === "fulfilled" && r.value.delivered,
  );
  record.status = delivered ? "sent" : "simulated";
  record.results = results.map((r) =>
    r.status === "fulfilled" ? r.value : { error: r.reason?.message },
  );

  db.notifications.unshift(record);
  if (db.notifications.length > 500) db.notifications.length = 500;
  persist();

  return [record];
}

/** Simulated reminder sweep: notifies about appointments starting within `hours`. */
export const runReminderSweep = async (hours = 24) => {
  const target = new Date(Date.now() + hours * 3600000);
  const todayStr = new Date().toISOString().slice(0, 10);
  const targetStr = target.toISOString().slice(0, 10);

  const due = db.appointments.filter((a) => {
    if (!["confirmed", "scheduled"].includes(a.status)) return false;
    if (a.date < todayStr || a.date > targetStr) return false;
    if (a.date === todayStr && a.startTime > target.toTimeString().slice(0, 5))
      return false;
    return !a.reminderSent;
  });

  const out = [];
  for (const a of due) {
    a.reminderSent = true;
    // eslint-disable-next-line no-await-in-loop
    out.push(
      ...(await sendNotifications({
        event: "appointment_reminder",
        appointment: a,
        doctor: db.doctors.find((d) => d.id === a.doctorId),
        facility: db.facilities.find((f) => f.id === a.facilityId),
        patient: { name: a.patientName, ...a.contact },
      })),
    );
  }
  persist();
  log.info(`reminder sweep: ${due.length} appointment(s) due within ${hours}h`);
  return out;
};

/** Fire-and-forget status change notification. */
export const notifyStatusChange = (appointment, nextStatus) =>
  sendNotifications({
    event: "status_update",
    appointment,
    doctor: db.doctors.find((d) => d.id === appointment.doctorId),
    facility: db.facilities.find((f) => f.id === appointment.facilityId),
    patient: { name: appointment.patientName, ...appointment.contact },
    status: nextStatus,
  });

export const listNotifications = (patientId, limit = 50) =>
  db.notifications
    .filter((n) => !patientId || n.patientId === patientId)
    .slice(0, limit);

export const markAllRead = (patientId) => {
  db.notifications.forEach((n) => {
    if (n.patientId === patientId) n.read = true;
  });
  persist();
  return true;
};
