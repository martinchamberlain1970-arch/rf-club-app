import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Cross-app snooker Elo synchronisation has been disabled. Club results affect club Elo only." },
    { status: 410 }
  );
}
