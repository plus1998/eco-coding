import { ensureDeviceBinding } from "../_shared/bindings.ts";
import { handleCors } from "../_shared/cors.ts";
import { errorResponse, json, readJsonObject, requireMethod, requireString } from "../_shared/http.ts";
import { createServiceClient, requireUser } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    requireMethod(req, "POST");
    const user = await requireUser(req);
    const body = await readJsonObject(req);
    const mobileDeviceId = requireString(body, "mobileDeviceId");
    const deviceSecret = requireString(body, "deviceSecret");
    const desktopDeviceId = requireString(body, "desktopDeviceId");

    const admin = createServiceClient();
    const ensured = await ensureDeviceBinding(admin, {
      userId: user.id,
      mobileDeviceId,
      deviceSecret,
      desktopDeviceId,
    });

    return json({
      binding: ensured.binding,
      desktopDeviceId: ensured.desktopDeviceId,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
