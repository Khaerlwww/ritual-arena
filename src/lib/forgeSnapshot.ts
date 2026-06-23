import type { Address } from "viem";
import { POWER_MODEL_VERSION, rarityFromPower, rarityLabel } from "../shared/powerModel";

/**
 * Forge snapshot — card always starts at Power 1 / INITIATE.
 * No wallet scanning. Power evolves through Training/Arena after forge.
 */
export type ForgeCardSnapshot = {
  wallet: Address;
  handle: string;
  power: number;
  rarity: string;
  powerModelVersion: number;
  generatedAt: number;
};

/**
 * Create initial forge snapshot — always Power 1 / INITIATE.
 */
export function buildForgeCardSnapshot(
  wallet: Address,
  handle: string
): ForgeCardSnapshot {
  return {
    wallet,
    handle,
    power: 1,
    rarity: "INITIATE",
    powerModelVersion: POWER_MODEL_VERSION,
    generatedAt: Math.floor(Date.now() / 1000),
  };
}

/**
 * Create evolved snapshot from on-chain CardSnapshot values.
 * Called after Training/Arena to update metadata.
 */
export function buildEvolvedSnapshot(
  wallet: Address,
  handle: string,
  currentPower: number,
  currentRarity: number
): ForgeCardSnapshot {
  return {
    wallet,
    handle,
    power: currentPower,
    rarity: rarityLabel(currentRarity),
    powerModelVersion: POWER_MODEL_VERSION,
    generatedAt: Math.floor(Date.now() / 1000),
  };
}
