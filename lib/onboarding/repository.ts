import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db/clients/web";
import { users } from "@/db/schema/auth";
import {
  boards,
  projectMemberships,
  projects,
  workspaceMemberships,
  workspaces,
} from "@/db/schema/product";
import { prepareNewBoardDocument } from "@/lib/boards/canvas-document";
import type { CompleteOnboardingInput } from "@/lib/onboarding/contracts";

export async function completeOnboarding(
  userId: string,
  input: CompleteOnboardingInput,
) {
  return db.transaction(async (transaction) => {
    await transaction
      .update(users)
      .set({ name: input.displayName, updatedAt: new Date() })
      .where(eq(users.id, userId));

    const [workspace] = await transaction
      .insert(workspaces)
      .values({ name: input.workspaceName, createdBy: userId })
      .returning();
    if (!workspace) throw new Error("Workspace creation returned no row.");

    await transaction.insert(workspaceMemberships).values({
      workspaceId: workspace.id,
      userId,
      role: "owner",
    });

    const [defaultProject] = await transaction
      .insert(projects)
      .values({
        workspaceId: workspace.id,
        name: "Unfiled",
        icon: "folder",
        defaultSharingPolicy: "workspace",
        isDefault: true,
        createdBy: userId,
      })
      .returning({ id: projects.id });
    if (!defaultProject) throw new Error("Default project creation returned no row.");
    await transaction.insert(projectMemberships).values({
      workspaceId: workspace.id,
      projectId: defaultProject.id,
      userId,
      role: "editor",
    });

    const [board] = await transaction
      .insert(boards)
      .values({
        workspaceId: workspace.id,
        projectId: defaultProject.id,
        ownerId: userId,
        title: input.boardTitle,
        document: prepareNewBoardDocument(input.document, input.theme),
        createdBy: userId,
      })
      .returning();
    if (!board) throw new Error("Board creation returned no row.");

    return {
      workspace: { ...workspace, role: "owner" as const },
      board: { ...board, role: "owner" as const },
    };
  });
}
