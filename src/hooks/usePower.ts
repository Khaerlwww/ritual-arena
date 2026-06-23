import { useEffect, useState } from "react";
import { isAddress, type Address } from "viem";
import { fetchAnthemEvolutionInput } from "./useAnthem";
import type { EvolutionInput, XData } from "../lib/powerEngine";
import { calcEvolutionPower } from "../lib/powerEngine";

type PowerState = {
  onchainData?: EvolutionInput;
  xData?: XData;
  power: number;
  isLoading: boolean;
  error?: string;
};

/**
 * Hook for reading evolved power from on-chain CardSnapshot.
 * Used by Training/Arena UI to display current power.
 */
export function usePower(wallet?: Address, xHandle?: string): PowerState {
  const [state, setState] = useState<PowerState>({ isLoading: false, power: 0 });

  useEffect(() => {
    if (!wallet || !isAddress(wallet)) {
      setState({ isLoading: false, power: 0 });
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, isLoading: true, error: undefined }));

    (async () => {
      try {
        const input = await fetchAnthemEvolutionInput(wallet);
        if (cancelled) return;
        const power = calcEvolutionPower(input);
        setState({
          onchainData: input,
          power,
          isLoading: false,
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          isLoading: false,
          power: 0,
          error: err instanceof Error ? err.message : "Unable to read card power.",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [wallet, xHandle]);

  return state;
}
