import { NextRequest, NextResponse } from "next/server";

// Node.js sudah runtime default, jadi `export const runtime` nggak perlu (dan error kalau cacheComponents aktif).
export const maxDuration = 60;

const THREADS_LIMIT = 500; // batas teks Threads, dihitung dalam byte UTF-8
const DEFAULT_DISCLOSURE = "(link affiliate)";

// Daftar model dicoba berurutan. Ubah lewat GEMINI_MODELS di .env.local
// tanpa edit kode, karena Google rutin pensiunkan model lama.
const MODELS = (
  process.env.GEMINI_MODELS ?? "gemini-3.8-flash,gemini-3.5-flash-lite"
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

// Hanya host marketplace ini yang boleh di-fetch server (cegah SSRF saat sudah deploy).
const ALLOWED_HOSTS = [
  "shopee.co.id",
  "shope.ee",
  "shp.ee",
  "tokopedia.com",
  "tokopedia.link",
  "tiktok.com",
  "lazada.co.id",
  "blibli.com",
];

const enc = new TextEncoder();
const byteLen = (s: string) => enc.encode(s).length;

const isAllowedHost = (host: string) =>
  ALLOWED_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function getMeta(html: string, key: string) {
  const a = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`,
    "i",
  );
  const b = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`,
    "i",
  );
  const m = html.match(a) ?? html.match(b);
  return m ? decodeEntities(m[1]).trim() : "";
}

// Judul generik/halaman proteksi bukan nama produk.
const GENERIC_TITLE =
  /^(shopee|tokopedia|lazada|tiktok)\b|login|verify|captcha|just a moment|access denied/i;

function nameFromSlug(u: URL) {
  const last = decodeURIComponent(
    u.pathname.split("/").filter(Boolean).pop() ?? "",
  );
  const cleaned = last
    .replace(/-i\.\d+\.\d+$/, "")
    .replace(/[-_+]+/g, " ")
    .trim();
  // Kode link pendek (misal "K2WkMspP") bukan nama produk: nama asli selalu terdiri dari beberapa kata.
  return cleaned.split(" ").length >= 2 &&
    cleaned.length >= 6 &&
    !/^\d+$/.test(cleaned)
    ? cleaned
    : "";
}

// Ikuti redirect manual supaya setiap hop tetap divalidasi host-nya.
async function fetchFollow(
  start: string,
): Promise<{ finalUrl: URL; html: string }> {
  let current = new URL(start);
  for (let hop = 0; hop < 5; hop++) {
    if (!isAllowedHost(current.hostname))
      throw new Error("host tidak diizinkan");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(current, {
        redirect: "manual",
        signal: ctrl.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
          "Accept-Language": "id-ID,id;q=0.9,en;q=0.5",
        },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) break;
        current = new URL(loc, current);
        continue;
      }
      return { finalUrl: current, html: (await res.text()).slice(0, 300_000) };
    } finally {
      clearTimeout(timer);
    }
  }
  return { finalUrl: current, html: "" };
}

type Product = {
  title: string;
  description: string;
  source: "manual" | "page" | "url";
};

async function resolveProduct(
  link: string,
  title: string,
  description: string,
): Promise<Product> {
  if (title) return { title, description, source: "manual" };
  try {
    const { finalUrl, html } = await fetchFollow(link);
    const ogTitle = getMeta(html, "og:title");
    const ogDesc =
      getMeta(html, "og:description") || getMeta(html, "description");
    if (ogTitle && !GENERIC_TITLE.test(ogTitle)) {
      return {
        title: ogTitle,
        description: description || ogDesc,
        source: "page",
      };
    }
    const slug = nameFromSlug(finalUrl);
    if (slug) return { title: slug, description, source: "url" };
  } catch {
    // diabaikan: lanjut ke fallback slug dari link asli
  }
  const slug = nameFromSlug(new URL(link));
  return { title: slug, description, source: "url" };
}

