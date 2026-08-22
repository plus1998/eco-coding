import { handleCors } from "../_shared/cors.ts";
import { requireOwnedDevice } from "../_shared/devices.ts";
import {
  errorResponse,
  HttpError,
  json,
  readJsonObject,
  requireMethod,
  requireString,
} from "../_shared/http.ts";
import { createServiceClient, requireAuthSession } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    requireMethod(req, "POST");
    const auth = await requireAuthSession(req);
    if (!auth.sessionId) {
      throw new HttpError(401, "User session does not contain session_id.", "session_id_missing");
    }

    const body = await readJsonObject(req);
    const deviceId = requireString(body, "deviceId");
    const deviceSecret = requireString(body, "deviceSecret");
    const kind = requireString(body, "kind");
    if (kind !== "desktop" && kind !== "mobile") {
      throw new HttpError(400, "kind must be desktop or mobile.", "invalid_request");
    }

    const admin = createServiceClient();
    const device = await requireOwnedDevice(admin, {
      userId: auth.user.id,
      deviceId,
      kind,
      deviceSecret,
    });

    const now = new Date().toISOString();
    const { data: verifiedAt, error } = await admin.rpc("eco_bind_device_session", {
      p_session_id: auth.sessionId,
      p_user_id: auth.user.id,
      p_device_id: device.id,
      p_verified_at: now,
    });
    if (error) {
      console.error("device session bind failed", error);
      throw new HttpError(409, "Failed to authorize device session.", "device_session_register_failed");
    }

    return json({
      sessionId: auth.sessionId,
      deviceId: device.id,
      verifiedAt: typeof verifiedAt === "string" ? verifiedAt : now,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
