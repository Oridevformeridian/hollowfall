// Achievement registry — the single source of truth shared by the server (which evaluates and
// unlocks, authoritatively) and the client (which only renders). See HOLLOWFALL_stats_achievements.md.
// Each achievement's progress is a pure function of the player's cumulative `stats`; it's unlocked
// when progress >= target. Adding an achievement is a new entry here — no other plumbing.

export interface PlayerStats {
  casualWins?: number; casualLosses?: number; competitiveWins?: number; competitiveLosses?: number;
  casualSevers?: number; competitiveSevers?: number; casualAces?: number; flawlessWins?: number;
  mirrorSevers?: number; casualMatches?: number; competitiveMatches?: number;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  category: 'pvp' | 'casual' | 'skill';
  target: number;
  metric: (s: PlayerStats) => number;
}

const pvpSevers = (s: PlayerStats) => (s.casualSevers || 0) + (s.competitiveSevers || 0);

export const ACHIEVEMENTS: Achievement[] = [
  // General PVP severs (casual + competitive)
  { id: 'sever_1', name: 'Sever I', description: 'Sever 10 Walkers in PVP', category: 'pvp', target: 10, metric: pvpSevers },
  { id: 'sever_2', name: 'Sever II', description: 'Sever 50 Walkers in PVP', category: 'pvp', target: 50, metric: pvpSevers },
  { id: 'sever_3', name: 'Sever III', description: 'Sever 100 Walkers in PVP', category: 'pvp', target: 100, metric: pvpSevers },
  // Casual-specific severs (much higher)
  { id: 'casual_sever_1', name: 'Casual Sever I', description: 'Sever 100 Walkers in Casual', category: 'casual', target: 100, metric: s => s.casualSevers || 0 },
  { id: 'casual_sever_2', name: 'Casual Sever II', description: 'Sever 500 Walkers in Casual', category: 'casual', target: 500, metric: s => s.casualSevers || 0 },
  { id: 'casual_sever_3', name: 'Casual Sever III', description: 'Sever 1000 Walkers in Casual', category: 'casual', target: 1000, metric: s => s.casualSevers || 0 },
  // Aces (casual 1v1 win using <=3 damage spells)
  { id: 'ace_1', name: 'Ace I', description: 'Ace 10 Casual matches (win a 1v1 with 3 damage spells or fewer)', category: 'skill', target: 10, metric: s => s.casualAces || 0 },
  { id: 'ace_2', name: 'Ace II', description: 'Ace 25 Casual matches', category: 'skill', target: 25, metric: s => s.casualAces || 0 },
  { id: 'ace_3', name: 'Ace III', description: 'Ace 50 Casual matches', category: 'skill', target: 50, metric: s => s.casualAces || 0 },
  // Flawless Courier (win taking 0 damage all match)
  { id: 'flawless_1', name: 'Flawless Courier I', description: 'Win a match without taking any damage', category: 'skill', target: 1, metric: s => s.flawlessWins || 0 },
  { id: 'flawless_2', name: 'Flawless Courier II', description: 'Win 5 matches without taking any damage', category: 'skill', target: 5, metric: s => s.flawlessWins || 0 },
  { id: 'flawless_3', name: 'Flawless Courier III', description: 'Win 10 matches without taking any damage', category: 'skill', target: 10, metric: s => s.flawlessWins || 0 },
  // Mirror match
  { id: 'mirror_1', name: 'Mirror Match', description: 'Sever an opponent of your own class', category: 'skill', target: 1, metric: s => s.mirrorSevers || 0 },
];

export interface AchievementState { unlocked: boolean; unlockedAt?: number; progress: number; }

// Evaluate all achievements against fresh stats, merging with prior state (to keep unlockedAt and
// never re-lock). Pure — used server-side to persist; the client reads the persisted result.
export function evaluateAchievements(
  stats: PlayerStats,
  prior: Record<string, AchievementState> = {},
  now = Date.now()
): Record<string, AchievementState> {
  const out: Record<string, AchievementState> = { ...prior };
  for (const a of ACHIEVEMENTS) {
    const progress = a.metric(stats);
    const wasUnlocked = prior[a.id]?.unlocked || false;
    const unlocked = wasUnlocked || progress >= a.target;
    out[a.id] = {
      unlocked,
      progress,
      unlockedAt: prior[a.id]?.unlockedAt ?? (unlocked && !wasUnlocked ? now : undefined)
    };
  }
  return out;
}