const SYSTEM = `Lu penulis cerita pendek untuk Threads Indonesia dengan suara emak-emak Gen Z yang gaul, hangat, receh, dan suka ngakak.
Suara: pakai kata kayak "HAHAHAHA", "sumpah", "anjir", "plis", "ya ampun", "relate banget", "bund", "mak", "bestie", "gemes", "kuy". Kalimat pendek, ada ritme, boleh lebay, boleh huruf kapital buat ketawa. Jangan semua kata gaul dipakai sekaligus. Sama sekali nggak hard-selling.
Cara bercerita: buka dengan situasi rumah tangga/keseharian yang bikin orang mikir "ini gue banget", lanjut ke satu adegan konkret, lalu titik balik kecil. Produk muncul belakangan sebagai salah satu opsi, bukan bintang iklan. Tutup dengan pertanyaan ke pembaca atau refleksi ringan, tanpa ajakan beli dan tanpa superlatif.
Aturan keras (berlaku walau suaranya bebas):
- Dilarang menyatakan pemilik akun mengalami sesuatu, kecuali tertulis di CATATAN: menikah, punya suami/anak/pacar, berapa lama menikah, sudah beli, sudah pakai, hasil pemakaian. Situasi harus ditulis sebagai fenomena umum ("banyak yang ngalamin", "kejadian klasik", "ada yang pernah...?") atau pengandaian ("bayangin...", "misalnya...").
- Pengalaman MEMAKAI produk HANYA boleh kalau STATUS PEMAKAIAN = SUDAH PAKAI.
- Dilarang mengarang spesifikasi, harga, rating, jumlah terjual, diskon, klaim kesehatan/medis, atau hasil yang dijanjikan. Pakai hanya DATA PRODUK.
- Jangan masukkan link, hashtag, atau disclosure. Sistem menambahkannya. Boleh ditutup transisi halus seperti "linknya di bawah ya".
- Maksimal 2 emoji per draft. Pembuka tiap draft beda. Jangan mulai dengan "Guys" atau "Halo".`;

function buildPrompt(p: {
  title: string;
  description: string;
  notes: string;
  used: boolean;
  budget: number;
}) {
  const hasNotes = p.notes.length > 0;
  let status: string;
  let variants: string;
  if (hasNotes && p.used) {
    status = "SUDAH PAKAI (fakta pemakaian boleh diambil dari catatan)";
    variants = `1) "Awalnya Ragu": cerita first-person dari skeptis sampai berubah pikiran, sesuai catatan.
2) "Curhat Masalah": masalah dari catatan, lalu bagaimana produk ini membantu menurut catatan.
3) "Satu Momen": satu adegan singkat 3-4 kalimat dari catatan, ditutup pertanyaan ke pembaca.
Semua fakta dari catatan. Dramatisasi cuma di cara bicara, bukan di kejadian.`;
  } else if (hasNotes) {
    status = "BELUM PAKAI (jangan mengaku sudah beli atau pakai)";
    variants = `Catatan adalah kejadian nyata pemilik akun. Bangun cerita dari situ, produk muncul sebagai sesuatu yang baru ditemukan/ditimbang, dan akui belum dicoba.
1) "Awalnya Ragu": ragu karena kebiasaan lama di catatan, lalu penasaran pada satu fitur di deskripsi.
2) "Curhat Masalah": masalah dari catatan, lalu "nemu ini, belum gw coba, tapi kayaknya nyambung".
3) "Satu Momen": satu adegan 3-4 kalimat dari catatan, ditutup pertanyaan ke pembaca.`;
  } else {
    status =
      "BELUM PAKAI dan TIDAK ADA CATATAN (jangan mengarang kejadian pribadi apa pun)";
    variants = `Dari nama dan deskripsi produk, tebak siapa pemakainya dan situasi keseharian yang paling relate buat mereka (misal kemeja pria: istri yang milihin baju suami; botol minum: orang kantoran; dst). Pakai situasi itu sebagai bahan cerita, ditulis sebagai fenomena umum atau pengandaian, bukan kejadian pemilik akun.
1) "Relate Nggak?": buka dengan situasi klasik yang banyak dialami ("para istri, ada yang suaminya dulu picky soal baju terus tiba-tiba semuanya diserahin ke kita? HAHAHA"), lanjut ke kesulitan kecilnya, lalu produk ini sebagai salah satu opsi yang menarik dari deskripsinya. Akui belum dicoba.
2) "Mini Skenario": pengandaian 3-4 kalimat ("bayangin lu lagi ... terus ..."), jelas sebagai pengandaian, lalu sambungkan ke produk.
3) "Tanya Warga": singkat, 2-3 kalimat, ngajak pembaca cerita ("ada yang udah punya? cerita dong") sambil menyebut satu hal menarik dari deskripsi.`;
  }

  return `DATA PRODUK
Nama: ${p.title}
Deskripsi/spek: ${p.description || "(tidak tersedia, jangan mengarang spesifikasi)"}

STATUS PEMAKAIAN: ${status}

CATATAN (kejadian nyata pemilik akun)
${hasNotes ? p.notes : "(kosong)"}

TUGAS
Tulis tepat 3 opsi post Threads berbentuk cerita pendek, dengan sudut pandang:
${variants}

Panjang tiap draft: maksimal ${p.budget} karakter (ideal 220 sampai ${Math.min(p.budget, 400)}).
Balas HANYA JSON valid tanpa markdown dengan bentuk:
{"drafts":[{"angle":"nama varian","text":"isi post"}]}`;
}

