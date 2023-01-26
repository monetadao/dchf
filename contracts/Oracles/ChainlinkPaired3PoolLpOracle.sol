// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.14;

import { IERC20 } from "@openzeppelin/contracts/interfaces/IERC20.sol";
import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "../Dependencies/BaseMath.sol";
import "./Chainlink3PoolLpOracle.sol";

interface IGrizzlyVault {
	function pricePerShare() external view returns (uint256);

	function decimals() external view returns (uint8);

	function token() external view returns (address);
}

/// @title ChainlinkOracle
/// @notice An Implementation of the IOracle for single Chainlink feeds.
/// Assumptions: If a Chainlink Aggregator is not working as intended (e.g. calls revert (excl. getRoundData))
/// then the methods `value` will revert as well
contract ChainlinkPaired3PoolLpOracle is Chainlink3PoolLpOracle {
	/// ======== Custom Errors ======== ///

	// any additional checks?

	/// ======== Variables ======== ///

	address public immutable feed;
	uint256 public immutable scale;

	address public immutable lpToken;
	uint256 public immutable lpPrecision;

	address public immutable gvToken;

	// NOTE for immutable params usdc, usdt, etc, would not make sense to explicitly assign the value out of the constructor, too many params!
	/// @param _feed Address of the Chainlink feed
	/// @param _timeout Unique identifier
	constructor(
		address _chfFeed,
		address _usdcFeed,
		address _daiFeed,
		address _usdtFeed,
		address _feed,
		address _pool3Pool,
		address _lpToken,
		address _gvToken,
		uint256 _timeout
	) Chainlink3PoolLpOracle (
		_chfFeed,
		_usdcFeed,
		_daiFeed,
		_usdtFeed,
		_pool3Pool,
		_timeout
		) {
		feed = _feed;
		// TODO: check feed.decimals <= 18 or scale = 0
		scale = DECIMAL_PRECISION / 10**AggregatorV3Interface(_feed).decimals();

		lpToken = _lpToken;
		lpPrecision = 10**(ICurvePool(_lpToken).decimals());

		gvToken = _gvToken;

		assert(IGrizzlyVault(_gvToken).token() == _lpToken); // sanity check in constructor
	}

	/// ======== Chainlink Oracle Implementation ======== ///

	/// @notice Retrieves the latest spot price for a `token` from the corresponding Chainlink feed
	/// @dev Makes minimal sanity checks and reverts if Chainlink returns invalid data
	/// @return value_ Spot price retrieved from the latest round data [DECIMAL_PRECISION]
	function _feedValue()
		internal
		view
		override(Chainlink3PoolLpOracle)
		returns (uint256 value_, uint256 timestamp_)
	{
		// compute robust 3pool value
		uint256 pool3Value = _pool3Value();

		// compute robust 3pool-paired LP oracle value
		(uint256 feedValue, uint256 feedTimestamp) = _fetchAndValidateChainlinkValue(feed, scale);
		uint256 lpValue = min(feedValue, pool3Value);
		value_ = (lpValue * ICurvePool(lpToken).get_virtual_price()) / lpPrecision;

		// value_ =
		// 	(IGrizzlyVault(gvToken).pricePerShare() * lpValueAdjusted) /
		// 	IGrizzlyVault(gvToken).decimals(); // same decimals as lpValue

		timestamp_ = feedTimestamp; // TODO: what do we do here?
	}
}
