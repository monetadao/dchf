// SPDX-License-Identifier: MIT

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

pragma solidity ^0.8.14;

interface IPriceFeed {
	struct OracleResponse {
		int256 answer;
		uint256 timestamp;
		uint8 decimals;
	}

	struct RegisterOracle {
		IOracle priceOracle;
		AggregatorV3Interface chainLinkIndex;
		bool isRegistered;
	}

	// --- Events ---
	event LastGoodPriceUpdated(address indexed token, uint256 _lastGoodPrice);
	event LastGoodIndexUpdated(address indexed token, uint256 _lastGoodIndex);
	event RegisteredNewOracle(address token, address oracle, address chainLinkIndex);
	event newIntervalSet(uint256 newInterval, uint256 oldInterval);

	// --- Function ---
	function addOracle(
		address _token,
		address _oracle,
		address _chainlinkIndexOracle
	) external;

	function fetchPrice(address _token) external returns (uint256);

	function getDirectPrice(address _asset) external returns (uint256);
}

interface IOracle {
	function decimals() external view returns (uint8);

	function description() external view returns (string memory);

	function version() external view returns (uint256);

	function latestAnswer() external view returns (int256 answer, uint256 updatedAt);

	function latestRoundData()
		external
		view
		returns (
			uint80 roundId,
			int256 answer,
			uint256 startedAt,
			uint256 updatedAt,
			uint80 answeredInRound
		);
}

