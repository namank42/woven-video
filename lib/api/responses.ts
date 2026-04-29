export function apiError(
  message: string,
  status = 400,
  code = "bad_request",
) {
  return Response.json(
    {
      error: {
        message,
        type: code,
        code,
      },
    },
    { status },
  );
}

export function unauthorizedError(message = "Missing or invalid bearer token.") {
  return apiError(message, 401, "unauthorized");
}
