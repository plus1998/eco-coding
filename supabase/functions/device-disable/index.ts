import { handleCors } from "../_shared/cors.ts";
import {
  disableDevice,
  parseDeviceKind,
  requireOwnedActiveDesktop,
  requireOwnedDevice,
  revokeBindingsForDesktop,
} from "../_shared/devices.ts";
import {
  errorResponse,
  HttpError,
  json,
  optionalString,
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
    const body = await readJsonObject(req);
    const deviceId = requireString(body, "deviceId");
    const deviceSecret = optionalString(body, "deviceSecret");
    const kind = parseDeviceKind(body.kind);

    const admin = createServiceClient();
    if (deviceSecret) {
      await requireOwnedDevice(admin, {
        userId: auth.user.id,
        deviceId,
        kind,
        deviceSecret,
      });
    } else if (kind === "desktop") {
      // Account-owner cleanup for lost / unreachable PCs (no device secret).
      await requireOwnedActiveDesktop(admin, {
        userId: auth.user.id,
        deviceId,
      });
    } else {
      throw new HttpError(
        400,
        "deviceSecret is required to disable a mobile device.",
        "invalid_request",
      );
    }

    const device = await disableDevice(admin, {
      userId: auth.user.id,
      deviceId,
    });

    if (kind === "desktop") {
      await revokeBindingsForDesktop(admin, {
        userId: auth.user.id,
        desktopDeviceId: deviceId,
      });
    }

    return json({ device });
  } catch (error) {
    return errorResponse(error);
  }
});
