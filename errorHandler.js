import { AppError, sendError } from "../utils/responses.js";
import logger from "../utils/logger.js";

const log = logger.tag("error");

export const notFound = (req, res) =>
  sendError(
    res,
    `Route not found: ${req.method} ${req.originalUrl}`,
    404,
    "NOT_FOUND",
  );

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  if (err instanceof AppError) {
    return sendError(res, err.message, err.status, err.code, err.details);
  }

  // Supabase/PostgREST style errors if we ever swap the data layer.
  if (err?.code === "23505") {
    return sendError(res, "That record already exists", 409, "DUPLICATE");
  }

  log.error(err?.stack || err?.message || err);
  return sendError(
    res,
    "Something went wrong on our side",
    500,
    "INTERNAL_ERROR",
  );
};
