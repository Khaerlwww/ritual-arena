import type { Address } from "viem";

// Wallet test/operator yang pernah dipakai untuk QA/keeper battle.
// Ini hanya filter tampilan produk + auto-matchmaking candidate.
// Tidak mengubah state on-chain.
const HIDDEN_PRODUCT_WALLETS = new Set<string>([
  "0x542e1746920eb2e8303b0599561d44ed4e050d62", // V11 deployer / keeper
  "0x96db83ce302f2381fe7242a08ea1c65c14e83c53", // QA/test battle wallet
]);

export function isHiddenProductWallet(wallet?: string | null): boolean {
  if (!wallet) return false;
  return HIDDEN_PRODUCT_WALLETS.has(wallet.toLowerCase());
}

export function filterVisibleProductWallets<T extends { wallet: Address | string }>(rows: T[]): T[] {
  return rows.filter((row) => !isHiddenProductWallet(row.wallet));
}
