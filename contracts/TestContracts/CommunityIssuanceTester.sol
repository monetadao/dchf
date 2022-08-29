/*// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;
import "../MON/CommunityIssuance.sol";

contract CommunityIssuanceTester is CommunityIssuance {
	using SafeMathUpgradeable for uint256;

	function obtainMON(uint256 _amount) external {
		monToken.transfer(msg.sender, _amount);
	}

	function getLastUpdateTokenDistribution(address stabilityPool)
		external
		view
		returns (uint256)
	{
		return _getLastUpdateTokenDistribution(stabilityPool);
	}

	function unprotectedIssueMON(address stabilityPool) external returns (uint256) {
		return _issueMON(stabilityPool);
	}
}*/
