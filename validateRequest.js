/**
 * Tiny declarative validator so we avoid pulling Joi/Zod into a prototype.
 * Rules: { field: { required, type, min, max, enum, default } }
 */
import { AppError } from "../utils/responses.js";

const TYPE_CHECKS = {
  string: (v) => typeof v === "string",
  number: (v) => typeof v === "number" && !Number.isNaN(v),
  boolean: (v) => typeof v === "boolean",
  array: (v) => Array.isArray(v),
  object: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v)),
  date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)),
};

export const validate =
  (rules, source = "body") =>
  (req, res, next) => {
    const payload = req[source] || {};
    const errors = [];

    Object.entries(rules).forEach(([field, rule]) => {
      let value = payload[field];

      if (value === undefined || value === "") {
        if (rule.default !== undefined) {
          req[source][field] = rule.default;
          return;
        }
        if (rule.required)
          errors.push({ field, message: `${field} is required` });
        return;
      }

      if (rule.type && !TYPE_CHECKS[rule.type](value)) {
        errors.push({
          field,
          message: `${field} must be a valid ${rule.type}`,
        });
        return;
      }

      if (rule.enum && !rule.enum.includes(value)) {
        errors.push({
          field,
          message: `${field} must be one of: ${rule.enum.join(", ")}`,
        });
        return;
      }

      if (rule.min !== undefined && value.length < rule.min) {
        errors.push({
          field,
          message: `${field} must be at least ${rule.min} characters`,
        });
        return;
      }

      if (
        rule.maxLength !== undefined &&
        String(value).length > rule.maxLength
      ) {
        errors.push({
          field,
          message: `${field} must be under ${rule.maxLength} characters`,
        });
        return;
      }

      if (rule.max !== undefined && Number(value) > rule.max) {
        errors.push({ field, message: `${field} must be ${rule.max} or less` });
      }
    });

    if (errors.length) {
      return next(
        new AppError("Validation failed", 422, "VALIDATION_ERROR", errors),
      );
    }
    return next();
  };

export default validate;
