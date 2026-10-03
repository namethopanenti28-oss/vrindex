import db, { id, persist, addMinutes, CITIES } from "../config/db.js";
import { sendSuccess, AppError, asyncHandler } from "../utils/responses.js";
import logger from "../utils/logger.js";
import { recommendDoctors } from "../services/aiService.js";
import {
  getSlots,
  availableDates,
  getAvailabilitySummary,
} from "../services/appointmentService.js";

const log = logger.tag("doctor-ctrl");

/** Public-safe projection: never leak internal user ids or passwords. */
const shape = (d) => ({
  id: d.id,
  name: d.name,
  specialty: d.specialty,
  specialtyName: d.specialtyName,
  facilityId: d.facilityId,
  facilityName: d.facilityName,
  city: d.city,
  address: d.address,
  qualification: d.qualification,
  experience: d.experience,
  bio: d.bio,
  consultationFee: d.consultationFee,
  rating: d.rating,
  reviewCount: d.reviewCount,
  languages: d.languages,
  isAcceptingNew: d.isAcceptingNew,
  imageColor: d.imageColor,
  serviceIds: d.serviceIds,
});

/* ------------------------------------------------------------------ *
 *  GET /api/doctors                                                 *
 *  Discovery + search + filtering                                    *
 * ------------------------------------------------------------------ */
