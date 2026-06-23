// Reward catalog — visual identity upgrades only, never pay-to-win.

export type RewardKind = "frame" | "holo" | "border" | "aura" | "badge" | "title" | "background";

export type Reward = {
  id: string;
  name: string;
  kind: RewardKind;
  requirement: string;
};

/** Streak-milestone rewards (by consecutive check-in count). */
export const STREAK_REWARDS: { milestone: number; reward: Reward }[] = [
  { milestone: 3, reward: { id: "frame-consistent", name: "Profile Frame", kind: "frame", requirement: "3 check-in streak" } },
  { milestone: 7, reward: { id: "holo-rare", name: "Rare Holographic Effect", kind: "holo", requirement: "7 check-in streak" } },
  { milestone: 14, reward: { id: "border-epic", name: "Epic Border Animation", kind: "border", requirement: "14 check-in streak" } },
  { milestone: 30, reward: { id: "aura-prism-streak", name: "Prism Aura", kind: "aura", requirement: "30 check-in streak" } },
];

/** XP-level unlocked visual effects. */
export const XP_REWARDS: { level: number; reward: Reward }[] = [
  { level: 2, reward: { id: "frame-ice", name: "Ice Profile Frame", kind: "frame", requirement: "Level 2" } },
  { level: 4, reward: { id: "bg-pulse", name: "Animated Card Background", kind: "background", requirement: "Level 4" } },
  { level: 6, reward: { id: "holo-layer", name: "Extra Holographic Layer", kind: "holo", requirement: "Level 6" } },
  { level: 8, reward: { id: "border-rare", name: "Animated Rare Border", kind: "border", requirement: "Level 8" } },
  { level: 12, reward: { id: "badge-ritual", name: "Ritual OG Badge", kind: "badge", requirement: "Level 12" } },
  { level: 16, reward: { id: "aura-prism", name: "Prism Aura", kind: "aura", requirement: "Level 16" } },
];

export function rewardKindLabel(kind: RewardKind): string {
  switch (kind) {
    case "frame":
      return "Frame";
    case "holo":
      return "Holographic";
    case "border":
      return "Border FX";
    case "aura":
      return "Aura";
    case "badge":
      return "Badge";
    case "title":
      return "Title";
    case "background":
      return "Background";
  }
}
