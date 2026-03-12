import { NextRequest, NextResponse } from "next/server";

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

interface MALSearchResponse {
  data: {
    node: MALMangaResult;
  }[];
  paging?: {
    next?: string;
  };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");

  if (!query || query.length < 2) {
    return NextResponse.json({ error: "Query must be at least 2 characters" }, { status: 400 });
  }

  const malClientId = process.env.MAL_CLIENT_ID;
  if (!malClientId || malClientId === "your_mal_client_id_here") {
    return NextResponse.json(
      { error: "MAL API client ID not configured" },
      { status: 500 }
    );
  }

  try {
    const fields = "id,title,main_picture,synopsis,media_type,num_chapters,num_volumes,mean,status";
    const url = `https://api.myanimelist.net/v2/manga?q=${encodeURIComponent(query)}&limit=10&fields=${fields}`;

    const response = await fetch(url, {
      headers: {
        "X-MAL-CLIENT-ID": malClientId,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("MAL API error:", response.status, errorText);
      return NextResponse.json(
        { error: `MAL API error: ${response.status}` },
        { status: response.status }
      );
    }

    const data: MALSearchResponse = await response.json();

    const results = data.data.map((item) => item.node);

    return NextResponse.json({ results });
  } catch (error) {
    console.error("MAL search error:", error);
    return NextResponse.json(
      { error: "Failed to search MAL" },
      { status: 500 }
    );
  }
}
