import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rawFetch } from "@/lib/period-comparison";
import { useAuth } from "@/lib/auth";

const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
async function api(path: string, body?: unknown) {
  const r = await rawFetch(
    "/api/executions" + path,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Request failed");
  return data;
}
const selectStyle = "h-10 w-full rounded-md border bg-background px-3 text-sm";
export default function RankingExecutions() {
  const { isOwner } = useAuth();
  const cache = useQueryClient();
  const [mode, setMode] = useState("voice"),
    [platform, setPlatform] = useState("copilot"),
    [workerId, setWorker] = useState(""),
    [serial, setSerial] = useState("");
  const [keywordId, setKeyword] = useState(""),
    [phrase, setPhrase] = useState(""),
    [proxy, setProxy] = useState(false),
    [target, setTarget] = useState("country-PH");
  const [voice, setVoice] = useState("say"),
    [realistic, setRealistic] = useState(false),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const workers = useQuery({
    queryKey: ["execution-workers"],
    queryFn: () => api("/workers"),
    refetchInterval: 10000,
    enabled: isOwner,
  });
  const jobs = useQuery({
    queryKey: ["executions", filter],
    queryFn: () => api(filter ? "?mode=" + filter : ""),
    refetchInterval: 5000,
    enabled: isOwner,
  });
  const detail = useQuery({
    queryKey: ["execution", selected],
    queryFn: () => api("/" + selected),
    enabled: !!selected && isOwner,
    refetchInterval: 5000,
  });
  const keywords = useQuery({
    queryKey: ["execution-keywords"],
    queryFn: async () => {
      const r = await rawFetch("/api/keywords");
      if (!r.ok) throw new Error("Cannot load keywords");
      return r.json();
    },
    enabled: isOwner,
  });
  if (!isOwner) return <p>Owner access is required.</p>;
  const available = (workers.data ?? []).filter(
    (w: any) => w.online && w.modes.includes(mode),
  );
  const worker = available.find((w: any) => w.id === workerId);
  const activeError =
    error ||
    workers.error?.message ||
    jobs.error?.message ||
    detail.error?.message ||
    keywords.error?.message;
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const j = await api("", {
        keywordId: Number(keywordId),
        mode,
        platform,
        workerId,
        deviceSerial: serial,
        phrase: phrase.trim() || undefined,
        proxy: { enabled: proxy, target, rounds: 1 },
        voice: { engine: voice, realistic },
      });
      setSelected(j.id);
      await cache.invalidateQueries({ queryKey: ["executions"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const d = detail.data,
    trace = d?.result?.result?.voice_trace;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Ranking executions</h1>
        <p className="text-sm text-muted-foreground">
          Run an audit through an available worker and review its evidence.
        </p>
      </div>
      {activeError && (
        <p role="alert" className="text-destructive">
          {activeError}
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Run audit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <label>
              Mode
              <select
                aria-label="Mode"
                className={selectStyle}
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value);
                  setWorker("");
                  setSerial("");
                }}
              >
                <option value="type">Type</option>
                <option value="voice">Voice</option>
              </select>
            </label>
            <label>
              Platform
              <select
                aria-label="Platform"
                className={selectStyle}
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
              >
                {["chatgpt", "gemini", "copilot", "bing"].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <label>
              Keyword
              <select
                aria-label="Keyword"
                className={selectStyle}
                value={keywordId}
                onChange={(e) => {
                  setKeyword(e.target.value);
                  setPhrase("");
                }}
              >
                <option value="">Select a keyword</option>
                {(keywords.data ?? [])
                  .filter((k: any) => k.isActive !== false)
                  .map((k: any) => (
                    <option value={k.id} key={k.id}>
                      {k.keywordText} · {k.clientName ?? k.clientId}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Worker
              <select
                aria-label="Worker"
                className={selectStyle}
                value={workerId}
                onChange={(e) => {
                  setWorker(e.target.value);
                  setSerial("");
                }}
              >
                <option value="">Select an online worker</option>
                {available.map((w: any) => (
                  <option key={w.id}>{w.id}</option>
                ))}
              </select>
            </label>
            <label>
              Phone
              <select
                aria-label="Phone"
                className={selectStyle}
                value={serial}
                onChange={(e) => setSerial(e.target.value)}
              >
                <option value="">Select a phone</option>
                {(worker?.devices ?? []).map((s: string) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            {mode === "voice" && (
              <label>
                Voice engine
                <select
                  aria-label="Voice engine"
                  className={selectStyle}
                  value={voice}
                  onChange={(e) => setVoice(e.target.value)}
                >
                  <option value="say">macOS voice</option>
                  <option value="kokoro">Kokoro</option>
                </select>
              </label>
            )}
          </div>
          {!available.length && (
            <p className="text-sm text-muted-foreground">
              No online worker supports {mode === "voice" ? "Voice" : "Type"}.
              The existing typed audit runner remains available through its
              current workflow.
            </p>
          )}
          <label className="block">
            Prompt override (optional)
            <Input
              aria-label="Prompt override"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder="Use the keyword as the prompt"
            />
          </label>
          <div className="flex flex-wrap gap-4 items-center">
            <label>
              <input
                type="checkbox"
                checked={proxy}
                onChange={(e) => setProxy(e.target.checked)}
              />{" "}
              Use proxy
            </label>
            {proxy && (
              <label>
                Proxy target
                <Input
                  aria-label="Proxy target"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                />
              </label>
            )}
            {mode === "voice" && (
              <label>
                <input
                  type="checkbox"
                  checked={realistic}
                  onChange={(e) => setRealistic(e.target.checked)}
                />{" "}
                Vary the voice
              </label>
            )}
          </div>
          <Button
            onClick={submit}
            disabled={
              busy || !keywordId || !worker || !worker.devices.includes(serial)
            }
          >
            {busy ? "Queueing…" : "Queue audit"}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Executions</CardTitle>
        </CardHeader>
        <CardContent>
          <select
            aria-label="Filter mode"
            className={selectStyle + " mb-4 max-w-48"}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">All modes</option>
            <option value="type">Type</option>
            <option value="voice">Voice</option>
          </select>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th>Prompt</th>
                  <th>Mode</th>
                  <th>Platform</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {(jobs.data ?? []).map((j: any) => (
                  <tr key={j.id} className="border-t">
                    <td className="py-3">
                      <button
                        className="text-primary underline text-left"
                        onClick={() => setSelected(j.id)}
                      >
                        {j.phrase}
                      </button>
                    </td>
                    <td>{j.mode}</td>
                    <td>{j.platform}</td>
                    <td>
                      {j.status}
                      {j.cancel_requested ? " · cancellation requested" : ""}
                    </td>
                    <td>{new Date(j.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      {d && (
        <Card>
          <CardHeader>
            <CardTitle>
              Execution details · {d.mode} · {d.status}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4" data-testid="execution-detail">
            <p>{d.request.phrase}</p>
            <p className="text-sm">
              Heard: {d.result?.recognized ?? "—"}{" "}
              {d.result?.exact === true ? "✓ exact" : ""}
            </p>
            {["queued", "running"].includes(d.status) && (
              <Button
                variant="outline"
                disabled={d.cancel_requested}
                onClick={() =>
                  api("/" + d.id + "/cancel", {})
                    .then(() => detail.refetch())
                    .catch((e) => setError(e.message))
                }
              >
                Cancel{d.status === "running" ? " after current run" : ""}
              </Button>
            )}
            {d.result?.result?.err && (
              <p className="text-destructive">{d.result.result.err}</p>
            )}
            {d.result?.ranking && (
              <p>
                Rank: {d.result.ranking.rank ?? "not found"} /{" "}
                {d.result.ranking.total ?? "—"}
              </p>
            )}
            {(trace?.attempts ?? []).map((a: any) => (
              <div key={a.id} className="rounded border p-3 text-sm">
                <b>
                  Voice attempt {a.id}: {a.voice} · {a.engine}
                </b>
                <p>
                  Rate: {a.rate_wpm ?? a.speed ?? "voice default"} · Pitch:{" "}
                  {a.pitch ?? "voice default"} · Tone:{" "}
                  {a.tone ?? "no explicit setting"}
                </p>
                <p>
                  Seed: {a.seed ?? "not randomized"} · {a.audio?.sample_rate_hz}{" "}
                  Hz · {a.audio?.duration_s}s
                </p>
                <p className="break-all text-xs">SHA-256: {a.sha256}</p>
              </div>
            ))}
            {(d.artifacts ?? []).map((a: any) => {
              const url =
                BASE +
                "/api/executions/" +
                d.id +
                "/artifacts/" +
                a.artifact_id;
              return (
                <div key={a.artifact_id} className="space-y-2">
                  <p className="text-sm">{a.name}</p>
                  {!a.uploaded ? (
                    <p>Upload pending</p>
                  ) : (
                    <>
                      {a.content_type === "audio/wav" ? (
                        <audio
                          aria-label={a.name}
                          controls
                          preload="none"
                          crossOrigin="use-credentials"
                          src={url}
                        />
                      ) : (
                        <img
                          src={url}
                          crossOrigin="use-credentials"
                          alt="Execution screenshot"
                          className="max-w-sm rounded border"
                        />
                      )}
                      <a
                        href={url + "?download=1"}
                        className="block text-primary underline"
                      >
                        Download {a.name}
                      </a>
                    </>
                  )}
                </div>
              );
            })}
            <pre className="whitespace-pre-wrap text-sm rounded bg-muted p-4 max-h-96 overflow-auto">
              {d.result?.result?.answer ??
                d.result?.result?.serp_text ??
                "No answer captured yet."}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
