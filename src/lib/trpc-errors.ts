export function isExpectedTRPCError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    (error as { data?: { code?: string } }).data?.code === "TOO_MANY_REQUESTS"
  );
}

export function isGenerationCancelledTRPCError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    (error as { data?: { code?: string } }).data?.code === "NOT_FOUND" &&
    "message" in error &&
    (error as { message?: string }).message === "Generation cancelled"
  );
}
