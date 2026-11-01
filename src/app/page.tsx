"use client";

import { useEffect, useMemo, useState } from "react";

const LIMIT = 500;
const DEFAULT_DISCLOSURE = "(link affiliate)";
const enc = new TextEncoder();
const bytes = (s: string) => enc.encode(s).length;

type Draft = { angle: string; text: string };
type Result = {
  product: {
    title: string;
    description: string;
    source: "manual" | "page" | "url";
  };
  model: string;
  drafts: Draft[];
};

const SOURCE_LABEL = {
  manual: "diisi manual",
  page: "dari halaman produk",
  url: "dari URL link",
} as const;

const field =
  "w-full rounded-md border border-[#CBD3E1] bg-white px-3 py-2 text-[15px] text-[#17203A] placeholder:text-[#8A94A8] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#2F3CCB]";

export default function Home() {
  const [link, setLink] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [used, setUsed] = useState(false);
  const [disclosure, setDisclosure] = useState(DEFAULT_DISCLOSURE);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [bodies, setBodies] = useState<string[]>([]);
  const [copied, setCopied] = useState<number | null>(null);

  // Simpan password & disclosure di browser supaya nggak ngetik ulang.
  useEffect(() => {
    try {
      setPassword(localStorage.getItem("app_password") ?? "");
      setDisclosure(localStorage.getItem("disclosure") ?? DEFAULT_DISCLOSURE);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("app_password", password);
      localStorage.setItem("disclosure", disclosure);
    } catch {}
  }, [password, disclosure]);

  const tail = useMemo(
    () => `\n\n${disclosure.trim() || DEFAULT_DISCLOSURE}\n${link.trim()}`,
    [disclosure, link],
  );
  const finalText = (body: string) => `${body.trim()}${tail}`;

  async function generate() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(password ? { "x-app-password": password } : {}),
        },
        body: JSON.stringify({
          link,
          title,
          description,
          notes,
          used,
          disclosure,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data)
        throw new Error(data?.error ?? `Request gagal (${res.status})`);
      setResult(data as Result);
      setBodies((data as Result).drafts.map((d) => d.text));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generate gagal.");
    } finally {
      setLoading(false);
    }
  }

  async function copy(i: number) {
    try {
      await navigator.clipboard.writeText(finalText(bodies[i]));
      setCopied(i);
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 1800);
    } catch {
      setError("Clipboard diblokir browser. Salin manual dari kotak teks.");
    }
  }

  return (
    <main className="min-h-screen bg-[#E9EDF3] text-[#17203A]">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-8 lg:grid-cols-[380px_1fr]">
        <section className="self-start rounded-lg bg-white p-5 shadow-sm lg:sticky lg:top-8">
          <h1 className="text-xl font-semibold tracking-tight">
            Draft Threads dari link produk
          </h1>
          <p className="mt-1 text-sm text-[#5A6479]">
            Paste link, cerita dibuat otomatis. Pilih, edit, lalu salin.
          </p>

          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">
                Link produk
              </span>
              <input
                className={field}
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://shope.ee/..."
                inputMode="url"
              />
            </label>

            <details className="rounded-md border border-[#CBD3E1] px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium">
                Punya pengalaman asli? Tambahkan (opsional)
              </summary>
              <div className="mt-3 space-y-3">
                <textarea
                  className={field}
                  rows={4}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Kejadian nyata yang nyambung ke produk ini. Kosong juga nggak apa-apa, cerita dibuat otomatis."
                />
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-[#2F3CCB]"
                    checked={used}
                    onChange={(e) => setUsed(e.target.checked)}
                  />
                  <span>Gw udah pakai produk ini (butuh catatan di atas)</span>
                </label>
              </div>
            </details>

            <details className="rounded-md border border-[#CBD3E1] px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium">
                Kalau nama produk nggak kebaca
              </summary>
              <div className="mt-3 space-y-3">
                <input
                  className={field}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Nama produk"
                />
                <textarea
                  className={field}
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Deskripsi atau spek (opsional)"
                />
              </div>
            </details>

            <details className="rounded-md border border-[#CBD3E1] px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium">
                Pengaturan
              </summary>
              <div className="mt-3 space-y-3">
                <label className="block">
                  <span className="mb-1 block text-xs text-[#5A6479]">
                    Tulisan disclosure di akhir post
                  </span>
                  <input
                    className={field}
                    value={disclosure}
                    onChange={(e) => setDisclosure(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[#5A6479]">
                    Password app (wajib kalau APP_PASSWORD diisi)
                  </span>
                  <input
                    className={field}
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="off"
                  />
                </label>
              </div>
            </details>

            <button
              onClick={generate}
              disabled={loading || !link.trim()}
              className="w-full rounded-md bg-[#2F3CCB] px-4 py-2.5 text-[15px] font-medium text-white hover:bg-[#2631A8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2F3CCB] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Membuat draft..." : "Buat 3 draft"}
            </button>

            {error && (
              <p
                role="alert"
                className="rounded-md bg-[#FBE9E7] px-3 py-2 text-sm text-[#8C1D13]"
              >
                {error}
              </p>
            )}
          </div>
        </section>

        <section aria-live="polite" className="space-y-4">
          {!result && !loading && (
            <p className="rounded-lg border border-dashed border-[#B4BFD3] p-8 text-sm text-[#5A6479]">
              Draft muncul di sini setelah lu klik Buat 3 draft.
            </p>
          )}

          {result && (
            <>
              <div className="text-sm text-[#5A6479]">
                <p>
                  Produk:{" "}
                  <span className="font-medium text-[#17203A]">
                    {result.product.title}
                  </span>{" "}
                  ({SOURCE_LABEL[result.product.source]})
                </p>
                {!result.product.description && (
                  <p className="mt-0.5">
                    Deskripsi nggak terbaca, jadi draft hanya berdasar nama
                    produk dan catatan lu.
                  </p>
                )}
                <p className="mt-0.5">Model: {result.model}</p>
              </div>

              {bodies.map((body, i) => {
                const used = bytes(finalText(body));
                const over = used > LIMIT;
                return (
                  <article
                    key={i}
                    className="rounded-lg bg-white p-4 shadow-sm"
                  >
                    <h2 className="text-sm font-semibold">
                      {result.drafts[i]?.angle}
                    </h2>
                    <textarea
                      className={`${field} mt-2`}
                      rows={7}
                      value={body}
                      onChange={(e) =>
                        setBodies((prev) =>
                          prev.map((b, j) => (j === i ? e.target.value : b)),
                        )
                      }
                      aria-label={`Isi draft ${i + 1}`}
                    />
                    <p className="mt-2 whitespace-pre-line rounded-md bg-[#F3F5F9] px-3 py-2 text-xs text-[#5A6479]">
                      {tail.trim()}
                    </p>

                    <div className="mt-3 flex items-center gap-3">
                      <div
                        className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#E1E6EF]"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={LIMIT}
                        aria-valuenow={Math.min(used, LIMIT)}
                        aria-label="Pemakaian batas 500 byte"
                      >
                        <div
                          className={`h-full transition-[width] motion-reduce:transition-none ${over ? "bg-[#B3261E]" : "bg-[#2F3CCB]"}`}
                          style={{
                            width: `${Math.min(100, (used / LIMIT) * 100)}%`,
                          }}
                        />
                      </div>
                      <span
                        className={`text-xs tabular-nums ${over ? "font-semibold text-[#B3261E]" : "text-[#5A6479]"}`}
                      >
                        {used}/{LIMIT}
                      </span>
                      <button
                        onClick={() => copy(i)}
                        disabled={over}
                        className="rounded-md border border-[#2F3CCB] px-3 py-1.5 text-sm font-medium text-[#2F3CCB] hover:bg-[#EEF0FD] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2F3CCB] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {copied === i ? "Tersalin" : "Salin"}
                      </button>
                    </div>
                    {over && (
                      <p className="mt-2 text-xs text-[#B3261E]">
                        Lewat {used - LIMIT} byte. Persingkat isi post sebelum
                        disalin.
                      </p>
                    )}
                  </article>
                );
              })}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
