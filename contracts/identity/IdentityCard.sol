// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice IdentityRegistry push channel for Collection Score + card-snapshot
///         updates. IdentityCard is a trusted updater for both functions.
interface IIdentityRegistry {
    function updateCollection(address wallet, uint256 collectionScore) external;
    /// @notice Mirrors IdentityCard.cardSnapshots[wallet] into the registry so
    ///         the leaderboard displays the same Power / Grade as the profile.
    function updateCardSnapshot(
        address wallet,
        uint16 currentPower,
        uint8 currentRarity
    ) external;
}

/// @notice Minimal interface untuk RitualTraining membaca stats dari AnthemArena.
interface IRitualArenaStats {
    struct DailyStreak {
        uint64 totalCheckIns;
    }
    struct Player {
        uint256 wins;
        uint256 totalBattles;
        uint256 winStreak;
        uint256 bestWinStreak;
    }
    function dailyStreaks(address wallet) external view returns (DailyStreak memory);
    function players(address wallet) external view returns (Player memory);
}

/// @title Ritual Anthem (Non-Transferable)
/// @notice Turns an onchain wallet identity into a non-transferable anthem NFT.
///         The token is a standard ERC-721 (so wallets/explorers recognise it)
///         but is non-transferable: once minted it is permanently bound to the
///         minting wallet. Each card stores a CardSnapshot with power (1-100)
///         and rarity derived from pre-mint on-chain activity.
///         Two mint paths are supported:
///           1. Self-mint: any wallet mints/updates its own anthem directly.
///           2. Oracle path: an AI oracle fulfills a requested anthem.
contract RitualAnthem is ERC721URIStorage {
    string public metadataBaseURI;

    event MetadataBaseURIUpdated(string uri);
    struct Anthem {
        uint256 tokenId;
        address wallet;
        string  xHandle;
        string  mood;
        string  lyrics;
        string  musicPrompt;
        string  audioURI;
        string  metadataURI;
        uint256 createdAt;
        // V5-added fields
        uint16  initialPower;
        uint8   initialRarity;
        uint32  version;
        bytes32 sourceHash;
        uint64  updatedAt;
        uint8   generation;
        bool    locked;
    }

    /// @notice Card snapshot — immutable forge-time record + mutable refresh state.
    ///         Stores power and rarity on-chain so frontend and contract
    ///         share the same source of truth.
    /// @dev    Power and rarity values are derived from on-chain activity.
    struct CardSnapshot {
        uint256 tokenId;
        uint16  initialPower;       // power at forge time (1-100; 0 = invalid)
        uint16  currentPower;       // latest power (1-100; 0 = invalid/no-snapshot)
        uint8   initialRarity;      // rarity rank at forge time (0-4)
        uint8   currentRarity;      // latest rarity rank (0-4)
        bytes32 initialSourceHash;  // hash of forge-time on-chain data
        bytes32 currentSourceHash;  // hash of latest refreshed data
        uint64  forgedAt;           // mint timestamp
        uint64  lastRefreshed;      // last refresh timestamp
        uint8   snapshotVersion;    // 0 = no snapshot, 1 = current
        // V5-added aliases
        uint32  version;
        uint64  updatedAt;
    }

    struct Request {
        address wallet;
        address requester;
        bool fulfilled;
    }

    // ── Rarity rank enum ───────────────────────────────────────────────────
    // 0 = Common, 1 = Rare, 2 = Epic, 3 = Legendary, 4 = Mythic

    uint8 internal constant RARITY_COMMON    = 0;
    uint8 internal constant RARITY_RARE      = 1;
    uint8 internal constant RARITY_EPIC      = 2;
    uint8 internal constant RARITY_LEGENDARY = 3;
    uint8 internal constant RARITY_MYTHIC    = 4;

    address public immutable aiOracle;
    address public verifier; // Authorized signer for power attestation EIP-712 signatures
    uint256 public nextRequestId = 1;
    uint256 public nextTokenId = 1;
    uint256 public totalAnthems;

    // --- Mint fee (paid on a *new* self-mint; updates are free) ---
    address public owner;
    address public pendingOwner;
    address public feeRecipient;
    uint256 public mintFee;

    mapping(uint256 => Request) public requests;
    mapping(address => Anthem) private anthemsByWallet;
    mapping(uint256 => address) private tokenWallet;
    mapping(bytes32 => bool) public handleUsed;
    mapping(address => CardSnapshot) private cardSnapshots;

    // Nonce tracking for replay protection
    mapping(address => mapping(uint256 => bool)) public usedNonces;

    // --- Trusted updaters (untuk auto-evolve dari RitualTraining) ---
    mapping(address => bool) public trustedUpdaters;

    // V5 storage aliases (so V5 clients keep working)
    mapping(address => bool)    public hasMinted;
    mapping(address => uint256) public tokenOf;

    // --- IdentityRegistry (push Collection Score on every change) ---
    IIdentityRegistry public identityRegistry;

    event TrustedUpdaterSet(address indexed updater, bool trusted);
    event SnapshotAutoEvolved(
        uint256 indexed tokenId,
        address indexed wallet,
        uint16 oldPower,
        uint16 newPower,
        uint8 oldRarity,
        uint8 newRarity
    );

    event AnthemRequested(uint256 indexed requestId, address indexed wallet, address indexed requester);
    event AnthemFulfilled(uint256 indexed requestId, address indexed wallet, uint256 indexed tokenId);
    event AnthemMinted(uint256 indexed tokenId, address indexed wallet, string mood, string xHandle, uint16 initialPower, uint8 initialRarity);
    event AnthemUpdated(uint256 indexed tokenId, address indexed wallet, string mood, string xHandle);
    event MetadataUpdated(uint256 indexed tokenId, address indexed wallet, string metadataURI);
    event SnapshotRefreshed(uint256 indexed tokenId, address indexed wallet, uint16 newPower, uint8 newRarity, uint8 snapshotVersion);
    event MintFeePaid(address indexed payer, address indexed recipient, uint256 amount);
    event MintFeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event OwnershipTransferStarted(address indexed prev, address indexed next);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event VerifierUpdated(address indexed oldVerifier, address indexed newVerifier);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    /// @param oracle_       AI oracle address (defaults to deployer when zero).
    /// @param feeRecipient_ Address that receives the mint fee (defaults to deployer when zero).
    /// @param mintFee_      Fee charged for each new anthem, in wei (e.g. 0.0001 ether).
    constructor(address oracle_, address feeRecipient_, uint256 mintFee_) ERC721("Ritual Arena Anthem Card", "RAAC") {
        aiOracle = oracle_ == address(0) ? msg.sender : oracle_;
        owner = msg.sender;
        feeRecipient = feeRecipient_ == address(0) ? msg.sender : feeRecipient_;
        mintFee = mintFee_;
        verifier = msg.sender; // default verifier = deployer
    }

    // --------------------------------------------------------------------
    // Verifier management
    // --------------------------------------------------------------------

    function setVerifier(address newVerifier) external onlyOwner {
        require(newVerifier != address(0), "zero verifier");
        emit VerifierUpdated(verifier, newVerifier);
        verifier = newVerifier;
    }

    /// @notice Owner sets the metadata base URI for dynamic tokenURI generation.
    ///         Token URIs are constructed as: metadataBaseURI + tokenId
    function setMetadataBaseURI(string calldata uri) external onlyOwner {
        metadataBaseURI = uri;
        emit MetadataBaseURIUpdated(uri);
    }

    /// @notice Owner sets/unsets a trusted updater (e.g. RitualTraining contract).
    function setTrustedUpdater(address updater, bool trusted) external onlyOwner {
        require(updater != address(0), "zero updater");
        trustedUpdaters[updater] = trusted;
        emit TrustedUpdaterSet(updater, trusted);
    }

    /// @notice Owner sets the IdentityRegistry that this contract pushes the
    ///         Collection Score to. Set once and never unset — required for
    ///         the leaderboard to auto-update on every forge / snapshot change.
    function setIdentityRegistry(address registry) external onlyOwner {
        require(registry != address(0), "zero");
        identityRegistry = IIdentityRegistry(registry);
    }

    /// @notice Called by a trusted updater (RitualTraining) after each train().
    ///         Updates currentPower and currentRarity if new values are higher.
    ///         Never decreases power or rarity — both are monotonically increasing.
    /// @param wallet   The wallet whose card to evolve.
    /// @param newPower Newly calculated power score (1-100).
    function autoEvolveSnapshot(address wallet, uint16 newPower) external {
        require(trustedUpdaters[msg.sender], "not trusted updater");
        require(wallet != address(0), "zero wallet");
        require(newPower >= 1 && newPower <= 100, "power out of range");

        CardSnapshot storage snap = cardSnapshots[wallet];
        require(snap.snapshotVersion >= 1, "no snapshot");

        uint16 oldPower = snap.currentPower;
        uint8 oldRarity = snap.currentRarity;

        // Only update if power actually increased
        if (newPower <= oldPower) return;

        uint8 newRarity = _rarityFromPower(newPower);
        // Rarity never decreases (milestone permanent)
        if (newRarity < oldRarity) newRarity = oldRarity;

        snap.currentPower = newPower;
        snap.currentRarity = newRarity;
        snap.lastRefreshed = uint64(block.timestamp);
        // V5 aliases
        snap.updatedAt = uint64(block.timestamp);
        unchecked { snap.version += 1; }

        emit SnapshotAutoEvolved(snap.tokenId, wallet, oldPower, newPower, oldRarity, newRarity);

        // Push the new Collection Score to the canonical IdentityRegistry
        // so the leaderboard updates automatically on every power change.
        if (address(identityRegistry) != address(0)) {
            identityRegistry.updateCollection(wallet, _calcCollectionScore(wallet));
            // Mirror the evolved power/rarity so the leaderboard's
            // currentPower / currentRarity fields match the on-chain
            // CardSnapshot. Without this, the leaderboard would always
            // show Power 0 even after training.
            identityRegistry.updateCardSnapshot(wallet, newPower, newRarity);
        }
    }

    /// @notice Compute Collection Score (max 100) from on-chain state:
    ///         - currentPower contribution:  max 60  (power * 0.6)
    ///         - currentRarity contribution: max 30  (rarity * 7.5)
    ///         - cardCount contribution:      max 10  (capped at 10 cards)
    ///         Total caps at MAX_COLLECTION_SCORE = 100. V5 PackManager is
    ///         the primary source of collectionScore (NFT count based).
    ///         IdentityCard's _calcCollectionScore is kept for the legacy
    ///         forge/evolve path and stays within the same 0..100 range.
    function _calcCollectionScore(address wallet) internal view returns (uint256) {
        CardSnapshot storage snap = cardSnapshots[wallet];
        uint256 powerComponent = snap.snapshotVersion == 0
            ? 0
            : uint256(snap.currentPower) * 6 / 10;
        if (powerComponent > 60) powerComponent = 60;

        uint256 rarityComponent = snap.snapshotVersion == 0
            ? 0
            : uint256(snap.currentRarity) * 75 / 10;
        if (rarityComponent > 30) rarityComponent = 30;

        uint256 cardCount = balanceOf(wallet);
        uint256 countComponent = cardCount; // 1 per card, max 10
        if (countComponent > 10) countComponent = 10;

        uint256 raw = powerComponent + rarityComponent + countComponent;
        return raw > 100 ? 100 : raw;
    }

    /// @notice Push the current Collection Score for a wallet to the
    ///         IdentityRegistry. Safe to call when no IdentityRegistry
    ///         is configured (no-op).
    function _pushCollectionScore(address wallet) internal {
        if (address(identityRegistry) == address(0)) return;
        identityRegistry.updateCollection(wallet, _calcCollectionScore(wallet));
    }

    // --------------------------------------------------------------------
    // EIP-712 signature verification helpers
    // --------------------------------------------------------------------

    /// @dev Returns the EIP-712 domain separator for attestation signatures.
    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("RitualAnthem")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    /// @dev Hash for forge attestation: wallet, handle, chainId, contractAddress, expiry, nonce
    ///      Power/rarity are NOT part of forge attestation — they start at 1/COMMON.
    function hashForgeAttestation(
        address wallet,
        string calldata xHandle,
        uint256 chainId,
        address contractAddress,
        uint256 expiry,
        uint256 nonce
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("ForgeAttestation(address wallet,string xHandle,uint256 chainId,address contractAddress,uint256 expiry,uint256 nonce)"),
                wallet,
                keccak256(bytes(xHandle)),
                chainId,
                contractAddress,
                expiry,
                nonce
            )
        );
    }

    /// @dev Hash for refresh attestation: wallet, tokenId, newPower, newRarity, sourceHash, chainId, contractAddress, expiry, nonce
    function hashRefreshAttestation(
        address wallet,
        uint256 tokenId,
        uint16 newPower,
        uint8 newRarity,
        uint256 chainId,
        address contractAddress,
        uint256 expiry,
        uint256 nonce
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("RefreshAttestation(address wallet,uint256 tokenId,uint16 newPower,uint8 newRarity,uint256 chainId,address contractAddress,uint256 expiry,uint256 nonce)"),
                wallet,
                tokenId,
                newPower,
                newRarity,
                chainId,
                contractAddress,
                expiry,
                nonce
            )
        );
    }

    /// @dev Verify signature and check expiry + nonce
    function _verifyAttestation(
        bytes32 hash,
        bytes calldata signature,
        uint256 expiry,
        uint256 nonce,
        address wallet
    ) internal {
        require(block.timestamp <= expiry, "signature expired");
        require(!usedNonces[wallet][nonce], "nonce already used");

        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19\x01", domainSeparator(), hash)
        );
        address signer = ECDSA.recover(ethSignedHash, signature);
        require(signer == verifier, "invalid signature");

        usedNonces[wallet][nonce] = true;
    }

    // ---------------------------------------------------------------------
    // V5 simple mint (used by V5 tests + V5-only callers)
    // ---------------------------------------------------------------------
    /// @notice V5 self-mint: no forge, no signature, fixed power=1/COMMON.
    ///         tokenId is deterministic from the wallet address.
    function mintAnthem() external payable returns (uint256 tokenId) {
        require(anthemsByWallet[msg.sender].tokenId == 0, "wallet already minted");
        require(msg.value >= mintFee, "insufficient fee");

        tokenId = uint256(uint160(msg.sender));
        totalAnthems += 1;
        tokenWallet[tokenId] = msg.sender;
        _storeAnthem(msg.sender, tokenId, "", "", "", "", "", "");
        _mint(msg.sender, tokenId);
        _setTokenURI(tokenId, "");

        // V5 storage aliases
        hasMinted[msg.sender] = true;
        tokenOf[msg.sender] = tokenId;

        // Card snapshot
        cardSnapshots[msg.sender] = CardSnapshot({
            tokenId:            tokenId,
            initialPower:       1,
            currentPower:       1,
            initialRarity:      0,
            currentRarity:      0,
            initialSourceHash:  bytes32(0),
            currentSourceHash:  bytes32(0),
            forgedAt:           uint64(block.timestamp),
            lastRefreshed:      uint64(block.timestamp),
            snapshotVersion:    1,
            version:            1,
            updatedAt:          uint64(block.timestamp)
        });

        if (address(identityRegistry) != address(0)) {
            identityRegistry.updateCardSnapshot(msg.sender, 1, 0);
        }

        _settleFee(mintFee);
        emit AnthemMinted(tokenId, msg.sender, "", "", 1, 0);
    }

    // ---------------------------------------------------------------------
    // Self-mint path (frontend, no backend)
    // ---------------------------------------------------------------------

    /// @notice Mint your own anthem. Requires a valid verifier attestation signature.
    ///         Power always starts at 1 (COMMON) and evolves through Training/Arena.
    /// @param xHandle    X/Twitter handle
    /// @param mood       Card mood
    /// @param lyrics     Card lyrics
    /// @param musicPrompt Music generation prompt
    /// @param audioURI   Audio URI
    /// @param metadataURI Metadata URI
    /// @param expiry     Attestation expiry timestamp
    /// @param nonce      Unique nonce for replay protection
    /// @param signature  EIP-712 signature from authorized verifier
    function mintAnthem(
        string calldata xHandle,
        string calldata mood,
        string calldata lyrics,
        string calldata musicPrompt,
        string calldata audioURI,
        string calldata metadataURI,
        uint256 expiry,
        uint256 nonce,
        bytes calldata signature
    ) external payable returns (uint256 tokenId) {
        require(bytes(lyrics).length > 0, "empty lyrics");
        require(bytes(musicPrompt).length > 0, "empty prompt");
        require(anthemsByWallet[msg.sender].tokenId == 0, "wallet already minted");

        // Verify forge attestation signature (no power/rarity — fixed at 1/COMMON)
        bytes32 hash = hashForgeAttestation(
            msg.sender, xHandle,
            block.chainid, address(this), expiry, nonce
        );
        _verifyAttestation(hash, signature, expiry, nonce, msg.sender);

        require(msg.value >= mintFee, "insufficient fee");

        // Fixed initial power/rarity — card starts simple, evolves through activity
        uint16 initialPower = 1;
        uint8  initialRarity = RARITY_COMMON;

        tokenId = _mintAnthem(msg.sender, xHandle, mood, lyrics, musicPrompt, audioURI, metadataURI, initialPower, initialRarity);
        emit AnthemMinted(tokenId, msg.sender, mood, xHandle, initialPower, initialRarity);
        _settleFee(mintFee);
    }

    // ---------------------------------------------------------------------
    // Oracle path (AI-native narrative)
    // ---------------------------------------------------------------------

    function requestAnthem(address wallet) external returns (uint256 requestId) {
        require(wallet != address(0), "zero wallet");
        requestId = nextRequestId++;
        requests[requestId] = Request({ wallet: wallet, requester: msg.sender, fulfilled: false });
        emit AnthemRequested(requestId, wallet, msg.sender);
    }

    function fulfillAnthem(
        uint256 requestId,
        string calldata xHandle,
        string calldata mood,
        string calldata lyrics,
        string calldata musicPrompt,
        string calldata audioURI,
        string calldata metadataURI,
        uint16 initialPower,
        uint8  initialRarity,
        bytes32 sourceHash
    ) external returns (uint256 tokenId) {
        require(msg.sender == aiOracle, "not oracle");
        Request storage request = requests[requestId];
        require(request.wallet != address(0), "unknown request");
        require(!request.fulfilled, "fulfilled");
        require(bytes(lyrics).length > 0, "empty lyrics");
        require(bytes(musicPrompt).length > 0, "empty prompt");
        require(bytes(audioURI).length > 0, "empty audio");
        require(anthemsByWallet[request.wallet].tokenId == 0, "anthem exists");

        request.fulfilled = true;

        // Oracle path also uses fixed initial power/rarity
        uint16 initialPower = 1;
        uint8  initialRarity = RARITY_COMMON;

        tokenId = _mintAnthem(request.wallet, xHandle, mood, lyrics, musicPrompt, audioURI, metadataURI, initialPower, initialRarity);
        emit AnthemFulfilled(requestId, request.wallet, tokenId);
    }

    // ---------------------------------------------------------------------
    // Internal mint + storage
    // ---------------------------------------------------------------------

    function _mintAnthem(
        address wallet,
        string memory xHandle,
        string memory mood,
        string memory lyrics,
        string memory musicPrompt,
        string memory audioURI,
        string memory metadataURI,
        uint16 initialPower,
        uint8  initialRarity
    ) private returns (uint256 tokenId) {
        // Claim the X handle (case-insensitive) so it can't be reused.
        if (bytes(xHandle).length > 0) {
            bytes32 key = _handleKey(xHandle);
            require(!handleUsed[key], "handle already used");
            handleUsed[key] = true;
        }
        tokenId = nextTokenId++;
        totalAnthems += 1;
        tokenWallet[tokenId] = wallet;
        _storeAnthem(wallet, tokenId, xHandle, mood, lyrics, musicPrompt, audioURI, metadataURI);
        _mint(wallet, tokenId);
        _setTokenURI(tokenId, metadataURI);

        // V5 storage aliases
        hasMinted[wallet] = true;
        tokenOf[wallet] = tokenId;

        // Store card snapshot on forge — sourceHash is zero (no scan)
        cardSnapshots[wallet] = CardSnapshot({
            tokenId:            tokenId,
            initialPower:       initialPower,
            currentPower:       initialPower,
            initialRarity:      initialRarity,
            currentRarity:      initialRarity,
            initialSourceHash:  bytes32(0),
            currentSourceHash:  bytes32(0),
            forgedAt:           uint64(block.timestamp),
            lastRefreshed:      uint64(block.timestamp),
            snapshotVersion:    1,
            version:            1,
            updatedAt:          uint64(block.timestamp)
        });

        // Push the new Collection Score to the canonical IdentityRegistry
        // so the leaderboard updates automatically on every forge.
        _pushCollectionScore(wallet);
        // Mirror the initial card power/rarity into the registry so the
        // leaderboard displays Power 1 / COMMON on the very first read
        // (without this, the registry's currentPower stays at 0 until the
        // first training tx, even though the card has been forged).
        if (address(identityRegistry) != address(0)) {
            identityRegistry.updateCardSnapshot(wallet, initialPower, initialRarity);
        }
    }

    /// @dev Lower-cases ASCII A-Z and hashes, so "Niraj" and "niraj" collide.
    function _handleKey(string memory handle) private pure returns (bytes32) {
        bytes memory b = bytes(handle); // calldata -> memory copy
        for (uint256 i = 0; i < b.length; i++) {
            uint8 c = uint8(b[i]);
            if (c >= 65 && c <= 90) b[i] = bytes1(c + 32);
        }
        return keccak256(b);
    }

    /// @dev Writes anthem fields directly to storage to avoid stack-too-deep.
    function _storeAnthem(
        address wallet,
        uint256 tokenId,
        string memory xHandle,
        string memory mood,
        string memory lyrics,
        string memory musicPrompt,
        string memory audioURI,
        string memory metadataURI
    ) private {
        Anthem storage a = anthemsByWallet[wallet];
        a.tokenId = tokenId;
        a.wallet = wallet;
        a.xHandle = xHandle;
        a.mood = mood;
        a.lyrics = lyrics;
        a.musicPrompt = musicPrompt;
        a.audioURI = audioURI;
        a.metadataURI = metadataURI;
        a.createdAt = block.timestamp;
        // V5-added fields
        a.initialPower = 1;
        a.initialRarity = 0;
        a.version = 1;
        a.sourceHash = keccak256(bytes(metadataURI));
        a.updatedAt = uint64(block.timestamp);
        a.generation = 0;
        a.locked = false;
    }

    /// @dev Forwards `requiredFee` to the recipient and refunds any excess to the payer.
    ///      Follows checks-effects-interactions: callers mutate state before calling this.
    function _settleFee(uint256 requiredFee) private {
        if (requiredFee > 0 && feeRecipient != address(0)) {
            (bool sent, ) = payable(feeRecipient).call{value: requiredFee}("");
            require(sent, "fee transfer failed");
            emit MintFeePaid(msg.sender, feeRecipient, requiredFee);
        }
        uint256 excess = msg.value - requiredFee;
        if (excess > 0) {
            (bool refunded, ) = payable(msg.sender).call{value: excess}("");
            require(refunded, "refund failed");
        }
    }

    // ---------------------------------------------------------------------
    // Internal snapshot helpers
    // ---------------------------------------------------------------------

    /// @dev Rarity thresholds tuned for 14-day campaign (active user = ~90 power = MYTHIC).
    ///      COMMON    1-19
    ///      RARE     20-39
    ///      EPIC     40-65
    ///      LEGENDARY 66-79
    ///      MYTHIC   80-100
    function _rarityFromPower(uint16 power) private pure returns (uint8) {
        if (power == 0)  return RARITY_COMMON;
        if (power >= 80) return RARITY_MYTHIC;
        if (power >= 66) return RARITY_LEGENDARY;
        if (power >= 40) return RARITY_EPIC;
        if (power >= 20) return RARITY_RARE;
        return RARITY_COMMON;
    }

    // ---------------------------------------------------------------------
    // Refresh card metadata (metadata-only, no power/rarity changes)
    // ---------------------------------------------------------------------

    /// @notice Update card metadata URI. Does NOT modify power or rarity.
    ///         Power/rarity evolution is exclusively handled by autoEvolveSnapshot().
    /// @param newTokenURI  New metadata URI (must be non-empty)
    function updateCardMetadata(string calldata newTokenURI) external {
        CardSnapshot storage snap = cardSnapshots[msg.sender];
        require(snap.tokenId != 0, "no snapshot");
        require(snap.snapshotVersion >= 1, "snapshot not initialized");
        require(bytes(newTokenURI).length > 0, "empty uri");

        snap.lastRefreshed = uint64(block.timestamp);
        snap.updatedAt = uint64(block.timestamp);  // V5 alias
        _setTokenURI(snap.tokenId, newTokenURI);
        anthemsByWallet[msg.sender].metadataURI = newTokenURI;

        emit MetadataBaseURIUpdated(snap.tokenId, msg.sender, newTokenURI);
    }

    event MetadataBaseURIUpdated(uint256 indexed tokenId, address indexed wallet, string newTokenURI);

    // ---------------------------------------------------------------------
    // Snapshot getters
    // ---------------------------------------------------------------------

    /// @notice Get the full card snapshot for a wallet.
    ///         For cards without a snapshot (snapshotVersion = 0), returns tokenId = 0
    ///         and all other fields as zero — a clear "no snapshot" signal.
    ///         Power 0 means invalid/no-snapshot; valid power range is 1-100.
    function getCardSnapshot(address wallet) external view returns (CardSnapshot memory) {
        return cardSnapshots[wallet];
    }

    /// @notice Get the current power (1-100) from CardSnapshot. Returns 0 if no snapshot.
    function getCurrentPower(address wallet) external view returns (uint16) {
        return cardSnapshots[wallet].currentPower;
    }

    /// @notice Get the current rarity rank (0-4) from CardSnapshot. Returns 0 if no snapshot.
    function getCurrentRarity(address wallet) external view returns (uint8) {
        return cardSnapshots[wallet].currentRarity;
    }

    /// @notice Get the initial power at forge time. Returns 0 if no snapshot.
    function getInitialPower(address wallet) external view returns (uint16) {
        return cardSnapshots[wallet].initialPower;
    }

    /// @notice Get the initial rarity at forge time. Returns 0 if no snapshot.
    function getInitialRarity(address wallet) external view returns (uint8) {
        return cardSnapshots[wallet].initialRarity;
    }

    /// @notice Check if a wallet has a valid CardSnapshot (snapshotVersion > 0).
    ///         Returns false for wallets without a card or snapshot.
    ///         Arena uses this to reject wallets without valid power data.
    function hasCardSnapshot(address wallet) external view returns (bool) {
        return cardSnapshots[wallet].snapshotVersion >= 1;
    }

    // ---------------------------------------------------------------------
    // Admin (fee configuration)
    // ---------------------------------------------------------------------

    function setMintFee(uint256 newFee) external onlyOwner {
        emit MintFeeUpdated(mintFee, newFee);
        mintFee = newFee;
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        require(newRecipient != address(0), "zero recipient");
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero owner");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Refresh card metadata without changing the non-transferable identity.
    /// @dev Allows holders to update their card metadata URI.
    function updateMetadata(string calldata metadataURI, string calldata audioURI) external {
        Anthem storage a = anthemsByWallet[msg.sender];
        require(a.tokenId != 0, "no anthem");
        require(bytes(metadataURI).length > 0, "empty metadata");

        a.metadataURI = metadataURI;
        a.audioURI = audioURI;
        _setTokenURI(a.tokenId, metadataURI);

        emit MetadataUpdated(a.tokenId, msg.sender, metadataURI);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "not pending owner");
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    // ---------------------------------------------------------------------
    // Non-Transferable enforcement
    // ---------------------------------------------------------------------

    /// @dev Allow minting (from == 0) and burning (to == 0), block transfers.
    ///      This makes every anthem permanently bound to its minter.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        require(from == address(0) || to == address(0), "non-transferable");
        return super._update(to, tokenId, auth);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getAnthem(address wallet) external view returns (Anthem memory) {
        return anthemsByWallet[wallet];
    }

    function hasAnthem(address wallet) external view returns (bool) {
        return anthemsByWallet[wallet].tokenId != 0;
    }

    /// @notice True if an X handle has already been claimed (case-insensitive).
    function isHandleTaken(string calldata xHandle) external view returns (bool) {
        if (bytes(xHandle).length == 0) return false;
        return handleUsed[_handleKey(xHandle)];
    }

    /// @notice Batch-read minted anthems for the gallery.
    /// @param startId first tokenId (1-based; 0 is treated as 1)
    /// @param maxCount maximum number of anthems to return
    function getAnthems(uint256 startId, uint256 maxCount) external view returns (Anthem[] memory list) {
        if (startId == 0) startId = 1;
        uint256 last = nextTokenId - 1;
        if (startId > last || maxCount == 0) {
            return new Anthem[](0);
        }
        uint256 end = startId + maxCount - 1;
        if (end > last) end = last;
        uint256 count = end - startId + 1;
        list = new Anthem[](count);
        for (uint256 i = 0; i < count; i++) {
            list[i] = anthemsByWallet[tokenWallet[startId + i]];
        }
    }

    /// @notice V5-style no-arg overload — returns the full anthem list.
    function getAnthems() external view returns (Anthem[] memory list) {
        uint256 last = nextTokenId - 1;
        if (last == 0) return new Anthem[](0);
        list = new Anthem[](last);
        for (uint256 i = 0; i < last; i++) {
            list[i] = anthemsByWallet[tokenWallet[i + 1]];
        }
    }

    // ---------------------------------------------------------------------
    // Anthem Streak & Legacy
    // ── Weekly check-in ──────────────────────────────────────────────────
    //
    // A weekly check-in for anthem holders. Checking in roughly once per
    // week (with a +/- 2 day grace window) keeps a streak alive. Streaks
    // unlock permanent badges that never downgrade. Pure on-chain logic —
    // no oracle or external feed required.

    struct StreakData {
        uint256 streakCount;    // consecutive weekly check-ins
        uint256 lastCheckIn;    // timestamp of the most recent check-in
        uint256 longestStreak;  // best streak ever reached
        uint256 totalCheckIns;  // lifetime check-ins
    }

    // Check-in cadence: ~weekly, with a +/- 2 day grace window.
    uint256 public constant CHECK_IN_MIN = 5 days; // earliest a check-in is accepted
    uint256 public constant CHECK_IN_MAX = 9 days; // latest before the streak resets

    mapping(address => StreakData) private streakData;
    // Highest badge tier unlocked per wallet (sticky: never decreases).
    mapping(address => uint8) public badgeLevel;

    event CheckIn(address indexed wallet, uint256 streakCount, uint256 timestamp);
    event BadgeUnlocked(address indexed wallet, uint8 level, string badgeName);

    /// @notice Weekly check-in for anthem holders. Counts when called between
    ///         day 5 and day 9 since the last check-in (extending the streak);
    ///         calling later resets the streak, with this check-in starting a
    ///         fresh streak of 1.
    /// @dev    Only wallets that already minted an anthem can check in.
    function checkIn() external {
        require(anthemsByWallet[msg.sender].tokenId != 0, "no anthem");

        StreakData storage s = streakData[msg.sender];
        if (s.lastCheckIn == 0) {
            // First-ever check-in starts the streak.
            s.streakCount = 1;
        } else {
            uint256 elapsed = block.timestamp - s.lastCheckIn;
            require(elapsed >= CHECK_IN_MIN, "check-in too early");
            if (elapsed <= CHECK_IN_MAX) {
                // On time: extend the streak.
                s.streakCount += 1;
            } else {
                // Missed the window: reset, counting this check-in as streak 1.
                s.streakCount = 1;
            }
        }

        s.lastCheckIn = block.timestamp;
        s.totalCheckIns += 1;
        if (s.streakCount > s.longestStreak) {
            s.longestStreak = s.streakCount;
        }

        emit CheckIn(msg.sender, s.streakCount, block.timestamp);
        _updateBadge(msg.sender, s.streakCount);
    }

    /// @dev Promotes the wallet's badge when a streak milestone is reached.
    ///      Badges are sticky — they never downgrade when a streak resets.
    function _updateBadge(address wallet, uint256 streakCount) private {
        uint8 newLevel;
        if (streakCount >= 15) newLevel = 3;
        else if (streakCount >= 7) newLevel = 2;
        else if (streakCount >= 3) newLevel = 1;

        if (newLevel > badgeLevel[wallet]) {
            badgeLevel[wallet] = newLevel;
            emit BadgeUnlocked(wallet, newLevel, _badgeName(newLevel));
        }
    }

    /// @dev Human-readable badge name for a given level.
    function _badgeName(uint8 level) private pure returns (string memory) {
        if (level == 3) return "Ritual OG";
        if (level == 2) return "Diamond Hands";
        if (level == 1) return "Consistent";
        return "None";
    }

    // ----- Streak views -----

    function getStreakData(address wallet) external view returns (StreakData memory) {
        return streakData[wallet];
    }

    /// @notice Pure helper: power level (1-100) → rarity tier (0-4)
    function rarityForPower(uint16 power) external pure returns (uint8) {
        if (power >= 91) return 4; // MYTHIC
        if (power >= 71) return 3; // LEGENDARY
        if (power >= 41) return 2; // EPIC
        if (power >= 21) return 1; // RARE
        return 0;                 // COMMON
    }

    function getBadgeLevel(address wallet) external view returns (uint8) {
        return badgeLevel[wallet];
    }

    function getBadgeName(address wallet) external view returns (string memory) {
        return _badgeName(badgeLevel[wallet]);
    }

    /// @notice True when `wallet` may check in right now and keep its streak
    ///         (between day 5 and day 9 since the last check-in). A holder that
    ///         has never checked in is always considered in-window.
    function isCheckInWindow(address wallet) external view returns (bool) {
        if (anthemsByWallet[wallet].tokenId == 0) return false;
        StreakData storage s = streakData[wallet];
        if (s.lastCheckIn == 0) return true;
        uint256 elapsed = block.timestamp - s.lastCheckIn;
        return elapsed >= CHECK_IN_MIN && elapsed <= CHECK_IN_MAX;
    }

    // ---------------------------------------------------------------------
    // Daily Identity Check-In  ->  Rarity Upgrade Path
    // ---------------------------------------------------------------------
    //
    // A *daily* ritual (distinct from the weekly checkIn above): checking in
    // roughly once a day grows a daily streak, and that streak becomes a real,
    // on-chain rarity modifier (see rarityBoost). This gives holders a concrete
    // reason to return every day - the longer the streak, the higher the
    // effective rarity tier their card can reach. Pure onchain logic, no oracle.

    struct DailyStreakData {
        uint256 streak;        // consecutive daily check-ins
        uint256 lastCheckIn;   // timestamp of the most recent daily check-in
        uint256 longestStreak; // best daily streak ever reached
        uint256 totalCheckIns; // lifetime daily check-ins
    }

    // Daily cadence with a forgiving window: at least ~a day apart (anti-spam),
    // at most 2 days before the streak lapses.
    uint256 public constant DAILY_MIN = 20 hours; // earliest a new daily check-in counts
    uint256 public constant DAILY_MAX = 48 hours; // miss this and the daily streak resets

    mapping(address => DailyStreakData) private dailyStreaks;

    event DailyCheckIn(address indexed wallet, uint256 streak, uint256 rarityBoost, uint256 timestamp);

    /// @notice Daily check-in for anthem holders. Accepted at most once per ~day
    ///         (>= DAILY_MIN since the last one); within DAILY_MAX it extends the
    ///         streak, later it resets to 1. Anti-spam: reverts if called again
    ///         before DAILY_MIN elapses.
    /// @return streak the wallet's new daily streak count.
    function dailyCheckIn() external returns (uint256 streak) {
        require(anthemsByWallet[msg.sender].tokenId != 0, "no anthem");

        DailyStreakData storage d = dailyStreaks[msg.sender];
        if (d.lastCheckIn == 0) {
            // First-ever daily check-in starts the streak.
            d.streak = 1;
        } else {
            uint256 elapsed = block.timestamp - d.lastCheckIn;
            require(elapsed >= DAILY_MIN, "already checked in today");
            if (elapsed <= DAILY_MAX) {
                d.streak += 1; // on time: extend
            } else {
                d.streak = 1; // missed a day: reset, this counts as streak 1
            }
        }

        d.lastCheckIn = block.timestamp;
        d.totalCheckIns += 1;
        if (d.streak > d.longestStreak) {
            d.longestStreak = d.streak;
        }

        streak = d.streak;
        emit DailyCheckIn(msg.sender, streak, _rarityBoost(streak), block.timestamp);
    }

    // ----- Daily streak + rarity-boost views -----

    function getDailyStreak(address wallet) external view returns (DailyStreakData memory) {
        return dailyStreaks[wallet];
    }

    /// @notice True when `wallet` can do its daily check-in right now (a holder,
    ///         and >= DAILY_MIN since its last check-in; a holder that never
    ///         checked in is always eligible).
    function isDailyCheckInWindow(address wallet) external view returns (bool) {
        if (anthemsByWallet[wallet].tokenId == 0) return false;
        DailyStreakData storage d = dailyStreaks[wallet];
        if (d.lastCheckIn == 0) return true;
        return block.timestamp - d.lastCheckIn >= DAILY_MIN;
    }

    /// @notice On-chain rarity score bonus earned from the wallet's *current*
    ///         daily streak. The frontend rarity engine mirrors this exact curve
    ///         and adds it to the wallet's base power score, so the effective tier
    ///         is consistent and verifiable. Capped (+40) and applied off-chain so
    ///         the top tiers (MYTHIC/GENESIS) stay reserved for base score / mint
    ///         order, never auto-granted by streak alone.
    function rarityBoost(address wallet) external view returns (uint256) {
        return _rarityBoost(dailyStreaks[wallet].streak);
    }

    /// @dev Milestone boost curve, shared with the off-chain rarity engine.
    function _rarityBoost(uint256 streak) private pure returns (uint256) {
        if (streak >= 30) return 40;
        if (streak >= 14) return 25;
        if (streak >= 7) return 15;
        if (streak >= 3) return 8;
        return 0;
    }

    // ---------------------------------------------------------------------
    // Genesis early-mint tier
    // ---------------------------------------------------------------------
    //
    // The first GENESIS_SUPPLY anthems ever minted (token #1..#GENESIS_SUPPLY)
    // are the Genesis tier — the highest, collector-exclusive rarity. This is a
    // pure early-mint condition decided by mint order (tokenId), so it is
    // tamper-proof and verifiable on-chain. Every other rarity tier is derived
    // off-chain from the wallet's deterministic power score.

    uint256 public constant GENESIS_SUPPLY = 10;

    /// @notice True when a (1-based) tokenId belongs to the Genesis tier.
    function isGenesisToken(uint256 tokenId) public pure returns (bool) {
        return tokenId >= 1 && tokenId <= GENESIS_SUPPLY;
    }

    /// @notice True when `wallet`'s minted anthem is a Genesis token.
    function isGenesisWallet(address wallet) external view returns (bool) {
        return isGenesisToken(anthemsByWallet[wallet].tokenId);
    }

    /// @notice How many Genesis tokens have been minted so far (capped at supply).
    function genesisMinted() public view returns (uint256) {
        uint256 minted = nextTokenId - 1;
        return minted > GENESIS_SUPPLY ? GENESIS_SUPPLY : minted;
    }

    /// @notice Remaining Genesis slots; the next mint is Genesis while this is > 0.
    function genesisRemaining() external view returns (uint256) {
        return GENESIS_SUPPLY - genesisMinted();
    }

    // ---------------------------------------------------------------------
    // Dynamic TokenURI
    // ---------------------------------------------------------------------

    /// @notice Returns the token URI for a given tokenId.
    ///         Format: metadataBaseURI + tokenId
    ///         The metadata endpoint is responsible for generating dynamic
    ///         JSON with currentPower/currentRarity from CardSnapshot.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "token does not exist");
        return string(abi.encodePacked(metadataBaseURI, _toString(tokenId)));
    }

    /// @dev Convert uint256 to string (Solidity ^0.8.24).
    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        uint256 ptr = digits;
        temp = value;
        while (temp != 0) {
            unchecked {
                ptr--;
            }
            buffer[ptr] = bytes1(uint8(48 + temp % 10));
            temp /= 10;
        }
        return string(buffer);
    }
}