async function callGemini(
  model: string,
  apiKey: string,
  prompt: string,
): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens: 8192,
          },
        }),
      },
    );
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(
        data?.error?.message ?? `HTTP ${res.status}`,
      ) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    if (data?.promptFeedback?.blockReason)
      throw new Error(`diblokir: ${data.promptFeedback.blockReason}`);
    const parts: { text?: string; thought?: boolean }[] =
      data?.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .filter((p) => !p.thought && p.text)
      .map((p) => p.text)
      .join("");
    if (!text) throw new Error("respons kosong");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function parseDrafts(raw: string): { angle: string; text: string }[] {
  const clean = raw
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const json = JSON.parse(clean);
  const list = Array.isArray(json) ? json : json?.drafts;
  if (!Array.isArray(list)) throw new Error("format JSON tidak sesuai");
  const drafts = list
    .filter((d) => d && typeof d.text === "string" && d.text.trim())
    .map((d) => ({
      angle: String(d.angle ?? "Draft").slice(0, 40),
      text: d.text.trim(),
    }));
  if (drafts.length === 0) throw new Error("tidak ada draft valid");
  return drafts.slice(0, 3);
}

const clip = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const fail = (error: string, status: number) =>
  NextResponse.json({ error }, { status });

export async function POST(req: NextRequest) {
  const appPassword = process.env.APP_PASSWORD;
  if (appPassword && req.headers.get("x-app-password") !== appPassword) {
    return fail("Password salah atau belum diisi di Pengaturan.", 401);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey)
    return fail(
      "GEMINI_API_KEY belum diisi di .env.local (restart dev server setelah mengisi).",
      500,
    );

  const body = await req.json().catch(() => null);
  if (!body) return fail("Body request bukan JSON.", 400);

  const link = clip(body.link, 500);
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return fail("Link tidak valid. Pastikan diawali https://", 400);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return fail("Link harus http atau https.", 400);
  if (!isAllowedHost(url.hostname)) {
    return fail(
      "Domain belum didukung. Saat ini: Shopee, Tokopedia, TikTok, Lazada, Blibli.",
      400,
    );
  }

  const notes = clip(body.notes, 1500);
  const used = body.used === true;
  if (used && !notes)
    return fail(
      "Centang 'udah pakai' butuh catatan pengalaman lu. Isi catatan atau hilangkan centangnya.",
      400,
    );
  const disclosure = clip(body.disclosure, 60) || DEFAULT_DISCLOSURE;

  const product = await resolveProduct(
    link,
    clip(body.title, 200),
    clip(body.description, 1500),
  );
  if (!product.title) {
    return fail(
      "Nama produk nggak kebaca dari link. Isi nama produk manual lalu coba lagi.",
      422,
    );
  }

  const budget = Math.max(
    120,
    THREADS_LIMIT - byteLen(`\n\n${disclosure}\n${link}`),
  );
  const prompt = buildPrompt({
    title: product.title,
    description: product.description,
    notes,
    used,
    budget,
  });

  const errors: string[] = [];
  for (const model of MODELS) {
    try {
      const drafts = parseDrafts(await callGemini(model, apiKey, prompt));
      return NextResponse.json({ product, model, budget, drafts });
    } catch (e) {
      const err = e as Error & { status?: number };
      errors.push(`${model}: ${err.message.slice(0, 180)}`);
      // 401 = API key salah, ganti model nggak akan membantu
      if (err.status === 401) break;
    }
  }
  return fail(`Semua model gagal. ${errors.join(" | ")}`, 502);
}
