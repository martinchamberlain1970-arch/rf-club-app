"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import RequireAuth from "@/components/RequireAuth";
import ScreenHeader from "@/components/ScreenHeader";
import useAdminStatus from "@/components/useAdminStatus";
import MessageModal from "@/components/MessageModal";
import InfoModal from "@/components/InfoModal";
import ConfirmModal from "@/components/ConfirmModal";
import { supabase } from "@/lib/supabase";

type Location = {
  id: string;
  name: string;
  address: string | null;
  contact_phone: string | null;
  contact_email: string | null;
};
type Player = {
  id: string;
  display_name: string;
  full_name: string | null;
  location_id?: string | null;
  snooker_handicap?: number | null;
  snooker_handicap_base?: number | null;
};
type Season = {
  id: string;
  name: string;
  location_id: string;
  is_active: boolean;
  created_at: string;
  handicap_enabled?: boolean | null;
  singles_count?: number | null;
  doubles_count?: number | null;
};
type Team = { id: string; season_id: string; location_id: string; name: string; is_active: boolean };
type TeamMember = { id: string; season_id: string; team_id: string; player_id: string; is_captain: boolean; is_vice_captain: boolean };
type RegisteredTeam = { id: string; name: string; location_id: string | null };
type RegisteredTeamMember = { id: string; team_id: string; player_id: string; is_captain: boolean; is_vice_captain: boolean };
type Fixture = {
  id: string;
  season_id: string;
  location_id: string;
  week_no: number | null;
  fixture_date: string | null;
  home_team_id: string;
  away_team_id: string;
  status: "pending" | "in_progress" | "complete";
  home_points: number;
  away_points: number;
};
type FrameSlot = {
  id: string;
  fixture_id: string;
  slot_no: number;
  slot_type: "singles" | "doubles";
  home_player1_id: string | null;
  home_player2_id: string | null;
  away_player1_id: string | null;
  away_player2_id: string | null;
  home_nominated: boolean;
  away_nominated: boolean;
  home_forfeit: boolean;
  away_forfeit: boolean;
  winner_side: "home" | "away" | null;
  home_nominated_name?: string | null;
  away_nominated_name?: string | null;
  home_points_scored?: number | null;
  away_points_scored?: number | null;
};
type LeagueBreak = {
  id?: string;
  fixture_id?: string;
  player_id: string | null;
  entered_player_name: string;
  break_value: string;
};
type PlayerTableRow = {
  player_id: string;
  player_name: string;
  team_name: string;
  appearances: number;
  played: number;
  won: number;
  lost: number;
  win_pct: number;
};
type LeagueSubmission = {
  id: string;
  fixture_id: string;
  season_id: string;
  location_id: string;
  submitted_by_user_id: string;
  submitter_team_id: string | null;
  frame_results: Array<{ slot_no: number; winner_side: "home" | "away" | null }>;
  scorecard_photo_url: string | null;
  status: "pending" | "approved" | "rejected" | "needs_correction";
  rejection_reason: string | null;
  created_at: string;
};
type KnockoutEvent = {
  id: string;
  name: string;
  competition_type: string;
  match_mode: "singles" | "doubles" | "triples";
  format_label: "scratch" | "handicap";
  age_min: number | null;
  sport_type: "snooker" | "billiards";
  sort_order: number;
  signup_open: boolean;
  signup_deadline: string | null;
  published: boolean;
  is_active: boolean;
};
type KnockoutSignup = {
  id: string;
  event_id: string;
  user_id: string;
  player_id: string | null;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  created_at: string;
};
const named = (p?: Player | null) => (p ? (p.full_name?.trim() ? p.full_name : p.display_name) : "Unknown");
const statusLabel = (s: Fixture["status"]) =>
  s === "in_progress" ? "in progress" : s === "pending" ? "scheduled" : "complete";
const LEAGUE_BODY_NAME = "Gravesend & District Indoor Games League";
const LEAGUE_TEMPLATES = {
  winter: { label: "Winter League", singlesCount: 4, doublesCount: 1 },
  summer: { label: "Summer League", singlesCount: 6, doublesCount: 0 },
} as const;
type LeagueTemplateKey = keyof typeof LEAGUE_TEMPLATES;
const NON_VENUE_LOCATION_NAMES = new Set(["gravesend snooker league"]);
const locationLabel = (name: string) => {
  if (name.trim().toLowerCase() === "traders & northfleey association") {
    return "Northfleet & District Traders Association";
  }
  return name;
};

