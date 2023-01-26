// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.14;

import { IERC20 } from "@openzeppelin/contracts/interfaces/IERC20.sol";
import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "../Dependencies/BaseMath.sol";
import "../Interfaces/IOracle.sol";

/// @title BaseOracle
/// @notice Abstract base contract for Oracle implementations.
/// @dev Uses Chainlink for the CHF/USD price. Token price (in USD) feeds are implemented by 
/// extending contracts.
abstract contract BaseOracle is IOracle, BaseMath {
	/// ======== Custom Errors ======== ///

	error ChainlinkOracle__value_staleFeed();
	error ChainlinkOracle__value_invalidTimestamp();
	error ChainlinkOracle__value_invalidValue();

	/// ======== Variables ======== ///

	address public immutable chfFeed;
	uint256 public immutable chfScale;
	uint256 public immutable timeout;

	/// @param _chfFeed Address of the Chainlink feed
	/// @param _timeout Unique identifier
	constructor(address _chfFeed, uint256 _timeout) {
		chfFeed = _chfFeed;
		chfScale = DECIMAL_PRECISION / 10**AggregatorV3Interface(_chfFeed).decimals();
		timeout = _timeout;
	}

	/// ======== Oracle Implementation ======== ///

	/// @notice Retrieves the latest spot prices for CHF and the `feed` asset and returns oracle value
	/// @dev Makes minimal sanity checks and reverts if the CHF Chainlink feed returns invalid values
	/// @return value_ Spot price retrieved from the latest round data [DECIMAL_PRECISION]
	function value() external view override(IOracle) returns (uint256 value_) {
		(uint256 _chf, ) = _chfValue();
		(uint256 _feed, ) = _feedValue();
		return (_feed * DECIMAL_PRECISION) / _chf;
	}

	/// @notice Retrieves the latest spot price for a `token` from the corresponding Oracle
	/// @dev Makes minimal sanity checks and reverts if Oracle returns invalid data
	/// @return value_ Spot price retrieved from the Oracle in DECIMAL_PRECISION]
	function feedValue() external view virtual returns (uint256 value_, uint256 timestamp) {
		return _feedValue();
	}

	// To be implemented by the actual Oracle contract
	function _feedValue() internal view virtual returns (uint256 value_, uint256 timestamp);

	/// @notice Retrieves the latest spot price for a `token` from the corresponding Chainlink feed
	/// @dev Makes minimal sanity checks and reverts if Chainlink returns invalid data
	/// @return value_ Spot price retrieved from the latest round data [DECIMAL_PRECISION]
	function chfValue() external view returns (uint256 value_, uint256 timestamp) {
		return _chfValue();
	}

	// Fetches the current CHF/USD price
	function _chfValue() private view returns (uint256 value_, uint256 timestamp_) {
		// fetch last chainlink price
		(value_, timestamp_) = _fetchAndValidateChainlinkValue(chfFeed, chfScale);
	}

	// Fetches an up-to-date valid price from a Chainlink feed _feed
	function _fetchAndValidateChainlinkValue(
		address _feed,
		uint256 _scale
	) internal view returns (uint256 value_, uint256 timestamp_) {
		(, int256 roundValue, , uint256 roundTimestamp, ) = AggregatorV3Interface(_feed)
			.latestRoundData();

		// sanity checks
		if (roundTimestamp > block.timestamp) revert ChainlinkOracle__value_invalidTimestamp();
		if ((block.timestamp - roundTimestamp) > timeout)
			revert ChainlinkOracle__value_staleFeed();
		if (roundValue <= 0) revert ChainlinkOracle__value_invalidValue();

		// scale to DECIMAL_PRECISION
		value_ = uint256(roundValue) * _scale;

		// also return timestamp
		timestamp_ = roundTimestamp;
	}
}
