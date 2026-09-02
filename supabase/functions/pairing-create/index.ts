import { handleCors } from "../_shared/cors.ts";
import { errorResponse, json, readJsonObject, requireMethod, requireString } from "../_shared/http.ts";
import { createPairingSession } from "../_shared/pairing.ts";
import { createServiceClient, requireUser } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    requireMethod(req, "POST");
    const user = await requireUser(req);
    const body = await readJsonObject(req);
    const desktopDeviceId = requireString(body, "desktopDeviceId");
    const deviceSecret = requireString(body, "deviceSecret");

    const admin = createServiceClient();
    const created = await createPairingSession(admin, {
      userId: user.id,
      desktopDeviceId,
      deviceSecret,
    });

    // code_hash / bootstrap_token_hash stay server-side only.
    return json({
      pairingId: created.pairingId,
      code: created.code,
      bootstrapToken: created.bootstrapToken,
      expiresAt: created.expiresAt,
      qrPayload: created.qrPayload,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
