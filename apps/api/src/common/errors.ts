/**
 * HTTP error classes mirroring the legacy `GlobalExceptionHandler` mapping:
 * 400 validation / illegal argument, 401 unauthenticated, 403 forbidden,
 * 404 missing resource, 409 conflict.
 */

export class HttpException extends Error {
  readonly status: number;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(status: number, message: string, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

export class BadRequestException extends HttpException {
  constructor(message = "Bad request", fieldErrors?: Record<string, string[]>) {
    super(400, message, fieldErrors);
  }
}

export class UnauthorizedException extends HttpException {
  constructor(message = "Unauthorized") {
    super(401, message);
  }
}

export class ForbiddenException extends HttpException {
  constructor(message = "Forbidden") {
    super(403, message);
  }
}

export class NotFoundException extends HttpException {
  constructor(message = "Not Found") {
    super(404, message);
  }
}

export class ConflictException extends HttpException {
  constructor(message = "Conflict") {
    super(409, message);
  }
}
