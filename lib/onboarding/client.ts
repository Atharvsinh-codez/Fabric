import type { BoardDocument } from "@/db/schema/product";

type OnboardingResult = Readonly<{
  workspace: { id: string; name: string; role: "owner" };
  board: {
    id: string;
    workspaceId: string;
    title: string;
    revision: number;
    documentGenerationId: string;
    role: "owner";
  };
}>;

export async function submitOnboarding(input: {
  displayName: string;
  workspaceName: string;
  boardTitle: string;
  document: BoardDocument;
}): Promise<OnboardingResult> {
  const response = await fetch("/api/onboarding", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const result = (await response.json().catch(() => ({}))) as OnboardingResult & {
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(result.error?.message ?? "Fabric could not create the workspace.");
  }

  return result;
}
