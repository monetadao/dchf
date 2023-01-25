// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

interface IPriceFeed {
	struct OracleResponse {
		int256 answer;
		uint256 timestamp;
		uint8 decimals;
	}

	// --- Events ---
	event RegisteredNewOracle(address token, address oracle);

	// --- Function ---
	function addOracle(
		address _token,
		address _oracle
	) external;

	function fetchPrice(address _token) external returns (uint256);

	function getDirectPrice(address _token) external returns (uint256);
}