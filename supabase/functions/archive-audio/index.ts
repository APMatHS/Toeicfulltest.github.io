import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...cors, "Content-Type": "application/json" }
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

function readSupabaseKey(mapName: string, legacyName: string) {
  const legacy = Deno.env.get(legacyName);
  if (legacy) return legacy;
  const raw = Deno.env.get(mapName);
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return parsed.default || Object.values(parsed)[0] || "";
  } catch {
    return raw;
  }
}

function archiveCredentials() {
  return {
    access: Deno.env.get("ARCHIVE_ACCESS_KEY") || "",
    secret: Deno.env.get("ARCHIVE_SECRET_KEY") || ""
  };
}

function archiveIdentifier(testId: string) {
  const url = Deno.env.get("SUPABASE_URL") || "";
  let project = "toeic";
  try {
    project = new URL(url).hostname.split(".")[0] || "toeic";
  } catch {}
  return ("toeic-" + project.replace(/[^A-Za-z0-9._-]/g, "") + "-" + testId.replace(/-/g, "")).toLowerCase();
}

function audioExtension(filename: string, mime: string) {
  const match = String(filename || "").toLowerCase().match(/\.(mp3|m4a|wav|aac|ogg)$/);
  if (match) return "." + match[1];
  const map: Record<string, string> = {
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/wav": ".wav",
    "audio/aac": ".aac",
    "audio/ogg": ".ogg"
  };
  return map[mime] || ".mp3";
}

function archivePath(identifier: string, filename: string) {
  return "archive:" + identifier + "/" + filename;
}

function parseArchivePath(path: string | null | undefined) {
  const raw = String(path || "");
  if (!raw.startsWith("archive:")) return null;
  const rest = raw.slice("archive:".length);
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) return null;
  const identifier = rest.slice(0, slash);
  const filename = rest.slice(slash + 1);
  if (!/^[A-Za-z0-9._-]+$/.test(identifier) || filename.includes("..")) return null;
  return { identifier, filename };
}

function encodedFile(filename: string) {
  return filename.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

function archiveObjectUrl(identifier: string, filename: string) {
  return "https://s3.us.archive.org/" + encodeURIComponent(identifier) + "/" + encodedFile(filename);
}

function archivePublicUrl(identifier: string, filename: string) {
  return "https://archive.org/download/" + encodeURIComponent(identifier) + "/" + encodedFile(filename);
}

async function archiveFetch(url: string, init: RequestInit, retries = 3) {
  let last: Response | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    let current = url;
    for (let redirects = 0; redirects < 5; redirects++) {
      const res = await fetch(current, { ...init, redirect: "manual" });
      last = res;
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers.get("location");
        if (!location) break;
        current = new URL(location, current).toString();
        continue;
      }
      break;
    }
    if (last && ![429, 503].includes(last.status)) return last;
    await sleep(900 * Math.pow(2, attempt));
  }
  if (!last) throw new Error("Archive request failed before receiving a response");
  return last;
}

async function deleteArchiveFile(path: string, access: string, secret: string) {
  const parsed = parseArchivePath(path);
  if (!parsed || !access || !secret) return null;
  const res = await archiveFetch(archiveObjectUrl(parsed.identifier, parsed.filename), {
    method: "DELETE",
    headers: {
      "Authorization": "LOW " + access + ":" + secret,
      "x-archive-cascade-delete": "1",
      "x-archive-queue-derive": "0"
    }
  }, 2);
  if (res.ok || res.status === 404) return null;
  return "Archive cleanup HTTP " + res.status;
}

