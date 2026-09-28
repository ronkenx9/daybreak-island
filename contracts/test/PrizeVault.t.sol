// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {PrizeVault} from "../src/PrizeVault.sol";

contract Stock is ERC20 {
    constructor() ERC20("Tesla", "TSLA") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract PrizeVaultTest is Test {
    PrizeVault vault;
    Stock tsla;
    Stock amzn;
    address admin = makeAddr("admin");
    address guardian = makeAddr("guardian");
    uint256 signerKey = 0xA11CE;
    address signer;
    address winner = makeAddr("winner");
    uint256 constant ONE = 1e18;

    function setUp() public {
        vm.warp(1_760_000_000);
        signer = vm.addr(signerKey);
        vault = new PrizeVault(admin, guardian, signer, 1);
        tsla = new Stock();
        amzn = new Stock();
        tsla.mint(address(vault), 100 * ONE);
        vm.prank(admin);
        vault.setDailyCap(address(tsla), 5 * ONE);
    }

    function voucher(address to, address token, uint256 amount, uint256 id) internal view returns (PrizeVault.Voucher memory) {
        return PrizeVault.Voucher(to, token, amount, id, uint64(block.timestamp + 1 days));
    }

    function sign(PrizeVault.Voucher memory v, uint256 key) internal view returns (bytes memory) {
        (uint8 r, bytes32 s1, bytes32 s2) = vm.sign(key, vault.voucherDigest(v));
        return abi.encodePacked(s1, s2, r);
    }

    // ------------------------------------------------------------ happy path

    function test_validVoucherPaysWinner() public {
        PrizeVault.Voucher memory v = voucher(winner, address(tsla), ONE, 1);
        vm.prank(makeAddr("relayer")); // anyone may submit; the prize goes to v.to
        vault.claim(v, sign(v, signerKey));
        assertEq(tsla.balanceOf(winner), ONE);
        assertTrue(vault.used(1));
        assertEq(vault.paidOn(address(tsla), vault.today()), ONE);
    }

    function test_anyoneCanFund() public {
        address flywheel = makeAddr("flywheel");
        tsla.mint(flywheel, 3 * ONE);
        vm.startPrank(flywheel);
        tsla.approve(address(vault), 3 * ONE);
        vault.fund(address(tsla), 3 * ONE);
        vm.stopPrank();
        assertEq(tsla.balanceOf(address(vault)), 103 * ONE);
    }

    function test_capsResetNextDay() public {
        vm.prank(admin);
        vault.setDailyCap(address(tsla), ONE);
        PrizeVault.Voucher memory a = voucher(winner, address(tsla), ONE, 1);
        vault.claim(a, sign(a, signerKey));
        vm.warp(block.timestamp + 1 days);
        PrizeVault.Voucher memory b = voucher(winner, address(tsla), ONE, 2);
        vault.claim(b, sign(b, signerKey));
        assertEq(tsla.balanceOf(winner), 2 * ONE);
    }

    // ------------------------------------------------------------ rejections

    function test_replayReverts() public {
        PrizeVault.Voucher memory v = voucher(winner, address(tsla), ONE, 1);
        bytes memory sig = sign(v, signerKey);
        vault.claim(v, sig);
        vm.warp(block.timestamp + 1 days); // even on a new day
        vm.expectRevert(PrizeVault.AlreadyUsed.selector);
        vault.claim(v, sig);
    }

    function test_expiredReverts() public {
        PrizeVault.Voucher memory v = voucher(winner, address(tsla), ONE, 1);
        bytes memory sig = sign(v, signerKey);
        vm.warp(v.expiry + 1);
        vm.expectRevert(PrizeVault.Expired.selector);
        vault.claim(v, sig);
    }

    function test_wrongSignerReverts() public {
        PrizeVault.Voucher memory v = voucher(winner, address(tsla), ONE, 1);
        bytes memory sig = sign(v, 0xBAD);
        vm.expectRevert(PrizeVault.BadSignature.selector);
        vault.claim(v, sig);
    }

    function test_tamperedVoucherReverts() public {
        PrizeVault.Voucher memory v = voucher(winner, address(tsla), ONE, 1);
        bytes memory sig = sign(v, signerKey);
        v.amount = 5 * ONE; // attacker edits the amount
        vm.expectRevert(PrizeVault.BadSignature.selector);
        vault.claim(v, sig);
        v.amount = ONE;
        v.to = makeAddr("thief"); // or the recipient
        vm.expectRevert(PrizeVault.BadSignature.selector);
        vault.claim(v, sig);
    }

    function test_wrongChainReverts() public {
        PrizeVault.Voucher memory v = voucher(winner, address(tsla), ONE, 1);
        bytes memory sig = sign(v, signerKey); // signed for this chain id
        vm.chainId(1);
        vm.expectRevert(PrizeVault.BadSignature.selector);
        vault.claim(v, sig);
    }

    function test_otherVaultCannotReuseSignature() public {
        PrizeVault other = new PrizeVault(admin, guardian, signer, 1);
        tsla.mint(address(other), 10 * ONE);
        vm.prank(admin);
        other.setDailyCap(address(tsla), 5 * ONE);
        PrizeVault.Voucher memory v = voucher(winner, address(tsla), ONE, 1);
        bytes memory sig = sign(v, signerKey);
        vm.expectRevert(PrizeVault.BadSignature.selector);
        other.claim(v, sig);
    }

    function test_dailyCapReverts() public {
        vm.prank(admin);
        vault.setWalletClaimsPerDay(100);
        for (uint256 i = 1; i <= 5; i++) {
            PrizeVault.Voucher memory ok = voucher(makeAddr(vm.toString(i)), address(tsla), ONE, i);
            vault.claim(ok, sign(ok, signerKey));
        }
        PrizeVault.Voucher memory v = voucher(winner, address(tsla), ONE, 6);
        bytes memory sig = sign(v, signerKey);
        vm.expectRevert(PrizeVault.DailyCapReached.selector);
        vault.claim(v, sig);
    }

    function test_walletLimitReverts() public {
        PrizeVault.Voucher memory a = voucher(winner, address(tsla), ONE, 1);
        vault.claim(a, sign(a, signerKey));
        PrizeVault.Voucher memory b = voucher(winner, address(tsla), ONE, 2);
        bytes memory sig = sign(b, signerKey);
        vm.expectRevert(PrizeVault.WalletLimitReached.selector);
        vault.claim(b, sig);
    }

    function test_unlistedTokenReverts() public {
        amzn.mint(address(vault), 10 * ONE);
        PrizeVault.Voucher memory v = voucher(winner, address(amzn), ONE, 1);
        bytes memory sig = sign(v, signerKey);
        vm.expectRevert(PrizeVault.TokenNotAllowed.selector);
        vault.claim(v, sig);
    }

    function test_pausedReverts_andGuardianCanRevoke() public {
        PrizeVault.Voucher memory v = voucher(winner, address(tsla), ONE, 1);
        bytes memory sig = sign(v, signerKey);
        vm.prank(guardian);
        vault.pause();
        vm.expectRevert(); // EnforcedPause
        vault.claim(v, sig);
        vm.prank(guardian);
        vm.expectRevert(); // guardian cannot unpause
        vault.unpause();
        vm.prank(admin);
        vault.unpause();
        vm.prank(guardian);
        vault.revoke(1);
        vm.expectRevert(PrizeVault.AlreadyUsed.selector);
        vault.claim(v, sig);
    }

    function test_onlyAdminCanChangeSettingsOrWithdraw() public {
        address rando = makeAddr("rando");
        vm.startPrank(rando);
        vm.expectRevert();
        vault.withdraw(address(tsla), rando, ONE);
        vm.expectRevert();
        vault.setSigner(rando);
        vm.expectRevert();
        vault.setDailyCap(address(tsla), 1000 * ONE);
        vm.expectRevert();
        vault.setWalletClaimsPerDay(1000);
        vm.expectRevert();
        vault.pause();
        vm.expectRevert();
        vault.revoke(7);
        vm.stopPrank();
        vm.prank(guardian);
        vm.expectRevert(); // guardian can stop things, not move money
        vault.withdraw(address(tsla), guardian, ONE);
        vm.prank(admin);
        vault.withdraw(address(tsla), admin, ONE);
        assertEq(tsla.balanceOf(admin), ONE);
    }

    function test_rotatedSignerInvalidatesOldKey() public {
        PrizeVault.Voucher memory v = voucher(winner, address(tsla), ONE, 1);
        bytes memory sig = sign(v, signerKey);
        vm.prank(admin);
        vault.setSigner(vm.addr(0xC0FFEE));
        vm.expectRevert(PrizeVault.BadSignature.selector);
        vault.claim(v, sig);
    }

    // ------------------------------------------------------------ fuzz

    /// Any key other than the signer can never pay out.
    function testFuzz_randomKeysNeverPay(uint256 key, uint256 amount, uint256 id) public {
        key = bound(key, 1, 115792089237316195423570985008687907852837564279074904382605163141518161494336);
        vm.assume(key != signerKey);
        amount = bound(amount, 1, 5 * ONE);
        PrizeVault.Voucher memory v = voucher(winner, address(tsla), amount, id);
        bytes memory sig = sign(v, key);
        vm.expectRevert(PrizeVault.BadSignature.selector);
        vault.claim(v, sig);
    }

    /// Whatever the amounts, one day's payouts never exceed the cap.
    function testFuzz_dailyCapHolds(uint256[8] memory amounts) public {
        vm.prank(admin);
        vault.setWalletClaimsPerDay(100);
        uint256 cap = vault.dailyCap(address(tsla));
        for (uint256 i = 0; i < amounts.length; i++) {
            uint256 a = bound(amounts[i], 1, 3 * ONE);
            PrizeVault.Voucher memory v = voucher(makeAddr(vm.toString(i)), address(tsla), a, i + 1);
            bytes memory sig = sign(v, signerKey);
            uint256 before = vault.paidOn(address(tsla), vault.today());
            if (before + a > cap) {
                vm.expectRevert(PrizeVault.DailyCapReached.selector);
                vault.claim(v, sig);
            } else {
                vault.claim(v, sig);
            }
            assertLe(vault.paidOn(address(tsla), vault.today()), cap);
        }
    }
}
