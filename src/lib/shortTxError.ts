// src/lib/shortTxError.ts
//
// Turn a noisy viem / wallet error blob into one short, dismissable line.
// Replaces the full `e.message` (which dumps the entire tx call + URL +
// version + docs link) with a single human sentence the UI can show in
// a fixed-height row that never grows.

export type ViemLikeError = {
  name?: string;
  shortMessage?: string;
  details?: string;
  message?: string;
  code?: number | string;
  cause?: {
    name?: string;
    shortMessage?: string;
    message?: string;
    code?: number | string;
  };
};

export function shortTxError(err: unknown, action = "Transaction"): string {
  const e = err as ViemLikeError | undefined;
  if (!e) return `${action} failed.`;

  const code = e?.code ?? e?.cause?.code;
  const blob = [
    e?.name, e?.shortMessage, e?.details, e?.message,
    e?.cause?.name, e?.cause?.shortMessage, e?.cause?.message,
  ].filter(Boolean).join(" • ");

  // User cancelled in wallet
  if (
    code === 4001 || code === "ACTION_REJECTED" ||
    /user (rejected|denied)|rejected the request|denied (transaction|message)/i.test(blob)
  ) {
    return `${action} cancelled.`;
  }
  // Out of native gas token
  if (/insufficient funds/i.test(blob)) {
    return `${action} failed — not enough RITUAL for gas.`;
  }
  // AP / ERC20 allowance
  if (/ERC20InsufficientAllowance|insufficient allowance/i.test(blob)) {
    return `${action} failed — AP not approved.`;
  }
  if (/ERC20InsufficientBalance|insufficient balance/i.test(blob)) {
    return `${action} failed — not enough AP.`;
  }
  // Out of stock
  if (/sold out|RaritySoldOut|MintCapReached/i.test(blob)) {
    return `${action} failed — pack sold out.`;
  }
  // Generic
  const short = e?.shortMessage || e?.cause?.shortMessage
    || (e?.message ? e.message.split("\n")[0] : "Unknown error");
  return `${action} failed: ${short}`;
}
