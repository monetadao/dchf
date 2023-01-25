// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

interface IPriceFeed {
	// --- Events ---
	event RegisteredNewOracle(address token, address oracle);

	// --- Function ---
	function addOracle(address _token, address _oracle) external;

	function fetchPrice(address _token) external returns (uint256);

	function getDirectPrice(address _token) external returns (uint256);
}
