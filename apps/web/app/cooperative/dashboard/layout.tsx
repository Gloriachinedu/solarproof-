import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export default async function CooperativeDashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login?callbackUrl=/cooperative/dashboard");
  }

  if (session.user.role !== "COOPERATIVE_ADMIN") {
    redirect("/dashboard");
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 sm:text-3xl">
          Cooperative Dashboard
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Aggregate performance across all meters in your cooperative.
        </p>
      </header>
      <main className="flex flex-col gap-6">{children}</main>
    </div>
  );
}
