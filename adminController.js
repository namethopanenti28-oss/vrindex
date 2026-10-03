import db, { id, persist } from "../config/db.js";
import { sendSuccess, AppError, asyncHandler } from "../utils/responses.js";
import logger from "../utils/logger.js";

const log = logger.tag("admin");

/* ------------------------------------------------------------------ *
 *  GET /api/admin/overview                                          *
 *  Headline KPIs + charts data                                       *
 * ------------------------------------------------------------------ */
export const overview = asyncHandler(async (req, res) => {
  const todayStr = new Date().toISOString().slice(0, 10);
  const all = db.appointments;
  const live = all.filter((a) => !["cancelled"].includes(a.status));
  const completed = all.filter((a) => a.status === "completed");
  const cancelled = all.filter((a) => a.status === "cancelled");
  const noShow = all.filter((a) => a.status === "no-show");
  const upcoming = all.filter(
    (a) => a.date >= todayStr && ["scheduled", "confirmed"].includes(a.status),
  );

  const booked = live.length;
  const noShowRate = booked
    ? Number(((noShow.length / booked) * 100).toFixed(1))
    : 0;
  const cancelRate = booked
    ? Number(((cancelled.length / booked) * 100).toFixed(1))
    : 0;

  // --- 14-day trend ---
  const trend = [];
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    trend.push({
      date: ds,
      appointments: all.filter((a) => a.date === ds).length,
      completed: all.filter((a) => a.date === ds && a.status === "completed")
        .length,
      cancelled: all.filter((a) => a.date === ds && a.status === "cancelled")
        .length,
      noShow: all.filter((a) => a.date === ds && a.status === "no-show").length,
    });
  }

  // --- by specialty ---
  const bySpecialty = db.specialties
    .map((s) => {
      const rows = all.filter(
        (a) =>
          a.doctorName &&
          db.doctors.find((d) => d.id === a.doctorId)?.specialtyName === s.name,
      );
      const c = rows.filter((a) => a.status === "cancelled").length;
      const ns = rows.filter((a) => a.status === "no-show").length;
      return {
        specialty: s.name,
        total: rows.length,
        completed: rows.filter((a) => a.status === "completed").length,
        cancelled: c,
        noShow: ns,
        utilization: rows.length
          ? Math.round(
              (rows.filter((a) => a.status === "completed").length /
                rows.length) *
                100,
            )
          : 0,
      };
    })
    .filter((r) => r.total > 0);

  // --- top doctors ---
  const topDoctors = db.doctors
    .map((d) => {
      const rows = all.filter(
        (a) => a.doctorId === d.id && a.status === "completed",
      );
      return {
        doctorId: d.id,
        name: d.name,
        specialtyName: d.specialtyName,
        completed: rows.length,
        rating: d.rating,
        revenue: rows.length * d.consultationFee,
        noShow: all.filter((a) => a.doctorId === d.id && a.status === "no-show")
          .length,
      };
    })
    .sort((a, b) => b.completed - a.completed)
    .slice(0, 8);

  // --- slot utilization across the board ---
  const totalSlots = db.slots.length;
  const usedSlots = db.slots.filter(
    (s) => s.status === "booked" || s.status === "blocked",
  ).length;
  const upcomingSlots = db.slots.filter((s) => s.date >= todayStr);

  return sendSuccess(res, {
    kpis: {
      totalAppointments: all.length,
      booked: booked,
      completed: completed.length,
      cancelled: cancelled.length,
      noShow: noShow.length,
      upcoming: upcoming.length,
      todayCount: all.filter((a) => a.date === todayStr).length,
      cancelRate,
      noShowRate,
      revenue: completed.reduce((sum, a) => sum + (a.fee || 0), 0),
      slotUtilization: totalSlots
        ? Math.round((usedSlots / totalSlots) * 100)
        : 0,
      activePatients: new Set(all.map((a) => a.patientId)).size,
    },
    counts: {
      doctors: db.doctors.length,
      facilities: db.facilities.length,
      services: db.services.length,
      specialties: db.specialties.length,
      users: db.users.length,
      upcomingSlotCount: upcomingSlots.length,
      openSlotCount: upcomingSlots.filter((s) => s.status === "available")
        .length,
    },
    trend,
    bySpecialty,
    topDoctors,
  });
});

/* ------------------------------------------------------------------ *
 *  Facility / doctor admin CRUD                                      *
 * ------------------------------------------------------------------ */
