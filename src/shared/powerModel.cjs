"use strict";

const POWER_MODEL_VERSION = 2;

function rarityFromPower(power) {
  if (power >= 80) return 4; // MYTHIC
  if (power >= 66) return 3; // LEGENDARY
  if (power >= 40) return 2; // EPIC
  if (power >= 20) return 1; // RARE
  return 0; // COMMON
}

function rarityLabel(rank) {
  return ["COMMON", "RARE", "EPIC", "LEGENDARY", "MYTHIC"][rank] || "COMMON";
}

function calcEvolutionPower(input) {
  const xpScore = Math.min((input.totalXp || 0) * 10 / 35, 50);
  const winScore = Math.min((input.wins || 0) * 4, 30);
  const streakScore = Math.min((input.longestStreak || 0) * 10 / 7, 20);

  const candidate = Math.min(xpScore + winScore + streakScore, 100);
  return Math.max(candidate, input.currentPower || 1);
}

module.exports = {
  POWER_MODEL_VERSION,
  calcEvolutionPower,
  rarityFromPower,
  rarityLabel,
};
