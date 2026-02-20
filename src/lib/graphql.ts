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
    if (typeof window !== "undefined") {
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
    throw new Error("Unauthorized");
  }

  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data as T;
}
