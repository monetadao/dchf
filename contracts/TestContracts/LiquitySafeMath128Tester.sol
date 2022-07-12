// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;
import "../Dependencies/DfrancSafeMath128.sol";

/* Tester contract for math functions in DfrancSafeMath128.sol library. */

contract DfrancSafeMath128Tester {
	using DfrancSafeMath128 for uint128;

	function add(uint128 a, uint128 b) external pure returns (uint128) {
		return a.add(b);
	}

	function sub(uint128 a, uint128 b) external pure returns (uint128) {
		return a.sub(b);
	}
}
