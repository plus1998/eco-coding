import { handleCors } from "../_shared/cors.ts";
import { disableDevice, parseDeviceKind, requireOwnedDevice } from "../_shared/devices.ts";
import { errorResponse, json, readJsonObject, requireMethod, requireString } from "../_shared/http.ts";
import { createServiceClient, requireAuthSession } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    requireMethod(req, "POST");
    const auth = await requireAuthSession(req);
    const body = await readJsonObject(req);
    const deviceId = requireString(body, "deviceId");
    const deviceSecret = requireString(body, "deviceSecret");
    const kind = parseDeviceKind(body.kind);

    const admin = createServiceClient();
    await requireOwnedDevice(admin, {
      userId: auth.user.id,
      deviceId,
      kind,
      deviceSecret,
    });
    const device = await disableDevice(admin, {
      userId: auth.user.id,
      deviceId,
    });

    return json({ device });
  } catch (error) {
    return errorResponse(error);
  }
});
