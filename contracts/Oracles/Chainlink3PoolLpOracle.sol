// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.14;

import { IERC20 } from "@openzeppelin/contracts/interfaces/IERC20.sol";
import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "../Dependencies/BaseMath.sol";
import "./BaseOracle.sol";

interface ICurvePool {
	function get_virtual_price() external view returns (uint256 price);

	function decimals() external view returns (uint256);
}

/// @title ChainlinkOracle
/// @notice An Implementation of the IOracle for single Chainlink feeds.
/// Assumptions: If a Chainlink Aggregator is not working as intended (e.g. calls revert (excl. getRoundData))
/// then the methods `value` will revert as well
contract Chainlink3PoolLpOracle is BaseOracle {
	/// ======== Custom Errors ======== ///

	// any additional checks?

	/// ======== Variables ======== ///

	address public immutable usdcFeed;
	uint256 public immutable usdcScale;

	address public immutable daiFeed;
	uint256 public immutable daiScale;

	address public immutable usdtFeed;
	uint256 public immutable usdtScale;

	address public immutable pool3Pool;
	uint256 public immutable pool3Precision;

	//address public immutable gvToken;

	// NOTE for immutable params usdc, usdt, etc, would not make sense to explicitly assign the value out of the constructor, too many params!
	/// @param _chfFeed Address of the Chainlink feed
	/// @param _timeout Unique identifier
	constructor(
		address _chfFeed,
		address _usdcFeed,
		address _daiFeed,
		address _usdtFeed,
		address _pool3Pool,
		uint256 _timeout
	) BaseOracle(_chfFeed, _timeout) {
		usdcFeed = _usdcFeed;
		// TODO: check feed.decimals <= 18 or scale = 0
		usdcScale = DECIMAL_PRECISION / 10**AggregatorV3Interface(_usdcFeed).decimals();

		daiFeed = _daiFeed;
		daiScale = DECIMAL_PRECISION / 10**AggregatorV3Interface(_daiFeed).decimals();

		usdtFeed = _usdtFeed;
		usdtScale = DECIMAL_PRECISION / 10**AggregatorV3Interface(_usdtFeed).decimals();

		pool3Pool = _pool3Pool;
		pool3Precision = 10**18; // precision used in 3pool-Pool
	}

	/// ======== Chainlink Oracle Implementation ======== ///

	/// @notice Retrieves the latest spot price for a `token` from the corresponding Chainlink feed
	/// @dev Makes minimal sanity checks and reverts if Chainlink returns invalid data
	/// @return value_ Spot price retrieved from the latest round data [DECIMAL_PRECISION]
	function _feedValue()
		internal
		view
		virtual
		override(BaseOracle)
		returns (uint256 value_, uint256 timestamp_)
	{
		// compute robust 3pool value
		value_ = _pool3Value();
		timestamp_ = block.timestamp; // TODO: what to do here?
	}

	// Returns the 3pool value
	function _pool3Value()
		internal
		view
		returns (uint256 value_) 
	{
		(uint256 usdcValue, ) = _fetchAndValidateChainlinkValue(usdcFeed, usdcScale);
		(uint256 daiValue, ) = _fetchAndValidateChainlinkValue(daiFeed, daiScale);
		(uint256 usdtValue, ) = _fetchAndValidateChainlinkValue(usdtFeed, usdtScale);
		uint256 pool3Value = min(usdcValue, min(daiValue, usdtValue));
		value_ = 
			(pool3Value * ICurvePool(pool3Pool).get_virtual_price()) / pool3Precision;

	}

	// Returns the smallest of two numbers
	function min(uint256 a, uint256 b) internal pure returns (uint256) {
		return a < b ? a : b;
	}
}
