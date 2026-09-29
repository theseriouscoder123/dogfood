// Marks requests for the embeddable gallery, so the root layout can render it bare: no site
// header or footer, and no lookup of who is signed in. An embed shows the same thing to everyone.
import { NextResponse, type NextRequest } from "next/server";

export const EMBED_HEADER = "x-dogfood-embed";

export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  if (req.nextUrl.pathname.startsWith("/embed/")) headers.set(EMBED_HEADER, "1");
  else headers.delete(EMBED_HEADER);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/((?!_next/|favicon|api/).*)"] };
