import db, { id, persist } from "../config/db.js";
import { signToken } from "../middlewares/authMiddleware.js";
import { sendSuccess, AppError, asyncHandler } from "../utils/responses.js";
import logger from "../utils/logger.js";

const log = logger.tag("auth");

/* Demo users use a `hashed:` prefix; anything else goes through bcrypt. */
async function verifyPassword(plain, stored) {
  if (String(stored).startsWith("hashed:")) return stored === `hashed:${plain}`;
  // eslint-disable-next-line global-require, import/no-extraneous-dependencies
  const bcrypt = (await import("bcryptjs")).default;
  return bcrypt.compare(plain, stored);
}

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  phone: u.phone,
  profile: u.profile,
  createdAt: u.createdAt,
  doctor:
    u.role === "doctor"
      ? db.doctors.find((d) => d.userId === u.id) || null
      : undefined,
});

/* ------------------------------------------------------------------ *
 *  POST /api/auth/register                                           *
 * ------------------------------------------------------------------ */
export const register = asyncHandler(async (req, res) => {
  const { name, email, password, phone, role, profile } = req.body;

  if (db.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
    throw new AppError(
      "An account with this email already exists",
      409,
      "EMAIL_TAKEN",
    );
  }

  const user = {
    id: id("usr"),
    name,
    email,
    password: `hashed:${password}`,
    role: role === "provider" ? "doctor" : "patient",
    phone: phone || null,
    createdAt: new Date().toISOString(),
    profile: {
      dateOfBirth: profile?.dateOfBirth || null,
      gender: profile?.gender || null,
      bloodGroup: profile?.bloodGroup || null,
      address: profile?.address || null,
      emergencyContact: profile?.emergencyContact || null,
      allergies: Array.isArray(profile?.allergies) ? profile.allergies : [],
    },
  };
  db.users.push(user);
  persist();
  log.info(`registered ${user.role} ${email}`);

  return sendSuccess(
    res,
    { token: signToken(user), user: publicUser(user) },
    "Account created",
    201,
  );
});

/* ------------------------------------------------------------------ *
 *  POST /api/auth/login                                              *
 * ------------------------------------------------------------------ */
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = db.users.find(
    (u) => u.email.toLowerCase() === String(email).toLowerCase(),
  );

  // Uniform error message: don't leak whether the email exists.
  if (!user || !(await verifyPassword(password, user.password))) {
    throw new AppError("Invalid email or password", 401, "BAD_CREDENTIALS");
  }

  log.info(`login ${user.email} (${user.role})`);
  return sendSuccess(
    res,
    { token: signToken(user), user: publicUser(user) },
    "Signed in",
  );
});

/* ------------------------------------------------------------------ *
 *  GET /api/auth/me                                                  *
 * ------------------------------------------------------------------ */
export const me = asyncHandler(async (req, res) => {
  const user = db.users.find((u) => u.id === req.user.id);
  if (!user) throw new AppError("Account not found", 404, "USER_NOT_FOUND");
  return sendSuccess(res, { user: publicUser(user) });
});

/* ------------------------------------------------------------------ *
 *  PATCH /api/auth/me                                                *
 * ------------------------------------------------------------------ */
export const updateProfile = asyncHandler(async (req, res) => {
  const user = db.users.find((u) => u.id === req.user.id);
  if (!user) throw new AppError("Account not found", 404, "USER_NOT_FOUND");

  const { name, phone, profile } = req.body;
  if (name) user.name = name;
  if (phone) user.phone = phone;
  if (profile) user.profile = { ...user.profile, ...profile };

  persist();
  log.info(`profile updated for ${user.email}`);
  return sendSuccess(res, { user: publicUser(user) }, "Profile updated");
});
