// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

interface IOracle {
	function value() external view returns (uint256 value);

	function feedValue() external view returns (uint256 value, uint256 timestamp);

	function chfValue() external view returns (uint256 value, uint256 timestamp);
}
