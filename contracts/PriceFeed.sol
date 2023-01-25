// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./Dependencies/CheckContract.sol";

import "./Interfaces/IPriceFeed.sol";
import "./Interfaces/IOracle.sol";

contract PriceFeed is Ownable, CheckContract, IPriceFeed {
	string public constant NAME = "PriceFeed";

	bool public isInitialized;

	address public adminContract;

	mapping(address => address) public registeredOracles;

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
		checkContract(_admin);
		adminContract = _admin;
	}

	function addOracle(address _token, address _oracle) external override isController {
		IOracle oracle = IOracle(_oracle);

		require(_oracle != address(0), "Not valid address");
		require(oracle.value() != 0, "Not valid oracle");

		registeredOracles[_token] = _oracle;

		emit RegisteredNewOracle(_token, _oracle);
	}

	function getDirectPrice(address _token) public view returns (uint256) {
		return _fetchPrice(_token);
	}

	function fetchPrice(address _token) external view override returns (uint256) {
		return _fetchPrice(_token);
	}

	function _fetchPrice(address _token) private view returns (uint256) {
		return IOracle(registeredOracles[_token]).value();
	}
}
