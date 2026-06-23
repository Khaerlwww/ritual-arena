// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ICardImprint — minimal read surface for the Card Imprint NFT.
interface ICardImprint {
    function hasMintedImprint(address wallet) external view returns (bool);

    function imprintOfWallet(address wallet) external view returns (uint256);
}
