// SPDX-License-Identifier: MIT

pragma solidity 0.8.14;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "../Interfaces/IPriceFeed.sol";

interface IWstEth {
	function stEthPerToken() external view returns (uint256 rate);
}

contract WstETHOracle is IOracle {
	/**
	 * Network: Mainnet
	 * Aggregator: stETH/USD
	 */
	AggregatorV3Interface public constant stETH =
		AggregatorV3Interface(0xCfE54B5cD566aB89272946F602D76Ea879CAb4a8);

	IWstEth public constant wstEth = IWstEth(0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0);

	int256 public immutable DECIMAL_ADJUSTMENT;

	constructor() {
		DECIMAL_ADJUSTMENT = int256(10**(stETH.decimals())); // 10 ** 8
	}

	function decimals() external pure override returns (uint8) {
		return 18;
	}

	function description() external pure override returns (string memory) {
		return "wstETH/USD Oracle";
	}

	function version() external pure override returns (uint256) {
		return 1;
	}

	/**
	 * @notice Returns the data for the latest round of this oracle
	 * @return answer the value of the data fetched by this oracle
	 * @return updatedAt the timestamp of the answer
	 */
	function latestAnswer() public view override returns (int256 answer, uint256 updatedAt) {
		int256 stEthAnswer;
		(, stEthAnswer, , updatedAt, ) = stETH.latestRoundData(); // We use the data of the single asset feed
		answer = _getLatestWstEthPrice(stEthAnswer);
	}

	/**
	 * @notice Returns the data mirroring a Chainlink AggregatorV3Interface, need to check for price feed staleness!
	 */
	function latestRoundData()
		external
		view
		override
		returns (
			uint80 roundId,
			int256 answer,
			uint256 startedAt,
			uint256 updatedAt,
			uint80 answeredInRound
		)
	{
		int256 stEthAnswer;
		(roundId, stEthAnswer, startedAt, updatedAt, answeredInRound) = stETH.latestRoundData(); // We use the data of the single asset feed
		answer = _getLatestWstEthPrice(stEthAnswer);
	}

	/**
	 * @dev Returns the price for wstETH in USD normalized to 1e18
	 */
	function _getLatestWstEthPrice(int256 _stEthAnswer)
		internal
		view
		returns (int256 wstEthPrice)
	{
		/** e.g
		 * _stEthAnswer: 187714624539
		 * wstEth.stEthPerToken(): 1131525821102232825
		 * wstEthPrice = 187714624539 * 1131525821102232825 / 1e8 = 2.124e18
		 */
		wstEthPrice = (_stEthAnswer * int256(wstEth.stEthPerToken())) / DECIMAL_ADJUSTMENT;
	}
}

