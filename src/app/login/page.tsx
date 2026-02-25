"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { gql } from "@/lib/graphql";
import { LOGIN_MUTATION } from "@/lib/queries";

interface LoginResponse {
  loginUser: {
    token: string;
    user: {
      _id: string;
      email: string;
      role: string;
      firstname: string;
      lastname: string;
    };
  };
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const data = await gql<LoginResponse>(LOGIN_MUTATION, {
        email,
        password,
      });
      localStorage.setItem("token", data.loginUser.token);
      localStorage.setItem("me", JSON.stringify(data.loginUser.user));

      // Warm jobs caches immediately after login so first Jobs screen is snappier.
      const warm = async (stage: "LEAD" | "QUOTE") => {
        try {
          const res = await fetch("https://api.insulhub.nz/graphql", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-access-token": data.loginUser.token,
            },
            body: JSON.stringify({
              query: `query Jobs($stages:[JobStage!],$skip:Int,$limit:Int){jobs(stages:$stages,skip:$skip,limit:$limit){total results{_id jobNumber stage createdAt updatedAt archivedAt lead{leadStatus allocatedTo{_id firstname lastname} callbackDate quoteBookingDate} quote{quoteNumber date status deferralDate c_total} client{contactDetails{name email phoneMobile streetAddress suburb city postCode}}}}}`,
              variables: { stages: [stage], skip: 0, limit: 5000 },
            }),
          });
          const json = await res.json();
          const jobs = (json?.data?.jobs?.results || []).filter((j: { archivedAt?: string }) => !j.archivedAt);
          const total = json?.data?.jobs?.total || jobs.length;
          const payload = JSON.stringify({ jobs, total, ts: Date.now() });
          sessionStorage.setItem(`jobs-cache:${stage}`, payload);
        } catch {
          // best effort only
        }
      };
      void warm("LEAD");
      void warm("QUOTE");

      router.push("/jobs");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-[#1a3a4a] px-4 py-5 text-center">
        <p className="text-white text-sm font-semibold tracking-wide">InsulMAX</p>
        <p className="text-[#e85d04] text-2xl font-bold tracking-widest">
          INSULHUB
        </p>
      </div>

      {/* Form */}
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-md p-6">
          <h1 className="text-xl font-bold text-gray-800 mb-1">Sign in</h1>
          <p className="text-sm text-gray-500 mb-6">
            Use your InsulHub credentials
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full border border-gray-200 rounded-lg px-3 py-3 text-gray-900 text-base focus:outline-none focus:ring-2 focus:ring-[#e85d04] focus:border-transparent"
                placeholder="you@insulmax.co.nz"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full border border-gray-200 rounded-lg px-3 py-3 text-gray-900 text-base focus:outline-none focus:ring-2 focus:ring-[#e85d04] focus:border-transparent"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#e85d04] hover:bg-[#d45403] disabled:bg-gray-300 text-white font-semibold py-3 rounded-lg transition-colors text-base"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
