// SPDX-License-Identifier: MIT
// Minimal mock ERC-721 used by RitualMarketplace tests.
// NOT deployed to any network — test-only helper.
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract MockERC721 is ERC721 {
    uint256 public nextId = 1;
    constructor() ERC721("MockNFT", "MOCK") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }

    function exists(uint256 tokenId) external view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }
}
