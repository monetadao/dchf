// SPDX-License-Identifier: MIT

pragma solidity ^0.8.14;
import "../Interfaces/IDCHFToken.sol";

contract DCHFTokenCaller {
	IDCHFToken DCHF;

	function setDCHF(IDCHFToken _DCHF) external {
		DCHF = _DCHF;
	}

	function DCHFMint(
		address _asset,
		address _account,
		uint256 _amount
	) external {
		DCHF.mint(_asset, _account, _amount);
	}

	function DCHFBurn(address _account, uint256 _amount) external {
		DCHF.burn(_account, _amount);
	}

	function DCHFSendToPool(
		address _sender,
		address _poolAddress,
		uint256 _amount
	) external {
		DCHF.sendToPool(_sender, _poolAddress, _amount);
	}

	function DCHFReturnFromPool(
		address _poolAddress,
		address _receiver,
		uint256 _amount
	) external {
		DCHF.returnFromPool(_poolAddress, _receiver, _amount);
	}
}
