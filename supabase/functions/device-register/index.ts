import { handleCors } from "../_shared/cors.ts";
import { parseDeviceKind, registerDevice } from "../_shared/devices.ts";
import {
  errorResponse,
  HttpError,
  json,
  optionalObject,
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
    const user = auth.user;
    const body = await readJsonObject(req);
    const kind = parseDeviceKind(body.kind);
    const name = requireString(body, "name");
    const metadata = optionalObject(body, "metadata");
    if (!auth.sessionId) {
      throw new HttpError(401, "User session does not contain session_id.", "session_id_missing");
    }

    const admin = createServiceClient();
    const registered = await registerDevice(admin, {
      sessionId: auth.sessionId,
      userId: user.id,
      kind,
      name,
      ...(metadata ? { metadata } : {}),
    });

    // secret_hash is never returned; deviceSecret is one-shot. The database
    // creates the device and binds this Auth session in one transaction.
    return json(
      {
        device: registered.device,
        deviceSecret: registered.deviceSecret,
      },
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
});
