// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

interface ICommunityIssuance {
	// --- Events ---

	event MONTokenAddressSet(address _MONTokenAddress);
	event StabilityPoolAddressSet(address _stabilityPoolAddress);
	event TotalMONIssuedUpdated(address indexed stabilityPool, uint256 _totalMONIssued);

	// --- Functions ---

	function setAddresses(
		address _MONTokenAddress,
		address _stabilityPoolAddress,
		address _adminContract
	) external;

	function issueMON() external returns (uint256);

	function sendMON(address _account, uint256 _MONamount) external;

	function initializeStabilityPool(address _pool, uint256 _assignedSupply) external;

	function initializeStabilityPoolFrom(
		address _pool,
		uint256 _assignedSupply,
		address _spender
	) external;
}
