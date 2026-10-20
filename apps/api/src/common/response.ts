/**
 * `ApiResponse<T>` builders. Must match the legacy Java shape exactly:
 * `{ success: boolean, data?: T, message?: string, timestamp?: string }`
 * with `timestamp` as an ISO-8601 string.
 */

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  timestamp?: string;
}

export interface ApiErrorBody {
  success: false;
  message: string;
  timestamp?: string;
  fieldErrors?: Record<string, string[]>;
}

function timestamp(): string {
  return new Date().toISOString();
}

export function success<T>(data: T, message = "Success"): ApiResponse<T> {
  return { success: true, data, message, timestamp: timestamp() };
}

export function successNoMessage<T>(data: T): ApiResponse<T> {
  return { success: true, data, timestamp: timestamp() };
}

export function failure(
  message: string,
  fieldErrors?: Record<string, string[]>,
): ApiErrorBody {
  return {
    success: false,
    message,
    timestamp: timestamp(),
    ...(fieldErrors ? { fieldErrors } : {}),
  };
}