export default function LeaguePage() {
  const admin = useAdminStatus();
  const [message, setMessage] = useState<string | null>(null);
  const [infoModal, setInfoModal] = useState<{ title: string; description: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [locations, setLocations] = useState<Location[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [registeredTeams, setRegisteredTeams] = useState<RegisteredTeam[]>([]);
  const [registeredMembers, setRegisteredMembers] = useState<RegisteredTeamMember[]>([]);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [slots, setSlots] = useState<FrameSlot[]>([]);
  const [submissions, setSubmissions] = useState<LeagueSubmission[]>([]);
  const [knockoutEvents, setKnockoutEvents] = useState<KnockoutEvent[]>([]);
  const [knockoutSignups, setKnockoutSignups] = useState<KnockoutSignup[]>([]);

  const [adminLocationId, setAdminLocationId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserPlayerId, setCurrentUserPlayerId] = useState<string | null>(null);
  const [seasonId, setSeasonId] = useState("");

  const [seasonName, setSeasonName] = useState("");
  const [seasonTemplate, setSeasonTemplate] = useState<LeagueTemplateKey>("winter");
  const [seasonHandicapEnabled, setSeasonHandicapEnabled] = useState(false);
  const [activeView, setActiveView] = useState<"guide" | "teamManagement" | "venues" | "profiles" | "setup" | "fixtures" | "table" | "playerTable" | "knockouts">("guide");

  const [selectedLeagueTeamNames, setSelectedLeagueTeamNames] = useState<string[]>([]);
  const [registryTeamName, setRegistryTeamName] = useState("");
  const [registryVenueId, setRegistryVenueId] = useState("");
  const [newVenueName, setNewVenueName] = useState("");
  const [registryTeamId, setRegistryTeamId] = useState("");
  const [showStep2Teams, setShowStep2Teams] = useState(true);
  const [showStep3Players, setShowStep3Players] = useState(true);
  const [newPlayerFirstName, setNewPlayerFirstName] = useState("");
  const [newPlayerSecondName, setNewPlayerSecondName] = useState("");
  const [bulkPlayersText, setBulkPlayersText] = useState("");
  const [newPlayerLocationId, setNewPlayerLocationId] = useState("");
  const [transferPlayerId, setTransferPlayerId] = useState("");
  const [transferFromVenueId, setTransferFromVenueId] = useState("");
  const [transferVenueId, setTransferVenueId] = useState("");
  const [transferDestinationTeamId, setTransferDestinationTeamId] = useState("");
  const [manageVenueId, setManageVenueId] = useState("");
  const [manageVenueName, setManageVenueName] = useState("");
  const [manageVenueAddress, setManageVenueAddress] = useState("");
  const [manageVenuePostcode, setManageVenuePostcode] = useState("");
  const [manageVenuePhone, setManageVenuePhone] = useState("");
  const [manageVenueEmail, setManageVenueEmail] = useState("");
  const [venuePlayerSearch, setVenuePlayerSearch] = useState("");
  const [expandedVenueTeams, setExpandedVenueTeams] = useState<Record<string, boolean>>({});
  const [showAllVenueTeamMembers, setShowAllVenueTeamMembers] = useState<Record<string, boolean>>({});
  const [showUnassignedPlayers, setShowUnassignedPlayers] = useState(false);
  const [showAllRegisteredVenues, setShowAllRegisteredVenues] = useState(false);
  const [profileVenueFilterId, setProfileVenueFilterId] = useState("");

  const [fixtureWeek, setFixtureWeek] = useState("");
  const [fixtureWeekFilter, setFixtureWeekFilter] = useState("");
  const [fixtureDate, setFixtureDate] = useState("");
  const [fixtureHome, setFixtureHome] = useState("");
  const [fixtureAway, setFixtureAway] = useState("");
  const [fixtureId, setFixtureId] = useState("");
  const [resultEntryOpen, setResultEntryOpen] = useState(false);
  const [reviewReason, setReviewReason] = useState("");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [genStartDate, setGenStartDate] = useState("");
  const [genDoubleRound, setGenDoubleRound] = useState(true);
  const [genClearExisting, setGenClearExisting] = useState(true);
  const [breakDateInput, setBreakDateInput] = useState("");
  const [breakDates, setBreakDates] = useState<string[]>([]);
  const [nominatedNames, setNominatedNames] = useState<Record<string, string>>({});
  const [fixtureBreaks, setFixtureBreaks] = useState<LeagueBreak[]>([
    { player_id: null, entered_player_name: "", break_value: "" },
    { player_id: null, entered_player_name: "", break_value: "" },
    { player_id: null, entered_player_name: "", break_value: "" },
    { player_id: null, entered_player_name: "", break_value: "" },
  ]);
  const [breaksFeatureAvailable, setBreaksFeatureAvailable] = useState(true);
  const [statusBackfillSeasonId, setStatusBackfillSeasonId] = useState<string | null>(null);
  const [selectedTableTeamId, setSelectedTableTeamId] = useState<string | null>(null);
  const [selectedTeamResultFixtureId, setSelectedTeamResultFixtureId] = useState<string | null>(null);

  const canManage = admin.isSuper;
  const canSeeLeagueViews = admin.isSuper || admin.isAdmin || !admin.loading;
  const canApproveSubmissions = admin.isSuper;
  const canOpenAdminTabs = admin.isSuper;

  const currentSeason = useMemo(() => seasons.find((s) => s.id === seasonId) ?? null, [seasons, seasonId]);
  const seasonById = useMemo(() => new Map(seasons.map((s) => [s.id, s])), [seasons]);
  const currentSeasonSinglesCount = Math.max(1, Math.min(6, currentSeason?.singles_count ?? 4));
  const currentSeasonDoublesCount = Math.max(0, Math.min(2, currentSeason?.doubles_count ?? 1));
  const isWinterFormat = currentSeasonSinglesCount === 4 && currentSeasonDoublesCount === 1;
  const venueLocations = useMemo(
    () =>
      locations
        .filter((l) => !NON_VENUE_LOCATION_NAMES.has(l.name.trim().toLowerCase()))
        .sort((a, b) => locationLabel(a.name).localeCompare(locationLabel(b.name))),
    [locations]
  );
  const registeredTeamOptions = useMemo(() => {
    if (registeredTeams.length > 0) return registeredTeams;
    const map = new Map<string, RegisteredTeam>();
    for (const t of teams) {
      const key = `${(t.name ?? "").trim().toLowerCase()}::${t.location_id ?? ""}`;
      if (!map.has(key)) {
        map.set(key, { id: `derived-${key}`, name: t.name, location_id: t.location_id });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [registeredTeams, teams]);
  const selectedVenue = useMemo(
    () => locations.find((l) => l.id === manageVenueId) ?? null,
    [locations, manageVenueId]
  );
  const selectedVenuePlayers = useMemo(
    () =>
      players
        .filter((p) => p.location_id === manageVenueId)
        .sort((a, b) => named(a).localeCompare(named(b))),
    [players, manageVenueId]
  );
  const selectedVenueTeams = useMemo(
    () =>
      registeredTeams
        .filter((t) => t.location_id === manageVenueId)
        .map((t) => t.name)
        .sort((a, b) => a.localeCompare(b)),
    [registeredTeams, manageVenueId]
  );
  const seasonTeams = useMemo(() => teams.filter((t) => t.season_id === seasonId), [teams, seasonId]);
  const seasonFixtures = useMemo(() => fixtures.filter((f) => f.season_id === seasonId), [fixtures, seasonId]);
  const playerById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const teamMembersByTeam = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const m of members) {
      const prev = map.get(m.team_id) ?? [];
      prev.push(m.player_id);
      map.set(m.team_id, prev);
    }
    return map;
  }, [members]);
  const registeredMembersByTeam = useMemo(() => {
    const map = new Map<string, RegisteredTeamMember[]>();
    for (const m of registeredMembers) {
      const prev = map.get(m.team_id) ?? [];
      prev.push(m);
      map.set(m.team_id, prev);
    }
    return map;
  }, [registeredMembers]);
  const fallbackRosterByLeagueTeamId = useMemo(() => {
    const map = new Map<string, string[]>();
    const regTeamByKey = new Map(
      registeredTeams.map((t) => [`${(t.name ?? "").trim().toLowerCase()}::${t.location_id ?? ""}`, t.id])
    );
    for (const team of seasonTeams) {
      const direct = teamMembersByTeam.get(team.id) ?? [];
      if (direct.length) {
        map.set(team.id, direct);
        continue;
      }
      const key = `${(team.name ?? "").trim().toLowerCase()}::${team.location_id ?? ""}`;
      const regTeamId = regTeamByKey.get(key);
      const fallback = regTeamId ? (registeredMembersByTeam.get(regTeamId) ?? []).map((m) => m.player_id) : [];
      map.set(team.id, fallback);
    }
    return map;
  }, [registeredTeams, registeredMembersByTeam, seasonTeams, teamMembersByTeam]);
  const selectedVenueTeamRoster = useMemo(() => {
    const teamsAtVenue = registeredTeams
      .filter((t) => t.location_id === manageVenueId)
      .sort((a, b) => a.name.localeCompare(b.name));
    return teamsAtVenue.map((team) => {
      const teamMembers = (registeredMembersByTeam.get(team.id) ?? [])
        .map((m) => ({
          ...m,
          player: playerById.get(m.player_id) ?? null,
        }))
        .filter((m) => m.player)
        .sort((a, b) => named(a.player).localeCompare(named(b.player)));
      return {
        id: team.id,
        name: team.name,
        members: teamMembers,
      };
    });
  }, [registeredTeams, registeredMembersByTeam, playerById, manageVenueId]);
  const selectedVenueUnassignedPlayers = useMemo(() => {
    const assignedPlayerIds = new Set(
      selectedVenueTeamRoster.flatMap((team) => team.members.map((m) => m.player_id))
    );
    return selectedVenuePlayers.filter((p) => !assignedPlayerIds.has(p.id));
  }, [selectedVenueTeamRoster, selectedVenuePlayers]);
  const filteredSelectedVenueTeamRoster = useMemo(() => {
    const query = venuePlayerSearch.trim().toLowerCase();
    if (!query) return selectedVenueTeamRoster;
    return selectedVenueTeamRoster
      .map((team) => ({
        ...team,
        members: team.members.filter((m) => named(m.player).toLowerCase().includes(query)),
      }))
      .filter((team) => team.members.length > 0);
  }, [selectedVenueTeamRoster, venuePlayerSearch]);
  const visiblePlayerProfiles = useMemo(() => {
    const filtered = profileVenueFilterId
      ? players.filter((p) => p.location_id === profileVenueFilterId)
      : players;
    return filtered
      .slice()
      .sort((a, b) => named(a).localeCompare(named(b)))
      .map((p) => ({
        id: p.id,
        name: named(p),
        venue: locationLabel(locations.find((l) => l.id === p.location_id)?.name ?? "Unknown venue"),
        handicap: p.snooker_handicap ?? 0,
      }));
  }, [players, profileVenueFilterId, locations]);
  const registeredTeamNamesByPlayer = useMemo(() => {
    const teamNameById = new Map(registeredTeams.map((t) => [t.id, t.name]));
    const map = new Map<string, string[]>();
    for (const member of registeredMembers) {
      const prev = map.get(member.player_id) ?? [];
      const teamName = teamNameById.get(member.team_id);
      if (teamName) prev.push(teamName);
      map.set(member.player_id, prev);
    }
    for (const [playerId, names] of map.entries()) {
      map.set(playerId, Array.from(new Set(names)).sort((a, b) => a.localeCompare(b)));
    }
    return map;
  }, [registeredMembers, registeredTeams]);
  const playersAtSourceVenue = useMemo(() => {
    if (!transferFromVenueId) return [];
    return players
      .filter((p) => p.location_id === transferFromVenueId)
      .sort((a, b) => named(a).localeCompare(named(b)));
  }, [players, transferFromVenueId]);
  const destinationTeams = useMemo(() => {
    if (!transferVenueId) return [];
    return registeredTeams
      .filter((t) => t.location_id === transferVenueId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [registeredTeams, transferVenueId]);
  const fixtureSlots = useMemo(() => slots.filter((s) => s.fixture_id === fixtureId).sort((a, b) => a.slot_no - b.slot_no), [slots, fixtureId]);
  const fixtureSlotsByFixtureId = useMemo(() => {
    const map = new Map<string, FrameSlot[]>();
    for (const s of slots) {
      const prev = map.get(s.fixture_id) ?? [];
      prev.push(s);
      map.set(s.fixture_id, prev);
    }
    for (const [key, value] of map.entries()) {
      map.set(key, value.sort((a, b) => a.slot_no - b.slot_no));
    }
    return map;
  }, [slots]);
  const pendingSubmissionByFixtureId = useMemo(() => {
    const map = new Map<string, LeagueSubmission>();
    for (const s of submissions) {
      if (s.status !== "pending") continue;
      if (!map.has(s.fixture_id)) map.set(s.fixture_id, s);
    }
    return map;
  }, [submissions]);
  const fixtureParticipantPlayerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of fixtureSlots) {
      if (s.home_player1_id) ids.add(s.home_player1_id);
      if (s.home_player2_id) ids.add(s.home_player2_id);
      if (s.away_player1_id) ids.add(s.away_player1_id);
      if (s.away_player2_id) ids.add(s.away_player2_id);
    }
    return Array.from(ids);
  }, [fixtureSlots]);
  const currentFixture = useMemo(() => fixtures.find((f) => f.id === fixtureId) ?? null, [fixtures, fixtureId]);
  const fixtureRosterPlayerIds = useMemo(() => {
    if (!currentFixture) return [] as string[];
    const ids = new Set<string>();
    const home = fallbackRosterByLeagueTeamId.get(currentFixture.home_team_id) ?? [];
    const away = fallbackRosterByLeagueTeamId.get(currentFixture.away_team_id) ?? [];
    for (const id of home) ids.add(id);
    for (const id of away) ids.add(id);
    return Array.from(ids);
  }, [currentFixture, fallbackRosterByLeagueTeamId]);
  const fixturePlayerOptions = useMemo(() => {
    const ids = new Set<string>([...fixtureParticipantPlayerIds, ...fixtureRosterPlayerIds]);
    return Array.from(ids)
      .map((id) => ({ id, label: named(playerById.get(id)) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [fixtureParticipantPlayerIds, fixtureRosterPlayerIds, playerById]);
  const captainTeamIds = useMemo(() => {
    if (!currentUserPlayerId) return new Set<string>();
    const ids = members
      .filter((m) => m.player_id === currentUserPlayerId && m.is_captain)
      .map((m) => m.team_id);
    return new Set(ids);
  }, [members, currentUserPlayerId]);
  const allPendingSubmissions = useMemo(
    () =>
      submissions
        .filter((s) => s.status === "pending")
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [submissions]
  );
  const activeKnockoutSignups = useMemo(
    () => knockoutSignups.filter((s) => s.status === "approved" || s.status === "pending"),
    [knockoutSignups]
  );
  const myKnockoutSignupByEventId = useMemo(() => {
    const map = new Map<string, KnockoutSignup>();
    if (!currentUserId) return map;
    for (const signup of knockoutSignups) {
      if (signup.user_id !== currentUserId || signup.status === "withdrawn") continue;
      map.set(signup.event_id, signup);
    }
    return map;
  }, [knockoutSignups, currentUserId]);
  const knockoutSignupCountByEventId = useMemo(() => {
    const map = new Map<string, number>();
    for (const signup of activeKnockoutSignups) {
      map.set(signup.event_id, (map.get(signup.event_id) ?? 0) + 1);
    }
    return map;
  }, [activeKnockoutSignups]);

  const getSeasonFrameConfig = (season?: Season | null) => {
    const singles = Math.max(1, Math.min(6, season?.singles_count ?? 4));
    const doubles = Math.max(0, Math.min(2, season?.doubles_count ?? 1));
    return { singles, doubles, total: singles + doubles };
  };
  const slotLabel = useCallback((slotNo: number, season?: Season | null) => {
    const cfg = getSeasonFrameConfig(season ?? currentSeason);
    if (slotNo <= cfg.singles) return `Singles ${slotNo}`;
    if (cfg.doubles <= 0) return `Frame ${slotNo}`;
    const doublesNo = slotNo - cfg.singles;
    return cfg.doubles === 1 ? "Doubles" : `Doubles ${doublesNo}`;
  }, [currentSeason]);
  const canEditFixtureResult = useCallback((fixture: Fixture | null) => {
    if (!fixture) return false;
    if (admin.isSuper) return true;
    if (!admin.isAdmin) return false;
    if (adminLocationId && fixture.location_id === adminLocationId) return true;
    return captainTeamIds.has(fixture.home_team_id) || captainTeamIds.has(fixture.away_team_id);
  }, [admin.isAdmin, admin.isSuper, adminLocationId, captainTeamIds]);
  const canEditCurrentFixture = canEditFixtureResult(currentFixture);

  const loadAll = useCallback(async () => {
    const client = supabase;
    if (!client) {
      setMessage("Supabase is not configured.");
      return;
    }
    setLoading(true);
    const [
      authRes,
      locRes,
      playersRes,
      seasonsRes,
      teamsRes,
      membersRes,
      fixturesRes,
      slotsRes,
      submissionsRes,
      knockoutEventsRes,
      knockoutSignupsRes,
    ] = await Promise.all([
      client.auth.getUser(),
      client.from("locations").select("id,name,address,contact_phone,contact_email").order("name"),
      client
        .from("players")
        .select("id,display_name,full_name,location_id,snooker_handicap,snooker_handicap_base")
        .eq("is_archived", false),
      client
        .from("league_seasons")
        .select("id,name,location_id,is_active,created_at,handicap_enabled,singles_count,doubles_count")
        .order("created_at", { ascending: false }),
      client.from("league_teams").select("id,season_id,location_id,name,is_active"),
      client.from("league_team_members").select("id,season_id,team_id,player_id,is_captain,is_vice_captain"),
      client.from("league_fixtures").select("id,season_id,location_id,week_no,fixture_date,home_team_id,away_team_id,status,home_points,away_points").order("fixture_date", { ascending: true }),
      client.from("league_fixture_frames").select("id,fixture_id,slot_no,slot_type,home_player1_id,home_player2_id,away_player1_id,away_player2_id,home_nominated,away_nominated,home_forfeit,away_forfeit,winner_side,home_nominated_name,away_nominated_name,home_points_scored,away_points_scored"),
      client
        .from("league_result_submissions")
        .select("id,fixture_id,season_id,location_id,submitted_by_user_id,submitter_team_id,frame_results,scorecard_photo_url,status,rejection_reason,created_at")
        .order("created_at", { ascending: false }),
      client
        .from("league_knockout_events")
        .select("id,name,competition_type,match_mode,format_label,age_min,sport_type,sort_order,signup_open,published,is_active")
        .order("sort_order", { ascending: true }),
      client
        .from("league_knockout_signups")
        .select("id,event_id,user_id,player_id,status,created_at")
        .order("created_at", { ascending: false }),
    ]);
    const regTeamsRes = await client.from("league_registered_teams").select("id,name,location_id").order("name");
    const regMembersRes = await client.from("league_registered_team_members").select("id,team_id,player_id,is_captain,is_vice_captain");

    const userId = authRes.data.user?.id ?? null;
    setCurrentUserId(userId);

    if (!admin.isSuper) {
      if (userId) {
        const appUserRes = await client.from("app_users").select("linked_player_id").eq("id", userId).maybeSingle();
        const linkedPlayerId = (appUserRes.data?.linked_player_id as string | null) ?? null;
        setCurrentUserPlayerId(linkedPlayerId);
        const myPlayer = linkedPlayerId
          ? await client.from("players").select("location_id").eq("id", linkedPlayerId).maybeSingle()
          : await client.from("players").select("location_id").eq("claimed_by", userId).maybeSingle();
        if (!myPlayer.error) setAdminLocationId(myPlayer.data?.location_id ?? null);
      }
    } else {
      const appUserRes = userId ? await client.from("app_users").select("linked_player_id").eq("id", userId).maybeSingle() : null;
      setCurrentUserPlayerId((appUserRes?.data?.linked_player_id as string | null) ?? null);
    }

    let locationRows = locRes.data ?? [];
    let locationErrorMessage = locRes.error?.message ?? null;
    if (locRes.error && (locRes.error.message.toLowerCase().includes("address") || locRes.error.message.toLowerCase().includes("contact_"))) {
      const fallbackLocs = await client.from("locations").select("id,name").order("name");
      if (!fallbackLocs.error) {
        locationRows = (fallbackLocs.data ?? []).map((l) => ({
          id: l.id as string,
          name: l.name as string,
          address: null,
          contact_phone: null,
          contact_email: null,
        }));
        locationErrorMessage = null;
      }
    }

    let playerRows = playersRes.data ?? [];
    let playerErrorMessage = playersRes.error?.message ?? null;
    if (playersRes.error && playersRes.error.message.toLowerCase().includes("is_archived")) {
      const fallbackPlayers = await client
        .from("players")
        .select("id,display_name,full_name,location_id,snooker_handicap,snooker_handicap_base");
      if (!fallbackPlayers.error) {
        playerRows = fallbackPlayers.data ?? [];
        playerErrorMessage = null;
      }
    }

    let seasonRows = seasonsRes.data ?? [];
    let seasonErrorMessage = seasonsRes.error?.message ?? null;
    if (seasonsRes.error && seasonsRes.error.message.toLowerCase().includes("handicap_enabled")) {
      const fallbackSeasons = await client
        .from("league_seasons")
        .select("id,name,location_id,is_active,created_at")
        .order("created_at", { ascending: false });
      if (!fallbackSeasons.error) {
        seasonRows = (fallbackSeasons.data ?? []).map((s) => ({
          ...s,
          handicap_enabled: false,
          singles_count: 4,
          doubles_count: 1,
        }));
        seasonErrorMessage = null;
      }
    }

    const firstError =
      locationErrorMessage ||
      playerErrorMessage ||
      seasonErrorMessage ||
      teamsRes.error?.message ||
      membersRes.error?.message ||
      fixturesRes.error?.message ||
      slotsRes.error?.message ||
      submissionsRes.error?.message ||
      knockoutEventsRes.error?.message ||
      knockoutSignupsRes.error?.message ||
      regTeamsRes.error?.message ||
      regMembersRes.error?.message ||
      null;

    if (firstError) {
      setMessage(`Partial load: ${firstError}`);
    }

    setLocations((locationRows ?? []) as Location[]);
    setPlayers(playerRows as Player[]);
    setSeasons(seasonRows as Season[]);
    setTeams((teamsRes.data ?? []) as Team[]);
    setMembers((membersRes.data ?? []) as TeamMember[]);
    setRegisteredTeams(regTeamsRes.error ? [] : ((regTeamsRes.data ?? []) as RegisteredTeam[]));
    setRegisteredMembers(regMembersRes.error ? [] : ((regMembersRes.data ?? []) as RegisteredTeamMember[]));
    setFixtures((fixturesRes.data ?? []) as Fixture[]);
    setSlots((slotsRes.data ?? []) as FrameSlot[]);
    setSubmissions((submissionsRes.data ?? []) as LeagueSubmission[]);
    setKnockoutEvents((knockoutEventsRes.data ?? []) as KnockoutEvent[]);
    setKnockoutSignups((knockoutSignupsRes.data ?? []) as KnockoutSignup[]);

    setLoading(false);
  }, [admin.isSuper]);

  useEffect(() => {
    if (!fixtureSlots.length) {
      queueMicrotask(() => {
        setNominatedNames({});
      });
      return;
    }
    const nominatedInit: Record<string, string> = {};
    for (const slot of fixtureSlots) {
      if (slot.home_nominated_name) nominatedInit[`${slot.id}:home`] = slot.home_nominated_name;
      if (slot.away_nominated_name) nominatedInit[`${slot.id}:away`] = slot.away_nominated_name;
    }
    queueMicrotask(() => {
      setNominatedNames(nominatedInit);
    });
  }, [fixtureSlots, fixtureId]);

  useEffect(() => {
    const client = supabase;
    if (!client || !fixtureId) return;
    let active = true;
    const run = async () => {
      const res = await client
        .from("league_fixture_breaks")
        .select("id,fixture_id,player_id,entered_player_name,break_value")
        .eq("fixture_id", fixtureId)
        .order("break_value", { ascending: false });
      if (!active) return;
      if (res.error) {
        if (res.error.message?.toLowerCase().includes("does not exist")) {
          setBreaksFeatureAvailable(false);
        } else {
          setMessage(res.error.message);
        }
        return;
      }
      setBreaksFeatureAvailable(true);
      const rows = (res.data ?? []).map((r) => ({
        id: r.id as string,
        fixture_id: r.fixture_id as string,
        player_id: (r.player_id as string | null) ?? null,
        entered_player_name: (r.entered_player_name as string | null) ?? "",
        break_value: String(r.break_value ?? ""),
      }));
      const padded: LeagueBreak[] = [...rows];
      while (padded.length < 4) padded.push({ player_id: null, entered_player_name: "", break_value: "" });
      setFixtureBreaks(padded);
    };
    void run();
    return () => {
      active = false;
    };
  }, [fixtureId]);

  useEffect(() => {
    if (!admin.loading) {
      queueMicrotask(() => {
        void loadAll();
      });
    }
  }, [admin.loading, loadAll]);

  useEffect(() => {
    if (!resultEntryOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [resultEntryOpen]);

  useEffect(() => {
    queueMicrotask(() => {
      setSelectedLeagueTeamNames([]);
    });
  }, [seasonId]);

  useEffect(() => {
    if (canOpenAdminTabs) return;
    if (activeView === "teamManagement" || activeView === "venues" || activeView === "profiles" || activeView === "setup") {
      queueMicrotask(() => {
        setActiveView("fixtures");
      });
    }
  }, [activeView, canOpenAdminTabs]);

  useEffect(() => {
    const venue = locations.find((l) => l.id === manageVenueId);
    if (!venue) return;
    const rawAddress = venue.address ?? "";
    const [addressLine, postcode] = rawAddress.split(" | ");
    queueMicrotask(() => {
      setManageVenueName(venue.name ?? "");
      setManageVenueAddress(addressLine ?? "");
      setManageVenuePostcode(postcode ?? "");
      setManageVenuePhone(venue.contact_phone ?? "");
      setManageVenueEmail(venue.contact_email ?? "");
      setVenuePlayerSearch("");
      setExpandedVenueTeams({});
      setShowAllVenueTeamMembers({});
      setShowUnassignedPlayers(false);
    });
  }, [locations, manageVenueId]);

  const createSeason = async () => {
    const client = supabase;
    if (!client) return;
    if (!canManage) {
      setMessage("Only Super User can manage league setup.");
      return;
    }
    const fallbackLocation = venueLocations[0]?.id ?? locations[0]?.id ?? null;
    if (!fallbackLocation) {
      setMessage("Cannot create league yet. First register at least one venue in Team Management (Step 1), then register teams (Step 2).");
      return;
    }
    const authRes = await client.auth.getUser();
    const creatorId = authRes.data.user?.id ?? null;
    const template = LEAGUE_TEMPLATES[seasonTemplate];
    const suffix = seasonName.trim();
    const computedSeasonName = `${LEAGUE_BODY_NAME} - ${template.label}${suffix ? ` ${suffix}` : ""}`;
    let ins = await client.from("league_seasons").insert({
      name: computedSeasonName,
      location_id: fallbackLocation,
      created_by_user_id: creatorId,
      handicap_enabled: seasonHandicapEnabled,
      sport_type: "snooker",
      points_per_frame: 1,
      singles_count: template.singlesCount,
      doubles_count: template.doublesCount,
      max_night_squad: 6,
      is_active: true,
    }).select("id").single();
    if (ins.error && ins.error.message.toLowerCase().includes("handicap_enabled")) {
      ins = await client
        .from("league_seasons")
        .insert({
          name: computedSeasonName,
          location_id: fallbackLocation,
          created_by_user_id: creatorId,
          sport_type: "snooker",
          points_per_frame: 1,
          singles_count: template.singlesCount,
          doubles_count: template.doublesCount,
          max_night_squad: 6,
          is_active: true,
        })
        .select("id")
        .single();
    }
    if (ins.error) {
      setMessage(ins.error.message);
      return;
    }
    setSeasonName("");
    setSeasonTemplate("winter");
    setSeasonHandicapEnabled(false);
    setSeasonId(ins.data.id);
    await loadAll();
    setInfoModal({
      title: "League Created",
      description: seasonHandicapEnabled
        ? "League created successfully. Handicap mode is enabled and reviewed from Elo."
        : "League created successfully. Handicap mode is disabled.",
    });
  };

  const copyRegisteredRosterToLeagueTeam = async (
    leagueTeamId: string,
    teamName: string,
    seasonIdValue: string
  ): Promise<string | null> => {
    const client = supabase;
    if (!client) return "Supabase is not configured.";
    const registeredTeam = registeredTeams.find((t) => t.name.toLowerCase() === teamName.toLowerCase());
    if (!registeredTeam) return null;
    const roster = registeredMembers.filter((m) => m.team_id === registeredTeam.id);
    if (roster.length === 0) return null;
    const copyRes = await client.from("league_team_members").upsert(
      roster.map((m) => ({
        season_id: seasonIdValue,
        team_id: leagueTeamId,
        player_id: m.player_id,
        is_captain: m.is_captain,
        is_vice_captain: m.is_vice_captain ?? false,
      })),
      { onConflict: "season_id,team_id,player_id" }
    );
    return copyRes.error?.message ?? null;
  };

  const addTeamsToLeague = async () => {
    const client = supabase;
    if (!client) return;
    if (!seasonId) {
      setMessage("Select a league first.");
      return;
    }
    const picked = Array.from(new Set(selectedLeagueTeamNames.map((t) => t.trim()).filter(Boolean)));
    if (picked.length === 0) {
      setMessage("Select at least one registered team.");
      return;
    }
    const season = seasons.find((s) => s.id === seasonId);
    if (!season) return;
    const existingNames = new Set(seasonTeams.map((t) => t.name.trim().toLowerCase()));
    const toAdd = picked.filter((name) => !existingNames.has(name.toLowerCase()));
    if (toAdd.length === 0) {
      setMessage("All selected teams are already in this league.");
      return;
    }
    let added = 0;
    const failed: string[] = [];
    for (const teamName of toAdd) {
      const ins = await client
        .from("league_teams")
        .insert({
          season_id: seasonId,
          location_id: season.location_id,
          name: teamName,
          is_active: true,
        })
        .select("id,name")
        .single();
      if (ins.error || !ins.data) {
        failed.push(`${teamName}${ins.error?.message ? `: ${ins.error.message}` : ""}`);
        continue;
      }
      const rosterError = await copyRegisteredRosterToLeagueTeam(ins.data.id, teamName, seasonId);
      if (rosterError) {
        failed.push(`${teamName}: ${rosterError}`);
        continue;
      }
      added += 1;
    }
    setSelectedLeagueTeamNames([]);
    await loadAll();
    if (failed.length > 0) {
      setMessage(`Added ${added} team(s). Some failed: ${failed.join(" | ")}`);
      return;
    }
    setInfoModal({ title: "Teams Added", description: `Added ${added} team(s) to the selected league.` });
  };

  const deleteRegisteredTeam = async (teamId: string) => {
    const client = supabase;
    if (!client) return;
    const team = registeredTeams.find((t) => t.id === teamId);
    if (!team) return;
    const inLeague = teams.some((t) => t.name.trim().toLowerCase() === team.name.trim().toLowerCase());
    if (inLeague) {
      setMessage(`Cannot delete "${team.name}" because it is already used in a league.`);
      return;
    }
    const ok = window.confirm(`Delete registered team "${team.name}"? This will remove team-player assignments.`);
    if (!ok) return;
    const delMembers = await client.from("league_registered_team_members").delete().eq("team_id", teamId);
    if (delMembers.error) {
      setMessage(delMembers.error.message);
      return;
    }
    const delTeam = await client.from("league_registered_teams").delete().eq("id", teamId);
    if (delTeam.error) {
      setMessage(delTeam.error.message);
      return;
    }
    if (registryTeamId === teamId) setRegistryTeamId("");
    await loadAll();
    setInfoModal({ title: "Team Deleted", description: `"${team.name}" was removed from registered teams.` });
  };

  const registerPlayersBulk = async () => {
    const client = supabase;
    if (!client) return;
    const locationId = newPlayerLocationId;
    if (!locationId) {
      setMessage("Select a location first.");
      return;
    }
    const lines = bulkPlayersText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      setMessage("Enter at least one player name (one per line).");
      return;
    }
    const parsed = lines
      .map((line) => {
        const cleaned = line.replace(/\s+/g, " ").trim();
        const commaParts = cleaned.split(",").map((x) => x.trim()).filter(Boolean);
        if (commaParts.length >= 2) return { first: commaParts[0], second: commaParts.slice(1).join(" ") };
        const words = cleaned.split(" ").filter(Boolean);
        if (words.length < 2) return null;
        return { first: words[0], second: words.slice(1).join(" ") };
      })
      .filter(Boolean) as { first: string; second: string }[];
    if (parsed.length === 0) {
      setMessage("Use one player per line: First Last (or First,Last).");
      return;
    }
    let created = 0;
    let addedToTeam = 0;
    const issues: string[] = [];
    for (const row of parsed) {
      const fullName = `${row.first.trim()} ${row.second.trim()}`.trim();
      const displayName = row.first.trim();
      const duplicateCheck = await client
        .from("players")
        .select("id")
        .eq("location_id", locationId)
        .ilike("full_name", fullName)
        .eq("is_archived", false)
        .limit(1);
      if (duplicateCheck.error) {
        issues.push(`${fullName}: duplicate check failed`);
        continue;
      }
      if ((duplicateCheck.data ?? []).length > 0) {
        issues.push(`${fullName}: already exists`);
        continue;
      }
      const playerInsert = await client
        .from("players")
        .insert({
          display_name: displayName,
          first_name: row.first.trim(),
          nickname: null,
          full_name: fullName,
          is_archived: false,
          location_id: locationId,
        })
        .select("id")
        .single();
      if (playerInsert.error || !playerInsert.data) {
        issues.push(`${fullName}: ${playerInsert.error?.message ?? "create failed"}`);
        continue;
      }
      created += 1;
      if (registryTeamId) {
        const memberInsert = await client.from("league_registered_team_members").insert({
          team_id: registryTeamId,
          player_id: playerInsert.data.id,
          is_captain: false,
          is_vice_captain: false,
        });
        if (memberInsert.error) {
          issues.push(`${fullName}: created, team add failed`);
        } else {
          addedToTeam += 1;
        }
      }
    }
    await loadAll();
    setBulkPlayersText("");
    setInfoModal({
      title: "Bulk Player Register Complete",
      description:
        issues.length > 0
          ? `Created ${created}. Added to team ${addedToTeam}. Issues: ${issues.slice(0, 5).join(" | ")}${issues.length > 5 ? " ..." : ""}`
          : `Created ${created} player(s)${registryTeamId ? ` and added ${addedToTeam} to selected team` : ""}.`,
    });
  };

  const createRegisteredTeam = async () => {
    const client = supabase;
    if (!client) return;
    if (!registryVenueId) {
      setMessage("Select a venue.");
      return;
    }
    if (!registryTeamName.trim()) {
      setMessage("Enter a team name.");
      return;
    }
    const { error } = await client.from("league_registered_teams").insert({
      name: registryTeamName.trim(),
      location_id: registryVenueId,
    });
    if (error) {
      setMessage(error.message);
      return;
    }
    setRegistryTeamName("");
    setRegistryVenueId("");
    await loadAll();
  };

  const createVenue = async () => {
    const client = supabase;
    if (!client) return;
    const name = newVenueName.trim();
    if (!name) {
      setMessage("Enter a venue name.");
      return;
    }
    const { data, error } = await client.from("locations").insert({ name }).select("id").single();
    if (error) {
      if (error.message?.includes("locations_name_key")) {
        setInfoModal({
          title: "Venue Already Exists",
          description: `"${name}" is already registered. Select it from the venue list below.`,
        });
      } else {
        setMessage(error.message);
      }
      return;
    }
    setNewVenueName("");
    setRegistryVenueId(data.id);
    setNewPlayerLocationId(data.id);
    await loadAll();
    setInfoModal({ title: "Venue Registered", description: `${name} was added.` });
  };

  const saveVenueDetails = async () => {
    const client = supabase;
    if (!client) return;
    if (!manageVenueId) {
      setMessage("Select a venue first.");
      return;
    }
    const cleanName = manageVenueName.trim();
    if (!cleanName) {
      setMessage("Venue name is required.");
      return;
    }
    const { error } = await client
      .from("locations")
      .update({
        name: cleanName,
        address: [manageVenueAddress.trim(), manageVenuePostcode.trim()].filter(Boolean).join(" | ") || null,
        contact_phone: manageVenuePhone.trim() || null,
        contact_email: manageVenueEmail.trim() || null,
      })
      .eq("id", manageVenueId);
    if (error) {
      if (error.message?.includes("locations_name_key")) {
        setInfoModal({
          title: "Venue Already Exists",
          description: `"${cleanName}" already exists. Use a different venue name.`,
        });
      } else {
        setMessage(error.message);
      }
      return;
    }
    await loadAll();
    setInfoModal({ title: "Venue Updated", description: "Venue details saved." });
  };

  const removeRegisteredMember = async (memberId: string) => {
    const client = supabase;
    if (!client) return;
    const { error } = await client.from("league_registered_team_members").delete().eq("id", memberId);
    if (error) {
      setMessage(error.message);
      return;
    }
    await loadAll();
  };

  const registerPlayerForClub = async (addToSelectedTeam: boolean) => {
    const client = supabase;
    if (!client) return;
    const first = newPlayerFirstName.trim();
    const second = newPlayerSecondName.trim();
    if (!first || !second) {
      setMessage("Enter first and second name.");
      return;
    }
    if (!newPlayerLocationId) {
      setMessage("Select a location for the new player.");
      return;
    }
    const fullName = `${first} ${second}`;
    const displayName = first;
    const duplicateCheck = await client
      .from("players")
      .select("id")
      .eq("location_id", newPlayerLocationId)
      .ilike("full_name", fullName)
      .eq("is_archived", false)
      .limit(1);
    if (duplicateCheck.error) {
      setMessage(`Failed to check duplicates: ${duplicateCheck.error.message}`);
      return;
    }
    if ((duplicateCheck.data ?? []).length > 0) {
      setInfoModal({
        title: "Possible Duplicate",
        description: `${fullName} already exists at this venue. Use the transfer flow in Step 4 if this is the same person moving club/team.`,
      });
      return;
    }
    const playerInsert = await client
      .from("players")
      .insert({
        display_name: displayName,
        first_name: first,
        nickname: null,
        full_name: fullName,
        is_archived: false,
        location_id: newPlayerLocationId,
      })
      .select("id")
      .single();
    if (playerInsert.error) {
      if (playerInsert.error.message.includes("players_display_name_lower_uniq")) {
        setMessage(`A player with display name "${displayName}" already exists. Use Select player instead.`);
        return;
      }
      setMessage(`Failed to register player: ${playerInsert.error.message}`);
      return;
    }
    if (addToSelectedTeam) {
      if (!registryTeamId) {
        setMessage("Player created for club. Select a team to add them.");
        await loadAll();
        return;
      }
      const selectedTeam = registeredTeams.find((t) => t.id === registryTeamId);
      if (!selectedTeam || selectedTeam.location_id !== newPlayerLocationId) {
        setMessage("Selected team must be at the same venue as the player.");
        await loadAll();
        return;
      }
      const memberInsert = await client.from("league_registered_team_members").insert({
        team_id: registryTeamId,
        player_id: playerInsert.data.id,
        is_captain: false,
        is_vice_captain: false,
      });
      if (memberInsert.error) {
        setMessage(`Player was created, but could not be added to team: ${memberInsert.error.message}`);
        return;
      }
    }
    setNewPlayerFirstName("");
    setNewPlayerSecondName("");
    setNewPlayerLocationId("");
    await loadAll();
    setInfoModal({
      title: "Player Registered",
      description: addToSelectedTeam
        ? `${fullName} was created for the club and added to the selected team.`
        : `${fullName} was created for the selected club.`,
    });
  };

  const transferPlayerClubTeam = async () => {
    const client = supabase;
    if (!client) return;
    if (!transferFromVenueId) {
      setMessage("Select current venue first.");
      return;
    }
    if (!transferPlayerId) {
      setMessage("Select a player to transfer.");
      return;
    }
    if (!transferVenueId) {
      setMessage("Select the destination venue.");
      return;
    }
    if (!transferDestinationTeamId) {
      setMessage("Select the destination team.");
      return;
    }
    const selectedTeam = registeredTeams.find((t) => t.id === transferDestinationTeamId);
    if (!selectedTeam || selectedTeam.location_id !== transferVenueId) {
      setMessage("Destination team must belong to the selected destination venue.");
      return;
    }
    if (transferFromVenueId !== transferVenueId) {
      const updatePlayer = await client.from("players").update({ location_id: transferVenueId }).eq("id", transferPlayerId);
      if (updatePlayer.error) {
        setMessage(`Failed to update player venue: ${updatePlayer.error.message}`);
        return;
      }
    }
    const removeFromTeams = await client.from("league_registered_team_members").delete().eq("player_id", transferPlayerId);
    if (removeFromTeams.error) {
      setMessage(`Venue updated, but failed to remove old team links: ${removeFromTeams.error.message}`);
      return;
    }
    const addToDestinationTeam = await client
      .from("league_registered_team_members")
      .insert({
        team_id: transferDestinationTeamId,
        player_id: transferPlayerId,
        is_captain: false,
        is_vice_captain: false,
      });
    if (addToDestinationTeam.error) {
      setMessage(`Club/venue updated, but failed to add to destination team: ${addToDestinationTeam.error.message}`);
      return;
    }
    await loadAll();
    const playerName = named(playerById.get(transferPlayerId));
    const venueName = locationLabel(locations.find((l) => l.id === transferVenueId)?.name ?? "selected venue");
    const teamName = registeredTeams.find((t) => t.id === transferDestinationTeamId)?.name ?? "selected team";
    setInfoModal({
      title: "Transfer Complete",
      description: `${playerName} moved to ${venueName} and was assigned to ${teamName}. Previous team links were removed.`,
    });
    setTransferFromVenueId("");
    setTransferPlayerId("");
    setTransferVenueId("");
    setTransferDestinationTeamId("");
  };

  const createFixture = async () => {
    const client = supabase;
    if (!client) return;
    if (!seasonId || !fixtureHome || !fixtureAway) {
      setMessage("Select league, home team, and away team.");
      return;
    }
    if (fixtureHome === fixtureAway) {
      setMessage("Home and away teams must be different.");
      return;
    }
    const season = seasons.find((s) => s.id === seasonId);
    if (!season) return;
    const ins = await client
      .from("league_fixtures")
      .insert({
        season_id: seasonId,
        location_id: season.location_id,
        week_no: fixtureWeek ? Number.parseInt(fixtureWeek, 10) : null,
        fixture_date: fixtureDate || null,
        home_team_id: fixtureHome,
        away_team_id: fixtureAway,
      })
      .select("id")
      .single();
    if (ins.error) {
      setMessage(ins.error.message);
      return;
    }
    setFixtureWeek("");
    setFixtureDate("");
    setFixtureHome("");
    setFixtureAway("");
    setFixtureId(ins.data.id);
    await loadAll();
  };

  const generateFixtures = async () => {
    const client = supabase;
    if (!client) return;
    if (!seasonId) {
      setMessage("Select a league first.");
      return;
    }
    const getBreakWeeksFromDates = (): number[] => {
      if (!genStartDate || breakDates.length === 0) return [];
      const start = new Date(`${genStartDate}T12:00:00`);
      const values = new Set<number>();
      for (const d of breakDates) {
        const dt = new Date(`${d}T12:00:00`);
        const diffDays = Math.floor((dt.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        const weekNo = Math.floor(diffDays / 7) + 1;
        if (Number.isInteger(weekNo) && weekNo > 0) values.add(weekNo);
      }
      return Array.from(values).sort((a, b) => a - b);
    };
    if (!genStartDate && breakDates.length > 0) {
      setMessage("Select a start date before adding reserved weeks.");
      return;
    }
    const { data, error } = await client.rpc("generate_league_fixtures", {
      p_season_id: seasonId,
      p_start_date: genStartDate || null,
      p_double_round: genDoubleRound,
      p_clear_existing: genClearExisting,
      p_break_weeks: getBreakWeeksFromDates(),
    });
    if (error) {
      setMessage(error.message);
      return;
    }
    await loadAll();
    setInfoModal({
      title: "Fixtures Generated",
      description: `Generated ${Number(data ?? 0)} fixtures for the selected league.`,
    });
  };

  const applyBreakWeeksToExisting = async () => {
    const client = supabase;
    if (!client) return;
    if (!seasonId) {
      setMessage("Select a league first.");
      return;
    }
    if (!genStartDate) {
      setMessage("Enter a start date first.");
      return;
    }
    const start = new Date(`${genStartDate}T12:00:00`);
    const values = new Set<number>();
    for (const d of breakDates) {
      const dt = new Date(`${d}T12:00:00`);
      const diffDays = Math.floor((dt.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      const weekNo = Math.floor(diffDays / 7) + 1;
      if (Number.isInteger(weekNo) && weekNo > 0) values.add(weekNo);
    }
    const breakWeeks = Array.from(values).sort((a, b) => a - b);
    const { data, error } = await client.rpc("recalculate_league_fixture_dates", {
      p_season_id: seasonId,
      p_start_date: genStartDate,
      p_break_weeks: breakWeeks,
    });
    if (error) {
      setMessage(error.message);
      return;
    }
    await loadAll();
    setInfoModal({
      title: "Fixture Dates Updated",
      description: `Updated ${Number(data ?? 0)} fixtures.`,
    });
  };

  const addBreakDate = () => {
    if (!breakDateInput) return;
    if (!genStartDate) {
      setMessage("Select a start date before adding reserved weeks.");
      return;
    }
    if (breakDates.includes(breakDateInput)) return;
    setBreakDates((prev) => [...prev, breakDateInput].sort((a, b) => a.localeCompare(b)));
    setBreakDateInput("");
  };

  const removeBreakDate = (dateValue: string) => {
    setBreakDates((prev) => prev.filter((d) => d !== dateValue));
  };

  const deriveWinnerFromFrame = (row: FrameSlot): "home" | "away" | null => {
    if (row.home_forfeit && row.away_forfeit) return null;
    if (row.home_forfeit && !row.away_forfeit) return "away";
    if (row.away_forfeit && !row.home_forfeit) return "home";

    if (row.slot_type === "doubles") {
      const homeReady = Boolean(row.home_player1_id) && Boolean(row.home_player2_id);
      const awayReady = Boolean(row.away_player1_id) && Boolean(row.away_player2_id);
      if (!homeReady || !awayReady) return null;
    } else {
      const homeReady = row.home_nominated ? true : Boolean(row.home_player1_id);
      const awayReady = row.away_nominated ? true : Boolean(row.away_player1_id);
      if (!homeReady || !awayReady) return null;
    }

    const homePts = typeof row.home_points_scored === "number" ? row.home_points_scored : null;
    const awayPts = typeof row.away_points_scored === "number" ? row.away_points_scored : null;
    if (homePts === null || awayPts === null) return null;
    if (homePts > awayPts) return "home";
    if (awayPts > homePts) return "away";
    return null;
  };

  const updateFrameWithDerivedWinner = async (slot: FrameSlot, patch: Partial<FrameSlot>) => {
    const merged = { ...slot, ...patch } as FrameSlot;
    await updateSlot(slot.id, { ...patch, winner_side: deriveWinnerFromFrame(merged) });
  };

  const getSinglesSelectionValue = (slot: FrameSlot, side: "home" | "away") => {
    const playerId = side === "home" ? slot.home_player1_id : slot.away_player1_id;
    const nominated = side === "home" ? slot.home_nominated : slot.away_nominated;
    const forfeit = side === "home" ? slot.home_forfeit : slot.away_forfeit;
    if (forfeit) return "__NO_SHOW__";
    if (nominated) return "__NOMINATED__";
    return playerId ?? "";
  };

  const applySinglesSelection = async (
    slot: FrameSlot,
    side: "home" | "away",
    selection: string
  ) => {
    const sidePrefix = side === "home" ? "home" : "away";
    const nameKey = side === "home" ? "home_nominated_name" : "away_nominated_name";
    if (selection === "__NO_SHOW__") {
      setNominatedNames((prev) => ({ ...prev, [`${slot.id}:${side}`]: "" }));
      await updateFrameWithDerivedWinner(slot, {
        [`${sidePrefix}_player1_id`]: null,
        [`${sidePrefix}_nominated`]: false,
        [`${sidePrefix}_forfeit`]: true,
        [`${sidePrefix}_points_scored`]: 0,
        [nameKey]: null,
      } as Partial<FrameSlot>);
      return;
    }
    if (selection === "__NOMINATED__") {
      await updateFrameWithDerivedWinner(slot, {
        [`${sidePrefix}_player1_id`]: null,
        [`${sidePrefix}_nominated`]: true,
        [`${sidePrefix}_forfeit`]: false,
      } as Partial<FrameSlot>);
      return;
    }
    setNominatedNames((prev) => ({ ...prev, [`${slot.id}:${side}`]: "" }));
    await updateFrameWithDerivedWinner(slot, {
      [`${sidePrefix}_player1_id`]: selection || null,
      [`${sidePrefix}_nominated`]: false,
      [`${sidePrefix}_forfeit`]: false,
      [nameKey]: null,
    } as Partial<FrameSlot>);
  };

  const updateFramePoints = async (slot: FrameSlot, side: "home" | "away", rawValue: string) => {
    const parsedRaw = rawValue === "" ? null : Number.parseInt(rawValue, 10);
    const parsed = parsedRaw === null || Number.isNaN(parsedRaw) ? null : Math.min(200, Math.max(0, parsedRaw));
    const field = side === "home" ? "home_points_scored" : "away_points_scored";
    await updateFrameWithDerivedWinner(slot, { [field]: parsed } as Partial<FrameSlot>);
  };

  const updateNominatedName = async (slot: FrameSlot, side: "home" | "away", value: string) => {
    const key = `${slot.id}:${side}`;
    setNominatedNames((prev) => ({ ...prev, [key]: value }));
    const column = side === "home" ? "home_nominated_name" : "away_nominated_name";
    const client = supabase;
    if (!client) return;
    const { error } = await client
      .from("league_fixture_frames")
      .update({ [column]: value.trim() || null } as Record<string, string | null>)
      .eq("id", slot.id);
    if (error) {
      setMessage(error.message);
    }
  };

  const setBreakField = (idx: number, patch: Partial<LeagueBreak>) => {
    setFixtureBreaks((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const addBreakRow = () => {
    setFixtureBreaks((prev) => [...prev, { player_id: null, entered_player_name: "", break_value: "" }]);
  };

  const saveFixtureBreaks = async () => {
    const client = supabase;
    if (!client || !fixtureId) return;
    if (!breaksFeatureAvailable) {
      setMessage("Breaks 30+ table is not available yet. Run the league breaks SQL migration.");
      return;
    }
    const valid = fixtureBreaks
      .map((r) => ({
        player_id: r.player_id || null,
        entered_player_name: r.entered_player_name.trim() || null,
        break_value: Number(r.break_value || 0),
      }))
      .filter((r) => Number.isFinite(r.break_value) && r.break_value >= 30 && (r.player_id || r.entered_player_name));

    const slotRows = fixtureSlots;
    const pointsByPlayer = new Map<string, number>();
    for (const slot of slotRows) {
      const homePoints = typeof slot.home_points_scored === "number" ? slot.home_points_scored : 0;
      const awayPoints = typeof slot.away_points_scored === "number" ? slot.away_points_scored : 0;
      const homePlayers = [slot.home_player1_id, slot.home_player2_id].filter(Boolean) as string[];
      const awayPlayers = [slot.away_player1_id, slot.away_player2_id].filter(Boolean) as string[];
      for (const id of homePlayers) {
        const prev = pointsByPlayer.get(id) ?? 0;
        pointsByPlayer.set(id, Math.max(prev, homePoints));
      }
      for (const id of awayPlayers) {
        const prev = pointsByPlayer.get(id) ?? 0;
        pointsByPlayer.set(id, Math.max(prev, awayPoints));
      }
    }
    for (const row of valid) {
      if (!row.player_id) continue;
      const maxFramePoints = pointsByPlayer.get(row.player_id);
      if (maxFramePoints === undefined) {
        setMessage("Break entry failed: selected player is not part of this fixture.");
        return;
      }
      if (row.break_value > maxFramePoints) {
        setMessage(
          `Break entry failed: ${row.break_value} exceeds the player's frame points (${maxFramePoints}).`
        );
        return;
      }
    }

    const del = await client.from("league_fixture_breaks").delete().eq("fixture_id", fixtureId);
    if (del.error) {
      setMessage(del.error.message);
      return;
    }
    if (valid.length) {
      const ins = await client.from("league_fixture_breaks").insert(
        valid.map((r) => ({
          fixture_id: fixtureId,
          player_id: r.player_id,
          entered_player_name: r.entered_player_name,
          break_value: r.break_value,
        }))
      );
      if (ins.error) {
        setMessage(ins.error.message);
        return;
      }
    }
    await loadAll();
    setInfoModal({ title: "Breaks Saved", description: "Breaks 30+ have been recorded for this fixture." });
  };

  const recalculateSnookerHandicaps = async () => {
    const client = supabase;
    if (!client) return;
    const playersRes = await client
      .from("players")
      .select("id,rating_snooker,snooker_handicap,snooker_handicap_base")
      .eq("is_archived", false);
    if (playersRes.error) {
      // Demo schema may not yet include handicap columns.
      if (playersRes.error.message.toLowerCase().includes("snooker_handicap")) return;
      setMessage(playersRes.error.message);
      return;
    }
    const activePlayers = (playersRes.data ?? []) as Array<{
      id: string;
      rating_snooker: number | null;
      snooker_handicap: number | null;
      snooker_handicap_base: number | null;
    }>;
    const historyRows: Array<{
      player_id: string;
      previous_handicap: number;
      new_handicap: number;
      delta: number;
      reason: string;
      changed_by: string | null;
      fixture_id: null;
    }> = [];

    for (const player of activePlayers) {
      const rating = Math.round(player.rating_snooker ?? 1000);
      const target = Math.round((((1000 - rating) / 5) / 4)) * 4;
      const current = player.snooker_handicap ?? player.snooker_handicap_base ?? target;
      const delta = target - current;
      const step = delta === 0 ? 0 : Math.max(-4, Math.min(4, delta));
      const nextHandicap = current + step;
      const base = player.snooker_handicap_base ?? current;
      const { error } = await client
        .from("players")
        .update({ snooker_handicap: nextHandicap, snooker_handicap_base: base })
        .eq("id", player.id);
      if (error) {
        setMessage(error.message);
        return;
      }
      if (nextHandicap !== current) {
        historyRows.push({
          player_id: player.id,
          previous_handicap: current,
          new_handicap: nextHandicap,
          delta: nextHandicap - current,
          reason: "Weekly Elo review",
          changed_by: admin.userId ?? null,
          fixture_id: null,
        });
      }
    }

    if (historyRows.length > 0) {
      const historyRes = await client.from("snooker_handicap_history").insert(historyRows);
      if (historyRes.error && !historyRes.error.message.toLowerCase().includes("snooker_handicap_history")) {
        setMessage(historyRes.error.message);
        return;
      }
    }
  };

  const recomputeFixtureScore = async (fixtureTargetId: string) => {
    const client = supabase;
    if (!client) return;
    const framesRes = await client
      .from("league_fixture_frames")
      .select("slot_no,winner_side,home_forfeit,away_forfeit")
      .eq("fixture_id", fixtureTargetId);
    if (framesRes.error) {
      setMessage(framesRes.error.message);
      return;
    }
    const frameRows = (framesRes.data ?? []) as Array<{
      slot_no: number;
      winner_side: "home" | "away" | null;
      home_forfeit: boolean;
      away_forfeit: boolean;
    }>;
    const fixtureSeasonId = fixtures.find((f) => f.id === fixtureTargetId)?.season_id ?? null;
    const cfg = getSeasonFrameConfig(fixtureSeasonId ? seasonById.get(fixtureSeasonId) : null);
    const homePoints = frameRows.filter((r) => r.winner_side === "home").length;
    const awayPoints = frameRows.filter((r) => r.winner_side === "away").length;
    const expectedSlotNos = new Set(
      frameRows
        .map((r) => r.slot_no)
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= cfg.total)
    );
    const completedSlotNos = new Set(
      frameRows
        .filter((r) => r.winner_side !== null || r.home_forfeit || r.away_forfeit)
        .map((r) => r.slot_no)
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= cfg.total)
    );
    const expectedCount = expectedSlotNos.size || cfg.total;
    const completedCount = completedSlotNos.size;
    const status: Fixture["status"] =
      completedCount === 0 ? "pending" : completedCount >= expectedCount ? "complete" : "in_progress";
    const { data: fixtureRow, error: fixtureErr } = await client
      .from("league_fixtures")
      .update({ home_points: homePoints, away_points: awayPoints, status })
      .eq("id", fixtureTargetId)
      .select("id,season_id,location_id,week_no,fixture_date,home_team_id,away_team_id,status,home_points,away_points")
      .single();
    if (fixtureErr) {
      setMessage(fixtureErr.message);
      return;
    }
    setFixtures((prev) => prev.map((f) => (f.id === fixtureTargetId ? ({ ...f, ...(fixtureRow as Fixture) }) : f)));
    await recalculateSnookerHandicaps();
  };

  const computeFixtureProgress = useCallback((fixtureValue: Fixture) => {
    const frameRows = fixtureSlotsByFixtureId.get(fixtureValue.id) ?? [];
    const cfg = getSeasonFrameConfig(seasonById.get(fixtureValue.season_id));
    const homePoints = frameRows.filter((r) => r.winner_side === "home").length;
    const awayPoints = frameRows.filter((r) => r.winner_side === "away").length;
    const expectedSlotNos = new Set(
      frameRows
        .map((r) => r.slot_no)
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= cfg.total)
    );
    const completedSlotNos = new Set(
      frameRows
        .filter((r) => r.winner_side !== null || r.home_forfeit || r.away_forfeit)
        .map((r) => r.slot_no)
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= cfg.total)
    );
    const expectedCount = expectedSlotNos.size || cfg.total;
    const completedCount = completedSlotNos.size;
    const status: Fixture["status"] =
      completedCount === 0 ? "pending" : completedCount >= expectedCount ? "complete" : "in_progress";
    return { homePoints, awayPoints, status, completedCount, expectedCount };
  }, [fixtureSlotsByFixtureId, seasonById]);

  useEffect(() => {
    const client = supabase;
    if (!client || activeView !== "fixtures" || !seasonId || statusBackfillSeasonId === seasonId) return;
    let cancelled = false;
    const run = async () => {
      const targets = seasonFixtures.filter((f) => {
        const computed = computeFixtureProgress(f);
        return (
          f.status !== computed.status ||
          f.home_points !== computed.homePoints ||
          f.away_points !== computed.awayPoints
        );
      });
      for (const f of targets) {
        if (cancelled) return;
        const computed = computeFixtureProgress(f);
        const { error } = await client
          .from("league_fixtures")
          .update({
            status: computed.status,
            home_points: computed.homePoints,
            away_points: computed.awayPoints,
          })
          .eq("id", f.id);
        if (error) {
          setMessage(error.message);
          return;
        }
      }
      setStatusBackfillSeasonId(seasonId);
      if (!cancelled && targets.length > 0) await loadAll();
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [activeView, seasonId, statusBackfillSeasonId, seasonFixtures, computeFixtureProgress, loadAll]);

  const updateSlot = async (slotId: string, patch: Partial<FrameSlot>) => {
    const client = supabase;
    if (!client) return;
    const { data, error } = await client
      .from("league_fixture_frames")
      .update(patch)
      .eq("id", slotId)
      .select("id,fixture_id,slot_no,slot_type,home_player1_id,home_player2_id,away_player1_id,away_player2_id,home_nominated,away_nominated,home_forfeit,away_forfeit,winner_side,home_nominated_name,away_nominated_name,home_points_scored,away_points_scored")
      .single();
    if (error) {
      setMessage(error.message);
      return;
    }
    if (data) {
      setSlots((prev) => prev.map((s) => (s.id === slotId ? ({ ...s, ...(data as FrameSlot) }) : s)));
      await recomputeFixtureScore((data as FrameSlot).fixture_id);
    }
  };

  const setRegisteredCaptain = async (member: RegisteredTeamMember, next: boolean) => {
    const client = supabase;
    if (!client) return;
    if (next) {
      const clear = await client.from("league_registered_team_members").update({ is_captain: false }).eq("team_id", member.team_id);
      if (clear.error) {
        setMessage(clear.error.message);
        return;
      }
    }
    const { error } = await client
      .from("league_registered_team_members")
      .update({ is_captain: next, is_vice_captain: next ? false : member.is_vice_captain })
      .eq("id", member.id);
    if (error) {
      setMessage(error.message);
      return;
    }
    await loadAll();
  };

  const setRegisteredViceCaptain = async (member: RegisteredTeamMember, next: boolean) => {
    const client = supabase;
    if (!client) return;
    if (next) {
      const clear = await client.from("league_registered_team_members").update({ is_vice_captain: false }).eq("team_id", member.team_id);
      if (clear.error) {
        setMessage(clear.error.message);
        return;
      }
    }
    const { error } = await client
      .from("league_registered_team_members")
      .update({ is_vice_captain: next, is_captain: next ? false : member.is_captain })
      .eq("id", member.id);
    if (error) {
      setMessage(error.message);
      return;
    }
    await loadAll();
  };

  const reviewSubmission = async (submissionId: string, decision: "approved" | "rejected") => {
    const client = supabase;
    if (!client) return;
    if (!canApproveSubmissions) {
      setMessage("Only Super User can review submissions.");
      return;
    }
    const submission = submissions.find((s) => s.id === submissionId);
    if (!submission) return;
    if (decision === "approved") {
      for (const item of submission.frame_results ?? []) {
        if (!item?.slot_no || !item.winner_side) continue;
        const slot = slots.find((s) => s.fixture_id === submission.fixture_id && s.slot_no === item.slot_no);
        if (!slot) continue;
        const { error: slotErr } = await client
          .from("league_fixture_frames")
          .update({ winner_side: item.winner_side })
          .eq("id", slot.id);
        if (slotErr) {
          setMessage(slotErr.message);
          return;
        }
      }
      await recomputeFixtureScore(submission.fixture_id);
    }
    const { error } = await client
      .from("league_result_submissions")
      .update({
        status: decision,
        rejection_reason: decision === "rejected" ? (reviewReason.trim() || "Rejected by reviewer") : null,
        reviewed_by_user_id: admin.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", submissionId);
    if (error) {
      setMessage(error.message);
      return;
    }
    setReviewReason("");
    await loadAll();
    setInfoModal({ title: decision === "approved" ? "Submission Approved" : "Submission Rejected", description: "Review has been saved." });
  };

  const publishFixtures = async () => {
    const client = supabase;
    if (!client) return;
    if (!admin.isSuper || !seasonId || !currentSeason || !admin.userId) {
      setMessage("Only Super User can publish fixtures.");
      return;
    }
    const { error } = await client.from("league_fixture_publications").insert({
      season_id: seasonId,
      location_id: currentSeason.location_id,
      published_by_user_id: admin.userId,
      note: "Fixtures are now published. Captains can submit match-night results.",
    });
    if (error) {
      setMessage(error.message);
      return;
    }
    setInfoModal({ title: "Fixtures Published", description: "A notification is now available in user inboxes." });
  };

  const updateKnockoutEvent = async (eventId: string, patch: Partial<KnockoutEvent>) => {
    const client = supabase;
    if (!client) return;
    if (!admin.isSuper) {
      setMessage("Only Super User can manage knockout competitions.");
      return;
    }
    const { error } = await client.from("league_knockout_events").update(patch).eq("id", eventId);
    if (error) {
      setMessage(error.message);
      return;
    }
    await loadAll();
  };

  const enterKnockout = async (eventId: string) => {
    const client = supabase;
    if (!client || !currentUserId) return;
    if (!currentUserPlayerId) {
      setMessage("Link your player profile before entering a knockout competition.");
      return;
    }
    const existing = knockoutSignups.find((s) => s.event_id === eventId && s.user_id === currentUserId);
    if (existing && (existing.status === "approved" || existing.status === "pending")) {
      setMessage("You are already entered for this knockout competition.");
      return;
    }
    if (existing) {
      const { error } = await client
        .from("league_knockout_signups")
        .update({ status: "approved", player_id: currentUserPlayerId })
        .eq("id", existing.id);
      if (error) {
        setMessage(error.message);
        return;
      }
    } else {
      const { error } = await client.from("league_knockout_signups").insert({
        event_id: eventId,
        user_id: currentUserId,
        player_id: currentUserPlayerId,
        status: "approved",
      });
      if (error) {
        setMessage(error.message);
        return;
      }
    }
    await loadAll();
    setInfoModal({ title: "Entry Submitted", description: "You are now entered for this knockout competition." });
  };

  const withdrawKnockout = async (eventId: string) => {
    const client = supabase;
    if (!client || !currentUserId) return;
    const existing = knockoutSignups.find(
      (s) => s.event_id === eventId && s.user_id === currentUserId && (s.status === "approved" || s.status === "pending")
    );
    if (!existing) return;
    const { error } = await client.from("league_knockout_signups").update({ status: "withdrawn" }).eq("id", existing.id);
    if (error) {
      setMessage(error.message);
      return;
    }
    await loadAll();
    setInfoModal({ title: "Entry Withdrawn", description: "Your knockout entry was withdrawn." });
  };

  const deleteSeason = async () => {
    const client = supabase;
    if (!client) return;
    if (!seasonId) {
      setMessage("Select a subdivision first.");
      return;
    }
    setConfirmDeleteOpen(true);
  };

  const confirmDeleteSeason = async () => {
    const client = supabase;
    if (!client || !seasonId) return;
    const { error } = await client.from("league_seasons").delete().eq("id", seasonId);
    if (error) {
      setMessage(error.message);
      return;
    }
    setConfirmDeleteOpen(false);
    setSeasonId("");
    await loadAll();
    setInfoModal({ title: "League Deleted", description: "League and related data were deleted." });
  };

  const seasonTable = useMemo(() => {
    type FormEntry = { sortKey: number; result: "W" | "L" | "D" };
    const stats = new Map<
      string,
      {
        team_id: string;
        team_name: string;
        played: number;
        won: number;
        lost: number;
        frames_for: number;
        frames_against: number;
        points: number;
        form: FormEntry[];
      }
    >();

    for (const t of seasonTeams) {
      stats.set(t.id, {
        team_id: t.id,
        team_name: t.name,
        played: 0,
        won: 0,
        lost: 0,
        frames_for: 0,
        frames_against: 0,
        points: 0,
        form: [],
      });
    }

    for (const f of seasonFixtures) {
      const computed = computeFixtureProgress(f);
      if (computed.status !== "complete") continue;
      const home = stats.get(f.home_team_id);
      const away = stats.get(f.away_team_id);
      if (!home || !away) continue;
      const dateSort = f.fixture_date ? new Date(`${f.fixture_date}T12:00:00`).getTime() : (f.week_no ?? 0) * 7 * 24 * 60 * 60 * 1000;
      const homePts = computed.homePoints;
      const awayPts = computed.awayPoints;

      home.played += 1;
      away.played += 1;
      home.frames_for += homePts;
      home.frames_against += awayPts;
      away.frames_for += awayPts;
      away.frames_against += homePts;
      home.points = home.frames_for;
      away.points = away.frames_for;

      if (homePts > awayPts) {
        home.won += 1;
        away.lost += 1;
        home.form.push({ sortKey: dateSort, result: "W" });
        away.form.push({ sortKey: dateSort, result: "L" });
      } else if (awayPts > homePts) {
        away.won += 1;
        home.lost += 1;
        away.form.push({ sortKey: dateSort, result: "W" });
        home.form.push({ sortKey: dateSort, result: "L" });
      } else {
        home.form.push({ sortKey: dateSort, result: "D" });
        away.form.push({ sortKey: dateSort, result: "D" });
      }
    }

    const rows = Array.from(stats.values()).map((row) => {
      const ordered = row.form.sort((a, b) => a.sortKey - b.sortKey);
      const lastFive = ordered.slice(-5).map((f) => f.result).join(" ");
      let streak = "-";
      if (ordered.length > 0) {
        const last = ordered[ordered.length - 1].result;
        let count = 1;
        for (let i = ordered.length - 2; i >= 0; i -= 1) {
          if (ordered[i].result !== last) break;
          count += 1;
        }
        streak = `${last}${count}`;
      }
      return {
        ...row,
        frame_diff: row.frames_for - row.frames_against,
        streak,
        last_five: lastFive || "-",
      };
    });

    return rows.sort(
      (a, b) =>
        b.points - a.points ||
        b.frame_diff - a.frame_diff ||
        b.frames_for - a.frames_for ||
        a.team_name.localeCompare(b.team_name)
    );
  }, [seasonTeams, seasonFixtures, computeFixtureProgress]);
  const selectedTeamResults = useMemo(() => {
    if (!selectedTableTeamId) return [];
    return seasonFixtures
      .filter((f) => f.home_team_id === selectedTableTeamId || f.away_team_id === selectedTableTeamId)
      .map((f) => {
        const computed = computeFixtureProgress(f);
        const isHome = f.home_team_id === selectedTableTeamId;
        const opponentId = isHome ? f.away_team_id : f.home_team_id;
        const teamScore = isHome ? computed.homePoints : computed.awayPoints;
        const oppScore = isHome ? computed.awayPoints : computed.homePoints;
        const result =
          computed.status === "complete"
            ? teamScore > oppScore
              ? "W"
              : teamScore < oppScore
                ? "L"
                : "D"
            : "-";
        const score = computed.status === "pending" ? "-" : `${teamScore}-${oppScore}`;
        return {
          id: f.id,
          week: f.week_no,
          date: f.fixture_date,
          opponent: teamById.get(opponentId)?.name ?? "Opponent",
          isHome,
          score,
          status: computed.status,
          result,
        };
      })
      .sort((a, b) => {
        const aSort = a.date ? new Date(`${a.date}T12:00:00`).getTime() : (a.week ?? 0);
        const bSort = b.date ? new Date(`${b.date}T12:00:00`).getTime() : (b.week ?? 0);
        return bSort - aSort;
      });
  }, [selectedTableTeamId, seasonFixtures, teamById, computeFixtureProgress]);
  const selectedTeamResultFixture = useMemo(
    () => (selectedTeamResultFixtureId ? seasonFixtures.find((f) => f.id === selectedTeamResultFixtureId) ?? null : null),
    [selectedTeamResultFixtureId, seasonFixtures]
  );
  const selectedTeamResultFrames = useMemo(() => {
    if (!selectedTeamResultFixture) return [];
    const frameRows = fixtureSlotsByFixtureId.get(selectedTeamResultFixture.id) ?? [];
    const seasonForFixture = seasonById.get(selectedTeamResultFixture.season_id) ?? null;
    const seasonCfg = getSeasonFrameConfig(seasonForFixture);
    const useWinterNoShowRules = seasonCfg.singles === 4 && seasonCfg.doubles === 1;
    return frameRows.map((slot) => {
      const score =
        typeof slot.home_points_scored === "number" || typeof slot.away_points_scored === "number"
          ? `${slot.home_points_scored ?? 0}-${slot.away_points_scored ?? 0}`
          : "-";
      const homePlayers =
        slot.slot_type === "doubles"
          ? [slot.home_player1_id, slot.home_player2_id]
              .filter(Boolean)
              .map((id) => named(playerById.get(id as string)))
              .join(" / ")
          : slot.home_forfeit
            ? "No Show"
            : slot.home_nominated
              ? slot.home_nominated_name?.trim() || "Nominated Player"
              : slot.home_player1_id
                ? named(playerById.get(slot.home_player1_id))
                : useWinterNoShowRules && slot.slot_no === 3
                  ? "No Show"
                  : useWinterNoShowRules && slot.slot_no === 4
                    ? "Nominated Player"
                    : "Not recorded";
      const awayPlayers =
        slot.slot_type === "doubles"
          ? [slot.away_player1_id, slot.away_player2_id]
              .filter(Boolean)
              .map((id) => named(playerById.get(id as string)))
              .join(" / ")
          : slot.away_forfeit
            ? "No Show"
            : slot.away_nominated
              ? slot.away_nominated_name?.trim() || "Nominated Player"
              : slot.away_player1_id
                ? named(playerById.get(slot.away_player1_id))
                : useWinterNoShowRules && slot.slot_no === 3
                  ? "No Show"
                  : useWinterNoShowRules && slot.slot_no === 4
                    ? "Nominated Player"
                    : "Not recorded";
      return {
        id: slot.id,
        label: slotLabel(slot.slot_no, seasonForFixture),
        score,
        homePlayers,
        awayPlayers,
        winnerSide: slot.winner_side,
      };
    });
  }, [selectedTeamResultFixture, fixtureSlotsByFixtureId, playerById, seasonById, slotLabel]);

  useEffect(() => {
    queueMicrotask(() => {
      setSelectedTeamResultFixtureId(null);
    });
  }, [selectedTableTeamId]);
  const seasonSummary = useMemo(() => {
    const complete = seasonFixtures.filter((f) => f.status === "complete").length;
    const inProgress = seasonFixtures.filter((f) => f.status === "in_progress").length;
    const pending = seasonFixtures.filter((f) => f.status === "pending").length;
    return {
      teams: seasonTeams.length,
      fixtures: seasonFixtures.length,
      complete,
      inProgress,
      pending,
      pendingApprovals: allPendingSubmissions.filter((s) => s.season_id === seasonId).length,
    };
  }, [seasonFixtures, seasonTeams.length, allPendingSubmissions, seasonId]);
  const playerTables = useMemo(() => {
    const seasonTeamById = new Map(seasonTeams.map((t) => [t.id, t]));
    const playerTeamName = new Map<string, string>();
    for (const m of members) {
      if (m.season_id !== seasonId) continue;
      const team = seasonTeamById.get(m.team_id);
      if (!team) continue;
      if (!playerTeamName.has(m.player_id)) playerTeamName.set(m.player_id, team.name);
    }

    const singlesAppearanceByPlayer = new Map<string, Set<string>>();
    const doublesAppearanceByPlayer = new Map<string, Set<string>>();
    const singlesPlayed = new Map<string, { won: number; lost: number }>();
    const doublesPlayed = new Map<string, { won: number; lost: number }>();

    const fixtureIds = new Set(seasonFixtures.map((f) => f.id));
    const seasonSlots = slots.filter((s) => fixtureIds.has(s.fixture_id));
    for (const slot of seasonSlots) {
      const homeIds = [slot.home_player1_id, slot.home_player2_id].filter(Boolean) as string[];
      const awayIds = [slot.away_player1_id, slot.away_player2_id].filter(Boolean) as string[];
      const allIds = [...homeIds, ...awayIds];
      if (slot.slot_type === "singles") {
        for (const id of allIds) {
          const set = singlesAppearanceByPlayer.get(id) ?? new Set<string>();
          set.add(slot.fixture_id);
          singlesAppearanceByPlayer.set(id, set);
        }
      } else {
        for (const id of allIds) {
          const set = doublesAppearanceByPlayer.get(id) ?? new Set<string>();
          set.add(slot.fixture_id);
          doublesAppearanceByPlayer.set(id, set);
        }
      }

      if (!slot.winner_side) continue;
      if (slot.slot_type === "singles") {
        if (slot.home_player1_id && !slot.home_forfeit) {
          const prev = singlesPlayed.get(slot.home_player1_id) ?? { won: 0, lost: 0 };
          if (slot.winner_side === "home") prev.won += 1;
          else prev.lost += 1;
          singlesPlayed.set(slot.home_player1_id, prev);
        }
        if (slot.away_player1_id && !slot.away_forfeit) {
          const prev = singlesPlayed.get(slot.away_player1_id) ?? { won: 0, lost: 0 };
          if (slot.winner_side === "away") prev.won += 1;
          else prev.lost += 1;
          singlesPlayed.set(slot.away_player1_id, prev);
        }
      } else {
        for (const id of homeIds) {
          const prev = doublesPlayed.get(id) ?? { won: 0, lost: 0 };
          if (slot.winner_side === "home") prev.won += 1;
          else prev.lost += 1;
          doublesPlayed.set(id, prev);
        }
        for (const id of awayIds) {
          const prev = doublesPlayed.get(id) ?? { won: 0, lost: 0 };
          if (slot.winner_side === "away") prev.won += 1;
          else prev.lost += 1;
          doublesPlayed.set(id, prev);
        }
      }
    }

    const toRows = (
      appearancesMap: Map<string, Set<string>>,
      resultMap: Map<string, { won: number; lost: number }>
    ): PlayerTableRow[] => {
      const ids = new Set<string>([...appearancesMap.keys(), ...resultMap.keys()]);
      return Array.from(ids)
        .map((id) => {
          const player = playerById.get(id);
          const won = resultMap.get(id)?.won ?? 0;
          const lost = resultMap.get(id)?.lost ?? 0;
          const played = won + lost;
          return {
            player_id: id,
            player_name: named(player),
            team_name: playerTeamName.get(id) ?? "-",
            appearances: appearancesMap.get(id)?.size ?? 0,
            played,
            won,
            lost,
            win_pct: played > 0 ? Math.round((won / played) * 1000) / 10 : 0,
          };
        })
        .sort((a, b) => b.win_pct - a.win_pct || b.won - a.won || a.player_name.localeCompare(b.player_name));
    };

    const singles = toRows(singlesAppearanceByPlayer, singlesPlayed);
    const doubles = toRows(doublesAppearanceByPlayer, doublesPlayed);

    const totalByPlayer = new Map<string, PlayerTableRow>();
    const merge = (row: PlayerTableRow) => {
      const prev = totalByPlayer.get(row.player_id) ?? {
        player_id: row.player_id,
        player_name: row.player_name,
        team_name: row.team_name,
        appearances: 0,
        played: 0,
        won: 0,
        lost: 0,
        win_pct: 0,
      };
      prev.appearances += row.appearances;
      prev.played += row.played;
      prev.won += row.won;
      prev.lost += row.lost;
      prev.win_pct = prev.played > 0 ? Math.round((prev.won / prev.played) * 1000) / 10 : 0;
      totalByPlayer.set(row.player_id, prev);
    };
    singles.forEach(merge);
    doubles.forEach(merge);
    const totals = Array.from(totalByPlayer.values()).sort(
      (a, b) => b.win_pct - a.win_pct || b.won - a.won || a.player_name.localeCompare(b.player_name)
    );
    return { singles, doubles, totals };
  }, [seasonId, seasonTeams, seasonFixtures, slots, members, playerById]);
  const singlesRankByPlayer = useMemo(() => {
    const map = new Map<string, number>();
    playerTables.singles.forEach((row, idx) => {
      map.set(row.player_id, idx + 1);
    });
    return map;
  }, [playerTables.singles]);
  const playerSummaryRows = useMemo(() => {
    const singlesById = new Map(playerTables.singles.map((r) => [r.player_id, r]));
    const doublesById = new Map(playerTables.doubles.map((r) => [r.player_id, r]));
    const totalsById = new Map(playerTables.totals.map((r) => [r.player_id, r]));
    const ids = new Set<string>([
      ...playerTables.singles.map((r) => r.player_id),
      ...playerTables.doubles.map((r) => r.player_id),
      ...playerTables.totals.map((r) => r.player_id),
    ]);
    return Array.from(ids)
      .map((id) => {
        const singles = singlesById.get(id);
        const doubles = doublesById.get(id);
        const total = totalsById.get(id);
        return {
          player_id: id,
          player_name: total?.player_name ?? singles?.player_name ?? doubles?.player_name ?? "Unknown",
          team_name: total?.team_name ?? singles?.team_name ?? doubles?.team_name ?? "-",
          singles,
          doubles,
          total,
          rank: singlesRankByPlayer.get(id) ?? null,
        };
      })
      .sort((a, b) => {
        const ra = a.rank ?? Number.MAX_SAFE_INTEGER;
        const rb = b.rank ?? Number.MAX_SAFE_INTEGER;
        return ra - rb || a.player_name.localeCompare(b.player_name);
      });
  }, [playerTables.singles, playerTables.doubles, playerTables.totals, singlesRankByPlayer]);
  const fixtureWeekOptions = useMemo(() => {
    const weeks = Array.from(new Set(seasonFixtures.map((f) => f.week_no).filter((w): w is number => typeof w === "number")));
    return weeks.sort((a, b) => a - b);
  }, [seasonFixtures]);
  const visibleFixtures = useMemo(() => {
    if (!fixtureWeekFilter) return seasonFixtures;
    const week = Number.parseInt(fixtureWeekFilter, 10);
    return seasonFixtures.filter((f) => f.week_no === week);
  }, [seasonFixtures, fixtureWeekFilter]);
  const fixturesGroupedByWeek = useMemo(() => {
    const map = new Map<number, Fixture[]>();
    for (const fixture of visibleFixtures) {
      const key = fixture.week_no ?? 0;
      const prev = map.get(key) ?? [];
      prev.push(fixture);
      map.set(key, prev);
    }
    return Array.from(map.entries())
      .sort((a, b) => {
        if (a[0] === 0) return 1;
        if (b[0] === 0) return -1;
        return a[0] - b[0];
      })
      .map(([weekNo, items]) => {
        const weekDate = items.find((i) => i.fixture_date)?.fixture_date ?? null;
        const dateLabel = weekDate
          ? ` (${new Date(`${weekDate}T12:00:00`).toLocaleDateString(undefined, {
              weekday: "long",
              year: "numeric",
              month: "short",
              day: "numeric",
            })})`
          : "";
        const label = weekNo > 0 ? `Week ${weekNo}${dateLabel}` : "Unscheduled";
        const teamsPlaying = new Set<string>();
        for (const fixture of items) {
          teamsPlaying.add(fixture.home_team_id);
          teamsPlaying.add(fixture.away_team_id);
        }
        const byeTeams =
          weekNo > 0
            ? seasonTeams
                .filter((team) => !teamsPlaying.has(team.id))
                .map((team) => team.name)
                .sort((a, b) => a.localeCompare(b))
            : [];
        return { label, items, byeTeams };
      });
  }, [visibleFixtures, seasonTeams]);
  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <RequireAuth>
          <ScreenHeader
            title="League Manager"
            eyebrow="League"
            subtitle="League body, leagues, teams, fixtures, and standings."
          />
          {!admin.loading && !canSeeLeagueViews ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
              League manager is available to signed-in users.
            </section>
          ) : null}
          <MessageModal message={message} onClose={() => setMessage(null)} />
          <InfoModal open={Boolean(infoModal)} title={infoModal?.title ?? ""} description={infoModal?.description ?? ""} onClose={() => setInfoModal(null)} />
          <ConfirmModal
            open={confirmDeleteOpen}
            title="Delete League"
            description={`Delete "${seasons.find((s) => s.id === seasonId)?.name ?? "selected league"}"? This will permanently delete all related teams, fixtures, and results.`}
            confirmLabel="Delete Permanently"
            cancelLabel="Cancel"
            tone="danger"
            onConfirm={() => void confirmDeleteSeason()}
            onCancel={() => setConfirmDeleteOpen(false)}
          />
          {loading ? <section className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-600">Loading league data...</section> : null}

          {canSeeLeagueViews ? (
            <>
              <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setActiveView("guide")} className={`rounded-full px-3 py-1.5 text-sm ${activeView === "guide" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>
                    User Guide
                  </button>
                  {canOpenAdminTabs ? (
                    <>
                      <button type="button" onClick={() => setActiveView("teamManagement")} className={`rounded-full px-3 py-1.5 text-sm ${activeView === "teamManagement" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>
                        Team Management
                      </button>
                      <button type="button" onClick={() => setActiveView("venues")} className={`rounded-full px-3 py-1.5 text-sm ${activeView === "venues" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>
                        Venues
                      </button>
                      <button type="button" onClick={() => setActiveView("profiles")} className={`rounded-full px-3 py-1.5 text-sm ${activeView === "profiles" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>
                        Player Profiles
                      </button>
                      <button type="button" onClick={() => setActiveView("setup")} className={`rounded-full px-3 py-1.5 text-sm ${activeView === "setup" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>
                        League Setup
                      </button>
                    </>
                  ) : null}
                  <button type="button" onClick={() => setActiveView("fixtures")} className={`rounded-full px-3 py-1.5 text-sm ${activeView === "fixtures" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>
                    Fixtures
                  </button>
                  <button type="button" onClick={() => setActiveView("table")} className={`rounded-full px-3 py-1.5 text-sm ${activeView === "table" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>
                    League Table
                  </button>
                  <button type="button" onClick={() => setActiveView("playerTable")} className={`rounded-full px-3 py-1.5 text-sm ${activeView === "playerTable" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>
                    Player Table
                  </button>
                  <button type="button" onClick={() => setActiveView("knockouts")} className={`rounded-full px-3 py-1.5 text-sm ${activeView === "knockouts" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>
                    Knockout Cups
                  </button>
                </div>
              </section>
              {!seasonId && (activeView === "fixtures" || activeView === "table" || activeView === "playerTable") ? (
                <section className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
                  Select a league in <strong>League Setup</strong> first to view fixtures, results, and tables.
                </section>
              ) : null}
              {seasonId ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="grid gap-2 sm:grid-cols-6">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                      <p className="text-xs text-slate-500">Teams</p>
                      <p className="text-lg font-semibold text-slate-900">{seasonSummary.teams}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                      <p className="text-xs text-slate-500">Fixtures</p>
                      <p className="text-lg font-semibold text-slate-900">{seasonSummary.fixtures}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                      <p className="text-xs text-slate-500">Complete</p>
                      <p className="text-lg font-semibold text-slate-900">{seasonSummary.complete}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                      <p className="text-xs text-slate-500">In progress</p>
                      <p className="text-lg font-semibold text-slate-900">{seasonSummary.inProgress}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                      <p className="text-xs text-slate-500">Pending fixtures</p>
                      <p className="text-lg font-semibold text-slate-900">{seasonSummary.pending}</p>
                    </div>
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-2">
                      <p className="text-xs text-amber-700">Pending approvals</p>
                      <p className="text-lg font-semibold text-amber-900">{seasonSummary.pendingApprovals}</p>
                    </div>
                  </div>
                </section>
              ) : null}

              {canOpenAdminTabs && activeView === "setup" ? (
              <section className="rounded-2xl border border-teal-200 bg-gradient-to-br from-white to-teal-50 p-4 shadow-sm">
                <h2 className="text-lg font-semibold text-teal-900">League Setup</h2>
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">League body</p>
                  <p className="text-sm font-semibold text-slate-900">{LEAGUE_BODY_NAME}</p>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  <select
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2"
                    value={seasonTemplate}
                    onChange={(e) => setSeasonTemplate(e.target.value as LeagueTemplateKey)}
                  >
                    <option value="winter">{LEAGUE_BODY_NAME} - {LEAGUE_TEMPLATES.winter.label}</option>
                    <option value="summer">{LEAGUE_BODY_NAME} - {LEAGUE_TEMPLATES.summer.label}</option>
                  </select>
                  <input
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 sm:col-span-2"
                    placeholder="Season label (optional, e.g. 2026/2027)"
                    value={seasonName}
                    onChange={(e) => setSeasonName(e.target.value)}
                  />
                  <button type="button" onClick={createSeason} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white">
                    Create league
                  </button>
                </div>
                <label className="mt-2 inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={seasonHandicapEnabled}
                    onChange={(e) => setSeasonHandicapEnabled(e.target.checked)}
                  />
                  Handicap league (reviewed from Elo)
                </label>
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={deleteSeason}
                    disabled={!seasonId}
                    className="rounded-xl border border-rose-300 bg-white px-4 py-2 text-sm text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Delete selected league
                  </button>
                </div>
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <h3 className="text-sm font-semibold text-slate-900">Created leagues</h3>
                  <div className="mt-2 space-y-2">
                    {seasons.map((league) => (
                        <button
                          key={league.id}
                          type="button"
                          onClick={() => {
                            setSeasonId(league.id);
                            setInfoModal({
                              title: "League Selected",
                              description: `"${league.name}" selected. You can now add teams here or open Fixtures when ready.`,
                            });
                          }}
                          className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${
                            seasonId === league.id
                              ? "border-slate-900 bg-slate-900 text-white"
                              : "border-slate-200 bg-white text-slate-800"
                          }`}
                        >
                          <span className="inline-flex items-center gap-2">
                            <span>{league.name}</span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                league.handicap_enabled
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-slate-200 text-slate-700"
                              }`}
                            >
                              {league.handicap_enabled ? "Handicap ON" : "Handicap OFF"}
                            </span>
                          </span>
                        </button>
                      ))}
                    {seasons.length === 0 ? (
                      <p className="text-sm text-slate-600">No leagues created yet.</p>
                    ) : null}
                  </div>
                </div>
                <div className="mt-4 border-t border-slate-200 pt-4">
                  <h3 className="text-sm font-semibold text-slate-900">Selected League Teams</h3>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {seasonId && seasonTeams.length > 0 ? (
                      seasonTeams.map((t) => (
                        <div key={`setup-team-${t.id}`} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
                          {t.name}
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-slate-600">No teams added yet for this league.</p>
                    )}
                  </div>
                </div>
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-900">Add registered team into selected league</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-slate-300 bg-white p-2">
                      {registeredTeamOptions
                        .filter((teamOption) => !seasonTeams.some((t) => t.name.toLowerCase() === teamOption.name.toLowerCase()))
                        .map((teamOption) => {
                          const checked = selectedLeagueTeamNames.includes(teamOption.name);
                          const teamVenue = locations.find((l) => l.id === teamOption.location_id);
                          return (
                            <label key={teamOption.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-800">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedLeagueTeamNames((prev) => Array.from(new Set([...prev, teamOption.name])));
                                  } else {
                                    setSelectedLeagueTeamNames((prev) => prev.filter((n) => n !== teamOption.name));
                                  }
                                }}
                                disabled={!seasonId}
                              />
                              <span>{teamOption.name}</span>
                              <span className="text-xs text-slate-500">{teamVenue?.name ? `· ${locationLabel(teamVenue.name)}` : ""}</span>
                            </label>
                          );
                        })}
                      {registeredTeamOptions.filter((teamOption) => !seasonTeams.some((t) => t.name.toLowerCase() === teamOption.name.toLowerCase())).length === 0 ? (
                        <p className="text-sm text-slate-600">No available teams to add.</p>
                      ) : null}
                    </div>
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => {
                          const all = registeredTeamOptions
                            .filter((teamOption) => !seasonTeams.some((t) => t.name.toLowerCase() === teamOption.name.toLowerCase()))
                            .map((t) => t.name);
                          setSelectedLeagueTeamNames(all);
                        }}
                        className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700"
                        disabled={!seasonId}
                      >
                        Select all available
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedLeagueTeamNames([])}
                        className="ml-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700"
                        disabled={!seasonId}
                      >
                        Clear
                      </button>
                      <button type="button" onClick={addTeamsToLeague} className="block rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white" disabled={!seasonId}>
                        Add selected teams
                      </button>
                      <p className="text-xs text-slate-600">{selectedLeagueTeamNames.length} team(s) selected.</p>
                    </div>
                  </div>
                </div>
              </section>
              ) : null}

              {activeView === "guide" ? (
              <section className="rounded-2xl border border-sky-200 bg-gradient-to-br from-white to-sky-50 p-4 shadow-sm">
                <h2 className="text-lg font-semibold text-sky-900">User Guide</h2>
                <div className="mt-3 space-y-3 text-sm text-slate-700">
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="font-semibold text-slate-900">Step 1: Team Management</p>
                    <p>Register venues, teams, and players. Set captain/vice-captain, and transfer players if needed.</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="font-semibold text-slate-900">Step 2: League Setup</p>
                    <p>Create a league (season), select it, then add registered teams into the selected league.</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="font-semibold text-slate-900">Step 3: Fixtures</p>
                    <p>
                      Generate fixtures, add break weeks, and enter weekly results.
                      Winter format: 4 singles + 1 doubles. Summer format: 6 singles.
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="font-semibold text-slate-900">Step 4: Tables</p>
                    <p>League Table and Player Table are based on the selected league in League Setup.</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="font-semibold text-slate-900">Step 5: Knockout Cups</p>
                    <p>Super User publishes knockout cups and opens sign-ups. Users enter cups from the Knockout Cups tab.</p>
                  </div>
                </div>
              </section>
              ) : null}

              {canOpenAdminTabs && activeView === "venues" ? (
              <section className="rounded-2xl border border-cyan-200 bg-gradient-to-br from-white to-cyan-50 p-4 shadow-sm">
                <h2 className="text-lg font-semibold text-cyan-900">Venues</h2>
                <p className="mt-2 text-sm text-slate-600">Register venues and maintain contact details.</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  <input
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 sm:col-span-3"
                    placeholder="New venue name"
                    value={newVenueName}
                    onChange={(e) => setNewVenueName(e.target.value)}
                  />
                  <button type="button" onClick={createVenue} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white">
                    Register venue
                  </button>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-5">
                  <input
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2"
                    placeholder="Venue name"
                    value={manageVenueName}
                    onChange={(e) => setManageVenueName(e.target.value)}
                  />
                  <input
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2"
                    placeholder="Address"
                    value={manageVenueAddress}
                    onChange={(e) => setManageVenueAddress(e.target.value)}
                  />
                  <input
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2"
                    placeholder="Postcode"
                    value={manageVenuePostcode}
                    onChange={(e) => setManageVenuePostcode(e.target.value)}
                  />
                  <input
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2"
                    placeholder="Contact phone"
                    value={manageVenuePhone}
                    onChange={(e) => setManageVenuePhone(e.target.value)}
                  />
                  <input
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2"
                    placeholder="Contact email"
                    value={manageVenueEmail}
                    onChange={(e) => setManageVenueEmail(e.target.value)}
                  />
                </div>
                {!manageVenueId ? (
                  <p className="mt-2 text-xs text-slate-600">Click a venue in “All Registered Venues” to edit details.</p>
                ) : null}
                <div className="mt-2">
                  <button type="button" onClick={saveVenueDetails} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700">
                    Save venue details
                  </button>
                </div>
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">All Registered Venues ({venueLocations.length})</p>
                    <button
                      type="button"
                      className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700"
                      onClick={() => setShowAllRegisteredVenues((prev) => !prev)}
                    >
                      {showAllRegisteredVenues ? "Collapse" : "Expand"}
                    </button>
                  </div>
                  {showAllRegisteredVenues ? (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {venueLocations
                        .slice()
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((location) => (
                          <button
                            type="button"
                            key={`venue-list-${location.id}`}
                            onClick={() => setManageVenueId(location.id)}
                            className={`rounded-lg border px-3 py-2 text-left text-sm ${
                              manageVenueId === location.id
                                ? "border-slate-900 bg-slate-900 text-white"
                                : "border-slate-200 bg-white text-slate-800"
                            }`}
                          >
                            {locationLabel(location.name)}
                          </button>
                        ))}
                      {venueLocations.length === 0 ? (
                        <p className="text-sm text-slate-600">No venues registered yet.</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {manageVenueId ? (
                  <div className="mt-3 space-y-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-semibold text-slate-900">Venue Profile</p>
                      <p className="mt-1 text-base font-semibold text-slate-900">
                        {selectedVenue ? locationLabel(selectedVenue.name) : "Selected venue"}
                      </p>
                      {(() => {
                        const rawAddress = selectedVenue?.address ?? "";
                        const [addressLine, postcode] = rawAddress.split(" | ");
                        return (
                      <div className="mt-2 grid gap-2 text-sm text-slate-700 sm:grid-cols-3">
                        <p>
                          <span className="font-medium text-slate-900">Address: </span>
                          {addressLine?.trim() || "Not set"}
                        </p>
                        <p>
                          <span className="font-medium text-slate-900">Postcode: </span>
                          {postcode?.trim() || "Not set"}
                        </p>
                        <p>
                          <span className="font-medium text-slate-900">Phone: </span>
                          {selectedVenue?.contact_phone?.trim() || "Not set"}
                        </p>
                        <p>
                          <span className="font-medium text-slate-900">Email: </span>
                          {selectedVenue?.contact_email?.trim() || "Not set"}
                        </p>
                      </div>
                        );
                      })()}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                      <p className="text-xs text-slate-500">Players linked</p>
                      <p className="text-base font-semibold text-slate-900">{selectedVenuePlayers.length}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                      <p className="text-xs text-slate-500">Captains</p>
                      <p className="text-base font-semibold text-slate-900">
                        {
                          registeredMembers.filter((m) => {
                            if (!m.is_captain) return false;
                            const t = registeredTeams.find((rt) => rt.id === m.team_id);
                            return t?.location_id === manageVenueId;
                          }).length
                        }
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                      <p className="text-xs text-slate-500">Vice-captains</p>
                      <p className="text-base font-semibold text-slate-900">
                        {
                          registeredMembers.filter((m) => {
                            if (!m.is_vice_captain) return false;
                            const t = registeredTeams.find((rt) => rt.id === m.team_id);
                            return t?.location_id === manageVenueId;
                          }).length
                        }
                      </p>
                    </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-semibold text-slate-900">Teams at this venue ({selectedVenueTeams.length})</p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <input
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                          placeholder="Search players in this venue"
                          value={venuePlayerSearch}
                          onChange={(e) => setVenuePlayerSearch(e.target.value)}
                        />
                        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                          <span>Showing {filteredSelectedVenueTeamRoster.length} team(s)</span>
                          <button
                            type="button"
                            className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700"
                            onClick={() => {
                              const next: Record<string, boolean> = {};
                              for (const team of filteredSelectedVenueTeamRoster) next[team.id] = true;
                              setExpandedVenueTeams((prev) => ({ ...prev, ...next }));
                            }}
                            disabled={filteredSelectedVenueTeamRoster.length === 0}
                          >
                            Expand all
                          </button>
                          <button
                            type="button"
                            className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700"
                            onClick={() => {
                              const next: Record<string, boolean> = {};
                              for (const team of filteredSelectedVenueTeamRoster) next[team.id] = false;
                              setExpandedVenueTeams((prev) => ({ ...prev, ...next }));
                            }}
                            disabled={filteredSelectedVenueTeamRoster.length === 0}
                          >
                            Collapse all
                          </button>
                        </div>
                      </div>
                      <div className="mt-2 space-y-3">
                        {filteredSelectedVenueTeamRoster.map((team) => {
                          const expanded = Boolean(expandedVenueTeams[team.id]);
                          const showAll = Boolean(showAllVenueTeamMembers[team.id]);
                          const visibleMembers = showAll ? team.members : team.members.slice(0, 8);
                          return (
                          <div key={`venue-team-${team.id}`} className="rounded-lg border border-slate-200 bg-white p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-slate-900">
                                {team.name}
                                <span className="ml-2 text-xs font-normal text-slate-500">
                                  {team.members.length} player(s)
                                </span>
                              </p>
                              <button
                                type="button"
                                className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700"
                                onClick={() =>
                                  setExpandedVenueTeams((prev) => ({ ...prev, [team.id]: !prev[team.id] }))
                                }
                              >
                                {expanded ? "Hide players" : "Show players"}
                              </button>
                            </div>
                            {expanded ? (
                              <ul className="mt-2 space-y-1 text-sm text-slate-700">
                                {visibleMembers.map((member) => (
                                  <li key={member.id}>
                                    <Link
                                      href={`/players/${member.player_id}`}
                                      className="underline decoration-slate-300 underline-offset-2 hover:text-slate-900"
                                    >
                                      {named(member.player)}
                                    </Link>
                                    {member.is_captain ? " · Captain" : ""}
                                    {member.is_vice_captain ? " · Vice-captain" : ""}
                                  </li>
                                ))}
                                {team.members.length > 8 ? (
                                  <li>
                                    <button
                                      type="button"
                                      className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700"
                                      onClick={() =>
                                        setShowAllVenueTeamMembers((prev) => ({
                                          ...prev,
                                          [team.id]: !prev[team.id],
                                        }))
                                      }
                                    >
                                      {showAll ? "Show first 8" : `Show all (${team.members.length})`}
                                    </button>
                                  </li>
                                ) : null}
                                {team.members.length === 0 ? (
                                  <li className="text-slate-500">No players linked to this team yet.</li>
                                ) : null}
                              </ul>
                            ) : null}
                          </div>
                          );
                        })}
                        {selectedVenueTeams.length === 0 ? (
                          <p className="text-sm text-slate-600">No teams registered at this venue.</p>
                        ) : null}
                        {selectedVenueTeams.length > 0 && filteredSelectedVenueTeamRoster.length === 0 ? (
                          <p className="text-sm text-slate-600">No players found for this search.</p>
                        ) : null}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900">
                          Unassigned players at this venue ({selectedVenueUnassignedPlayers.length})
                        </p>
                        <button
                          type="button"
                          className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700"
                          onClick={() => setShowUnassignedPlayers((prev) => !prev)}
                        >
                          {showUnassignedPlayers ? "Hide" : "Show"}
                        </button>
                      </div>
                      {showUnassignedPlayers ? (
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {selectedVenueUnassignedPlayers.map((player) => (
                            <Link
                              key={`venue-player-unassigned-${player.id}`}
                              href={`/players/${player.id}`}
                              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 underline decoration-slate-300 underline-offset-2 hover:text-slate-900"
                            >
                              {named(player)}
                            </Link>
                          ))}
                          {selectedVenueUnassignedPlayers.length === 0 ? (
                            <p className="text-sm text-slate-600">No unassigned players at this venue.</p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </section>
              ) : null}

              {canOpenAdminTabs && activeView === "profiles" ? (
              <section className="rounded-2xl border border-sky-200 bg-gradient-to-br from-white to-sky-50 p-4 shadow-sm">
                <h2 className="text-lg font-semibold text-sky-900">Player Profiles</h2>
                <p className="mt-2 text-sm text-slate-600">Open a player profile to view profile details and statistics.</p>
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="grid gap-2 sm:grid-cols-3">
                    <select
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2"
                      value={profileVenueFilterId}
                      onChange={(e) => setProfileVenueFilterId(e.target.value)}
                    >
                      <option value="">All venues</option>
                      {venueLocations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {locationLabel(location.name)}
                        </option>
                      ))}
                    </select>
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                      Profiles shown: <span className="font-semibold text-slate-900">{visiblePlayerProfiles.length}</span>
                    </div>
                  </div>
                  <div className="mt-3 rounded-xl border border-slate-200 bg-white p-2">
                    <ul className="max-h-[28rem] space-y-1 overflow-y-auto">
                      {visiblePlayerProfiles.map((player) => (
                        <li key={`profile-row-${player.id}`} className="grid items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 sm:grid-cols-[1fr_auto_auto]">
                          <Link
                            href={`/players/${player.id}`}
                            className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-2 hover:text-slate-700"
                          >
                            {player.name}
                          </Link>
                          <span className="text-xs font-semibold text-slate-700">
                            HCP {player.handicap > 0 ? `+${player.handicap}` : player.handicap}
                          </span>
                          <span className="text-xs text-slate-600">{player.venue}</span>
                        </li>
                      ))}
                      {visiblePlayerProfiles.length === 0 ? <li className="px-2 py-1 text-sm text-slate-500">No players found for this venue.</li> : null}
                    </ul>
                  </div>
                </div>
              </section>
              ) : null}

              {canOpenAdminTabs && activeView === "teamManagement" ? (
              <section className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-white to-indigo-50 p-4 shadow-sm">
                <h2 className="text-lg font-semibold text-indigo-900">Team Management</h2>
                <p className="mt-2 text-sm text-slate-600">Follow steps in order. You can skip and return later.</p>
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-900">Step 1: Register venue</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-4">
                    <select className="rounded-xl border border-slate-300 bg-white px-3 py-2" value={LEAGUE_BODY_NAME} disabled>
                      <option value={LEAGUE_BODY_NAME}>{LEAGUE_BODY_NAME}</option>
                    </select>
                    <input
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 sm:col-span-2"
                      placeholder="Venue name"
                      value={newVenueName}
                      onChange={(e) => setNewVenueName(e.target.value)}
                    />
                    <button type="button" onClick={createVenue} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white">
                      Register venue
                    </button>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => setShowStep2Teams(true)} className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700">Register teams now</button>
                    <button type="button" onClick={() => setShowStep2Teams(false)} className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700">Do this later</button>
                  </div>
                </div>
                {showStep2Teams ? (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-sm font-semibold text-slate-900">Step 2: Register team at venue</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-4">
                      <select
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2"
                        value={registryVenueId}
                        onChange={(e) => setRegistryVenueId(e.target.value)}
                      >
                        <option value="">Select venue</option>
                        {venueLocations.map((location) => (
                          <option key={location.id} value={location.id}>
                            {locationLabel(location.name)}
                          </option>
                        ))}
                      </select>
                      <input
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 sm:col-span-2"
                        placeholder="Team name (e.g. Greenhithe A)"
                        value={registryTeamName}
                        onChange={(e) => setRegistryTeamName(e.target.value)}
                      />
                      <button type="button" onClick={createRegisteredTeam} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white">
                        Register team
                      </button>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button type="button" onClick={() => setShowStep3Players(true)} className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700">Register players now</button>
                      <button type="button" onClick={() => setShowStep3Players(false)} className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700">Do this later</button>
                    </div>
                    <div className="mt-3 max-h-48 space-y-2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2">
                      {registeredTeams
                        .filter((team) => !registryVenueId || team.location_id === registryVenueId)
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((team) => (
                          <div key={`reg-team-${team.id}`} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
                            <span>
                              {team.name}
                              <span className="ml-1 text-xs text-slate-500">
                                · {locationLabel(locations.find((l) => l.id === team.location_id)?.name ?? "Unknown venue")}
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() => void deleteRegisteredTeam(team.id)}
                              className="rounded-lg border border-rose-300 bg-white px-2 py-1 text-xs text-rose-700"
                            >
                              Delete
                            </button>
                          </div>
                        ))}
                      {registeredTeams.filter((team) => !registryVenueId || team.location_id === registryVenueId).length === 0 ? (
                        <p className="text-sm text-slate-600">No registered teams yet.</p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {showStep3Players ? (
                  <>
                    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-semibold text-slate-900">Step 3: Register new player for team/club (first-time creation)</p>
                      <p className="mt-2 text-xs text-slate-600">
                        This step creates brand-new players only. If the player already exists, use Step 4 transfer.
                      </p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-6">
                        <input
                          className="rounded-xl border border-slate-300 bg-white px-3 py-2"
                          placeholder="First name"
                          value={newPlayerFirstName}
                          onChange={(e) => setNewPlayerFirstName(e.target.value)}
                        />
                        <input
                          className="rounded-xl border border-slate-300 bg-white px-3 py-2"
                          placeholder="Second name"
                          value={newPlayerSecondName}
                          onChange={(e) => setNewPlayerSecondName(e.target.value)}
                        />
                        <select
                          className="rounded-xl border border-slate-300 bg-white px-3 py-2"
                          value={newPlayerLocationId}
                          onChange={(e) => {
                            const nextLocationId = e.target.value;
                            setNewPlayerLocationId(nextLocationId);
                            if (registryTeamId) {
                              const selectedTeam = registeredTeams.find((t) => t.id === registryTeamId);
                              if (selectedTeam && selectedTeam.location_id !== nextLocationId) {
                                setRegistryTeamId("");
                              }
                            }
                          }}
                        >
                          <option value="">Select location</option>
                          {venueLocations.map((location) => (
                            <option key={location.id} value={location.id}>
                              {locationLabel(location.name)}
                            </option>
                          ))}
                        </select>
                        <select
                          className="rounded-xl border border-slate-300 bg-white px-3 py-2"
                          value={registryTeamId}
                          onChange={(e) => setRegistryTeamId(e.target.value)}
                          disabled={!newPlayerLocationId}
                        >
                          <option value="">Select team (optional)</option>
                          {registeredTeams
                            .filter((t) => t.location_id === newPlayerLocationId)
                            .map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                        </select>
                        <button type="button" onClick={() => void registerPlayerForClub(false)} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700">
                          Register for club
                        </button>
                        <button
                          type="button"
                          onClick={() => void registerPlayerForClub(true)}
                          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700"
                        >
                          Register + add to team
                        </button>
                      </div>
                      {!registryTeamId ? <p className="mt-2 text-xs text-slate-600">Select a team only if using &quot;Register + add to team&quot;.</p> : null}
                      <div className="mt-3">
                        <label className="mb-1 block text-xs font-medium text-slate-600">
                          Bulk create players (one per line: First Last or First,Last)
                        </label>
                        <textarea
                          className="min-h-[120px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                          placeholder={"Example:\nJason Harrison\nBryan Hordon\nGraham Beale"}
                          value={bulkPlayersText}
                          onChange={(e) => setBulkPlayersText(e.target.value)}
                        />
                        <div className="mt-2">
                          <button
                            type="button"
                            onClick={() => void registerPlayersBulk()}
                            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700"
                          >
                            Bulk register {registryTeamId ? "+ add to selected team" : "for selected club"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                ) : null}
                {registryTeamId ? (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="font-medium text-slate-900">{registeredTeams.find((t) => t.id === registryTeamId)?.name ?? "Team"}</p>
                    <p className="text-xs text-slate-600">Set captain now. Vice-captain support can be added next.</p>
                    <ul className="mt-2 space-y-1 text-sm text-slate-700">
                      {(registeredMembersByTeam.get(registryTeamId) ?? []).map((m) => (
                        <li key={m.id} className="flex items-center justify-between gap-2">
                          <span>{named(playerById.get(m.player_id))}</span>
                          <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1 text-xs">
                              <input
                                type="checkbox"
                                checked={m.is_captain}
                                onChange={(e) => void setRegisteredCaptain(m, e.target.checked)}
                              />
                              Captain
                            </label>
                            <label className="flex items-center gap-1 text-xs">
                              <input
                                type="checkbox"
                                checked={m.is_vice_captain}
                                onChange={(e) => void setRegisteredViceCaptain(m, e.target.checked)}
                              />
                              Vice-captain
                            </label>
                            <button
                              type="button"
                              className="rounded border border-rose-300 bg-white px-2 py-0.5 text-xs text-rose-700"
                              onClick={() => void removeRegisteredMember(m.id)}
                            >
                              Remove
                            </button>
                          </div>
                        </li>
                      ))}
                      {(registeredMembersByTeam.get(registryTeamId) ?? []).length === 0 ? <li className="text-slate-500">No players assigned.</li> : null}
                    </ul>
                  </div>
                ) : null}
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-900">Step 4: Transfer player club/team</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-5">
                    <select
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2"
                      value={transferFromVenueId}
                      onChange={(e) => {
                        setTransferFromVenueId(e.target.value);
                        setTransferVenueId(e.target.value);
                        setTransferPlayerId("");
                        setTransferDestinationTeamId("");
                      }}
                    >
                      <option value="">Current venue</option>
                      {venueLocations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {locationLabel(location.name)}
                        </option>
                      ))}
                    </select>
                    <select
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2"
                      value={transferPlayerId}
                      onChange={(e) => setTransferPlayerId(e.target.value)}
                    >
                      <option value="">Select player at current venue</option>
                      {playersAtSourceVenue.map((player) => (
                        <option key={player.id} value={player.id}>
                          {named(player)}
                        </option>
                      ))}
                    </select>
                    <select
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2"
                      value={transferVenueId}
                      onChange={(e) => {
                        setTransferVenueId(e.target.value);
                        setTransferDestinationTeamId("");
                      }}
                    >
                      <option value="">Destination venue</option>
                      {venueLocations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {locationLabel(location.name)}
                        </option>
                      ))}
                    </select>
                    <select
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2"
                      value={transferDestinationTeamId}
                      onChange={(e) => setTransferDestinationTeamId(e.target.value)}
                    >
                      <option value="">Destination team</option>
                      {destinationTeams.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={transferPlayerClubTeam}
                      className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700"
                    >
                      Transfer player
                    </button>
                  </div>
                  {transferPlayerId ? (
                    <p className="mt-2 text-xs text-slate-600">
                      Current team(s): {(registeredTeamNamesByPlayer.get(transferPlayerId) ?? []).join(", ") || "None"}
                    </p>
                  ) : null}
                </div>
              </section>
              ) : null}

              {activeView === "fixtures" ? (
              <section className="rounded-2xl border border-amber-200 bg-gradient-to-br from-white to-amber-50 p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-amber-900">Fixtures</h2>
                  {currentSeason ? (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        currentSeason.handicap_enabled
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {currentSeason.handicap_enabled ? "Handicap ON (Elo review)" : "Handicap OFF"}
                    </span>
                  ) : null}
                </div>
                {canOpenAdminTabs ? (
                  <>
                    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-semibold text-slate-900">Auto-generate full league fixtures</p>
                      <p className="mt-1 text-xs text-slate-600">
                        Choose a season start date, then add any reserved Thursdays as break weeks (no league fixtures).
                      </p>
                      <div className="mt-2 grid items-end gap-2 sm:grid-cols-6">
                        <label className="space-y-1">
                          <span className="text-xs font-medium text-slate-600">Season start date</span>
                          <input
                            type="date"
                            className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                            value={genStartDate}
                            onChange={(e) => setGenStartDate(e.target.value)}
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-medium text-slate-600">Reserved break date (no fixtures)</span>
                          <input
                            type="date"
                            className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                            value={breakDateInput}
                            onChange={(e) => setBreakDateInput(e.target.value)}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={addBreakDate}
                          className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700"
                        >
                          Add break
                        </button>
                        <label className="flex h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
                          <input type="checkbox" checked={genDoubleRound} onChange={(e) => setGenDoubleRound(e.target.checked)} />
                          Home & away legs
                        </label>
                        <label className="flex h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
                          <input type="checkbox" checked={genClearExisting} onChange={(e) => setGenClearExisting(e.target.checked)} />
                          Replace existing fixtures
                        </label>
                        <button type="button" onClick={generateFixtures} className="h-11 rounded-xl bg-slate-900 px-4 text-sm font-medium text-white">
                          Generate fixtures
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {breakDates.map((d) => (
                          <button
                            type="button"
                            key={d}
                            onClick={() => removeBreakDate(d)}
                            className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700"
                            title="Remove break week"
                          >
                            {new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" })} x
                          </button>
                        ))}
                        {breakDates.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => setBreakDates([])}
                            className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700"
                          >
                            Clear breaks
                          </button>
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={applyBreakWeeksToExisting}
                          className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700"
                        >
                          Apply break weeks to existing dates
                        </button>
                        <p className="text-xs text-slate-600">
                          Reserved weeks are selected by date; later fixtures are moved forward automatically.
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-5">
                      <input className="rounded-xl border border-slate-300 bg-white px-3 py-2" placeholder="Week no" value={fixtureWeek} onChange={(e) => setFixtureWeek(e.target.value)} />
                      <input type="date" className="rounded-xl border border-slate-300 bg-white px-3 py-2" value={fixtureDate} onChange={(e) => setFixtureDate(e.target.value)} />
                      <select className="rounded-xl border border-slate-300 bg-white px-3 py-2" value={fixtureHome} onChange={(e) => setFixtureHome(e.target.value)}>
                        <option value="">Home team</option>
                        {seasonTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                      <select className="rounded-xl border border-slate-300 bg-white px-3 py-2" value={fixtureAway} onChange={(e) => setFixtureAway(e.target.value)}>
                        <option value="">Away team</option>
                        {seasonTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                      <button type="button" onClick={createFixture} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white">
                        Add fixture
                      </button>
                    </div>
                    <div className="mt-3 flex justify-end">
                      <button type="button" onClick={publishFixtures} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700">
                        Publish fixtures to inbox
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
                    Read-only fixtures view. Only Super User can generate, edit, and publish fixtures.
                  </div>
                )}
                <div className="mt-3">
                  <select
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                    value={fixtureWeekFilter}
                    onChange={(e) => setFixtureWeekFilter(e.target.value)}
                  >
                    <option value="">All weeks</option>
                    {fixtureWeekOptions.map((weekNo) => (
                      <option key={weekNo} value={String(weekNo)}>
                        Week {weekNo}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mt-3 space-y-3">
                  {fixturesGroupedByWeek.map((group) => (
                    <div key={group.label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm font-semibold text-slate-900">{group.label}</p>
                      <div className="mt-2 space-y-2">
                        {group.items.map((f) => (
                          (() => {
                            const computed = computeFixtureProgress(f);
                            const pendingSubmission = pendingSubmissionByFixtureId.get(f.id);
                            const isEditing = fixtureId === f.id && resultEntryOpen;
                            const canEditThisFixture = canEditFixtureResult(f);
                            const buttonState =
                              isEditing
                                ? { label: "Editing", className: "border-slate-900 bg-slate-900 text-white" }
                                : pendingSubmission
                                  ? { label: "Pending review", className: "border-amber-300 bg-amber-100 text-amber-900" }
                                  : !canEditThisFixture && computed.status !== "complete"
                                    ? { label: "View fixture", className: "border-slate-300 bg-white text-slate-700" }
                                    : computed.status === "complete"
                                    ? { label: "View result", className: "border-emerald-300 bg-emerald-100 text-emerald-900" }
                                    : { label: "Action required", className: "border-rose-300 bg-rose-100 text-rose-900" };
                            return (
                              <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                                <p className="text-sm text-slate-800">
                                  {teamById.get(f.home_team_id)?.name ?? "Home"} vs {teamById.get(f.away_team_id)?.name ?? "Away"}
                                  <span className="ml-2 text-xs text-slate-600">
                                    ({computed.homePoints}-{computed.awayPoints}) · {statusLabel(computed.status)}
                                  </span>
                                </p>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setFixtureId(f.id);
                                    setResultEntryOpen(true);
                                  }}
                                  className={`rounded-lg border px-2 py-1 text-xs ${buttonState.className}`}
                                >
                                  {buttonState.label}
                                </button>
                              </div>
                            );
                          })()
                        ))}
                        {group.byeTeams.map((teamName) => (
                          <div
                            key={`${group.label}-bye-${teamName}`}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                          >
                            <p className="text-sm text-slate-700">{teamName}</p>
                            <span className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-700">
                              BYE / No fixture this week
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {visibleFixtures.length === 0 ? <p className="text-sm text-slate-600">No fixtures for this filter.</p> : null}
                </div>
              </section>
              ) : null}

              {activeView === "fixtures" && fixtureId && resultEntryOpen ? (
                <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4">
                  <div className="max-h-[92vh] w-full max-w-5xl overflow-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
                    <div className="flex items-center justify-between">
                      <h2 className="text-lg font-semibold text-slate-900">Weekly Result Entry</h2>
                      <button
                        type="button"
                        onClick={() => setResultEntryOpen(false)}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
                      >
                        Close
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      {`Format: ${currentSeasonSinglesCount} singles${currentSeasonDoublesCount > 0 ? ` + ${currentSeasonDoublesCount} doubles` : ""}. Winner is derived automatically from frame points.`}
                    </p>
                    {!canEditCurrentFixture ? (
                      <p className="mt-2 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-xs text-slate-700">
                        Read-only view. Super User can edit all fixtures. Administrators can edit fixtures for their own club/location.
                      </p>
                    ) : null}
                    <div className="mt-3 space-y-3">
                      {fixtureSlots.map((slot) => {
                        const fixture = seasonFixtures.find((f) => f.id === slot.fixture_id);
                        if (!fixture) return null;
                        const homeRosterIds = fallbackRosterByLeagueTeamId.get(fixture.home_team_id) ?? [];
                        const awayRosterIds = fallbackRosterByLeagueTeamId.get(fixture.away_team_id) ?? [];
                        const homeSinglesTaken = new Set(
                          fixtureSlots
                            .filter((s) => s.slot_type === "singles" && s.id !== slot.id && s.home_player1_id)
                            .map((s) => s.home_player1_id as string)
                        );
                        const awaySinglesTaken = new Set(
                          fixtureSlots
                            .filter((s) => s.slot_type === "singles" && s.id !== slot.id && s.away_player1_id)
                            .map((s) => s.away_player1_id as string)
                        );
                        const homeSelection = getSinglesSelectionValue(slot, "home");
                        const awaySelection = getSinglesSelectionValue(slot, "away");
                        return (
                          <div key={slot.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <p className="text-sm font-semibold text-slate-900">
                              {`Frame ${slot.slot_no} · ${slotLabel(slot.slot_no, currentSeason)}`}
                            </p>
                            <div className="mt-2 grid gap-2 sm:grid-cols-5">
                              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Home</div>
                              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 sm:col-span-3">Player(s)</div>
                              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Points</div>

                              <div className="text-xs text-slate-600">{teamById.get(fixture.home_team_id)?.name ?? "Home"}</div>
                              <div className="sm:col-span-3">
                                {slot.slot_type === "doubles" ? (
                                  <div className="grid gap-2 sm:grid-cols-2">
                                    <select
                                      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
                                      value={slot.home_player1_id ?? ""}
                                      disabled={!canEditCurrentFixture}
                                      onChange={(e) => void updateFrameWithDerivedWinner(slot, { home_player1_id: e.target.value || null, home_forfeit: false })}
                                    >
                                      <option value="">Home player 1</option>
                                      {homeRosterIds.map((id) => (
                                        <option key={id} value={id} disabled={slot.home_player2_id === id}>
                                          {named(playerById.get(id))}
                                        </option>
                                      ))}
                                    </select>
                                    <select
                                      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
                                      value={slot.home_player2_id ?? ""}
                                      disabled={!canEditCurrentFixture}
                                      onChange={(e) => void updateFrameWithDerivedWinner(slot, { home_player2_id: e.target.value || null })}
                                    >
                                      <option value="">Home player 2</option>
                                      {homeRosterIds.map((id) => (
                                        <option key={id} value={id} disabled={slot.home_player1_id === id}>
                                          {named(playerById.get(id))}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                ) : (
                                  <select
                                    className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
                                    value={homeSelection}
                                    disabled={!canEditCurrentFixture}
                                    onChange={(e) => void applySinglesSelection(slot, "home", e.target.value)}
                                  >
                                    <option value="">Home player</option>
                                    {isWinterFormat && slot.slot_no === 3 ? <option value="__NO_SHOW__">No Show</option> : null}
                                    {isWinterFormat && slot.slot_no === 4 ? <option value="__NOMINATED__">Nominated Player</option> : null}
                                    {homeRosterIds.map((id) => (
                                      <option key={id} value={id} disabled={homeSinglesTaken.has(id) && slot.home_player1_id !== id}>
                                        {named(playerById.get(id))}
                                        {homeSinglesTaken.has(id) && slot.home_player1_id !== id ? " (Already used in singles)" : ""}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </div>
                              <input
                                key={`home-points-${slot.id}-${slot.home_points_scored ?? ""}`}
                                type="number"
                                min={0}
                                max={200}
                                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
                                defaultValue={slot.home_points_scored ?? ""}
                                disabled={!canEditCurrentFixture}
                                onBlur={(e) => void updateFramePoints(slot, "home", e.target.value)}
                                placeholder="0-200"
                              />

                              <div className="text-xs text-slate-600">{teamById.get(fixture.away_team_id)?.name ?? "Away"}</div>
                              <div className="sm:col-span-3">
                                {slot.slot_type === "doubles" ? (
                                  <div className="grid gap-2 sm:grid-cols-2">
                                    <select
                                      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
                                      value={slot.away_player1_id ?? ""}
                                      disabled={!canEditCurrentFixture}
                                      onChange={(e) => void updateFrameWithDerivedWinner(slot, { away_player1_id: e.target.value || null, away_forfeit: false })}
                                    >
                                      <option value="">Away player 1</option>
                                      {awayRosterIds.map((id) => (
                                        <option key={id} value={id} disabled={slot.away_player2_id === id}>
                                          {named(playerById.get(id))}
                                        </option>
                                      ))}
                                    </select>
                                    <select
                                      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
                                      value={slot.away_player2_id ?? ""}
                                      disabled={!canEditCurrentFixture}
                                      onChange={(e) => void updateFrameWithDerivedWinner(slot, { away_player2_id: e.target.value || null })}
                                    >
                                      <option value="">Away player 2</option>
                                      {awayRosterIds.map((id) => (
                                        <option key={id} value={id} disabled={slot.away_player1_id === id}>
                                          {named(playerById.get(id))}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                ) : (
                                  <select
                                    className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
                                    value={awaySelection}
                                    disabled={!canEditCurrentFixture}
                                    onChange={(e) => void applySinglesSelection(slot, "away", e.target.value)}
                                  >
                                    <option value="">Away player</option>
                                    {isWinterFormat && slot.slot_no === 3 ? <option value="__NO_SHOW__">No Show</option> : null}
                                    {isWinterFormat && slot.slot_no === 4 ? <option value="__NOMINATED__">Nominated Player</option> : null}
                                    {awayRosterIds.map((id) => (
                                      <option key={id} value={id} disabled={awaySinglesTaken.has(id) && slot.away_player1_id !== id}>
                                        {named(playerById.get(id))}
                                        {awaySinglesTaken.has(id) && slot.away_player1_id !== id ? " (Already used in singles)" : ""}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </div>
                              <input
                                key={`away-points-${slot.id}-${slot.away_points_scored ?? ""}`}
                                type="number"
                                min={0}
                                max={200}
                                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
                                defaultValue={slot.away_points_scored ?? ""}
                                disabled={!canEditCurrentFixture}
                                onBlur={(e) => void updateFramePoints(slot, "away", e.target.value)}
                                placeholder="0-200"
                              />
                            </div>
                            {slot.slot_type === "singles" && isWinterFormat && slot.slot_no === 4 ? (
                              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                {slot.home_nominated ? (
                                  <select
                                    className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
                                    value={nominatedNames[`${slot.id}:home`] ?? ""}
                                    disabled={!canEditCurrentFixture}
                                    onChange={(e) => {
                                      setNominatedNames((prev) => ({ ...prev, [`${slot.id}:home`]: e.target.value }));
                                      void updateNominatedName(slot, "home", e.target.value);
                                    }}
                                  >
                                    <option value="">Home nominated player (info)</option>
                                    {homeRosterIds.map((id) => (
                                      <option key={id} value={named(playerById.get(id))}>
                                        {named(playerById.get(id))}
                                      </option>
                                    ))}
                                  </select>
                                ) : <div />}
                                {slot.away_nominated ? (
                                  <select
                                    className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
                                    value={nominatedNames[`${slot.id}:away`] ?? ""}
                                    disabled={!canEditCurrentFixture}
                                    onChange={(e) => {
                                      setNominatedNames((prev) => ({ ...prev, [`${slot.id}:away`]: e.target.value }));
                                      void updateNominatedName(slot, "away", e.target.value);
                                    }}
                                  >
                                    <option value="">Away nominated player (info)</option>
                                    {awayRosterIds.map((id) => (
                                      <option key={id} value={named(playerById.get(id))}>
                                        {named(playerById.get(id))}
                                      </option>
                                    ))}
                                  </select>
                                ) : <div />}
                              </div>
                            ) : null}
                            <p className="mt-2 text-xs text-slate-600">
                              Winner: {slot.winner_side === "home" ? (teamById.get(fixture.home_team_id)?.name ?? "Home") : slot.winner_side === "away" ? (teamById.get(fixture.away_team_id)?.name ?? "Away") : "Not decided"}
                            </p>
                            <p className="text-xs text-slate-500">
                              No Show on both sides = no frame point. Nominated player frames still award team points, but no player profile stats.
                            </p>
                          </div>
                        );
                      })}
                    </div>

                    <section className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <h3 className="text-base font-semibold text-slate-900">Breaks 30+</h3>
                      <p className="mt-1 text-xs text-slate-600">Record up to 4 by default. Use More for additional breaks.</p>
                      {!breaksFeatureAvailable ? (
                        <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                          Break tracking table is missing. Run the SQL migration first.
                        </p>
                      ) : null}
                      <div className="mt-3 space-y-2">
                        {fixtureBreaks.map((row, idx) => (
                          <div key={`break-${idx}`} className="grid gap-2 sm:grid-cols-4">
                            <select
                              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
                              value={row.player_id ?? ""}
                              disabled={!canEditCurrentFixture}
                              onChange={(e) => setBreakField(idx, { player_id: e.target.value || null })}
                            >
                              <option value="">Select player</option>
                              {fixturePlayerOptions.map((opt) => (
                                <option key={opt.id} value={opt.id}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                            <input
                              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
                              placeholder="Or enter player name"
                              value={row.entered_player_name}
                              disabled={!canEditCurrentFixture}
                              onChange={(e) => setBreakField(idx, { entered_player_name: e.target.value })}
                            />
                            <input
                              type="number"
                              min={30}
                              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
                              placeholder="Break value (30+)"
                              value={row.break_value}
                              disabled={!canEditCurrentFixture}
                              onChange={(e) => setBreakField(idx, { break_value: e.target.value })}
                            />
                            <button
                              type="button"
                              onClick={() => setFixtureBreaks((prev) => prev.filter((_, i) => i !== idx))}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700"
                              disabled={!canEditCurrentFixture || (fixtureBreaks.length <= 4 && idx < 4)}
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={addBreakRow}
                          className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
                          disabled={!canEditCurrentFixture}
                        >
                          More
                        </button>
                        <button
                          type="button"
                          onClick={saveFixtureBreaks}
                          className="rounded-xl bg-slate-900 px-4 py-1.5 text-sm font-medium text-white"
                          disabled={!canEditCurrentFixture}
                        >
                          Save breaks
                        </button>
                      </div>
                    </section>
                  </div>
                </div>
              ) : null}

              {activeView === "table" ? (
              <section className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-white to-emerald-50 p-4 shadow-sm">
                <h2 className="text-lg font-semibold text-emerald-900">League Table</h2>
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-slate-600">
                        <th className="px-2 py-2">#</th>
                        <th className="px-2 py-2">Team</th>
                        <th className="px-2 py-2">P</th>
                        <th className="px-2 py-2">W</th>
                        <th className="px-2 py-2">L</th>
                        <th className="px-2 py-2">FF</th>
                        <th className="px-2 py-2">FA</th>
                        <th className="px-2 py-2">FD</th>
                        <th className="px-2 py-2">Points</th>
                        <th className="px-2 py-2">Streak</th>
                        <th className="px-2 py-2">Last 5</th>
                      </tr>
                    </thead>
                    <tbody>
                      {seasonTable.map((r, idx) => (
                        <tr key={r.team_id} className="border-b border-slate-100 text-slate-800">
                          <td className="px-2 py-2">{idx + 1}</td>
                          <td className="px-2 py-2">
                            <button
                              type="button"
                              className="text-left underline decoration-slate-300 underline-offset-2 hover:text-slate-900"
                              onClick={() => setSelectedTableTeamId(r.team_id)}
                            >
                              {r.team_name}
                            </button>
                          </td>
                          <td className="px-2 py-2">{r.played}</td>
                          <td className="px-2 py-2">{r.won}</td>
                          <td className="px-2 py-2">{r.lost}</td>
                          <td className="px-2 py-2">{r.frames_for}</td>
                          <td className="px-2 py-2">{r.frames_against}</td>
                          <td className="px-2 py-2">{r.frame_diff}</td>
                          <td className="px-2 py-2 font-semibold">{r.points}</td>
                          <td className="px-2 py-2">{r.streak}</td>
                          <td className="px-2 py-2">{r.last_five}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!seasonTable.length ? <p className="mt-2 text-sm text-slate-600">No table rows yet for this league.</p> : null}
                </div>
              </section>
              ) : null}

              {activeView === "playerTable" ? (
              <section className="rounded-2xl border border-violet-200 bg-gradient-to-br from-white to-violet-50 p-4 shadow-sm">
                <h2 className="text-lg font-semibold text-violet-900">Player Table</h2>
                {seasonId ? (
                  <>
                    <p className="mt-1 text-[11px] text-slate-600">Ranking is based on Singles results.</p>
                    <div className="mt-3 overflow-auto rounded-xl border border-slate-200 bg-white">
                      <table className="min-w-full border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-slate-600">
                            <th className="px-2 py-1">Rank</th>
                            <th className="px-2 py-1">Player</th>
                            <th className="px-2 py-1">Team</th>
                            <th className="px-2 py-1">S App</th>
                            <th className="px-2 py-1">S P</th>
                            <th className="px-2 py-1">S W</th>
                            <th className="px-2 py-1">S L</th>
                            <th className="px-2 py-1">S Win %</th>
                            <th className="px-2 py-1">D App</th>
                            <th className="px-2 py-1">D P</th>
                            <th className="px-2 py-1">D W</th>
                            <th className="px-2 py-1">D L</th>
                            <th className="px-2 py-1">D Win %</th>
                            <th className="px-2 py-1">T App</th>
                            <th className="px-2 py-1">T P</th>
                            <th className="px-2 py-1">T W</th>
                            <th className="px-2 py-1">T L</th>
                            <th className="px-2 py-1">T Win %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {playerSummaryRows.map((r) => (
                            <tr key={r.player_id} className="border-b border-slate-100 text-slate-800">
                              <td className="px-2 py-1 font-semibold">{r.rank ?? "-"}</td>
                              <td className="px-2 py-1">{r.player_name}</td>
                              <td className="px-2 py-1">{r.team_name}</td>
                              <td className="px-2 py-1">{r.singles?.appearances ?? 0}</td>
                              <td className="px-2 py-1">{r.singles?.played ?? 0}</td>
                              <td className="px-2 py-1">{r.singles?.won ?? 0}</td>
                              <td className="px-2 py-1">{r.singles?.lost ?? 0}</td>
                              <td className="px-2 py-1">{(r.singles?.win_pct ?? 0).toFixed(1)}%</td>
                              <td className="px-2 py-1">{r.doubles?.appearances ?? 0}</td>
                              <td className="px-2 py-1">{r.doubles?.played ?? 0}</td>
                              <td className="px-2 py-1">{r.doubles?.won ?? 0}</td>
                              <td className="px-2 py-1">{r.doubles?.lost ?? 0}</td>
                              <td className="px-2 py-1">{(r.doubles?.win_pct ?? 0).toFixed(1)}%</td>
                              <td className="px-2 py-1">{r.total?.appearances ?? 0}</td>
                              <td className="px-2 py-1">{r.total?.played ?? 0}</td>
                              <td className="px-2 py-1">{r.total?.won ?? 0}</td>
                              <td className="px-2 py-1">{r.total?.lost ?? 0}</td>
                              <td className="px-2 py-1">{(r.total?.win_pct ?? 0).toFixed(1)}%</td>
                            </tr>
                          ))}
                          {playerSummaryRows.length === 0 ? (
                            <tr>
                              <td className="px-2 py-2 text-slate-500" colSpan={18}>
                                No player data yet.
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-slate-600">Select a league in League Setup to view player statistics.</p>
                )}
              </section>
              ) : null}

              {activeView === "knockouts" ? (
                <section className="rounded-2xl border border-fuchsia-200 bg-gradient-to-br from-white to-fuchsia-50 p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-fuchsia-900">Knockout Competitions</h2>
                      <p className="mt-1 text-sm text-slate-600">
                        Super User publishes cups. Users can sign up when entries are open.
                      </p>
                    </div>
                    <Link href="/signups" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                      Open Sign-up Page
                    </Link>
                  </div>
                  <div className="mt-3 space-y-3">
                    {knockoutEvents.map((event) => {
                      const signupCount = knockoutSignupCountByEventId.get(event.id) ?? 0;
                      const mySignup = myKnockoutSignupByEventId.get(event.id) ?? null;
                      const isOpenForUsers = event.published && event.signup_open && event.is_active;
                      return (
                        <div key={event.id} className="rounded-xl border border-slate-200 bg-white p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{event.name}</p>
                              <p className="text-xs text-slate-600">
                                {event.sport_type === "billiards" ? "Billiards" : "Snooker"} ·{" "}
                                {event.match_mode === "triples"
                                  ? "Triples"
                                  : event.match_mode === "doubles"
                                    ? "Doubles"
                                    : "Singles"}{" "}
                                · {event.format_label === "handicap" ? "Handicap" : "Scratch"}
                                {event.age_min ? ` · ${event.age_min}+` : ""}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className={`rounded-full border px-2 py-0.5 ${event.published ? "border-emerald-300 bg-emerald-100 text-emerald-900" : "border-slate-300 bg-slate-100 text-slate-700"}`}>
                                {event.published ? "Published" : "Draft"}
                              </span>
                              <span className={`rounded-full border px-2 py-0.5 ${event.signup_open ? "border-teal-300 bg-teal-100 text-teal-900" : "border-slate-300 bg-slate-100 text-slate-700"}`}>
                                {event.signup_open ? "Sign-ups open" : "Sign-ups closed"}
                              </span>
                              <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-slate-700">
                                Entries: {signupCount}
                              </span>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            {admin.isSuper ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void updateKnockoutEvent(event.id, { published: !event.published })}
                                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700"
                                >
                                  {event.published ? "Unpublish" : "Publish"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void updateKnockoutEvent(event.id, { signup_open: !event.signup_open })}
                                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700"
                                >
                                  {event.signup_open ? "Close sign-ups" : "Open sign-ups"}
                                </button>
                              </>
                            ) : null}
                            {!admin.isSuper ? (
                              mySignup ? (
                                <button
                                  type="button"
                                  onClick={() => void withdrawKnockout(event.id)}
                                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700"
                                >
                                  Withdraw entry
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void enterKnockout(event.id)}
                                  disabled={!isOpenForUsers}
                                  className="rounded-lg bg-fuchsia-700 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Enter cup
                                </button>
                              )
                            ) : null}
                            {!admin.isSuper && !isOpenForUsers ? (
                              <span className="text-xs text-slate-500">Entry not open yet.</span>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                    {knockoutEvents.length === 0 ? (
                      <p className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600">
                        No knockout competitions configured yet.
                      </p>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {selectedTableTeamId ? (
                <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4">
                  <div className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold text-slate-900">
                        Team Results: {teamById.get(selectedTableTeamId)?.name ?? "Team"}
                      </h3>
                      <button
                        type="button"
                        onClick={() => setSelectedTableTeamId(null)}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
                      >
                        Close
                      </button>
                    </div>
                    <div className="mt-3 overflow-x-auto">
                      <table className="min-w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-slate-600">
                            <th className="px-2 py-2">Week</th>
                            <th className="px-2 py-2">Date</th>
                            <th className="px-2 py-2">Venue</th>
                            <th className="px-2 py-2">Opponent</th>
                            <th className="px-2 py-2">Score</th>
                            <th className="px-2 py-2">Result</th>
                            <th className="px-2 py-2">Status</th>
                            <th className="px-2 py-2">Summary</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedTeamResults.map((r) => (
                            <tr
                              key={r.id}
                              className={`border-b text-slate-800 ${
                                r.status === "complete"
                                  ? "border-emerald-100 bg-emerald-50/40"
                                  : r.status === "in_progress"
                                    ? "border-amber-100 bg-amber-50/40"
                                    : "border-slate-100 bg-white"
                              }`}
                            >
                              <td className="px-2 py-2">{r.week ?? "-"}</td>
                              <td className="px-2 py-2">{r.date ? new Date(`${r.date}T12:00:00`).toLocaleDateString() : "No date"}</td>
                              <td className="px-2 py-2">{r.isHome ? "Home" : "Away"}</td>
                              <td className="px-2 py-2">{r.opponent}</td>
                              <td className="px-2 py-2">{r.score}</td>
                              <td className="px-2 py-2">
                                <span
                                  className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold ${
                                    r.result === "W"
                                      ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                                      : r.result === "L"
                                        ? "border-rose-300 bg-rose-100 text-rose-900"
                                        : r.result === "D"
                                          ? "border-slate-300 bg-slate-100 text-slate-800"
                                          : "border-slate-300 bg-white text-slate-600"
                                  }`}
                                >
                                  {r.result}
                                </span>
                              </td>
                              <td className="px-2 py-2">
                                <span
                                  className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${
                                    r.status === "complete"
                                      ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                                      : r.status === "in_progress"
                                        ? "border-amber-300 bg-amber-100 text-amber-900"
                                        : "border-slate-300 bg-slate-100 text-slate-700"
                                  }`}
                                >
                                  {statusLabel(r.status)}
                                </span>
                              </td>
                              <td className="px-2 py-2">
                                {r.status === "complete" ? (
                                  <button
                                    type="button"
                                    onClick={() => setSelectedTeamResultFixtureId(r.id)}
                                    className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                                  >
                                    View match
                                  </button>
                                ) : (
                                  <span className="text-xs text-slate-500">-</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {selectedTeamResults.length === 0 ? <p className="mt-2 text-sm text-slate-600">No results for this team yet.</p> : null}
                    </div>
                  </div>
                </div>
              ) : null}

              {selectedTeamResultFixture ? (
                <div className="fixed inset-0 z-[60] flex items-start justify-center bg-slate-900/50 p-4">
                  <div className="max-h-[88vh] w-full max-w-3xl overflow-auto rounded-2xl border border-indigo-200 bg-gradient-to-br from-white to-indigo-50 p-4 shadow-xl">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold text-indigo-900">Match Summary</h3>
                      <button
                        type="button"
                        onClick={() => setSelectedTeamResultFixtureId(null)}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
                      >
                        Close
                      </button>
                    </div>
                    <p className="mt-2 text-sm text-slate-800">
                      {teamById.get(selectedTeamResultFixture.home_team_id)?.name ?? "Home"} vs{" "}
                      {teamById.get(selectedTeamResultFixture.away_team_id)?.name ?? "Away"}
                    </p>
                    <p className="text-xs text-slate-600">
                      Week {selectedTeamResultFixture.week_no ?? "-"} ·{" "}
                      {selectedTeamResultFixture.fixture_date
                        ? new Date(`${selectedTeamResultFixture.fixture_date}T12:00:00`).toLocaleDateString()
                        : "No date"}
                    </p>
                    <p className="mt-1 text-sm font-medium text-slate-900">
                      Final: {computeFixtureProgress(selectedTeamResultFixture).homePoints} -{" "}
                      {computeFixtureProgress(selectedTeamResultFixture).awayPoints}
                    </p>
                    <div className="mt-3 overflow-x-auto">
                      <table className="min-w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-slate-600">
                            <th className="px-2 py-2">Frame</th>
                            <th className="px-2 py-2">Home player(s)</th>
                            <th className="px-2 py-2">Score</th>
                            <th className="px-2 py-2 text-right">Away player(s)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedTeamResultFrames.map((row) => (
                            <tr key={row.id} className="border-b border-slate-100 text-slate-800">
                              <td className="px-2 py-2">{row.label}</td>
                              <td className="px-2 py-2">
                                <span
                                  className={`inline-flex rounded-md px-2 py-1 ${
                                    row.winnerSide === "home" ? "border border-emerald-300 bg-emerald-100 font-semibold text-emerald-900" : ""
                                  }`}
                                >
                                  {row.homePlayers}
                                </span>
                              </td>
                              <td className="px-2 py-2 font-medium">{row.score}</td>
                              <td className="px-2 py-2 text-right">
                                <span
                                  className={`inline-flex rounded-md px-2 py-1 ${
                                    row.winnerSide === "away" ? "border border-emerald-300 bg-emerald-100 font-semibold text-emerald-900" : ""
                                  }`}
                                >
                                  {row.awayPlayers}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : null}

              {activeView === "fixtures" && canApproveSubmissions ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h2 className="text-lg font-semibold text-slate-900">Pending Result Approvals</h2>
                  {!allPendingSubmissions.length ? <p className="mt-2 text-sm text-slate-600">No pending league submissions.</p> : null}
                  <div className="mt-3 space-y-2">
                    {allPendingSubmissions.map((s) => {
                      const f = fixtures.find((fx) => fx.id === s.fixture_id);
                      const homeName = f ? teamById.get(f.home_team_id)?.name ?? "Home" : "Home";
                      const awayName = f ? teamById.get(f.away_team_id)?.name ?? "Away" : "Away";
                      const frameResults = [...(s.frame_results ?? [])].sort((a, b) => a.slot_no - b.slot_no);
                      const submissionSeason = seasonById.get(s.season_id) ?? null;
                      const submissionCfg = getSeasonFrameConfig(submissionSeason);
                      const homeFrames = frameResults.filter((r) => r.winner_side === "home").length;
                      const awayFrames = frameResults.filter((r) => r.winner_side === "away").length;
                      return (
                        <div key={s.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <p className="font-medium text-slate-900">
                            {homeName} vs {awayName}
                          </p>
                          <p className="text-xs text-slate-600">
                            Submitted: {new Date(s.created_at).toLocaleString()}
                          </p>
                          <p className="mt-1 text-xs font-medium text-slate-800">
                            Submitted score: {homeName} {homeFrames} - {awayFrames} {awayName}
                          </p>
                          <div className="mt-2 rounded-lg border border-slate-200 bg-white p-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              {`Frame results (${submissionCfg.singles} singles${submissionCfg.doubles > 0 ? ` + ${submissionCfg.doubles} doubles` : ""})`}
                            </p>
                            <ul className="mt-1 space-y-1 text-xs text-slate-700">
                              {frameResults.map((r) => (
                                <li key={`${s.id}-${r.slot_no}`}>
                                  {slotLabel(r.slot_no, submissionSeason)}: {r.winner_side === "home" ? homeName : r.winner_side === "away" ? awayName : "Not set"}
                                </li>
                              ))}
                              {!frameResults.length ? <li>No frame results submitted.</li> : null}
                            </ul>
                          </div>
                          {s.scorecard_photo_url ? (
                            <p className="mt-2 text-xs">
                              <a href={s.scorecard_photo_url} target="_blank" rel="noreferrer" className="text-teal-700 underline">
                                Open scorecard photo
                              </a>
                            </p>
                          ) : null}
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => { setActiveView("fixtures"); setFixtureId(s.fixture_id); setResultEntryOpen(true); }}
                              className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
                            >
                              Open result entry
                            </button>
                            <button
                              type="button"
                              onClick={() => void reviewSubmission(s.id, "approved")}
                              className="rounded-xl bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => void reviewSubmission(s.id, "rejected")}
                              className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3">
                    <input
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                      placeholder="Optional rejection reason (used when rejecting)"
                      value={reviewReason}
                      onChange={(e) => setReviewReason(e.target.value)}
                    />
                  </div>
                </section>
              ) : null}
            </>
          ) : null}
        </RequireAuth>
      </div>
    </main>
  );
}
