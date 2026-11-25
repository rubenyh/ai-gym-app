/** SESSION-01: one active workout at a time. The UI offers resume or discard of `activeSessionId`. */
export class ActiveSessionExistsError extends Error {
  constructor(readonly activeSessionId: string) {
    super('Another workout is already active');
    this.name = 'ActiveSessionExistsError';
  }
}

/** A finish was requested for a session without any completed set; discard it instead (SESSION-04). */
export class EmptySessionError extends Error {
  constructor() {
    super('Complete at least one set before finishing, or discard the workout');
    this.name = 'EmptySessionError';
  }
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}

/** Invalid input rejected before anything is written. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
