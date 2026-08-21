import { handleCors } from "../_shared/cors.ts";
import { parseDeviceKind, registerDevice } from "../_shared/devices.ts";
import {
  errorResponse,
  json,
  optionalObject,
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
    const kind = parseDeviceKind(body.kind);
    const name = requireString(body, "name");
    const metadata = optionalObject(body, "metadata");

    const admin = createServiceClient();
    const registered = await registerDevice(admin, {
      userId: user.id,
      kind,
      name,
      ...(metadata ? { metadata } : {}),
    });

    // secret_hash is never returned; deviceSecret is one-shot.
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
