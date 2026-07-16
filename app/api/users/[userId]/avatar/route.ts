import { avatarRepository } from "@/lib/account/avatar-repository";
import { UuidSchema } from "@/lib/boards/contracts";
import { BoardApiError, handleApiError, invalidRequest } from "@/lib/boards/http";
import { getPrivateObjectStore } from "@/lib/storage/r2/private-object-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ userId: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const userId = UuidSchema.safeParse((await context.params).userId);
    if (!userId.success) throw invalidRequest();
    const user = await avatarRepository.get(userId.data);
    if (
      !user.avatarObjectKey ||
      !user.avatarContentHash ||
      !user.avatarMimeType ||
      !user.avatarByteSize
    ) {
      throw new BoardApiError(404, "not_found", "The requested resource was not found.");
    }
    const object = await getPrivateObjectStore().get({
      bucket: "avatars",
      key: user.avatarObjectKey,
    });
    return new Response(object.body, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
        "Content-Length": String(object.byteSize ?? user.avatarByteSize),
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Type": user.avatarMimeType,
        "Cross-Origin-Resource-Policy": "same-origin",
        ETag: `"sha256-${user.avatarContentHash}"`,
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
