import { LeaderboardEntry, LeaderboardTable } from "./types";

const TABLE_LIMIT = 100;

const sortEntries = (entries: LeaderboardEntry[]): LeaderboardEntry[] => {
  return entries
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.timestamp.localeCompare(right.timestamp);
    })
    .slice(0, TABLE_LIMIT);
};

export class LeaderboardService {
  submit(table: LeaderboardTable, entry: LeaderboardEntry): LeaderboardTable {
    if (entry.flagged) {
      return {
        entries: table.entries,
        quarantined: [entry, ...table.quarantined].slice(0, TABLE_LIMIT),
      };
    }

    const highestByPlayer = new Map<string, LeaderboardEntry>();

    for (const existing of [...table.entries, entry]) {
      const current = highestByPlayer.get(existing.playerId);
      if (!current || existing.score > current.score) {
        highestByPlayer.set(existing.playerId, existing);
      }
    }

    return {
      entries: sortEntries(Array.from(highestByPlayer.values())),
      quarantined: table.quarantined,
    };
  }
}
