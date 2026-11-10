import { ReportError } from "./model";
export type SourceDiagnostic = {
  operation: string;
  httpStatus: number;
  errors: { code: string; path: (string | number)[]; cause: string }[];
};
export class SourceReadError extends ReportError {
  constructor(public readonly diagnostic: SourceDiagnostic) {
    super("The CRM source could not be read. Please retry.", 503);
  }
  get isMissingAcceptanceDate() {
    return (
      this.diagnostic.operation === "GMReportAcceptedAt" &&
      this.diagnostic.httpStatus === 200 &&
      this.diagnostic.errors.length > 0 &&
      this.diagnostic.errors.every(
        (e) =>
          e.code === "INTERNAL_SERVER_ERROR" &&
          e.cause === "missing-required-field" &&
          e.path.length === 2 &&
          e.path[0] === "job" &&
          e.path[1] === "acceptedAt",
      )
    );
  }
}