async function cleanupOldMedia(admin: any, path: string | null, access: string, secret: string, excludeTestId: string) {
  if (!path) return null;
  const { count, error: refError } = await admin.from("tests")
    .select("id", { count: "exact", head: true })
    .eq("listening_audio_storage_path", path)
    .neq("id", excludeTestId);
  if (refError) return "Không kiểm tra được tham chiếu audio cũ: " + refError.message;
  if ((count || 0) > 0) return null;
  if (path.startsWith("archive:")) {
    if (!access || !secret) return "Thiếu Archive.org secret nên chưa dọn được file cũ";
    return await deleteArchiveFile(path, access, secret);
  }
  if (path.startsWith("static:") || /^https?:\/\//i.test(path)) return null;
  const { error } = await admin.storage.from("test-media").remove([path]);
  return error?.message || null;
}

async function archiveReady(identifier: string, filename: string) {
  const url = archivePublicUrl(identifier, filename);
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (res.ok) return true;
    } catch {}
    await sleep(700 * (i + 1));
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const publishableKey = readSupabaseKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  const secretKey = readSupabaseKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !publishableKey || !secretKey) {
    return json({ error: "Supabase server configuration missing" }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return json({ error: "Unauthorized" }, 401);

  const { data: profile } = await admin.from("profiles")
    .select("role,is_active")
    .eq("id", user.id)
    .single();
  if (!profile?.is_active || !["teacher", "system_admin"].includes(profile.role)) {
    return json({ error: "Forbidden" }, 403);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const action = String(body?.action || "");
  const testId = String(body?.test_id || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(testId)) {
    return json({ error: "Invalid test_id" }, 400);
  }

  const { data: test, error: testError } = await userClient.from("tests")
    .select("id,test_kind,content_locked_at,listening_audio_storage_path,listening_audio_filename")
    .eq("id", testId)
    .single();
  if (testError || !test) return json({ error: "Test not found or not accessible" }, 404);
  if (test.content_locked_at) {
    return json({ error: "Nội dung đề đã khóa vì đã có sinh viên bắt đầu." }, 409);
  }

  const creds = archiveCredentials();

  if (action === "remove") {
    const { error } = await userClient.rpc("staff_set_listening_audio_v118b", {
      p_test_id: testId,
      p_storage_path: null,
      p_filename: null,
      p_duration_seconds: null
    });
    if (error) return json({ error: error.message }, 400);
    const warning = await cleanupOldMedia(admin, test.listening_audio_storage_path, creds.access, creds.secret, testId);
    return json({ ok: true, cleanup_warning: warning || null });
  }

  if (action !== "upload") return json({ error: "Unknown action" }, 400);
  if (!["listening", "full"].includes(String(test.test_kind || ""))) {
    return json({ error: "Reading test does not use Listening audio" }, 400);
  }
  if (!creds.access || !creds.secret) {
    return json({ error: "Archive.org secrets are missing on Supabase" }, 500);
  }

  const stagingPath = String(body?.storage_path || "");
  const requiredPrefix = "tests/" + testId + "/archive-staging/";
  if (!stagingPath.startsWith(requiredPrefix) || stagingPath.includes("..")) {
    return json({ error: "Invalid staging path" }, 400);
  }

  const sourceName = String(body?.filename || "listening.mp3").slice(0, 240);
  const durationRaw = body?.duration_seconds;
  const duration = durationRaw == null || durationRaw === "" ? null : Number(durationRaw);
  if (duration != null && (!Number.isFinite(duration) || duration < 0)) {
    return json({ error: "Invalid duration" }, 400);
  }

  const { data: blob, error: downloadError } = await admin.storage.from("test-media").download(stagingPath);
  if (downloadError || !blob) {
    return json({ error: downloadError?.message || "Không đọc được file audio tạm." }, 400);
  }
  if (blob.size <= 0 || blob.size > MAX_AUDIO_BYTES) {
    return json({ error: "Audio staging file is empty or exceeds 50 MB" }, 400);
  }
  if (blob.type && !blob.type.startsWith("audio/")) {
    return json({ error: "Staging file is not audio" }, 400);
  }

  const identifier = archiveIdentifier(testId);
  const extension = audioExtension(sourceName, blob.type || "");
  const archiveFilename = "listening-" + Date.now() + "-" + crypto.randomUUID().slice(0, 8) + extension;
  const objectUrl = archiveObjectUrl(identifier, archiveFilename);
  const headers = new Headers({
    "Authorization": "LOW " + creds.access + ":" + creds.secret,
    "Content-Type": blob.type || "audio/mpeg",
    "x-archive-auto-make-bucket": "1",
    "x-archive-meta01-collection": "opensource_audio",
    "x-archive-meta-mediatype": "audio",
    "x-archive-meta-language": "eng",
    "x-archive-meta-title": "TOEIC Listening " + testId,
    "x-archive-queue-derive": "0",
    "x-archive-interactive-priority": "1"
  });

  let uploadResponse: Response;
  try {
    uploadResponse = await archiveFetch(objectUrl, {
      method: "PUT",
      headers,
      body: blob
    }, 4);
  } catch (err) {
    return json({
      error: "Archive upload failed: " + (err instanceof Error ? err.message : String(err))
    }, 502);
  }

  if (!uploadResponse.ok) {
    const detail = (await uploadResponse.text().catch(() => "")).slice(0, 500);
    return json({
      error: "Archive upload HTTP " + uploadResponse.status + (detail ? ": " + detail : "")
    }, 502);
  }

  const storedPath = archivePath(identifier, archiveFilename);
  const ready = await archiveReady(identifier, archiveFilename);
  const { error: setError } = await userClient.rpc("staff_set_listening_audio_v118b", {
    p_test_id: testId,
    p_storage_path: storedPath,
    p_filename: sourceName || "Audio Listening Part 1-4",
    p_duration_seconds: duration
  });

  if (setError) {
    await deleteArchiveFile(storedPath, creds.access, creds.secret).catch(() => null);
    return json({ error: setError.message }, 409);
  }

  const { error: stagingCleanupError } = await admin.storage.from("test-media").remove([stagingPath]);
  const oldCleanup = test.listening_audio_storage_path && test.listening_audio_storage_path !== storedPath
    ? await cleanupOldMedia(admin, test.listening_audio_storage_path, creds.access, creds.secret, testId)
    : null;

  return json({
    ok: true,
    storage_path: storedPath,
    archive_identifier: identifier,
    archive_filename: archiveFilename,
    archive_url: archivePublicUrl(identifier, archiveFilename),
    archive_ready: ready,
    cleanup_warning: oldCleanup || stagingCleanupError?.message || null
  });
});
