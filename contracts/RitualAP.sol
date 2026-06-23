// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title  Ritual AP — Arena Point (on-chain ERC-20)
/// @notice The single source of truth for AP balances. AP is **only**
///         ever minted, never pre-minted: `totalSupply` starts at 0 and
///         grows solely via MINTER_ROLE-gated earn actions
///         (Training, Staking, Achievements, future reward contracts).
///
///         Total supply is hard-capped at 21,000,000 AP (21M * 1e18).
///         Once the cap is hit, no further minting is possible — even
///         by a minter.
///
///         AP is the currency used inside the RitualMarketplace for
///         P2P card trading. Marketplace does NOT mint AP — it only
///         transfers existing AP from buyer to seller via `transferFrom`.
contract RitualAP is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    /// @dev 21,000,000 AP with 18 decimals. Hard cap, immutable.
    uint256 public constant MAX_SUPPLY = 21_000_000 * 10 ** 18;

    /// @dev Reverts if a mint would push totalSupply past MAX_SUPPLY.
    error CapExceeded(uint256 requested, uint256 remaining);
    error ZeroAddress();

    event MinterUpdated(address indexed minter, bool enabled);
    event BurnerUpdated(address indexed burner, bool enabled);

    constructor(address admin) ERC20("Ritual Arena Point", "AP") {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        // Admin can also mint + burn for emergency ops.
        _grantRole(MINTER_ROLE, admin);
        _grantRole(BURNER_ROLE, admin);
    }

    // -----------------------------------------------------------------
    // Minter / Burner management
    // -----------------------------------------------------------------

    function setMinter(address minter, bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (minter == address(0)) revert ZeroAddress();
        if (enabled) _grantRole(MINTER_ROLE, minter);
        else _revokeRole(MINTER_ROLE, minter);
        emit MinterUpdated(minter, enabled);
    }

    function setBurner(address burner, bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (burner == address(0)) revert ZeroAddress();
        if (enabled) _grantRole(BURNER_ROLE, burner);
        else _revokeRole(BURNER_ROLE, burner);
        emit BurnerUpdated(burner, enabled);
    }

    // -----------------------------------------------------------------
    // Mint (only minters, never preminted)
    // -----------------------------------------------------------------

    /// @notice Mint `amount` AP to `to`. Only callable by MINTER_ROLE.
    /// @dev    Reverts if `totalSupply + amount > MAX_SUPPLY`. Reason
    ///         string is optional off-chain context (e.g. "training",
    ///         "staking_reward", "achievement_unlock") — kept off the
    ///         event signature to keep the event compact and not bloat
    ///         logs. The minter (e.g. Training contract) is expected to
    ///         emit its own domain-specific event in the same tx.
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) return;
        uint256 supply = totalSupply();
        uint256 remaining = MAX_SUPPLY - supply;
        if (amount > remaining) revert CapExceeded(amount, remaining);
        _mint(to, amount);
    }

    /// @notice Mint `amounts[i]` AP to `tos[i]` in a single tx. Same
    ///         cap and access rules as `mint`. Useful for batch
    ///         achievement unlock flows.
    function mintBatch(address[] calldata tos, uint256[] calldata amounts) external onlyRole(MINTER_ROLE) {
        uint256 n = tos.length;
        require(n == amounts.length, "length mismatch");
        require(n <= 100, "batch too large");
        uint256 supply = totalSupply();
        for (uint256 i = 0; i < n; i++) {
            address to = tos[i];
            uint256 amount = amounts[i];
            if (to == address(0)) revert ZeroAddress();
            if (amount == 0) continue;
            uint256 remaining = MAX_SUPPLY - supply;
            if (amount > remaining) revert CapExceeded(amount, remaining);
            supply += amount;
            _mint(to, amount);
        }
    }

    // -----------------------------------------------------------------
    // Burn
    // -----------------------------------------------------------------

    /// @notice Burn `amount` AP from `from`. Requires BURNER_ROLE.
    ///         Decreases totalSupply. Used by PackManager when a pack
    ///         costs AP (future use) and by admin for clawback.
    function burnFrom(address from, uint256 amount) external onlyRole(BURNER_ROLE) {
        if (from == address(0)) revert ZeroAddress();
        if (amount == 0) return;
        _burn(from, amount);
    }

    // -----------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------

    function remainingSupply() external view returns (uint256) {
        return MAX_SUPPLY - totalSupply();
    }

    function cap() external pure returns (uint256) {
        return MAX_SUPPLY;
    }
}
