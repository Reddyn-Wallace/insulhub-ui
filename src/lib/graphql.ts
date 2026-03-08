function forceLogout() {
  if (typeof window !== "undefined") {
    localStorage.removeItem("token");
    localStorage.removeItem("me");
    window.location.href = "/login";
  }
}

function isUnauthenticatedMessage(message?: string) {
  const text = (message || "").toLowerCase();
  return text.includes("unauthenticated") || text.includes("unauthorized");
}

export async function gql<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;

  const res = await fetch("https://api.insulhub.nz/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-access-token": token } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });

  if (res.status === 401) {
    forceLogout();
    throw new Error("Unauthorized");
  }

  const json = await res.json();
  if (json.errors?.length) {
    const message = json.errors[0]?.message || "Request failed";
    if (isUnauthenticatedMessage(message)) {
      forceLogout();
      throw new Error("Unauthorized");
    }
    throw new Error(message);
  }
  return json.data as T;
}
