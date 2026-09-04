/**
 * Public one-shot extend: +7 days if still within the first 7-day window.
 */
import { handleCors } from "../_shared/cors.ts";
import {
  canExtendPage,
  HTML_PAGE_EXTEND_TTL_MS,
  isExpired,
  type HtmlPageRow,
} from "../_shared/html-pages.ts";
import {
  errorResponse,
  HttpError,
  json,
  readJsonObject,
  requireMethod,
  requireString,
} from "../_shared/http.ts";
import { createServiceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    requireMethod(req, "POST");
    const body = await readJsonObject(req);
    const slug = requireString(body, "slug");

    const admin = createServiceClient();
    const { data, error } = await admin.from("html_pages").select("*").eq("slug", slug).maybeSingle();
    if (error) {
      throw new HttpError(500, error.message, "db_error");
    }
    if (!data) {
      throw new HttpError(404, "HTML page not found.", "not_found");
    }

    const page = data as HtmlPageRow;
    if (isExpired(page.expires_at)) {
      throw new HttpError(410, "HTML page has expired.", "expired");
    }
    if (!canExtendPage(page)) {
      throw new HttpError(409, "Extend is not available for this page.", "extend_unavailable");
    }

    const nextExpires = new Date(Date.parse(page.expires_at) + HTML_PAGE_EXTEND_TTL_MS).toISOString();
    const extendedAt = new Date().toISOString();
    const { data: updated, error: updateError } = await admin
      .from("html_pages")
      .update({ expires_at: nextExpires, extended_at: extendedAt })
      .eq("id", page.id)
      .is("extended_at", null)
      .select("*")
      .single();

    if (updateError || !updated) {
      throw new HttpError(409, updateError?.message ?? "Extend conflict.", "extend_unavailable");
    }

    const row = updated as HtmlPageRow;
    return json({
      pageId: row.id,
      slug: row.slug,
      expiresAt: row.expires_at,
      extendedAt: row.extended_at,
      canExtend: false,
    });
  } catch (error) {
    return errorResponse(error);
  }
});
