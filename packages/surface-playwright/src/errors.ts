export class SurfaceError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class TargetNotFoundError extends SurfaceError {
  constructor(message: string) {
    super(message, "TARGET_NOT_FOUND");
  }
}

export class AmbiguousTargetError extends SurfaceError {
  constructor(message: string) {
    super(message, "AMBIGUOUS_TARGET");
  }
}

export class RouteNotAllowedError extends SurfaceError {
  constructor(message: string) {
    super(message, "ROUTE_NOT_ALLOWED");
  }
}

export class UnsupportedCheckError extends SurfaceError {
  constructor(message: string) {
    super(message, "UNSUPPORTED_CHECK");
  }
}
