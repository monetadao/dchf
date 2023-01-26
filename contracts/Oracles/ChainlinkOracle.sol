// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.14;

import { IERC20 } from "@openzeppelin/contracts/interfaces/IERC20.sol";
import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "../Dependencies/BaseMath.sol";
import "./BaseOracle.sol";

/// @title ChainlinkOracle
/// @notice An Implementation of the IOracle for single Chainlink feeds
/// @dev Reverts if any of the Chainlink feeds, CHF/USD or [token]/USD, does not return a valid value.
contract ChainlinkOracle is BaseOracle {
	/// ======== Custom Errors ======== ///

	// TODO: need any additional checks?

	/// ======== Variables ======== ///

	address public immutable feed;
	uint256 public immutable scale;

	/// @param _feed Address of the Chainlink feed
	/// @param _timeout Unique identifier
	constructor(
		address _chfFeed,
		address _feed,
		uint256 _timeout
	) BaseOracle(_chfFeed, _timeout) {
		feed = _feed;
		// TODO: check feed.decimals <= 18 or scale = 0
		scale = DECIMAL_PRECISION / 10**AggregatorV3Interface(_feed).decimals();
	}

	/// ======== Chainlink Oracle Implementation ======== ///

	/// @notice Retrieves the latest spot price for a `token` from the corresponding Chainlink feed
	/// @dev Makes minimal sanity checks and reverts if Chainlink returns invalid data
	/// @return value_ Spot price retrieved from the latest round data [DECIMAL_PRECISION]
	function _feedValue()
		internal
		view
		override(BaseOracle)
		returns (uint256 value_, uint256 timestamp_)
	{
		// fetch last chainlink price feed e.g ETH / BTC
		(value_, timestamp_) = _fetchAndValidateChainlinkValue(feed, scale);
	}
}
