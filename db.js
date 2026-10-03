import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

// Resolve relative to this file, not process.cwd(), so the data file always
// lands in <server>/.data regardless of where npm was invoked from.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../.data");
const DATA_FILE = path.join(DATA_DIR, "db.json");

/* ------------------------------------------------------------------ *
 *  Helpers                                                            *
 * ------------------------------------------------------------------ */
export const id = (prefix = "id") =>
  `${prefix}_${crypto.randomBytes(6).toString("hex")}`;

const dayOffset = (n) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export const today = () => dayOffset(0);
export const nowISO = () => new Date().toISOString();

/* ------------------------------------------------------------------ *
 *  Static reference data                                              *
 * ------------------------------------------------------------------ */
const SPECIALTIES = [
  {
    name: "Cardiology",
    icon: "heart",
    description: "Heart and cardiovascular care",
  },
  {
    name: "Dermatology",
    icon: "skin",
    description: "Skin, hair and nail conditions",
  },
  {
    name: "Pediatrics",
    icon: "child",
    description: "Care for infants and children",
  },
  {
    name: "Orthopedics",
    icon: "bone",
    description: "Bones, joints and musculoskeletal care",
  },
  {
    name: "Neurology",
    icon: "brain",
    description: "Brain, spine and nervous system",
  },
  {
    name: "General Medicine",
    icon: "stethoscope",
    description: "Primary and everyday healthcare",
  },
  { name: "Dentistry", icon: "tooth", description: "Oral and dental health" },
  { name: "Ophthalmology", icon: "eye", description: "Eye and vision care" },
  {
    name: "Psychiatry",
    icon: "mind",
    description: "Mental health and wellbeing",
  },
  {
    name: "Gynecology",
    icon: "health",
    description: "Women's health and maternity",
  },
];

const CITIES = ["Bengaluru", "Mumbai", "Delhi", "Hyderabad", "Chennai", "Pune"];

const FACILITIES = [
  {
    name: "MediCare City Hospital",
    city: "Bengaluru",
    address: "12 MG Road, Bengaluru",
    type: "Multi-specialty",
    rating: 4.6,
  },
  {
    name: "Sunrise Health Center",
    city: "Bengaluru",
    address: "44 Indiranagar, Bengaluru",
    type: "Clinic",
    rating: 4.3,
  },
  {
    name: "Apollo Care Clinic",
    city: "Mumbai",
    address: "8 Linking Road, Mumbai",
    type: "Multi-specialty",
    rating: 4.5,
  },
  {
    name: "GreenLife Clinic",
    city: "Delhi",
    address: "77 Nehru Place, Delhi",
    type: "Clinic",
    rating: 4.2,
  },
  {
    name: "Nova Diagnostics & Care",
    city: "Hyderabad",
    address: "5 Banjara Hills, Hyderabad",
    type: "Diagnostic Center",
    rating: 4.1,
  },
  {
    name: "Lakeview Medical Center",
    city: "Chennai",
    address: "31 Anna Salai, Chennai",
    type: "Multi-specialty",
    rating: 4.4,
  },
];

const SERVICES = [
  {
    name: "New Patient Consultation",
    duration: 30,
    price: 800,
    description: "First visit with history review and physical exam",
  },
  {
    name: "Follow-up Consultation",
    duration: 15,
    price: 400,
    description: "Review of ongoing treatment and progress",
  },
  {
    name: "Video Consultation",
    duration: 20,
    price: 500,
    description: "Secure online consultation from home",
  },
  {
    name: "Health Screening Package",
    duration: 90,
    price: 2500,
    description: "Complete preventive screening with reports",
  },
  {
    name: "Emergency Consultation",
    duration: 30,
    price: 1500,
    description: "Priority urgent care slot",
  },
];

const DOCTOR_NAMES = [
  {
    name: "Dr. Ananya Rao",
    specialty: "Cardiology",
    facility: "MediCare City Hospital",
    city: "Bengaluru",
  },
  {
    name: "Dr. Rohan Mehta",
    specialty: "Dermatology",
    facility: "Sunrise Health Center",
    city: "Bengaluru",
  },
  {
    name: "Dr. Priya Sharma",
    specialty: "Pediatrics",
    facility: "MediCare City Hospital",
    city: "Bengaluru",
  },
  {
    name: "Dr. Karthik Iyer",
    specialty: "Orthopedics",
    facility: "Lakeview Medical Center",
    city: "Chennai",
  },
  {
    name: "Dr. Sneha Kulkarni",
    specialty: "Neurology",
    facility: "Apollo Care Clinic",
    city: "Mumbai",
  },
  {
    name: "Dr. Arjun Nair",
    specialty: "General Medicine",
    facility: "GreenLife Clinic",
    city: "Delhi",
  },
  {
    name: "Dr. Meera Das",
    specialty: "Dentistry",
    facility: "Nova Diagnostics & Care",
    city: "Hyderabad",
  },
  {
    name: "Dr. Vikram Singh",
    specialty: "Ophthalmology",
    facility: "Apollo Care Clinic",
    city: "Mumbai",
  },
  {
    name: "Dr. Fatima Khan",
    specialty: "Psychiatry",
    facility: "Sunrise Health Center",
    city: "Bengaluru",
  },
  {
    name: "Dr. Sanjay Gupta",
    specialty: "General Medicine",
    facility: "Lakeview Medical Center",
    city: "Chennai",
  },
  {
    name: "Dr. Kavya Reddy",
    specialty: "Gynecology",
    facility: "Nova Diagnostics & Care",
    city: "Hyderabad",
  },
  {
    name: "Dr. Aditya Bose",
    specialty: "Cardiology",
    facility: "Lakeview Medical Center",
    city: "Chennai",
  },
];