export const listDoctorsAdmin = asyncHandler(async (req, res) => {
  const { search, specialty, city, accepting } = req.query;
  let list = db.doctors.slice();

  // Flatten the linked login account so search can match on it, but never
  // serialise the user record itself - it holds the password hash.
  const withAccount = (d) => {
    const account = db.users.find((u) => u.id === d.userId);
    const { user, ...safe } = d;
    return {
      ...safe,
      email: account?.email ?? null,
      phone: account?.phone ?? null,
      accountActive: Boolean(account),
    };
  };

  if (search) {
    const q = String(search).toLowerCase();
    list = list.map(withAccount).filter((d) =>
      [d.name, d.specialtyName, d.facilityName, d.email, d.city].some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(q),
      ),
    );
  }
  if (specialty) list = list.filter((d) => d.specialtyName === specialty);
  if (city) list = list.filter((d) => d.city === city);
  if (accepting === "true") list = list.filter((d) => d.isAcceptingNew);

  const safeList = list.map((d) =>
    d.email !== undefined ? d : withAccount(d),
  );
  return sendSuccess(res, { doctors: safeList, count: safeList.length });
});

export const updateDoctor = asyncHandler(async (req, res) => {
  const doctor = db.doctors.find((d) => d.id === req.params.id);
  if (!doctor) throw new AppError("Doctor not found", 404, "DOCTOR_NOT_FOUND");

  const allowed = [
    "isAcceptingNew",
    "consultationFee",
    "facilityId",
    "rating",
    "experience",
    "bio",
    "qualification",
  ];
  allowed.forEach((k) => {
    if (req.body[k] !== undefined) doctor[k] = req.body[k];
  });
  persist();
  log.info(`doctor ${doctor.id} updated by admin`);
  return sendSuccess(res, { doctor }, "Doctor updated");
});

export const listFacilitiesAdmin = asyncHandler(async (req, res) =>
  sendSuccess(res, {
    facilities: db.facilities.map((f) => ({
      ...f,
      doctorCount: db.doctors.filter((d) => d.facilityId === f.id).length,
      appointmentCount: db.appointments.filter((a) => a.facilityId === f.id)
        .length,
    })),
  }),
);

export const createFacility = asyncHandler(async (req, res) => {
  const { name, city, address, type, phone, openHours, rating } = req.body;
  if (db.facilities.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
    throw new AppError(
      "A facility with this name already exists",
      409,
      "DUPLICATE",
    );
  }
  const facility = {
    id: id("fac"),
    name,
    city,
    address: address || `${city}`,
    type: type || "Clinic",
    phone: phone || null,
    openHours: openHours || "9:00 AM - 8:00 PM",
    rating: Number(rating) || 4,
    queueEnabled: true,
  };
  db.facilities.push(facility);
  persist();
  log.info(`facility created: ${facility.name}`);
  return sendSuccess(res, { facility }, "Facility created", 201);
});

export const listServicesAdmin = asyncHandler(async (req, res) =>
  sendSuccess(res, {
    services: db.services.map((s) => ({
      ...s,
      doctorCount: db.doctors.filter((d) => d.serviceIds?.includes(s.id))
        .length,
    })),
  }),
);

/* ------------------------------------------------------------------ *
 *  GET /api/admin/patients                                          *
 *  Minimal patient list for administration (PHI-lite view).          *
 * ------------------------------------------------------------------ */
export const listPatients = asyncHandler(async (req, res) => {
  const patients = db.users
    .filter((u) => u.role === "patient")
    .map((u) => {
      const rows = db.appointments.filter((a) => a.patientId === u.id);
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        bloodGroup: u.profile?.bloodGroup,
        allergies: u.profile?.allergies || [],
        totalAppointments: rows.length,
        completed: rows.filter((a) => a.status === "completed").length,
        noShow: rows.filter((a) => a.status === "no-show").length,
        cancelled: rows.filter((a) => a.status === "cancelled").length,
        lastVisit:
          rows.filter((a) => a.status === "completed")[0]?.date || null,
      };
    });

  return sendSuccess(res, { patients, count: patients.length });
});

/* ------------------------------------------------------------------ *
 *  GET /api/admin/notifications  (platform-wide dispatch log)       *
 * ------------------------------------------------------------------ */
export const notificationLog = asyncHandler(async (req, res) =>
  sendSuccess(res, {
    notifications: db.notifications.slice(0, Number(req.query.limit) || 100),
    total: db.notifications.length,
    sent: db.notifications.filter((n) => n.status === "sent").length,
    simulated: db.notifications.filter((n) => n.status === "simulated").length,
  }),
);
