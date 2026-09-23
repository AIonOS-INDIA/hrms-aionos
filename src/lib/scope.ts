import { createContext, useContext } from "react";
import type { Company } from "@/lib/hrms";

export type ScopeValue = {
  companyId: string | null; // null = all entities (master only)
  setCompanyId: (id: string | null) => void;
  companies: Company[];
  companyById: (id: string) => Company | undefined;
  canSeeAll: boolean;
};

// Kept in a stable module (not AppShell) so hot reloads never create a
// second context instance, which would make useScope throw.
export const ScopeContext = createContext<ScopeValue | null>(null);

export function useScope() {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error("useScope must be used inside AppShell");
  return ctx;
}
