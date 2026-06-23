// src/lib/gasDefaults.ts
//
// Ritual Chain (chainId 1979) is not in MetaMask's gas registry, so the
// wallet popup shows "Gas unavailable" unless we pass EIP-1559 fees
// explicitly. These defaults are tuned for testnet (very cheap: 1 gwei
// priority + 2 gwei max, block base fee is essentially 0).
//
// Used by every writeContract call site — pass as `maxFeePerGas` /
// `maxPriorityFeePerGas` to walletClient.writeContract(…).

export const RITUAL_GAS = {
  /** Max total fee per gas unit — covers base + priority. */
  maxFeePerGas: 2_000_000_000n, // 2 gwei
  /** Miner/validator tip. Must be >= 1 gwei or wallets reject. */
  maxPriorityFeePerGas: 1_000_000_000n, // 1 gwei
  /** Legacy fallback if the wallet does not support EIP-1559. */
  gasPrice: 2_000_000_000n, // 2 gwei
} as const;
