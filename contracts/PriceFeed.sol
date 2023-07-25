// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./Interfaces/IPriceFeed.sol";

import "./Dependencies/CheckContract.sol";
import "./Dependencies/BaseMath.sol";
import "./Dependencies/DfrancMath.sol";

contract PriceFeed is Ownable, CheckContract, BaseMath, IPriceFeed {
	using SafeMath for uint256;

	string public constant NAME = "PriceFeed";

	// Use to convert a price answer to an 18-digit precision uint
	uint256 public constant TARGET_DIGITS = 18;

	uint256 public constant TIMEOUT = 4 hours;

	// Interval used to query the CHF/USD price
	uint256 public interval = 4 hours;

	bool public isInitialized;

	address public adminContract;

	mapping(address => RegisterOracle) public registeredOracles;

	OracleResponse public lastGoodIndex;

	modifier isController() {
		require(msg.sender == owner() || msg.sender == adminContract, "Invalid Permission");
		_;
	}

	function setAddresses(address _adminContract) external onlyOwner {
		require(!isInitialized, "Already initialized");
		checkContract(_adminContract);
		isInitialized = true;

		adminContract = _adminContract;
	}

	function setAdminContract(address _admin) external onlyOwner {
		require(_admin != address(0), "Admin address is zero");
		checkContract(_admin);
		adminContract = _admin;
	}

	function setIndexInterval(uint256 _interval) external onlyOwner {
		uint256 oldInterval = interval;
		interval = _interval;
		emit newIntervalSet(_interval, oldInterval);
	}

	function addOracle(
		address _token,
		address _priceOracle,
		address _chainlinkIndexOracle
	) external override isController {
		IOracle priceOracle = IOracle(_priceOracle);
		AggregatorV3Interface chainLinkIndex = AggregatorV3Interface(_chainlinkIndexOracle);

		require(
			_priceOracle != address(0) && _chainlinkIndexOracle != address(0),
			"Not valid address"
		);

		registeredOracles[_token] = RegisterOracle(priceOracle, chainLinkIndex, true);

		OracleResponse memory priceOracleResponse = _getCurrentOracleResponse(priceOracle);
		OracleResponse memory chainlinkIndexResponse = _getCurrentChainlinkResponse(
			chainLinkIndex
		);

		require(_badOracleResponse(priceOracleResponse) == false, "Oracle response not valid");
		require(_badOracleResponse(chainlinkIndexResponse) == false, "Index response not valid");

		lastGoodIndex = chainlinkIndexResponse;

		emit RegisteredNewOracle(_token, _priceOracle, _chainlinkIndexOracle);
	}

	function getDirectPrice(address _asset) public view returns (uint256 _priceAssetInDCHF) {
		RegisterOracle memory oracle = registeredOracles[_asset];

		OracleResponse memory oracleResponse = _getCurrentOracleResponse(oracle.priceOracle);

		OracleResponse memory chainlinkIndexResponse = lastGoodIndex;

		if (block.timestamp - chainlinkIndexResponse.timestamp > interval) {
			chainlinkIndexResponse = _getCurrentChainlinkResponse(oracle.chainLinkIndex);
		}

		uint256 scaledOraclePrice = _scalePriceByDigits(
			uint256(oracleResponse.answer),
			oracleResponse.decimals
		);

		uint256 scaledChainlinkIndex = _scalePriceByDigits(
			uint256(chainlinkIndexResponse.answer),
			chainlinkIndexResponse.decimals
		);

		_priceAssetInDCHF = _getIndexedPrice(scaledOraclePrice, scaledChainlinkIndex);
	}

	function fetchPrice(address _token) external override returns (uint256) {
		RegisterOracle storage oracle = registeredOracles[_token];
		require(oracle.isRegistered, "Oracle is not registered");

		OracleResponse memory oracleResponse = _getCurrentOracleResponse(oracle.priceOracle);

		require(_badOracleResponse(oracleResponse) == false, "Oracle response not valid");

		OracleResponse memory chainlinkIndexResponse = lastGoodIndex;

		if (block.timestamp - chainlinkIndexResponse.timestamp > interval) {
			chainlinkIndexResponse = _getCurrentChainlinkResponse(oracle.chainLinkIndex);
			require(_badOracleResponse(chainlinkIndexResponse) == false, "Index response not valid");

			// Update the state variable with a recent valid response
			lastGoodIndex = chainlinkIndexResponse;
		}

		uint256 scaledOraclePrice = _scalePriceByDigits(
			uint256(oracleResponse.answer),
			oracleResponse.decimals
		);

		uint256 scaledChainlinkIndex = _scalePriceByDigits(
			uint256(chainlinkIndexResponse.answer),
			chainlinkIndexResponse.decimals
		);

		return _getIndexedPrice(scaledOraclePrice, scaledChainlinkIndex);
	}

	function _getIndexedPrice(uint256 _price, uint256 _index) internal pure returns (uint256) {
		return (_price * 1 ether) / _index;
	}

	function _badOracleResponse(OracleResponse memory _response) internal view returns (bool) {
		if (_response.timestamp == 0 || _response.timestamp > block.timestamp) return true;

		if (block.timestamp - _response.timestamp > TIMEOUT) return true;

		if (_response.answer <= 0) return true;

		return false;
	}

	// Scale the returned price value down to Dfranc's target precision
	function _scalePriceByDigits(uint256 _price, uint256 _answerDigits)
		internal
		pure
		returns (uint256)
	{
		uint256 price;
		if (_answerDigits >= TARGET_DIGITS) {
			price = _price / (10**(_answerDigits - TARGET_DIGITS));
		} else if (_answerDigits < TARGET_DIGITS) {
			price = _price * (10**(TARGET_DIGITS - _answerDigits));
		}
		return price;
	}

	// --- Oracle response wrapper functions ---

	function _getCurrentOracleResponse(IOracle _priceOracle)
		internal
		view
		returns (OracleResponse memory oracleResponse)
	{
		try _priceOracle.decimals() returns (uint8 decimals) {
			oracleResponse.decimals = decimals;
		} catch {
			return oracleResponse;
		}

		try _priceOracle.latestRoundData() returns (
			uint80, /* roundId */
			int256 answer,
			uint256, /* startedAt */
			uint256 timestamp,
			uint80 /* answeredInRound */
		) {
			oracleResponse.answer = answer;
			oracleResponse.timestamp = timestamp;
			return oracleResponse;
		} catch {
			return oracleResponse;
		}
	}

	function _getCurrentChainlinkResponse(AggregatorV3Interface _priceAggregator)
		internal
		view
		returns (OracleResponse memory chainlinkResponse)
	{
		try _priceAggregator.decimals() returns (uint8 decimals) {
			chainlinkResponse.decimals = decimals;
		} catch {
			return chainlinkResponse;
		}

		try _priceAggregator.latestRoundData() returns (
			uint80, /* roundId */
			int256 answer,
			uint256, /* startedAt */
			uint256 timestamp,
			uint80 /* answeredInRound */
		) {
			chainlinkResponse.answer = answer;
			chainlinkResponse.timestamp = timestamp;
			return chainlinkResponse;
		} catch {
			return chainlinkResponse;
		}
	}
}

