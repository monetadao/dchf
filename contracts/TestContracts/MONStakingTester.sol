// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import "../MON/MONStaking.sol";

contract MONStakingTester is MONStaking {
	function requireCallerIsTroveManager() external view callerIsTroveManager {}
}
