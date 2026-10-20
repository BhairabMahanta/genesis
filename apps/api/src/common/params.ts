import type { Context } from "hono";
import { BadRequestException } from "./errors.js";

/** Reads a path parameter or throws 400 when it is absent. */
export function needParam(c: Context, name: string): string {
  const value = c.req.param(name);
  if (value === undefined || value === "") {
    throw new BadRequestException(`Missing path parameter: ${name}`);
  }
  return value;
}
