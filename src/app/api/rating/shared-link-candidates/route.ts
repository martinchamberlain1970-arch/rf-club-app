import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { error: "Cross-app player and Elo linking has been disabled. Club and league ratings are separate." },
    { status: 410 }
  );
}
