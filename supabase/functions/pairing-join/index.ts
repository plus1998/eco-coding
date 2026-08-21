import { handleCors } from "../_shared/cors.ts";
import {
  errorResponse,
  json,
  optionalObject,
  readJsonObject,
  requireMethod,
  requireString,
} from "../_shared/http.ts";
import { joinPairingSession } from "../_shared/pairing.ts";
import { createServiceClient, requireUser } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    requireMethod(req, "POST");
    const user = await requireUser(req);
    const body = await readJsonObject(req);
    const code = requireString(body, "code");
    const bootstrapToken = requireString(body, "bootstrapToken");
    const mobileDeviceId = requireString(body, "mobileDeviceId");
    const deviceSecret = requireString(body, "deviceSecret");
    const metadata = optionalObject(body, "metadata");
    const deviceName =
      typeof body.deviceName === "string" && body.deviceName.trim()
        ? body.deviceName.trim()
        : undefined;

    const admin = createServiceClient();
    const joined = await joinPairingSession(admin, {
      userId: user.id,
      mobileDeviceId,
      deviceSecret,
      code,
      bootstrapToken,
      ...(deviceName ? { deviceName } : {}),
      ...(metadata ? { metadata } : {}),
    });

    return json({
      pairingId: joined.pairingId,
      device: joined.device,
      binding: joined.binding,
      desktopDeviceId: joined.desktopDeviceId,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
