import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "League rating imports have been disabled. Rack & Frame now maintains an independent club Elo." },
    { status: 410 }
  );
}
