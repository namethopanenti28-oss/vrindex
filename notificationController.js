import db from "../config/db.js";
import { sendSuccess, asyncHandler } from "../utils/responses.js";
import { runReminderSweep } from "../services/notificationService.js";
import logger from "../utils/logger.js";

const log = logger.tag("notify-ctrl");

/* ------------------------------------------------------------------ *
 *  GET /api/notifications                                           *
 * ------------------------------------------------------------------ */
export const listNotifications = asyncHandler(async (req, res) => {
  const targetId =
    req.user.role === "patient"
      ? req.user.id
      : req.query.patientId || req.user.id;

  const mine = db.notifications.filter((n) => n.patientId === targetId);
  return sendSuccess(res, {
    notifications: mine.slice(0, Number(req.query.limit) || 50),
    unread: mine.filter((n) => !n.read).length,
    channels: {
      sms: Boolean(process.env.TWILIO_ACCOUNT_SID),
      email: Boolean(process.env.RESEND_API_KEY),
    },
  });
});

/* ------------------------------------------------------------------ *
 *  PATCH /api/notifications/read-all                                 *
 * ------------------------------------------------------------------ */
export const markRead = asyncHandler(async (req, res) => {
  db.notifications.forEach((n) => {
    if (n.patientId === req.user.id) n.read = true;
  });
  return sendSuccess(res, { ok: true }, "All notifications marked as read");
});

/* ------------------------------------------------------------------ *
 *  POST /api/notifications/reminders/sweep                           *
 *  Simulates the cron job that fires appointment reminders.          *
 * ------------------------------------------------------------------ */
export const sweep = asyncHandler(async (req, res) => {
  const hours = Number(req.body?.hours) || Number(req.query.hours) || 24;
  const sent = await runReminderSweep(hours);
  log.info(`manual sweep triggered (${hours}h window)`);
  return sendSuccess(
    res,
    { sent: sent.length, notifications: sent },
    "Reminder sweep complete",
  );
});
