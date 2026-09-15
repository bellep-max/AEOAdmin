// Run against a dedicated test AEO API with a seeded owner and active keyword.
// TEST_API_URL, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD, EXECUTOR_TOKEN, TEST_KEYWORD_ID.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
const base = process.env.TEST_API_URL ?? "http://localhost:8100";
const keywordId = Number(process.env.TEST_KEYWORD_ID ?? 1);
let cookie = "";
const token = process.env.EXECUTOR_TOKEN;
assert.ok(
  token && process.env.TEST_ADMIN_PASSWORD,
  "Test credentials required",
);
async function request(
  path,
  {
    body,
    worker,
    auth = "owner",
    method = body === undefined ? "GET" : "POST",
    status = 200,
    headers = {},
  } = {},
) {
  const r = await fetch(base + "/api" + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(auth === "owner"
        ? { Cookie: cookie }
        : auth === "worker"
          ? { "X-Executor-Token": token, "X-Worker-Id": worker }
          : {}),
      ...headers,
    },
    body:
      body === undefined
        ? undefined
        : Buffer.isBuffer(body)
          ? body
          : JSON.stringify(body),
  });
  assert.equal(
    r.status,
    status,
    `${method} ${path}: ${await (r.status === status ? Promise.resolve("") : r.text())}`,
  );
  return r;
}
const login = await request("/auth/login", {
  auth: "none",
  body: {
    email: process.env.TEST_ADMIN_EMAIL,
    password: process.env.TEST_ADMIN_PASSWORD,
  },
});
cookie = login.headers.get("set-cookie").split(";")[0];
await request("/executions", { auth: "none", status: 401 });
await request("/executions/worker/heartbeat", {
  auth: "none",
  body: {},
  status: 401,
});
const suffix = randomUUID().slice(0, 8),
  w1 = "test-a-" + suffix,
  w2 = "test-b-" + suffix;
const s1 = `adb-TEST${suffix}-alias1._adb-tls-connect._tcp`,
  s2 = `adb-TEST${suffix}-alias2._adb-tls-connect._tcp`;
for (const [worker, serial] of [
  [w1, s1],
  [w2, s2],
])
  await request("/executions/worker/heartbeat", {
    auth: "worker",
    body: {
      workerId: worker,
      devices: [serial],
      modes: worker === w1 ? ["voice"] : ["voice", "type"],
    },
  });
async function queue(worker, serial, mode = "voice") {
  return (
    await request("/executions", {
      body: {
        keywordId,
        mode,
        platform: "bing",
        workerId: worker,
        deviceSerial: serial,
      },
      status: 201,
    })
  ).json();
}
async function claim(worker, status = 200) {
  const r = await request("/executions/worker/claim", {
    auth: "worker",
    body: { workerId: worker },
    status,
  });
  return status === 204 ? null : r.json();
}
await request("/executions", {
  body: {
    keywordId,
    mode: "type",
    platform: "bing",
    workerId: w1,
    deviceSerial: s1,
  },
  status: 409,
});
const voice = await queue(w1, s1),
  typed = await queue(w2, s2, "type");
const claims = await Promise.all([claim(w1), claim(w1)]);
assert.ok(claims.every((x) => x.id === voice.id));
await claim(w2, 204); // mDNS aliases share the same hardware lease, across Type/Voice.
const wav = Buffer.from("RIFF-test-wave-evidence");
const bundle = {
  version: 1,
  request_id: voice.id,
  mode: "voice",
  platform: "bing",
  status: "success",
  exact: true,
  recognized: voice.request.phrase,
  result: {
    voice_trace: {
      attempts: [{ id: 1, voice: "Samantha", engine: "say", rate_wpm: 175 }],
    },
    answer_state: "complete",
  },
  artifacts: [
    {
      path: "audio.wav",
      content_type: "audio/wav",
      size: wav.length,
      sha256: createHash("sha256").update(wav).digest("hex"),
    },
  ],
};
const finish = (worker, bundle, status = 200) =>
  request("/executions/" + bundle.request_id + "/finish", {
    auth: "worker",
    body: { workerId: worker, bundle },
    status,
  });
await finish(w2, bundle, 404);
await finish(w1, bundle);
await finish(w1, bundle);
await finish(w1, { ...bundle, recognized: "changed" }, 409);
const put = (body, worker = w1, status = 200) =>
  request(`/executions/${voice.id}/artifacts/1`, {
    auth: "worker",
    worker,
    method: "PUT",
    body,
    status,
    headers: { "Content-Type": "audio/wav" },
  });
await put(Buffer.from("bad"), w1, 409);
await put(wav, w2, 404);
await put(wav);
await put(wav);
await request(`/executions/${voice.id}/artifacts/1`, {
  auth: "none",
  status: 401,
});
const downloaded = await request(`/executions/${voice.id}/artifacts/1`);
assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), wav);
const range = await request(`/executions/${voice.id}/artifacts/1`, {
  headers: { Range: "bytes=0-3" },
  status: 206,
});
assert.equal(await range.text(), "RIFF");
await request(`/executions/${voice.id}/artifacts/1`, {
  headers: { Range: "bytes=999-" },
  status: 416,
});
assert.equal((await claim(w2)).id, typed.id);
await finish(w2, {
  ...bundle,
  request_id: typed.id,
  mode: "type",
  artifacts: [],
});
const wrong = await queue(w1, s1);
await claim(w1);
await finish(w1, {
  ...bundle,
  request_id: wrong.id,
  exact: false,
  artifacts: [],
});
assert.equal(
  (await (await request("/executions/" + wrong.id)).json()).status,
  "error",
);
const cancelled = await queue(w1, s1);
await request("/executions/" + cancelled.id + "/cancel", { body: {} });
await claim(w1, 204);
const detail = await (await request("/executions/" + voice.id)).json();
assert.equal(detail.status, "success");
assert.equal(detail.artifacts[0].uploaded, true);
assert.equal(detail.result.result.voice_trace.attempts[0].voice, "Samantha");
await request("/executions/not-a-uuid/cancel", { body: {}, status: 400 });
console.log(
  "PASS: authentication, capabilities, Type/Voice hardware serialization, restart, immutable completion, exactness, cancellation, evidence checksum, authorization and range download.",
);
