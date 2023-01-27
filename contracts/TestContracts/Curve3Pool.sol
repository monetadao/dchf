// SPDX-License-Identifier: MIT

pragma solidity 0.8.14;

interface ICurvePool {
	function get_virtual_price() external view returns (uint256 price);

	function decimals() external view returns (uint256);
}

contract Curve3Pool is ICurvePool {
	uint256 public price;

	function setVirtualPrice(uint256 _price) external {
		price = _price;
	}

	function get_virtual_price() external pure override returns (uint256 price) {
		return price;
	}

	function decimals() external pure override returns (uint256) {
		return 18;
	}
}