export const listDoctors = asyncHandler(async (req, res) => {
  const {
    search,
    specialty,
    city,
    maxFee,
    minRating,
    mode,
    language,
    acceptingOnly,
    sort,
  } = req.query;

  let list = db.doctors.slice();

  if (search) {
    const q = String(search).toLowerCase();
    list = list.filter((d) =>
      [
        d.name,
        d.specialtyName,
        d.facilityName,
        d.city,
        d.bio,
        d.qualification,
      ].some((f) => String(f).toLowerCase().includes(q)),
    );
  }
  if (specialty) {
    const wanted = String(specialty).toLowerCase().split(",");
    list = list.filter((d) => wanted.includes(d.specialtyName.toLowerCase()));
  }
  if (city) {
    const wanted = String(city).toLowerCase().split(",");
    list = list.filter((d) => wanted.includes(d.city.toLowerCase()));
  }
  if (maxFee) list = list.filter((d) => d.consultationFee <= Number(maxFee));
  if (minRating) list = list.filter((d) => d.rating >= Number(minRating));
  if (language)
    list = list.filter((d) =>
      d.languages?.some(
        (l) => String(l).toLowerCase() === String(language).toLowerCase(),
      ),
    );
  if (mode) {
    // A doctor qualifies if they offer at least one slot in that mode.
    const todayStr = new Date().toISOString().slice(0, 10);
    const wanted = String(mode).toLowerCase();
    const doctorsWithMode = new Set(
      db.slots
        .filter((s) => s.date >= todayStr && s.mode.toLowerCase() === wanted)
        .map((s) => s.doctorId),
    );
    list = list.filter((d) => doctorsWithMode.has(d.id));
  }
  if (acceptingOnly === "true") list = list.filter((d) => d.isAcceptingNew);

  const todayStr = new Date().toISOString().slice(0, 10);
  const sorted = [...list];
  switch (sort) {
    case "fee-low":
      sorted.sort((a, b) => a.consultationFee - b.consultationFee);
      break;
    case "experience":
      sorted.sort((a, b) => b.experience - a.experience);
      break;
    case "rating":
      sorted.sort(
        (a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount,
      );
      break;
    case "soonest":
      sorted.sort((a, b) => nextOpenDays(a.id) - nextOpenDays(b.id));
      break;
    default:
      sorted.sort(
        (a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount,
      );
  }

  return sendSuccess(res, {
    doctors: sorted.map(shape),
    count: sorted.length,
    // `total` is the match count, not the size of the catalogue - the client
    // shows it as "N specialists match your filters".
    total: sorted.length,
    filters: {
      cities: [...new Set(db.doctors.map((d) => d.city))],
      specialties: db.specialties,
    },
  });
});

function nextOpenDays(doctorId) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const next = db.slots
    .filter(
      (s) =>
        s.doctorId === doctorId &&
        s.status === "available" &&
        s.date >= todayStr,
    )
    .map((s) => s.date)
    .sort()[0];
  if (!next) return 999;
  return Math.round((new Date(next) - new Date(todayStr)) / 86400000);
}

/* ------------------------------------------------------------------ *
 *  GET /api/doctors/recommended                                     *
 * ------------------------------------------------------------------ */
export const getRecommended = asyncHandler(async (req, res) => {
  const { specialty, city, maxFee, mode, limit } = req.query;
  const results = recommendDoctors({
    specialty,
    city,
    maxFee,
    mode,
    limit: Number(limit) || 6,
  });
  return sendSuccess(res, {
    recommendations: results.map((r) => ({
      ...shape(r.doctor),
      matchScore: r.score,
    })),
  });
});

/* ------------------------------------------------------------------ *
 *  GET /api/doctors/:id                                             *
 * ------------------------------------------------------------------ */
export const getDoctor = asyncHandler(async (req, res) => {
  const doctor = db.doctors.find((d) => d.id === req.params.id);
  if (!doctor) throw new AppError("Doctor not found", 404, "DOCTOR_NOT_FOUND");

  const facility = db.facilities.find((f) => f.id === doctor.facilityId);
  const services = db.services.filter((s) => doctor.serviceIds?.includes(s.id));
  const dates = availableDates(doctor.id);

  // Attach near-term availability snapshot per date for the profile page.
  const availability = dates.slice(0, 7).map((d) => ({
    date: d,
    ...getAvailabilitySummary(doctor.id, d),
  }));

  const todayStr = new Date().toISOString().slice(0, 10);
  const upcoming = db.appointments.filter(
    (a) =>
      a.doctorId === doctor.id &&
      a.date >= todayStr &&
      !["cancelled", "completed", "no-show"].includes(a.status),
  ).length;

  return sendSuccess(res, {
    doctor: shape(doctor),
    facility: facility || null,
    services,
    availability,
    upcomingAppointments: upcoming,
    stats: {
      totalReviews: doctor.reviewCount,
      patientsTreated: 500 + doctor.experience * 40,
      repeatRate: 65 + (doctor.id.charCodeAt(doctor.id.length - 1) % 25),
    },
  });
});

/* ------------------------------------------------------------------ *
 *  GET /api/doctors/:id/slots                                        *
 * ------------------------------------------------------------------ */
export const doctorSlots = asyncHandler(async (req, res) => {
  const { date, from, to, mode } = req.query;
  const doctor = db.doctors.find((d) => d.id === req.params.id);
  if (!doctor) throw new AppError("Doctor not found", 404, "DOCTOR_NOT_FOUND");

  const slots = getSlots({ doctorId: doctor.id, date, from, to, mode });
  return sendSuccess(res, {
    slots,
    dates: availableDates(doctor.id),
    summary: date ? getAvailabilitySummary(doctor.id, date) : null,
  });
});

/* ------------------------------------------------------------------ *
 *  Provider self-service: my schedule                                 *
 * ------------------------------------------------------------------ */
export const mySchedule = asyncHandler(async (req, res) => {
  const me = db.doctors.find((d) => d.userId === req.user.id);
  if (!me)
    throw new AppError(
      "No provider profile linked to this account",
      404,
      "NO_DOCTOR_PROFILE",
    );

  const todayStr = new Date().toISOString().slice(0, 10);
  const slots = getSlots({ doctorId: me.id, date: req.query.date });
  const appointments = db.appointments
    .filter((a) => a.doctorId === me.id)
    .sort((a, b) =>
      a.date === b.date
        ? a.startTime.localeCompare(b.startTime)
        : a.date.localeCompare(b.date),
    );

  return sendSuccess(res, {
    doctor: shape(me),
    slots,
    dates: availableDates(me.id),
    appointments,
    today: appointments.filter((a) => a.date === todayStr),
    summary: getAvailabilitySummary(me.id, req.query.date || todayStr),
  });
});

/* ------------------------------------------------------------------ *
 *  PATCH /api/doctors/:id/slots/:slotId                              *
 *  Provider blocks / frees / changes a slot.                          *
 * ------------------------------------------------------------------ */
export const updateSlot = asyncHandler(async (req, res) => {
  const me = db.doctors.find((d) => d.userId === req.user.id);
  const slot = db.slots.find((s) => s.id === req.params.slotId);

  if (!slot) throw new AppError("Slot not found", 404, "SLOT_NOT_FOUND");
  if (!me) throw new AppError("No provider profile", 404, "NO_DOCTOR_PROFILE");
  if (req.user.role === "doctor" && slot.doctorId !== me.id) {
    throw new AppError("You can only manage your own slots", 403, "FORBIDDEN");
  }
  if (slot.appointmentId)
    throw new AppError(
      "This slot has an active appointment",
      409,
      "SLOT_IN_USE",
    );

  const { status, mode, fee } = req.body;
  if (status) {
    if (!["available", "blocked"].includes(status)) {
      throw new AppError(
        "Provider can only set a slot to available or blocked",
        400,
        "INVALID_STATUS",
      );
    }
    slot.status = status;
  }
  if (mode) slot.mode = mode;
  if (fee !== undefined) slot.fee = Number(fee);

  persist();
  return sendSuccess(res, { slot }, "Slot updated");
});

/* ------------------------------------------------------------------ *
 *  POST /api/doctors/:id/slots  (bulk generate)                      *
 * ------------------------------------------------------------------ */
export const generateSlots = asyncHandler(async (req, res) => {
  const doctor = db.doctors.find((d) => d.id === req.params.id);
  if (!doctor) throw new AppError("Doctor not found", 404, "DOCTOR_NOT_FOUND");
  if (
    req.user.role === "doctor" &&
    db.doctors.find((d) => d.userId === req.user.id)?.id !== doctor.id
  ) {
    throw new AppError(
      "You can only manage your own schedule",
      403,
      "FORBIDDEN",
    );
  }

  const { date, times = [], duration = 30, mode = "in-person" } = req.body;
  if (!date || !times.length)
    throw new AppError("date and times are required", 400, "MISSING_FIELDS");

  const created = [];
  times.forEach((time) => {
    const exists = db.slots.some(
      (s) =>
        s.doctorId === doctor.id && s.date === date && s.startTime === time,
    );
    if (exists) return;
    const slot = {
      id: id("slot"),
      doctorId: doctor.id,
      date,
      startTime: time,
      endTime: addMinutes(time, Number(duration)),
      mode,
      status: "available",
      maxQueue: 3,
      currentQueue: 0,
      fee: doctor.consultationFee,
      createdAt: new Date().toISOString(),
      appointmentId: null,
    };
    db.slots.push(slot);
    created.push(slot);
  });

  persist();
  log.info(`generated ${created.length} slot(s) for ${doctor.name} on ${date}`);
  return sendSuccess(
    res,
    { created, skipped: times.length - created.length },
    "Slots created",
    201,
  );
});

/* ------------------------------------------------------------------ *
 *  Reference data                                                     *
 * ------------------------------------------------------------------ */
export const listFacilities = asyncHandler(async (req, res) => {
  const { city, search } = req.query;
  let list = db.facilities.slice();
  if (city)
    list = list.filter(
      (f) => f.city.toLowerCase() === String(city).toLowerCase(),
    );
  if (search) {
    const q = String(search).toLowerCase();
    list = list.filter((f) =>
      [f.name, f.city, f.address, f.type].some((v) =>
        String(v).toLowerCase().includes(q),
      ),
    );
  }
  return sendSuccess(res, {
    facilities: list.map((f) => ({
      ...f,
      doctorCount: db.doctors.filter((d) => d.facilityId === f.id).length,
      specialties: [
        ...new Set(
          db.doctors
            .filter((d) => d.facilityId === f.id)
            .map((d) => d.specialtyName),
        ),
      ],
    })),
    cities: CITIES,
  });
});

export const listServices = asyncHandler(async (req, res) =>
  sendSuccess(res, { services: db.services }),
);
export const listSpecialties = asyncHandler(async (req, res) =>
  sendSuccess(res, { specialties: db.specialties }),
);

export { shape as shapeDoctor };
