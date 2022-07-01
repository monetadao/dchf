// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;
import "../VSTA/VSTAStaking.sol";

contract VSTAStakingTester is VSTAStaking {
	function requireCallerIsTroveManager() external view callerIsTroveManager {}
}
