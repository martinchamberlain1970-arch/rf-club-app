import { redirect } from "next/navigation";

const legionMastersCompetitionId = "eb3561a5-b78e-4dc5-842a-783cf1e85a78";

export default function LegionMastersPage() {
  redirect(`/join/${legionMastersCompetitionId}`);
}
