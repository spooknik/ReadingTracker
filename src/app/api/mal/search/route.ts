import { NextRequest, NextResponse } from "next/server";

/**
 * Result shape exposed to the client.
 * Kept the same so the Add Series page doesn't need changes.
 */
export interface MALMangaResult {
  id: number;
  title: string;
  main_picture?: {
    medium: string;
    large: string;
  };
  synopsis?: string;
  media_type?: string;
  num_chapters?: number;
  num_volumes?: number;
  mean?: number;
  status?: string;
}

/**
 * Jikan API v4 manga item shape (fields we use).
 * Docs: https://docs.api.jikan.moe/#tag/manga/operation/getMangaSearch
 */
interface JikanMangaItem {
  mal_id: number;
  title: string;
  images?: {
    jpg?: {
      image_url?: string;
      small_image_url?: string;
      large_image_url?: string;
    };
  };
  synopsis?: string | null;
  type?: string | null;
  chapters?: number | null;
  volumes?: number | null;
  score?: number | null;
  status?: string | null;
}

interface JikanSearchResponse {
  data: JikanMangaItem[];
}

/**
 * Map Jikan media types to our internal types.
 * Jikan returns: Manga, Novel, Light Novel, One-shot, Doujinshi, Manhwa, Manhua
 */
function mapMediaType(jikanType?: string | null): string {
  if (!jikanType) return "manga";
  const t = jikanType.toLowerCase();
  if (t === "manhwa") return "manhwa";
  if (t === "manhua") return "manhua";
  if (t === "light novel" || t === "novel") return "light_novel";
  return "manga";
}

/**
 * Convert a Jikan manga item to our MALMangaResult shape
 * so the frontend doesn't need any changes.
 */
function toMALResult(item: JikanMangaItem): MALMangaResult {
  return {
    id: item.mal_id,
    title: item.title,
    main_picture: item.images?.jpg
      ? {
          medium: item.images.jpg.image_url || "",
          large: item.images.jpg.large_image_url || item.images.jpg.image_url || "",
        }
      : undefined,
    synopsis: item.synopsis ?? undefined,
    media_type: mapMediaType(item.type),
    num_chapters: item.chapters ?? undefined,
    num_volumes: item.volumes ?? undefined,
    mean: item.score ?? undefined,
    status: item.status ?? undefined,
  };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");

  if (!query || query.length < 2) {
    return NextResponse.json({ error: "Query must be at least 2 characters" }, { status: 400 });
  }

  try {
    const url = `https://api.jikan.moe/v4/manga?q=${encodeURIComponent(query)}&limit=25&order_by=favorites&sort=desc`;

    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Jikan API error:", response.status, errorText);
      return NextResponse.json(
        { error: `Search API error: ${response.status}` },
        { status: response.status }
      );
    }

    const data: JikanSearchResponse = await response.json();

    const results = data.data.map(toMALResult);

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: "Failed to search" },
      { status: 500 }
    );
  }
}
