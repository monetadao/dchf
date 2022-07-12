// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;
import "../Dependencies/CheckContract.sol";
import "../Interfaces/IMONStaking.sol";

contract MONStakingScript is CheckContract {
	IMONStaking immutable monStaking;

	constructor(address _MONStakingAddress) {
		checkContract(_MONStakingAddress);
		monStaking = IMONStaking(_MONStakingAddress);
	}

	function stake(uint256 _MONamount) external {
		monStaking.stake(_MONamount);
	}
}
