// useAchievements.ts
// Reads achievement state from AchievementRegistry contract.
// Falls back to frontend-derived achievements if registry not configured.

import { useEffect, useState, useCallback } from "react";
import type { Address } from "viem";
import { publicClient } from "./useAnthem";
import { achievementRegistryAbi } from "../abi/achievementRegistry";
import { achievementRegistryAddress, hasAchievementRegistry as hasAchievementRegistryConfigured } from "../lib/chains";
import { ACHIEVEMENTS, ACHIEVEMENT_IDS, calcAchievementScore, type AchievementState } from "../lib/achievementEngine";
import { checkAchievements } from "../lib/achievementEngine";

export const hasAchievementRegistry = hasAchievementRegistryConfigured;

export interface AchievementEntry {
  id: string;
  name: string;
  description: string;
  category: "progression" | "arena" | "consistency";
  points: number;
  unlocked: boolean;
  unlockedAt: number;
  sourceHash: string;
}

export interface AchievementRegistryState {
  entries: AchievementEntry[];
  achievementScore: number;
  totalUnlocked: number;
  isLoading: boolean;
  error: string | null;
}

export function useAchievements(wallet?: Address, fallbackState?: AchievementState) {
  const [state, setState] = useState<AchievementRegistryState>({
    entries: [],
    achievementScore: 0,
    totalUnlocked: 0,
    isLoading: true,
    error: null,
  });

  const fetchFromRegistry = useCallback(async () => {
    if (!wallet || !hasAchievementRegistry) return null;
    try {
      const score = (await publicClient.readContract({
        address: achievementRegistryAddress,
        abi: achievementRegistryAbi,
        functionName: "getAchievementScore",
        args: [wallet],
      })) as bigint;

      const ids = (await publicClient.readContract({
        address: achievementRegistryAddress,
        abi: achievementRegistryAbi,
        functionName: "getAchievementIds",
        args: [wallet],
      })) as readonly `0x${string}`[];

      const unlockedSet = new Set<string>(ids.map((id) => id.toLowerCase()));

      const entries: AchievementEntry[] = ACHIEVEMENTS.map((a) => ({
        ...a,
        points: 0,
        unlocked: unlockedSet.has(a.id.toLowerCase()),
        unlockedAt: 0,
        sourceHash: "0x",
      }));

      return {
        entries,
        achievementScore: Number(score),
        totalUnlocked: ids.length,
      };
    } catch {
      return null;
    }
  }, [wallet]);

  // No client-side fake achievement score. If the registry read fails,
  // the hook returns `null` and the UI shows an empty state.
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, isLoading: true, error: null }));

    (async () => {
      try {
        const registryResult = await fetchFromRegistry();
        if (cancelled) return;

        if (registryResult) {
          setState({ ...registryResult, isLoading: false, error: null });
        } else {
          // No registry data — show empty state, NOT a fabricated fallback.
          if (cancelled) return;
          setState({
            entries: ACHIEVEMENTS.map((a) => ({ ...a, points: 0, unlocked: false, unlockedAt: 0, sourceHash: "0x" })),
            achievementScore: 0,
            totalUnlocked: 0,
            isLoading: false,
            error: null,
          });
        }
      } catch (err) {
        if (cancelled) return;
        setState((s) => ({ ...s, isLoading: false, error: err instanceof Error ? err.message : "Unknown error" }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [wallet, fetchFromRegistry]);

  return state;
}
