import { handleCors } from "../_shared/cors.ts";
import { disableDevice } from "../_shared/devices.ts";
import {
  errorResponse,
  json,
  readJsonObject,
  requireMethod,
  requireString,
} from "../_shared/http.ts";
import { createServiceClient, requireUser } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    requireMethod(req, "POST");
    const user = await requireUser(req);
    const body = await readJsonObject(req);
    const deviceId = requireString(body, "deviceId");

    const admin = createServiceClient();
    const device = await disableDevice(admin, {
      userId: user.id,
      deviceId,
    });

    return json({ device });
  } catch (error) {
    return errorResponse(error);
  }
});