const SLOT_TIMES = [
  "09:00",
  "09:30",
  "10:00",
  "10:30",
  "11:00",
  "11:30",
  "14:00",
  "14:30",
  "15:00",
  "16:00",
  "17:00",
];

const QUEUE_STATES = ["waiting", "in-consultation", "completed"];

/* ------------------------------------------------------------------ *
 *  Seed builder                                                       *
 * ------------------------------------------------------------------ */
function hashPassword(plain) {
  // deterministic, no external dep needed at seed time
  return `hashed:${plain}`;
}

function buildSeed() {
  const specialties = SPECIALTIES.map((s) => ({ ...s, id: id("spec") }));

  const facilities = FACILITIES.map((f) => ({
    ...f,
    id: id("fac"),
    phone: `+91 80 4${Math.floor(100000 + Math.random() * 899999)}`,
    openHours: "9:00 AM - 8:00 PM",
    queueEnabled: true,
  }));

  const services = SERVICES.map((s) => ({
    ...s,
    id: id("svc"),
    currency: "INR",
  }));

  // --- users: 3 patients, 1 admin, 12 doctors ---
  const users = [
    {
      name: "Rahul Verma",
      email: "patient@demo.com",
      password: hashPassword("patient123"),
      role: "patient",
      phone: "+91 90000 10001",
    },
    {
      name: "Ishita Desai",
      email: "ishita@demo.com",
      password: hashPassword("patient123"),
      role: "patient",
      phone: "+91 90000 10002",
    },
    {
      name: "Aman Verma",
      email: "aman@demo.com",
      password: hashPassword("patient123"),
      role: "patient",
      phone: "+91 90000 10003",
    },
    {
      name: "System Admin",
      email: "admin@demo.com",
      password: hashPassword("admin123"),
      role: "admin",
      phone: "+91 90000 00000",
    },
  ].map((u) => ({
    ...u,
    id: id("usr"),
    createdAt: nowISO(),
    profile: {
      dateOfBirth: u.role === "patient" ? "1994-06-15" : null,
      gender: u.role === "patient" ? "male" : null,
      bloodGroup: u.role === "patient" ? "O+" : null,
      address: u.role === "patient" ? "45 Park Street, Bengaluru" : null,
      emergencyContact: u.role === "patient" ? "+91 90000 11111" : null,
      allergies: u.role === "patient" ? ["Penicillin"] : [],
    },
  }));

  const doctors = DOCTOR_NAMES.map((d, idx) => {
    const facility = facilities.find((f) => f.name === d.facility);
    const spec = specialties.find((s) => s.name === d.specialty);
    const user = {
      id: id("usr"),
      name: d.name,
      email: `doctor${idx + 1}@demo.com`,
      password: hashPassword("doctor123"),
      role: "doctor",
      phone: `+91 90000 2${String(idx + 1).padStart(4, "0")}`,
      createdAt: nowISO(),
      profile: {},
    };
    return {
      id: id("doc"),
      userId: user.id,
      name: d.name,
      specialty: spec.id,
      specialtyName: spec.name,
      facilityId: facility.id,
      facilityName: facility.name,
      city: d.city,
      address: facility.address,
      qualification: idx % 3 === 0 ? "MD, DM - Cardiology" : "MBBS, MD",
      experience: 5 + idx * 2,
      bio: `${d.name} is a highly experienced ${spec.name.toLowerCase()} specialist with over ${5 + idx * 2} years of clinical practice at ${facility.name}.`,
      consultationFee: 500 + idx * 150,
      rating: Number((4 + (idx % 5) * 0.2).toFixed(1)),
      reviewCount: 40 + idx * 37,
      languages:
        idx % 2 === 0 ? ["English", "Kannada", "Hindi"] : ["English", "Hindi"],
      isAcceptingNew: true,
      imageColor: ["#2563eb", "#7c3aed", "#059669", "#dc2626", "#d97706"][
        idx % 5
      ],
      serviceIds: [services[0].id, services[1].id, services[2].id].map(
        (sid) => sid,
      ),
      userId: user.id,
      user,
    };
  });

  // Doctor login accounts live in the same users collection. Without this the
  // provider dashboard has no way to authenticate.
  users.push(...doctors.map((d) => d.user));

  // --- slots: next 14 days ---
  const slots = [];
  for (let day = 0; day < 14; day += 1) {
    doctors.forEach((doc, dIdx) => {
      // stagger doctors so slots don't collide / all identical
      const times = SLOT_TIMES.filter(
        (_, i) => (i + dIdx) % 2 === 0 || day % 3 === 0,
      );
      times.forEach((time, tIdx) => {
        // leave a realistic number of slots already booked
        const roll = (day * 7 + dIdx * 3 + tIdx * 5) % 10;
        const status = roll < 4 ? "booked" : roll < 5 ? "blocked" : "available";
        slots.push({
          id: id("slot"),
          doctorId: doc.id,
          date: dayOffset(day),
          startTime: time,
          endTime: addMinutes(time, 30),
          mode: tIdx % 4 === 3 ? "video" : "in-person",
          status,
          maxQueue: 3,
          currentQueue: 0,
          fee: doc.consultationFee,
          createdAt: nowISO(),
        });
      });
    });
  }

  // --- appointments (history + upcoming for analytics) ---
  const patients = users.filter((u) => u.role === "patient");
  const statuses = [
    "completed",
    "completed",
    "completed",
    "cancelled",
    "no-show",
    "confirmed",
    "in-progress",
  ];
  const appointments = [];
  for (let i = 0; i < 42; i += 1) {
    const doc = doctors[i % doctors.length];
    const patient = patients[i % patients.length];
    const backDays = -(i % 30) - 1;
    const reason = [
      "Chest discomfort during exercise",
      "Recurring skin rash on arms",
      "Child fever and loss of appetite",
      "Knee pain while climbing stairs",
      "Frequent headaches and dizziness",
      "Annual health checkup",
      "Sensitive teeth while eating",
      "Blurred vision in left eye",
      "Sleep disturbance and stress",
      "Irregular menstrual cycles",
    ][i % 10];
    appointments.push({
      id: id("apt"),
      patientId: patient.id,
      patientName: patient.name,
      doctorId: doc.id,
      doctorName: doc.name,
      specialtyName: doc.specialtyName,
      facilityId: doc.facilityId,
      facilityName: doc.facilityName,
      date: dayOffset(backDays),
      startTime: SLOT_TIMES[i % SLOT_TIMES.length],
      mode: i % 4 === 3 ? "video" : "in-person",
      reason,
      symptoms: reason,
      status: statuses[i % statuses.length],
      fee: doc.consultationFee,
      queuePosition: null,
      createdAt: nowISO(),
      cancelledAt: null,
      cancelReason: null,
    });
  }

  // a couple of upcoming confirmed appointments for the demo patient
  const rahul = patients[0];
  const upcomingDocs = [doctors[0], doctors[5]];
  upcomingDocs.forEach((doc, i) => {
    appointments.push({
      id: id("apt"),
      patientId: rahul.id,
      patientName: rahul.name,
      doctorId: doc.id,
      doctorName: doc.name,
      specialtyName: doc.specialtyName,
      facilityId: doc.facilityId,
      facilityName: doc.facilityName,
      date: dayOffset(2 + i * 3),
      startTime: SLOT_TIMES[3 + i * 2],
      mode: i === 1 ? "video" : "in-person",
      reason: "Follow-up consultation",
      symptoms: "Follow-up consultation",
      status: i === 0 ? "confirmed" : "scheduled",
      fee: doc.consultationFee,
      queuePosition: null,
      createdAt: nowISO(),
      cancelledAt: null,
      cancelReason: null,
    });
  });

  const notifications = [];
  const queue = [];

  return {
    meta: { seededAt: nowISO() },
    specialties,
    facilities,
    services,
    users,
    doctors,
    slots,
    appointments,
    notifications,
    queue,
  };
}

function addMinutes(time, mins) {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ *
 *  Persistence (best effort)                                         *
 * ------------------------------------------------------------------ */
function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf8");
      if (raw.trim()) return JSON.parse(raw);
    }
  } catch (err) {
    console.warn("[db] could not read persisted data, reseeding:", err.message);
  }
  return null;
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  } catch (err) {
    // Prototype: non-fatal. DB stays in memory.
    console.warn("[db] persistence skipped:", err.message);
  }
}

let db = load();
if (!db) {
  db = buildSeed();
  save();
  console.log("[db] seeded in-memory database");
}

export default db;
export { save as persist, QUEUE_STATES, CITIES, addMinutes };
