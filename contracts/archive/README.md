# contracts/archive/

These contracts are **no longer part of the Ritual Arena V5 architecture**.

They were part of the legacy V4 "Card Imprint" system that has been
superseded by the V5 PackManager + RitualPackNFT flow. The live chain
still has these contracts deployed (see `deployments/ritual-1979-v5.json`),
but the V5 frontend does not call them.

## Contents

- `imprint/CardImprint.sol` — legacy secondary-NFT contract. Minted
  `hasMintedImprint(tokenId)` and `mintImprint()`. Replaced by
  RitualPackNFT (V5).
- `interfaces/ICardImprint.sol` — interface for the above.
- `AnthemArenaV3.sol` — superseded by `AnthemArena` (V5).
- `CollectionEdition.sol` — superseded by `PackManager` (V5).

## Do not reference

New code MUST NOT import from this directory. The compile artifacts
under `artifacts/contracts/imprint/...` are stale and will be
rebuilt as orphan artifacts on the next `hardhat compile` — no
production path references them.
