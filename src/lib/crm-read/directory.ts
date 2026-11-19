import { gql } from "@/lib/graphql";
import { USERS_QUERY } from "@/lib/queries";
import { loadCrmRead, recentCrmRead } from "./client";

type DirectoryUser = { _id: string; firstname: string; lastname: string; email: string; role?: string };

export async function loadSalesDirectory(token: string) {
  const cached = await recentCrmRead<DirectoryUser[]>("staff", "sales", token);
  if (cached) return cached.data;
  return (await loadCrmRead("staff", "sales", token, async () => {
    const { users } = await gql<{ users: { results: DirectoryUser[] } }>(USERS_QUERY, undefined, { token });
    return users.results.filter(user => user.role?.toUpperCase() !== "INSTALLER");
  })).data;
}
