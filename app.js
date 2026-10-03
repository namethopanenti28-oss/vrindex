import express from "express";
import cors from "cors";
import morgan from "morgan";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

import "./config/env.js";
import logger from "./utils/logger.js";
import { notFound, errorHandler } from "./middlewares/errorHandler.js";
import db from "./config/db.js";

import authRoutes from "./routes/authRoutes.js";
import doctorRoutes from "./routes/doctorRoutes.js";
import appointmentRoutes from "./routes/appointmentRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import aiRoutes from "./routes/aiRoutes.js";

const app = express();
const log = logger.tag("http");

/* ------------------------------------------------------------------ *
 *  Core middleware                                                     *
 * ------------------------------------------------------------------ */
app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(",") || true,
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV !== "test") {
  app.use(morgan("dev"));
}

// Lightweight request log via our tagged logger.
app.use((req, res, next) => {
  const started = Date.now();
  res.on("finish", () => {
    log.info(
      `${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - started}ms`,
    );
  });
  next();
});

/* ------------------------------------------------------------------ *
 *  Health + meta                                                       *
 * ------------------------------------------------------------------ */
app.get("/api/health", (req, res) =>
  res.json({
    success: true,
    message: "OK",
    data: {
      status: "healthy",
      uptime: Math.round(process.uptime()),
      seededAt: db.meta?.seededAt,
      counts: {
        doctors: db.doctors.length,
        facilities: db.facilities.length,
        services: db.services.length,
        appointments: db.appointments.length,
      },
    },
  }),
);

// Demo account hints so the prototype is easy to explore.
app.get("/api/demo-accounts", (req, res) =>
  res.json({
    success: true,
    message: "OK",
    data: [
      { role: "patient", email: "patient@demo.com", password: "patient123" },
      { role: "doctor", email: "doctor1@demo.com", password: "doctor123" },
      { role: "admin", email: "admin@demo.com", password: "admin123" },
    ],
  }),
);

/* ------------------------------------------------------------------ *
 *  API routes                                                          *
 * ------------------------------------------------------------------ */
app.use("/api/auth", authRoutes);
app.use("/api/doctors", doctorRoutes);
app.use("/api/appointments", appointmentRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/ai", aiRoutes);

/* ------------------------------------------------------------------ *
 *  Static client (production build)                                    *
 * ------------------------------------------------------------------ */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, "../../client/dist");

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback for anything that is not an API route.
  app.get(/^\/(?!api\/).*/, (req, res) =>
    res.sendFile(path.join(clientDist, "index.html")),
  );
}

/* ------------------------------------------------------------------ *
 *  404 + error handling                                                *
 * ------------------------------------------------------------------ */
app.use("/api", notFound);
app.use(errorHandler);

export default app;
