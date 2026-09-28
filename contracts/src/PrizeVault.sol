// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Daybreak Island prize vault
/// @notice Holds the real-stock prize pool. The game server never holds funds:
/// it signs a single-use, expiring voucher, and anyone may submit it here to pay
/// the named winner. The vault enforces its own limits, so a leaked signing key
/// can cost at most one day's cap per token before the guardian pauses it.
/// Anyone can top the pool up (e.g. the token-fee flywheel) with `fund`.
contract PrizeVault is EIP712, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    bytes32 public constant VOUCHER_TYPEHASH =
        keccak256("Voucher(address to,address token,uint256 amount,uint256 id,uint64 expiry)");

    struct Voucher {
        address to;
        address token;
        uint256 amount;
        uint256 id;
        uint64 expiry;
    }

    /// @notice Key the game server signs vouchers with.
    address public signer;
    /// @notice How many prizes one wallet may collect per UTC day.
    uint256 public walletClaimsPerDay;
    /// @notice Most of each token paid out per UTC day. Zero means the token is not a prize.
    mapping(address token => uint256) public dailyCap;
    mapping(address token => mapping(uint256 day => uint256)) public paidOn;
    mapping(address wallet => mapping(uint256 day => uint256)) public claimsOn;
    /// @notice Voucher ids already collected or revoked.
    mapping(uint256 id => bool) public used;

    event Claimed(uint256 indexed id, address indexed to, address indexed token, uint256 amount);
    event Funded(address indexed from, address indexed token, uint256 amount);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);
    event Revoked(uint256 indexed id);
    event SignerChanged(address signer);
    event DailyCapSet(address indexed token, uint256 cap);
    event WalletClaimsPerDaySet(uint256 limit);

    error Expired();
    error AlreadyUsed();
    error BadSignature();
    error TokenNotAllowed();
    error DailyCapReached();
    error WalletLimitReached();
    error ZeroAddress();

    constructor(address admin, address guardian, address signer_, uint256 walletClaimsPerDay_)
        EIP712("DaybreakIslandPrizes", "1")
    {
        if (admin == address(0) || guardian == address(0) || signer_ == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GUARDIAN_ROLE, guardian);
        signer = signer_;
        walletClaimsPerDay = walletClaimsPerDay_;
        emit SignerChanged(signer_);
        emit WalletClaimsPerDaySet(walletClaimsPerDay_);
    }

    /// @notice Current UTC day number; caps reset when it changes.
    function today() public view returns (uint256) {
        return block.timestamp / 1 days;
    }

    /// @notice EIP-712 digest the game server signs for a voucher.
    function voucherDigest(Voucher calldata v) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(VOUCHER_TYPEHASH, v.to, v.token, v.amount, v.id, v.expiry)));
    }

    /// @notice Pay a voucher to its winner. Callable by anyone (the winner, an
    /// agent, or a relayer); the prize always goes to `v.to`.
    function claim(Voucher calldata v, bytes calldata sig) external nonReentrant whenNotPaused {
        if (block.timestamp > v.expiry) revert Expired();
        if (used[v.id]) revert AlreadyUsed();
        if (ECDSA.recover(voucherDigest(v), sig) != signer) revert BadSignature();
        uint256 cap = dailyCap[v.token];
        if (cap == 0) revert TokenNotAllowed();
        uint256 day = today();
        if (paidOn[v.token][day] + v.amount > cap) revert DailyCapReached();
        if (claimsOn[v.to][day] >= walletClaimsPerDay) revert WalletLimitReached();

        used[v.id] = true;
        paidOn[v.token][day] += v.amount;
        claimsOn[v.to][day] += 1;
        IERC20(v.token).safeTransfer(v.to, v.amount);
        emit Claimed(v.id, v.to, v.token, v.amount);
    }

    /// @notice Add tokens to the prize pool. Open to anyone (flywheel, sponsors).
    function fund(address token, uint256 amount) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, token, amount);
    }

    // ------------------------------------------------------------------ guardian

    /// @notice Stop all collections at once (suspected key leak or bug).
    function pause() external {
        if (!hasRole(GUARDIAN_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, GUARDIAN_ROLE);
        }
        _pause();
    }

    /// @notice Cancel a voucher that must not be paid (e.g. issued by mistake).
    function revoke(uint256 id) external {
        if (!hasRole(GUARDIAN_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, GUARDIAN_ROLE);
        }
        used[id] = true;
        emit Revoked(id);
    }

    // --------------------------------------------------------------------- admin

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function setSigner(address signer_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (signer_ == address(0)) revert ZeroAddress();
        signer = signer_;
        emit SignerChanged(signer_);
    }

    function setDailyCap(address token, uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        dailyCap[token] = cap;
        emit DailyCapSet(token, cap);
    }

    function setWalletClaimsPerDay(uint256 limit) external onlyRole(DEFAULT_ADMIN_ROLE) {
        walletClaimsPerDay = limit;
        emit WalletClaimsPerDaySet(limit);
    }

    function withdraw(address token, address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(token, to, amount);
    }
}
